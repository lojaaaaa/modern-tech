# Реализация Telegram-архива

Integration branch: `implement/telegram-archive`. Base: `caf4f68`.
Источник требований: `tools/telegram-media-probe/SPEC.md` (не дублировать).
Исходные файлы прототипа импортируются отдельным коммитом без `.env`/`data`.

## Граф

01 → 02, 03; 04 готова после этого контракта; 02+03+04 → 05.
Реализация каждого тикета — отдельная ветка и worktree от integration tip.
Перед завершением исполнитель вливает integration tip. Отдельный merger
вливает готовые ветки в интеграционную. Ревью сравнивает с base `caf4f68`.

## Границы TDD

Предложены пользователю 9 ноября: вход `Probe.ingest` с подставным Telegram,
публичные операции Archive, настоящий HTTP API с подписанным initData,
пользовательские действия браузера. Пользователь подтвердил все границы ответом «да».
Живое получение временных фото — отдельный эксперимент, не результат fake API.

## Контракт хранилища (archive.py)

`Archive(directory, owner_id, clock=time.time)` — отдельное соединение SQLite
на экземпляр; HTTP создаёт экземпляр на запрос. WAL, busy_timeout, foreign_keys,
secure_delete. Сохранить Python 3.10+, stdlib; тесты unittest.

- `process(update, notify=True)`: уже проверенное бизнес-обновление; атомарная
  дедупликация, проекция, задания, монотонный курсор. Ключ сообщения chat_id+mid,
  смена business connection не создаёт нового диалога.
- `offset()`, `advance_cursor(update_id)` (также монотонно для пропусков).
- `conversations(query='')` → список диалогов (только с записями).
- `events(chat_id, before=None, limit=50)` → `{items, has_more, next_before,
  through_id}`; последняя страница в порядке `(at, id)`, стабильный id
  разрешает одинаковое время. `next_before` — id первой записи страницы;
  сервер разрешает его в пару `(at, id)`. through_id — максимум id на момент запроса.
- `history(chat_id, message_id)` → `{items, original_missing}`; нет обхода
  удаления через историю. Порядок состояний и их времена.
- `mark_read(chat_id, ids=None, through_id=None)` → `{unread}`; только текущий
  диалог, id<=through_id для «всё», новые события не затрагиваются.
- `settings()`, `update_settings(changes)` → глобальные настройки и receiver.
- `conversation_settings(chat_id)`, `update_conversation_settings(chat_id, changes)`
  → `{notifications: bool, collecting: bool}`.
- `delete_entry(id)`, `clear_conversation(chat_id)`, `clear()` → удаление данных,
  связанных уведомлений, ненужных файлов, сохранение настроек/дедупликации.
- `expire()` → очистка 30-дневных фоновых данных, включая legacy raw/nested.
- `photo_jobs()` → задания `{id, file_id, attempts}`; `photo_result(id,
  path=None, error=None)`; `retry_photo(id)`; `photo_path(id)` → Path или None.
  `path` относительный, назначается при успешном полном скачивании.
- `notices()` → ожидающие `{id, text, attempts, chat_id}`; `notice_result(id, error=None)`.
  Старые задания отменяются при удалении/выключении соответствующей настройки.
- `update_profile(chat_id, profile)`, `avatar_path(chat_id)`, `avatar_result(chat_id, path)` — последние доступные сведения/локальный аватар Telegram; обновление не меняет порядок диалогов и снимки событий.
- `receiver_status(connected=None, success=False)` — обновление фактического
  enabled/last_success; `close()`.

Диалог: `{id, name, username, avatar: null|'/api/...', unread, last_event,
last_event_at, notifications, collecting}`. `last_event` — Entry object (not a string). Аватар доступен только из данных
Telegram, нет выдуманного фото. Можно оставить null, если API не предоставил.
Entry: `{id, chat_id, message_id, kind:'edit'|'delete'|'photo', own, at, time_source,
received_at, read:bool, profile:{id,name,username}, before:null|Content,
after:null|Content, photo_status:null|'pending'|'saved'|'unavailable'|'error'}`.
Content: `{text, media:null|'photo'|'video'|'document'|..., author_id, date}`;
никогда raw reply/nested payload. History items: `{kind, at, content:null|Content}`.
У удаления сохранённое содержимое находится в `before`, а `after=null`.
`time_source` = telegram для известного времени правки из Telegram, received для
времени получения удаления/фото и правки без `edit_date`. UI подписывает время
получения явно. Последнее событие диалога также выбирается по `(at, id)`.
Фоновая переписка не возвращается списком/историей до архивного события.

