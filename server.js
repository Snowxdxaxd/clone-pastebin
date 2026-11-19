// «Сниппет» — обмен фрагментами кода (клон Pastebin/Gist).
// Node 24 ESM, без сборки. Порт: process.env.PORT || 3019.
import { createApp, json, bytes, notFound, badRequest } from './lib/http.mjs';
import { migrate, db, uid } from './lib/db.mjs';
import { ensureAuthTables, loginByName, logout, currentUser } from './lib/auth.mjs';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const PORT = process.env.PORT || 3019;
const MAX_CONTENT = 500 * 1024; // 500 КБ

// Время жизни: строка expiry -> смещение в мс. never/burn — без expires_at.
const EXPIRY_MS = { '10m': 600000, '1h': 3600000, '1d': 86400000, '1w': 604800000 };
const EXPIRY_LABELS = {
  '10m': '10 минут', '1h': '1 час', '1d': '1 день', '1w': '1 неделя',
  'never': 'никогда', 'burn': 'сгорает после прочтения',
};

// Языки — список из подсветки (public/vendor/highlight.min.js, common-сборка).
const LANGS = [
  'auto', 'bash', 'c', 'cpp', 'csharp', 'css', 'diff', 'go', 'graphql', 'ini',
  'java', 'javascript', 'json', 'kotlin', 'less', 'lua', 'makefile', 'markdown',
  'objectivec', 'perl', 'php', 'php-template', 'plaintext', 'python', 'python-repl',
  'r', 'ruby', 'rust', 'scss', 'shell', 'sql', 'swift', 'typescript', 'vbnet',
  'wasm', 'xml', 'yaml',
];

migrate([
  {
    id: '001-snippets',
    sql: `
      create table if not exists users (
        id text primary key,
        name text not null,
        created integer not null
      );
      create table if not exists snippets (
        id text primary key,
        title text not null,
        content text not null,
        language text not null default 'auto',
        expiry text not null default 'never',
        password_hash text,
        password_salt text,
        views integer not null default 0,
        parent_id text,
        version integer not null default 1,
        created integer not null,
        expires_at integer,
        author_id text,
        author_name text
      );
      create table if not exists versions (
        snippet_id text not null,
        version integer not null,
        title text not null,
        content text not null,
        created integer not null,
        primary key (snippet_id, version)
      );
      create index if not exists idx_snippets_created on snippets(created desc);
      create index if not exists idx_snippets_expires on snippets(expires_at);
    `,
  },
]);
ensureAuthTables(db);

