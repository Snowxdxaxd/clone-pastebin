// «Сниппет» — клиентское приложение (SPA без сборки)
(() => {
  'use strict';

  // ---------- Утилиты ----------
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ESC[ch]);
  const $ = (sel, root) => (root || document).querySelector(sel);

  const view = $('#view');
  const state = {
    user: null,
    langs: ['auto', 'javascript', 'typescript', 'python', 'go', 'java', 'c', 'cpp', 'csharp',
      'sql', 'json', 'html', 'xml', 'css', 'bash', 'shell', 'php', 'ruby', 'rust', 'kotlin',
      'swift', 'lua', 'perl', 'r', 'markdown', 'yaml', 'ini', 'diff', 'makefile', 'scss',
      'less', 'graphql', 'objectivec', 'vbnet', 'wasm', 'plaintext'],
    expiryLabels: {
      '10m': '10 минут', '1h': '1 час', '1d': '1 день', '1w': '1 неделя',
      'never': 'никогда', 'burn': 'сгорает после прочтения',
    },
    pw: {}, // пароль в памяти на текущую сессию просмотра: { [id]: string }
  };

  const byteLen = (s) => new TextEncoder().encode(String(s)).length;

  function formatBytes(n) {
    if (n < 1024) return n + ' Б';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1).replace('.', ',') + ' КБ';
    return (n / 1024 / 1024).toFixed(2).replace('.', ',') + ' МБ';
  }

  const dtf = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const formatDate = (ms) => dtf.format(new Date(ms));

  function formatRemaining(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (d > 0) return `${d} д ${h} ч`;
    if (h > 0) return `${h} ч ${m} мин`;
    if (m > 0) return `${m} мин ${sec} с`;
    return `${sec} с`;
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2500);
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    let data = {};
    try { data = await res.json(); } catch { /* пустой ответ */ }
    if (!res.ok) throw { status: res.status, data };
    return data;
  }

  // ---------- Иконки (инлайновые SVG) ----------
  const icons = {
    copy: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="9" rx="1.5"/><path d="M10.5 5.5 V3.5 a1.5 1.5 0 0 0 -1.5 -1.5 H4 a1.5 1.5 0 0 0 -1.5 1.5 v6 a1.5 1.5 0 0 0 1.5 1.5 h1.5"/></svg>',
    raw: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M4 2.5 h5.5 L13 6 v7.5 a1 1 0 0 1 -1 1 H4 a1 1 0 0 1 -1 -1 v-10 a1 1 0 0 1 1 -1 z"/><path d="M5 8 h6 M5 10.5 h6 M5 5.5 h2.5"/></svg>',
    fork: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="4" cy="3.5" r="1.6"/><circle cx="4" cy="12.5" r="1.6"/><circle cx="12" cy="5.5" r="1.6"/><path d="M4 5.1 v5.8 M12 7.1 c0 2.4 -3 2.6 -6 3.4"/></svg>',
    edit: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M11.3 2.3 a1.4 1.4 0 0 1 2 2 L6 11.6 l-2.7 0.7 0.7 -2.7 z"/></svg>',
    history: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="8" cy="8" r="5.8"/><path d="M8 4.6 V8 l2.6 1.6"/></svg>',
    lock: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7 V5 a2.5 2.5 0 0 1 5 0 v2"/></svg>',
    flame: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 1.5 c0.4 2 -0.8 3 -1.6 4.2 C5.5 7 5 8.2 5 9.6 A3.2 3.2 0 0 0 8.2 13 A3.3 3.3 0 0 0 11.5 9.7 c0 -1.2 -0.4 -2 -1 -2.8 -0.2 0.6 -0.5 1 -1 1.3 0.2 -2 -0.3 -4.6 -1.5 -6.7 z"/></svg>',
    eye: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M1.5 8 C3.2 4.9 5.4 3.4 8 3.4 s4.8 1.5 6.5 4.6 C12.8 11.1 10.6 12.6 8 12.6 s-4.8 -1.5 -6.5 -4.6 z"/><circle cx="8" cy="8" r="2"/></svg>',
    chevron: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6 3.5 L10.5 8 L6 12.5"/></svg>',
  };

  // ---------- Модальные окна ----------
  function closeModal() {
    const root = $('#modal-root');
    root.innerHTML = '';
  }

  function openModal(html) {
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-overlay"><div class="modal">${html}</div></div>`;
    const overlay = $('.modal-overlay', root);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeModal(); });
    return root;
  }

  function loginModal(onDone) {
    const root = openModal(`
      <h2>Вход по имени</h2>
      <div class="form-row">
        <label for="m-name">Имя</label>
        <input type="text" id="m-name" maxlength="32" autocomplete="off">
      </div>
      <div class="password-error" id="m-err"></div>
      <div class="modal-actions">
        <button type="button" id="m-cancel">Отмена</button>
        <button type="button" class="primary" id="m-ok">Войти</button>
      </div>
    `);
    const nameInput = $('#m-name', root);
    nameInput.focus();
    const submit = async () => {
      try {
        const r = await api('/api/login', { method: 'POST', body: JSON.stringify({ name: nameInput.value }) });
        state.user = r.user;
        renderAuthBox();
        closeModal();
        if (onDone) onDone(r.user);
      } catch {
        $('#m-err', root).textContent = 'Введите имя';
      }
    };
    $('#m-ok', root).addEventListener('click', submit);
    $('#m-cancel', root).addEventListener('click', closeModal);
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  }

  function passwordModal(title, onSubmit) {
    const root = openModal(`
      <h2>${esc(title)}</h2>
      <div class="form-row">
        <label for="m-pass">Пароль</label>
        <input type="password" id="m-pass">
      </div>
      <div class="password-error" id="m-err"></div>
      <div class="modal-actions">
        <button type="button" id="m-cancel">Отмена</button>
        <button type="button" class="primary" id="m-ok">Открыть</button>
      </div>
    `);
    const passInput = $('#m-pass', root);
    passInput.focus();
    const submit = () => {
      const p = passInput.value;
      if (!p) { $('#m-err', root).textContent = 'Введите пароль'; return; }
      onSubmit(p, (msg) => { $('#m-err', root).textContent = msg; });
    };
    $('#m-ok', root).addEventListener('click', submit);
    $('#m-cancel', root).addEventListener('click', closeModal);
    passInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  }

  // ---------- Сессия ----------
  function renderAuthBox() {
    const box = $('#auth-box');
    if (state.user) {
      box.innerHTML = `
        <span>Вы: <b>${esc(state.user.name)}</b></span>
        <button type="button" id="btn-logout">Выйти</button>`;
      $('#btn-logout', box).addEventListener('click', async () => {
        await api('/api/logout', { method: 'POST' });
        state.user = null;
        renderAuthBox();
      });
    } else {
      box.innerHTML = `
        <input type="text" id="login-name" maxlength="32" placeholder="Имя" autocomplete="off">
        <button type="button" class="primary" id="btn-login">Войти</button>`;
      const doLogin = async () => {
        const name = $('#login-name', box).value;
        if (!name.trim()) { toast('Введите имя'); return; }
        try {
          const r = await api('/api/login', { method: 'POST', body: JSON.stringify({ name }) });
          state.user = r.user;
          renderAuthBox();
        } catch { toast('Не удалось войти'); }
      };
      $('#btn-login', box).addEventListener('click', doLogin);
      $('#login-name', box).addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
    }
  }

  // ---------- Подсветка и код ----------
  function highlightHtml(text, lang) {
    if (window.hljs) {
      try {
        if (lang && lang !== 'auto' && window.hljs.getLanguage(lang)) {
          return { html: window.hljs.highlight(text, { language: lang }).value, detected: null };
        }
        if (lang === 'auto' && text.length <= 50000) {
          const r = window.hljs.highlightAuto(text);
          return { html: r.value, detected: r.language || null };
        }
        return { html: window.hljs.highlight(text, { language: 'plaintext' }).value, detected: null };
      } catch { /* ниже fallback */ }
    }
    return { html: esc(text), detected: null };
  }

  function renderCode(container, text, lang) {
    const { html, detected } = highlightHtml(text, lang);
    const lines = text.split('\n').length;
    const gutter = Array.from({ length: lines }, (_, i) => `<div>${i + 1}</div>`).join('');
    container.innerHTML = `
      <div class="codewrap">
        <div class="gutter">${gutter}</div>
        <div class="codebox"><pre><code>${html}</code></pre></div>
      </div>`;
    return detected;
  }

  // ---------- Главная ----------
  async function renderHome() {
    document.title = 'Сниппет — обмен фрагментами кода';
    view.innerHTML = `
      <div class="layout">
        <section class="card">
          <h1 style="margin:0 0 14px;font-size:20px">Новый сниппет</h1>
          <form id="create-form">
            <div class="form-grid">
              <div class="form-row">
                <label for="f-title">Заголовок</label>
                <input type="text" id="f-title" maxlength="120" placeholder="необязательно">
              </div>
              <div class="form-row">
                <label for="f-lang">Язык</label>
                <select id="f-lang"></select>
              </div>
              <div class="form-row">
                <label for="f-expiry">Время жизни</label>
                <select id="f-expiry">
                  <option value="10m">10 минут</option>
                  <option value="1h">1 час</option>
                  <option value="1d">1 день</option>
                  <option value="1w">1 неделя</option>
                  <option value="never" selected>никогда</option>
                  <option value="burn">сгорает после прочтения</option>
                </select>
              </div>
              <div class="form-row">
                <label for="f-pass">Пароль</label>
                <input type="password" id="f-pass" placeholder="необязательно" maxlength="128">
              </div>
            </div>
            <div class="form-row" style="margin-top:12px">
              <label for="content">Код</label>
              <textarea id="content" spellcheck="false" placeholder="Вставьте код сюда"></textarea>
              <div class="size-hint"><span id="size-counter">0 Б</span> из 500 КБ</div>
            </div>
            <div class="password-error" id="f-err"></div>
            <button type="submit" class="primary" id="f-submit">Создать сниппет</button>
          </form>
        </section>
        <aside class="card recent">
          <h2>Недавние</h2>
          <div id="recent-list"><div class="empty">Загрузка…</div></div>
        </aside>
      </div>`;

    const langSelect = $('#f-lang');
    langSelect.innerHTML = state.langs.map((l) =>
      `<option value="${esc(l)}">${l === 'auto' ? 'авто' : esc(l)}</option>`).join('');

    const contentEl = $('#content');
    const counter = $('#size-counter');
    contentEl.addEventListener('input', () => { counter.textContent = formatBytes(byteLen(contentEl.value)); });

    $('#create-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#f-err');
      err.textContent = '';
      const content = contentEl.value;
      if (!content.trim()) { err.textContent = 'Вставьте код'; return; }
      if (byteLen(content) > 500 * 1024) { err.textContent = 'Слишком большой фрагмент (лимит 500 КБ)'; return; }
      const btn = $('#f-submit');
      btn.disabled = true;
      try {
        const r = await api('/api/snippets', {
          method: 'POST',
          body: JSON.stringify({
            title: $('#f-title').value,
            content,
            language: $('#f-lang').value,
            expiry: $('#f-expiry').value,
            password: $('#f-pass').value || undefined,
          }),
        });
        navigate(`/s/${r.id}`);
      } catch (ex) {
        const map = {
          need_content: 'Пустой фрагмент',
          content_too_large: 'Слишком большой фрагмент (лимит 500 КБ)',
          bad_language: 'Неизвестный язык',
          bad_expiry: 'Неверное время жизни',
        };
        err.textContent = map[ex.data && ex.data.error] || 'Не удалось создать сниппет';
        btn.disabled = false;
      }
    });

    try {
      const r = await api('/api/snippets/recent');
      const list = $('#recent-list');
      if (!r.snippets.length) {
        list.innerHTML = '<div class="empty">Пока ничего нет</div>';
        return;
      }
      list.innerHTML = r.snippets.map((s) => `
        <a class="recent-item" href="/s/${esc(s.id)}" data-nav>
          <div class="recent-title">${esc(s.title)}</div>
          <div class="recent-meta">${esc(s.language === 'auto' ? 'авто' : s.language)} · ${formatBytes(s.size)} · ${esc(String(s.views))} просм. · ${formatDate(s.created)}</div>
          <div class="recent-preview">${esc(s.preview || '')}</div>
        </a>`).join('');
    } catch {
      $('#recent-list').innerHTML = '<div class="empty">Не удалось загрузить список</div>';
    }
  }

  // ---------- Страница сниппета ----------
  let countdownTimer = null;

  function stopCountdown() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  }

  function renderNotFound() {
    stopCountdown();
    document.title = 'Сниппет не найден';
    view.innerHTML = `
      <div class="notfound">
        <h1>Сниппет не найден</h1>
        <p>Возможно, истёк срок жизни или сниппет сгорел после прочтения.</p>
        <p><a href="/" data-nav>На главную</a></p>
      </div>`;
  }

  async function renderSnippet(id) {
    stopCountdown();
    view.innerHTML = '<div class="empty" style="margin-top:40px;text-align:center">Загрузка…</div>';

    let meta;
    try {
      meta = (await api(`/api/snippets/${id}/meta`)).snippet;
    } catch {
      renderNotFound();
      return;
    }

    document.title = `${meta.title} — Сниппет`;
    const langLabel = meta.language === 'auto' ? 'авто' : meta.language;
    view.innerHTML = `
      <div class="snippet-page">
        <div class="crumb"><a href="/" data-nav>Сниппет</a> / ${esc(meta.id)}</div>
        <div class="snippet-head">
          <h1>${esc(meta.title)}</h1>
          <div class="snippet-meta">
            <span class="badge">${esc(langLabel)}</span>
            <span class="badge">версия ${esc(String(meta.version))}</span>
            <span class="badge">${icons.eye} ${esc(String(meta.views))}</span>
            <span class="badge">${esc(formatBytes(meta.size))}</span>
            ${meta.author_name ? `<span>автор: ${esc(meta.author_name)}</span>` : ''}
            <span>создан ${formatDate(meta.created)}</span>
            <span id="countdown"></span>
            ${meta.parent_id ? `<a href="/s/${esc(meta.parent_id)}" data-nav>форк от ${esc(meta.parent_id)}</a>` : ''}
            ${meta.burn ? `<span class="badge burn">${icons.flame} сгорит после прочтения</span>` : ''}
            ${meta.need_password ? `<span class="badge">${icons.lock} нужен пароль</span>` : ''}
          </div>
        </div>
        <div class="snippet-actions" id="actions"></div>
        <div id="banner-area"></div>
        <div id="code-area"></div>
        <div class="versions" id="versions-area" hidden>
          <h2>История версий</h2>
          <div id="versions-list"></div>
        </div>
      </div>`;

    if (pendingBanner) {
      $('#banner-area').innerHTML = `<div class="banner info">${esc(pendingBanner)}</div>`;
      pendingBanner = null;
    }

    renderCountdown(meta);

    // Действия
    const actions = $('#actions');
    actions.innerHTML = `
      <button type="button" id="btn-copy">${icons.copy} Копировать</button>
      <a class="btn" id="btn-raw" href="/api/snippets/${esc(id)}/raw" target="_blank" rel="noopener">${icons.raw} RAW</a>
      <button type="button" id="btn-fork">${icons.fork} Форк</button>
      <button type="button" id="btn-edit">${icons.edit} Править</button>
      <button type="button" id="btn-history">${icons.history} История версий</button>`;

    const currentPassword = () => state.pw[id];

    $('#btn-copy', actions).addEventListener('click', () => {
      const text = state.currentContent || '';
      if (!text) { toast('Нечего копировать'); return; }
      copyText(text);
    });

    if (meta.need_password && !currentPassword()) {
      $('#btn-raw', actions).addEventListener('click', (e) => {
        e.preventDefault();
        passwordModal('Пароль для RAW', (p, showErr) => {
          api(`/api/snippets/${id}/unlock`, { method: 'POST', body: JSON.stringify({ password: p }) })
            .then(() => {
              state.pw[id] = p;
              window.open(`/api/snippets/${id}/raw?password=${encodeURIComponent(p)}`, '_blank', 'noopener');
              closeModal();
            })
            .catch(() => showErr('Неверный пароль'));
        });
      });
    } else if (meta.need_password) {
      $('#btn-raw', actions).href = `/api/snippets/${id}/raw?password=${encodeURIComponent(currentPassword())}`;
    }

    $('#btn-fork', actions).addEventListener('click', () => tryFork(meta));

    $('#btn-edit', actions).addEventListener('click', () => openEditModal(meta));

    $('#btn-history', actions).addEventListener('click', () => toggleHistory(meta));

    // Контент
    if (meta.need_password && !currentPassword()) {
      renderPasswordGate(meta);
    } else {
      await loadContent(meta, currentPassword());
    }
  }

  function copyText(text) {
    const done = () => toast('Скопировано в буфер обмена');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch { toast('Не удалось скопировать'); }
    document.body.removeChild(ta);
  }

  function renderCountdown(meta) {
    const el = $('#countdown');
    if (meta.burn) return; // у burn срока нет — есть бейдж «сгорит после прочтения»
    if (!meta.expires_at) { el.textContent = 'живёт постоянно'; return; }
    const tick = () => {
      const left = meta.expires_at - Date.now();
      if (left <= 0) {
        el.textContent = 'истёк';
        stopCountdown();
        // перепроверяем: если удалили — показываем 404
        api(`/api/snippets/${meta.id}/meta`).catch(() => renderNotFound());
        return;
      }
      el.textContent = `истекает через ${formatRemaining(left)}`;
    };
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  function renderPasswordGate(meta) {
    const area = $('#code-area');
    area.innerHTML = `
      <div class="card password-card">
        ${icons.lock}
        <h2 style="margin:10px 0 4px;font-size:18px">Сниппет защищён паролем</h2>
        <p style="margin:0 0 14px;color:var(--muted);font-size:14px">Введите пароль, чтобы увидеть код</p>
        <div class="form-row">
          <input type="password" id="gate-pass" style="width:100%">
        </div>
        <div class="password-error" id="gate-err"></div>
        <button type="button" class="primary" id="gate-ok">Открыть</button>
      </div>`;
    const input = $('#gate-pass', area);
    input.focus();
    const submit = async () => {
      const p = input.value;
      if (!p) { $('#gate-err', area).textContent = 'Введите пароль'; return; }
      try {
        const r = await api(`/api/snippets/${meta.id}/unlock`, { method: 'POST', body: JSON.stringify({ password: p }) });
        state.pw[meta.id] = p;
        const rawBtn = $('#btn-raw');
        if (rawBtn) rawBtn.href = `/api/snippets/${meta.id}/raw?password=${encodeURIComponent(p)}`;
        showCode(r.snippet, r.burned, meta);
      } catch (ex) {
        $('#gate-err', area).textContent = ex.status === 403 ? 'Неверный пароль' : 'Не удалось открыть';
      }
    };
    $('#gate-ok', area).addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  }

  // переменная для доступа к кнопкам из замыканий формы пароля
  let actionsEl = null;

  async function loadContent(meta, password) {
    try {
      const url = password
        ? `/api/snippets/${meta.id}?password=${encodeURIComponent(password)}`
        : `/api/snippets/${meta.id}`;
      const r = await api(url);
      showCode(r.snippet, r.burned, meta);
    } catch {
      renderNotFound();
    }
  }

  function showCode(snippet, burned, meta) {
    actionsEl = $('#actions');
    state.currentContent = snippet.content;
    state.currentTitle = snippet.title;

    const bannerArea = $('#banner-area');
    if (burned) {
      bannerArea.innerHTML = `<div class="banner burn">Сниппет удалён из-за режима сгорания. Это последнее прочтение — ссылка больше не откроется.</div>`;
      // после сгорания править/форкить/смотреть историю нечего
      $('#btn-edit', actionsEl).disabled = true;
      $('#btn-fork', actionsEl).disabled = true;
      $('#btn-history', actionsEl).disabled = true;
    }

    const detected = renderCode($('#code-area'), snippet.content, snippet.language);
    if (snippet.language === 'auto' && detected) {
      const badge = $('.snippet-meta .badge');
      if (badge) badge.textContent = `авто (${detected})`;
    }
    // обновляем счётчик просмотров из ответа
    const viewsBadges = document.querySelectorAll('.snippet-meta .badge');
    if (viewsBadges[2]) viewsBadges[2].innerHTML = `${icons.eye} ${snippet.views}`;
  }

  // ---------- Форк ----------
  function tryFork(meta) {
    const doFork = (password) => {
      const body = {};
      if (password) body.password = password;
      api(`/api/snippets/${meta.id}/fork`, { method: 'POST', body: JSON.stringify(body) })
        .then((r) => {
          closeModal();
          toast('Сниппет форкнут');
          navigate(r.url);
        })
        .catch((ex) => {
          if (ex.status === 401 && ex.data && ex.data.error === 'need_login') {
            loginModal(() => tryFork(meta));
          } else if (ex.status === 401 && ex.data && ex.data.need_password) {
            passwordModal('Пароль сниппета для форка', (p, showErr) => {
              api(`/api/snippets/${meta.id}/fork`, { method: 'POST', body: JSON.stringify({ password: p }) })
                .then((r) => { closeModal(); navigate(r.url); })
                .catch(() => showErr('Неверный пароль'));
            });
          } else if (ex.status === 403) {
            toast('Неверный пароль');
          } else {
            toast(ex.data && ex.data.error === 'burn_no_fork'
              ? 'Сниппеты «сгорает после прочтения» нельзя форкнуть'
              : 'Не удалось сделать форк');
          }
        });
    };
    doFork(state.pw[meta.id]);
  }

  // ---------- Правка ----------
  let pendingBanner = null; // текст баннера, который покажут после перезагрузки страницы сниппета

  function openEditModal(meta) {
    // нужен текущий контент; для защищённого — пароль уже должен быть известен
    const password = state.pw[meta.id];
    const needPassword = meta.need_password && !password;
    const root = openModal(`
      <h2>Правка сниппета</h2>
      <div class="form-row">
        <label for="e-title">Заголовок</label>
        <input type="text" id="e-title" maxlength="120" value="${esc(state.currentTitle || meta.title)}">
      </div>
      ${needPassword ? `
      <div class="form-row">
        <label for="e-pass">Пароль сниппета</label>
        <input type="password" id="e-pass">
      </div>` : ''}
      <div class="form-row">
        <label for="e-content">Код</label>
        <textarea id="e-content" spellcheck="false">${esc(state.currentContent || '')}</textarea>
        <div class="size-hint"><span id="e-size">${formatBytes(byteLen(state.currentContent || ''))}</span> из 500 КБ</div>
      </div>
      <div class="password-error" id="e-err"></div>
      <div class="modal-actions">
        <button type="button" id="e-cancel">Отмена</button>
        <button type="button" class="primary" id="e-save">Сохранить (новая версия)</button>
      </div>
    `);

    const contentEl = $('#e-content', root);
    contentEl.addEventListener('input', () => {
      $('#e-size', root).textContent = formatBytes(byteLen(contentEl.value));
    });

    $('#e-cancel', root).addEventListener('click', closeModal);
    $('#e-save', root).addEventListener('click', async () => {
      const err = $('#e-err', root);
      err.textContent = '';
      const content = contentEl.value;
      if (!content.trim()) { err.textContent = 'Пустой код'; return; }
      if (byteLen(content) > 500 * 1024) { err.textContent = 'Слишком большой фрагмент (лимит 500 КБ)'; return; }
      const body = { title: $('#e-title', root).value, content };
      const passInput = $('#e-pass', root);
      if (passInput) {
        const p = passInput.value;
        if (!p) { err.textContent = 'Введите пароль сниппета'; return; }
        body.password = p;
      } else if (meta.need_password && password) {
        body.password = password;
      }
      try {
        const r = await api(`/api/snippets/${meta.id}`, { method: 'PUT', body: JSON.stringify(body) });
        if (passInput) state.pw[meta.id] = body.password;
        closeModal();
        pendingBanner = `Создана версия ${r.version}`;
        renderSnippet(meta.id); // перезагружаем страницу сниппета
      } catch (ex) {
        if (ex.status === 403) err.textContent = 'Неверный пароль';
        else if (ex.status === 401) err.textContent = 'Требуется пароль сниппета';
        else err.textContent = 'Не удалось сохранить';
      }
    });
  }

  // ---------- История версий ----------
  let historyLoaded = false;
  let historyVisible = false;
  let viewingVersion = null;

  async function toggleHistory(meta) {
    const area = $('#versions-area');
    historyVisible = !historyVisible;
    area.hidden = !historyVisible;
    if (!historyVisible) {
      // возвращаем основной код, если смотрели версию
      if (viewingVersion) {
        viewingVersion = null;
        $('#banner-area').innerHTML = meta.burn
          ? `<div class="banner burn">Сниппет удалён из-за режима сгорания. Это последнее прочтение — ссылка больше не откроется.</div>`
          : '';
        renderCode($('#code-area'), state.currentContent, meta.language);
      }
      return;
    }
    if (!historyLoaded) await loadHistory(meta);
  }

  async function loadHistory(meta) {
    const list = $('#versions-list');
    list.innerHTML = '<div class="empty">Загрузка…</div>';
    try {
      const pw = state.pw[meta.id];
      const url = pw ? `/api/snippets/${meta.id}/versions?password=${encodeURIComponent(pw)}` : `/api/snippets/${meta.id}/versions`;
      const r = await api(url);
      const author = r.author_name || 'аноним';
      list.innerHTML = r.versions.slice().reverse().map((v) => `
        <div class="version-row${v.current ? ' current' : ''}" data-v="${v.version}">
          <span class="vnum">v${v.version}</span>
          <span>${esc(v.title)}</span>
          <span class="vdate">${formatDate(v.created)}</span>
          <span class="vauthor">${v.current ? 'текущая · ' : ''}${esc(author)}</span>
        </div>`).join('');
      historyLoaded = true;
      list.querySelectorAll('.version-row').forEach((row) => {
        row.addEventListener('click', () => viewVersion(meta, parseInt(row.dataset.v, 10)));
      });
    } catch (ex) {
      list.innerHTML = `<div class="empty">${ex.status === 401 ? 'Нужен пароль сниппета' : 'Не удалось загрузить историю'}</div>`;
    }
  }

  async function viewVersion(meta, v) {
    try {
      const pw = state.pw[meta.id];
      const url = pw
        ? `/api/snippets/${meta.id}/versions/${v}?password=${encodeURIComponent(pw)}`
        : `/api/snippets/${meta.id}/versions/${v}`;
      const r = await api(url);
      const ver = r.version;
      viewingVersion = v;
      $('#banner-area').innerHTML = `
        <div class="banner info">Просмотр версии ${ver.version} от ${formatDate(ver.created)}.
          <button type="button" id="btn-current" style="margin-left:8px">К текущей версии</button></div>`;
      renderCode($('#code-area'), ver.content, meta.language);
      $('#btn-current').addEventListener('click', () => {
        viewingVersion = null;
        $('#banner-area').innerHTML = '';
        renderCode($('#code-area'), state.currentContent, meta.language);
      });
    } catch {
      toast('Не удалось открыть версию');
    }
  }

  // ---------- Роутер ----------
  function navigate(path) {
    history.pushState(null, '', path);
    route();
  }

  function route() {
    closeModal();
    historyLoaded = false;
    historyVisible = false;
    viewingVersion = null;
    pendingBanner = null;
    state.currentContent = '';
    state.currentTitle = '';
    const path = location.pathname;
    if (path === '/' || path === '') {
      renderHome();
      return;
    }
    const m = path.match(/^\/s\/([a-z0-9]{1,32})\/?$/);
    if (m) {
      renderSnippet(m[1]);
      return;
    }
    renderNotFound();
  }

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-nav]');
    if (!a) return;
    e.preventDefault();
    navigate(a.getAttribute('href'));
  });

  window.addEventListener('popstate', route);

  // ---------- Инициализация ----------
  (async function init() {
    try {
      const [me, langs] = await Promise.all([
        api('/api/me'),
        api('/api/languages').catch(() => null),
      ]);
      state.user = me.user;
      if (langs && Array.isArray(langs.languages) && langs.languages.length) {
        state.langs = langs.languages;
      }
      if (langs && langs.expiry) state.expiryLabels = langs.expiry;
    } catch { /* работаем без сессии */ }
    renderAuthBox();
    route();
  })();
})();
