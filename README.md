# Сниппет

**▶ Live demo:** https://demo-pastebin.onrender.com (free-инстанс Render: первый запрос будит сервис ~30–60 сек)


Клон Pastebin/Gist: обмен фрагментами кода. Node 24, ESM, без сборки. SQLite (better-sqlite3), файл данных `data/app.db`.

## Запуск

```bash
npm install
npm start        # порт по умолчанию 3019, переменной PORT можно переопределить
```

Открыть http://localhost:3019

## Возможности

- Подсветка синтаксиса (highlight.js v11.9.0, 36 языков + автоопределение), номера строк.
- Время жизни: 10 минут / 1 час / 1 день / 1 неделя / никогда / сгорает после прочтения. Просроченные удаляются фоном раз в минуту и лениво при чтении.
- Приватные ссылки с паролем: пароль хранится как scrypt-хэш со случайной солью на сниппет (node:crypto), в открытом виде нигде не сохраняется.
- Режим «сгорает после прочтения»: контент отдаётся один раз (в транзакции чтение+удаление), затем сниппет удаляется — ссылка отдаёт 404.
- Форки: копия сниппета с новым id, `parent_id` и суффиксом «форк от …» в заголовке; автор — текущий пользователь сессии.
- Версионирование: правка доступна всем, каждая правка создаёт новую версию (старые в таблице `versions`), история с датами и автором.
- RAW-выдача в `text/plain; charset=utf-8`.
- Счётчик просмотров на каждом полном чтении контента (meta не считается).
- Вход по имени (без пароля) — для подписи «создал» и форков.

## API

| Метод | Путь | Назначение |
|---|---|---|
| POST | `/api/snippets` | Создать: `{title?, content ≤500КБ, language, expiry, password?}` → `{id, url}` |
| GET | `/api/snippets/recent` | Публичные последние 20 (мета + первые 200 символов) |
| GET | `/api/snippets/:id` | Полное чтение (views++, burn сгорает). Защищённый: 401 `{need_password:true}` |
| GET | `/api/snippets/:id/meta` | Мета без контента (burn не сгорает, views не растёт) |
| GET | `/api/snippets/:id/raw` | `text/plain; charset=utf-8` |
| POST | `/api/snippets/:id/unlock` | `{password}` → 200 с контентом или 403 |
| PUT | `/api/snippets/:id` | `{title?, content, password?}` → новая версия (version+1, старая в versions) |
| POST | `/api/snippets/:id/fork` | Форк (нужна сессия; у burn-сниппетов запрещён) |
| GET | `/api/snippets/:id/versions` | Список версий |
| GET | `/api/snippets/:id/versions/:v` | Контент версии v |
| POST | `/api/login`, `/api/logout`, GET `/api/me` | Сессия по имени |

Пароль для GET-эндпоинтов (raw, versions) передаётся query-параметром `?password=...`; для POST/PUT — в теле.

## Схема БД

- `snippets(id — uid 12 символов, title, content, language, expiry, password_hash, password_salt, views, parent_id, version, created, expires_at, author_id, author_name)`
- `versions(snippet_id, version, title, content, created, PK(snippet_id, version))`
- `users(id, name, created)`, `sessions(token, user_id, created)`

`expiry`: `10m | 1h | 1d | 1w | never | burn`. `expires_at` (мс) проставляется при создании для конечных сроков.

## Демо-данные

В пустую базу добавляются три сниппета: debounce на JavaScript, чтение CSV на Python (оба публичные) и SQL-запрос с паролем `demo`.

## Ограничения

- Подсветка — common-сборка highlight.js: 36 языков, а не все ~190.
- Вход по имени без пароля — демо-режим, подходит для подписи авторства, не для реальной защиты.
- Защищённые сниппеты не появляются в «Недавних», burn-сниппеты тоже.
- Клиент держит введённый пароль только в памяти страницы, на сервере сессий разблокировки нет — каждый запрос с контентом несёт пароль заново.
- Лимит контента 500 КБ; лимит тела запроса в каркасе — 16 МБ.