// ---------- Пароли: scrypt, случайная соль на сниппет ----------

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(row, password) {
  if (!row.password_hash || !row.password_salt) return false;
  const candidate = scryptSync(String(password), row.password_salt, 64);
  const stored = Buffer.from(row.password_hash, 'hex');
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

// ---------- Сроки и удаление ----------

function isExpired(row) {
  return row.expires_at !== null && row.expires_at !== undefined && row.expires_at < Date.now();
}

function deleteSnippetDeep(id) {
  db.prepare('delete from snippets where id = ?').run(id);
  db.prepare('delete from versions where snippet_id = ?').run(id);
}

// Чтение строки с ленивой проверкой TTL (meta и производные).
function getLiveSnippet(id) {
  const row = db.prepare('select * from snippets where id = ?').get(id);
  if (!row) return null;
  if (isExpired(row)) {
    deleteSnippetDeep(id);
    return null;
  }
  return row;
}

// Полное чтение контента: ленивый TTL, пароль, views++, burn (транзакция select+delete).
function readForContent(id, password) {
  const row = db.transaction(() => {
    const r = db.prepare('select * from snippets where id = ?').get(id);
    if (!r) return null;
    if (isExpired(r)) {
      deleteSnippetDeep(id);
      return null;
    }
    return r;
  })();
  if (!row) return { status: 404, body: { error: 'not_found' } };
  if (row.password_hash) {
    if (password === undefined || password === null) {
      return { status: 401, body: { need_password: true } };
    }
    if (!verifyPassword(row, password)) {
      return { status: 403, body: { error: 'wrong_password' } };
    }
  }
  if (row.expiry === 'burn') {
    db.transaction(() => deleteSnippetDeep(id))();
    return { row, burned: true };
  }
  db.prepare('update snippets set views = views + 1 where id = ?').run(id);
  row.views += 1;
  return { row };
}

// ---------- Сериализация ----------

function metaOf(row) {
  return {
    id: row.id,
    title: row.title,
    language: row.language,
    expiry: row.expiry,
    views: row.views,
    parent_id: row.parent_id,
    version: row.version,
    created: row.created,
    expires_at: row.expires_at ?? null,
    size: Buffer.byteLength(row.content, 'utf8'),
    need_password: !!row.password_hash,
    burn: row.expiry === 'burn',
    author_name: row.author_name ?? null,
  };
}

function contentOf(row) {
  return { ...metaOf(row), content: row.content };
}

function passwordFromQuery(ctx) {
  const p = ctx.query.get('password');
  return p === null ? undefined : p;
}

// ---------- Приложение ----------

const app = createApp({ publicDir: 'public', spa: true });

// --- сессии (для подписи «создал» и форков) ---
app.post('/api/login', (ctx) => {
  const user = loginByName(db, ctx.res, ctx.body.name);
  if (!user) return badRequest(ctx.res, 'need_name');
  json(ctx.res, 200, { user: { id: user.id, name: user.name } });
});

app.post('/api/logout', (ctx) => {
  logout(db, ctx);
  json(ctx.res, 200, { ok: true });
});

app.get('/api/me', (ctx) => {
  const u = currentUser(db, ctx);
  json(ctx.res, 200, { user: u ? { id: u.id, name: u.name } : null });
});

// --- справочник ---
app.get('/api/languages', (ctx) => {
  json(ctx.res, 200, { languages: LANGS, expiry: EXPIRY_LABELS });
});

// --- создание ---
app.post('/api/snippets', (ctx) => {
  const b = ctx.body || {};
  const content = String(b.content ?? '');
  if (!content.trim()) return badRequest(ctx.res, 'need_content');
  if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT) return badRequest(ctx.res, 'content_too_large');

  const language = String(b.language || 'auto');
  if (!LANGS.includes(language)) return badRequest(ctx.res, 'bad_language');

  const expiry = String(b.expiry || 'never');
  if (!(expiry in EXPIRY_MS) && expiry !== 'never' && expiry !== 'burn') {
    return badRequest(ctx.res, 'bad_expiry');
  }

  let password_hash = null;
  let password_salt = null;
  if (b.password !== undefined && b.password !== null && String(b.password) !== '') {
    if (String(b.password).length > 128) return badRequest(ctx.res, 'password_too_long');
    const h = hashPassword(String(b.password));
    password_hash = h.hash;
    password_salt = h.salt;
  }

  const title = String(b.title || '').trim().slice(0, 120) || 'Без названия';
  const user = currentUser(db, ctx);
  const id = uid();
  const now = Date.now();
  const expires_at = expiry in EXPIRY_MS ? now + EXPIRY_MS[expiry] : null;

  db.prepare(`
    insert into snippets(id, title, content, language, expiry, password_hash, password_salt,
      views, parent_id, version, created, expires_at, author_id, author_name)
    values (?, ?, ?, ?, ?, ?, ?, 0, null, 1, ?, ?, ?, ?)
  `).run(id, title, content, language, expiry, password_hash, password_salt, now, expires_at,
    user ? user.id : null, user ? user.name : null);

  json(ctx.res, 200, { id, url: `/s/${id}` });
});

// --- недавние (публичные, до защищённых не дотягиваемся) ---
// Важно: зарегистрировано до /api/snippets/:id, иначе «recent» съест параметр.
app.get('/api/snippets/recent', (ctx) => {
  const rows = db.prepare(`
    select id, title, language, expiry, views, version, created, expires_at, parent_id,
      author_name, length(content) as size, substr(content, 1, 200) as preview
    from snippets
    where password_hash is null and expiry != 'burn' and (expires_at is null or expires_at > ?)
    order by created desc
    limit 20
  `).all(Date.now());
  json(ctx.res, 200, { snippets: rows });
});

// --- полное чтение (views++, burn сгорает здесь) ---
app.get('/api/snippets/:id', (ctx) => {
  const r = readForContent(ctx.params.id, passwordFromQuery(ctx));
  if (r.status) return json(ctx.res, r.status, r.body);
  json(ctx.res, 200, { snippet: contentOf(r.row), burned: !!r.burned });
});