## HTTP-контракт (server.py, web/)

Все ответы JSON (фото — bytes), `/api/*` защищён заголовком
`Authorization: Telegram <WebApp.initData>`. Подпись HMAC, auth_date/future/expiry,
owner_id сверяются сервером; никакой dev-авторизации и токена во фронтенде.
Срок запуска ограничен одним часом; допустимое опережение серверного времени —
30 секунд. Просроченный запуск требует повторного открытия Mini App из Telegram.
Ошибки `{error: 'краткое описание'}`, соответствующий 400/401/403/404/409/500.
Не записывать body/headers переписки в логи. Ответы API и фото no-store.

- GET `/api/conversations?q=...` → `{items}`
- GET `/api/conversations/{chat}/events?before=...&limit=50` → страница выше
- GET `/api/conversations/{chat}/messages/{mid}/history` → история выше
- GET `/api/conversations/{chat}/avatar` → предоставленный Telegram аватар
- GET `/api/entries/{id}/photo` → полный сохранённый файл
- POST `/api/entries/{id}/retry` → `{ok:true}`
- POST `/api/conversations/{chat}/read` → body `{ids:[...]}` или `{through_id:n}`
- GET/PATCH `/api/settings` → настройки
- GET/PATCH `/api/conversations/{chat}/settings` → настройки диалога
- DELETE `/api/entries/{id}`, `/api/conversations/{chat}`, `/api/archive`
  body `{confirm:true}` → `{ok:true}`. Без подтверждения HTTP 400.

Settings: `{notify_edits,notify_deletes,retention_days:30,
receiver:{state:'active'|'disconnected'|'stale'|'unknown',last_success_at:null|unix,
connection_enabled:null|bool}}`. last_success — успех getUpdates;
свежесть >90 секунд не считается active.

Frontend без сборщика/зависимостей: web/index.html, app.js, style.css.
Telegram WebApp SDK; подписанное initData только в памяти/заголовке.
Фото загружается fetch с авторизацией → blob URL. Статические файлы доступны
без секретов; данные только через API. Тема обновляется по themeChanged,
viewport/safe areas. Никакого отправления исходному собеседнику из Mini App.

## Локальный запуск и состояние интеграции

Общий `config.load_env(path=None, environ=None)` вызывается явно только CLI,
читает разрешённые ключи из `.env` рядом с модулем и сохраняет приоритет окружения.
`TELEGRAM_DATA_DIR` должен совпадать для HTTP-сервера и приёмника; по умолчанию
используется локальный `data/`. HTTP-сервер слушает `127.0.0.1:8787`, параметры
задаются через `TELEGRAM_HOST` и `TELEGRAM_PORT`. HTTPS-туннель/reverse proxy
настраивается пользователем; `TELEGRAM_WEBAPP_URL` даёт владельцу кнопку запуска.
`TELEGRAM_CHAT_ID` пустой — все разрешённые диалоги, положительный — тестовый
scope, `0` — обнаружение без сбора. Подробная инструкция находится в README.

На `b68ed5d` влиты 01–04; проходят 46 Python-тестов, синтаксические проверки,
два браузерных сценария с подставным HTTP и общая проверка Mini App с настоящим
локальным API, временным Archive и подписанными синтетическими данными запуска.
Ревью ещё выполняется. Подтверждённая находка ручной очистки: удалённое содержимое
остаётся в активном WAL; её исправление и закрытие задач ожидают приёмки.
Сводный отчёт и источники результатов — [acceptance.md](acceptance.md).

## Закрытие

Исправление после ревью: срок 30 дней относится к содержимому фоновой копии.
Отдельный признак стороны исходного сообщения (chat_id, message_id, own),
не содержащий текста или raw JSON, переживает истечение, чтобы позднее удаление
собственного сообщения не уведомляло владельца. Ручные операции удаления стирают
и этот признак. После коммита ручного удаления выполняется очистка WAL;
занятый checkpoint не выдаётся за успешное завершение очистки.

Триажные Status сохраняют канонические значения. По существующей практике трекера выполненная задача получает `Status: ready-for-human`,
`Resolution: completed`, отмеченные критерии, ссылки на коммиты/проверки в Comments.
05 закрывается после приёмки и исправления всех находок ревью. Реальный HTTPS
адрес пользователь настраивает при запуске; постоянный хостинг вне SPEC.