// --- meta (без контента, burn не сгорает) ---
app.get('/api/snippets/:id/meta', (ctx) => {
  const row = getLiveSnippet(ctx.params.id);
  if (!row) return notFound(ctx.res);
  json(ctx.res, 200, { snippet: metaOf(row) });
});

// --- RAW ---
app.get('/api/snippets/:id/raw', (ctx) => {
  const r = readForContent(ctx.params.id, passwordFromQuery(ctx));
  if (r.status) return json(ctx.res, r.status, r.body);
  bytes(ctx.res, 200, Buffer.from(r.row.content, 'utf8'), 'text/plain; charset=utf-8',
    { 'X-Snippet-Id': r.row.id, 'Cache-Control': 'no-store' });
});

// --- разблокировка паролем (отдаёт контент) ---
app.post('/api/snippets/:id/unlock', (ctx) => {
  const r = readForContent(ctx.params.id, ctx.body ? ctx.body.password : undefined);
  if (r.status) return json(ctx.res, r.status, r.body);
  json(ctx.res, 200, { snippet: contentOf(r.row), burned: !!r.burned });
});

// --- правка: новая версия, старая уходит в versions ---
app.put('/api/snippets/:id', (ctx) => {
  const row = getLiveSnippet(ctx.params.id);
  if (!row) return notFound(ctx.res);
  const b = ctx.body || {};
  if (row.password_hash) {
    if (b.password === undefined || b.password === null) {
      return json(ctx.res, 401, { need_password: true });
    }
    if (!verifyPassword(row, String(b.password))) {
      return json(ctx.res, 403, { error: 'wrong_password' });
    }
  }
  const content = String(b.content ?? row.content);
  if (!content.trim()) return badRequest(ctx.res, 'need_content');
  if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT) return badRequest(ctx.res, 'content_too_large');
  const title = b.title === undefined ? row.title : (String(b.title).trim().slice(0, 120) || 'Без названия');

  const updated = db.transaction(() => {
    db.prepare('insert into versions(snippet_id, version, title, content, created) values (?, ?, ?, ?, ?)')
      .run(row.id, row.version, row.title, row.content, row.created);
    db.prepare('update snippets set title = ?, content = ?, version = version + 1 where id = ?')
      .run(title, content, row.id);
    return db.prepare('select * from snippets where id = ?').get(row.id);
  })();

  json(ctx.res, 200, { id: updated.id, version: updated.version });
});

// --- форк: новый id, parent_id, автор = текущий пользователь ---
app.post('/api/snippets/:id/fork', (ctx) => {
  const user = currentUser(db, ctx);
  if (!user) return json(ctx.res, 401, { error: 'need_login' });
  const parent = getLiveSnippet(ctx.params.id);
  if (!parent) return notFound(ctx.res);
  if (parent.expiry === 'burn') return badRequest(ctx.res, 'burn_no_fork');
  if (parent.password_hash) {
    const p = ctx.body ? ctx.body.password : undefined;
    if (p === undefined || p === null) return json(ctx.res, 401, { need_password: true });
    if (!verifyPassword(parent, String(p))) return json(ctx.res, 403, { error: 'wrong_password' });
  }

  const id = uid();
  const now = Date.now();
  const expiry = parent.expiry === 'burn' ? 'never' : parent.expiry;
  const expires_at = expiry in EXPIRY_MS ? now + EXPIRY_MS[expiry] : null;
  const title = (parent.title + ' — форк от ' + parent.id).slice(0, 140);

  db.prepare(`
    insert into snippets(id, title, content, language, expiry, password_hash, password_salt,
      views, parent_id, version, created, expires_at, author_id, author_name)
    values (?, ?, ?, ?, ?, null, null, 0, ?, 1, ?, ?, ?, ?)
  `).run(id, title, parent.content, parent.language, expiry, parent.id, now, expires_at,
    user.id, user.name);

  json(ctx.res, 200, { id, url: `/s/${id}` });
});

// --- история версий ---
app.get('/api/snippets/:id/versions', (ctx) => {
  const row = getLiveSnippet(ctx.params.id);
  if (!row) return notFound(ctx.res);
  if (row.password_hash) {
    const p = passwordFromQuery(ctx);
    if (p === undefined) return json(ctx.res, 401, { need_password: true });
    if (!verifyPassword(row, p)) return json(ctx.res, 403, { error: 'wrong_password' });
  }
  const old = db.prepare('select version, title, created from versions where snippet_id = ? order by version')
    .all(row.id);
  const versions = [
    ...old,
    { version: row.version, title: row.title, created: row.created, current: true },
  ];
  json(ctx.res, 200, { id: row.id, author_name: row.author_name, versions });
});

// --- контент конкретной версии ---
app.get('/api/snippets/:id/versions/:v', (ctx) => {
  const row = getLiveSnippet(ctx.params.id);
  if (!row) return notFound(ctx.res);
  if (row.password_hash) {
    const p = passwordFromQuery(ctx);
    if (p === undefined) return json(ctx.res, 401, { need_password: true });
    if (!verifyPassword(row, p)) return json(ctx.res, 403, { error: 'wrong_password' });
  }
  const v = parseInt(ctx.params.v, 10);
  if (!Number.isInteger(v) || v < 1 || v > row.version) return badRequest(ctx.res, 'bad_version');
  if (v === row.version) {
    return json(ctx.res, 200, { version: { snippet_id: row.id, version: v, title: row.title, content: row.content, created: row.created, current: true } });
  }
  const ver = db.prepare('select * from versions where snippet_id = ? and version = ?').get(row.id, v);
  if (!ver) return notFound(ctx.res);
  json(ctx.res, 200, { version: { ...ver, current: false } });
});

// ---------- Фоновая уборка просроченных ----------
setInterval(() => {
  try {
    db.prepare('delete from snippets where expires_at is not null and expires_at < ?').run(Date.now());
    db.prepare('delete from versions where snippet_id not in (select id from snippets)').run();
  } catch (e) {
    console.error('cleanup', e);
  }
}, 60000);

// ---------- Seed (только в пустую базу) ----------
function seed() {
  const { c } = db.prepare('select count(*) as c from snippets').get();
  if (c > 0) return;

  const jsCode = `// Пример: debounce — откладывает вызов до тишины
function debounce(fn, delay = 300) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// Пример использования: поиск не чаще, чем раз в 300 мс
const onSearch = debounce((query) => {
  console.log('ищем:', query);
}, 300);

input.addEventListener('input', (e) => onSearch(e.target.value));
`;

  const pyCode = `# Пример: чтение CSV в список словарей
import csv
from pathlib import Path


def read_rows(path, limit=None):
    """Читает CSV-файл и возвращает строки как словари."""
    with Path(path).open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = []
        for i, row in enumerate(reader):
            if limit is not None and i >= limit:
                break
            rows.append(dict(row))
    return rows


if __name__ == "__main__":
    for row in read_rows("data.csv", limit=5):
        print(row)
`;

  const sqlCode = `-- Пример: последние 20 публичных сниппетов
select id, title, language, views, created
from snippets
where password_hash is null
order by created desc
limit 20;

-- Просмотры по языкам
select language, count(*) as snippets, sum(views) as views
from snippets
group by language
order by views desc;
`;

  const insert = db.prepare(`
    insert into snippets(id, title, content, language, expiry, password_hash, password_salt,
      views, parent_id, version, created, expires_at, author_id, author_name)
    values (?, ?, ?, ?, 'never', ?, ?, 0, null, 1, ?, null, null, null)
  `);
  const now = Date.now();

  const add = (title, content, language, password) => {
    let ph = null;
    let ps = null;
    if (password) {
      const h = hashPassword(password);
      ph = h.hash;
      ps = h.salt;
    }
    insert.run(uid(), title, content, language, ph, ps, now);
  };

  add('Пример: debounce на JavaScript', jsCode, 'javascript', null);
  add('Пример: чтение CSV на Python', pyCode, 'python', null);
  add('Пример: SQL-запросы (пароль: demo)', sqlCode, 'sql', 'demo');
  console.log('seed: добавлены демо-сниппеты');
}
seed();

app.listen(PORT, () => {
  console.log(`snippets listening on 0.0.0.0:${PORT}`);
});
