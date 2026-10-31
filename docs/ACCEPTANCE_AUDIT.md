# Проверка требований и исследование расширений

Дата: 31 октября 2026. Проверены текущие frontend/, backend/, compose.yaml, workflow Quality, scripts и документация. Наличие файла конфигурации не равно успешной проверке в удалённом окружении.

## Матрица обязательных требований

| Требование | Состояние | Доказательство / остаток |
|---|---|---|
| ТЗ 25–30 страниц | Подготовлено | docs/SPECIFICATION.md и docs/TECHNICAL_SPECIFICATION.pdf (28 страниц по предыдущей проверке); PDF ещё не включает все последние UI-дополнения |
| Модульная архитектура | Реализована | backend/app/Modules: Identity, Access, Documents, Processing, Collaboration, Audit, Integrations; docs/ARCHITECTURE.md |
| 2–3 интеграции | Реализованы локальные | ClamAV, Tika/Tesseract, Gotenberg; smoke checks. Яндекс/Mail адаптеры есть, live round-trip не подтверждён |
| Очередь / асинхронная обработка | Реализовано частично | Redis, workers, outbox, scheduler. Требуются reconciliation зависших этапов и исходов передач |
| Кэш / фоновые задачи | Реализовано | Раздельные Redis queue/cache, locks, dedup preview, processing/transfers jobs |
| Аутентификация и роли | Реализовано, требует расширения тестов | Sessions/CSRF, admin/employee/observer, document grants. Нужны полная ролевая матрица, UI password reset и приглашения |
| Unit / integration / API tests | Есть и запускаются | PHPUnit и Vitest, HTTP/pipeline/Gotenberg smoke; SQLite feature tests не заменяют всю PostgreSQL интеграционную матрицу |
| CI: lint, tests, Docker build | Настроено, удалённый запуск не подтверждён | .github/workflows/quality.yml; frontend build и API image job. Нужен clean checkout прогон GitHub |
| CD / deploy | Не завершено | Нет deployment job, release registry, production Compose и проверенного rollback |
| Docker Compose | Реализовано для разработки | frontend/backend + PostgreSQL, Redis, processors; исходники bind-mounted, Vite dev server |
| Логи | Базовые | Laravel stderr/logging; нет полного JSON контекста request_id/job_id/duration для всех путей |
| Метрики | Не реализованы | Нет /metrics, Prometheus/Grafana, stage/queue/outbox dashboards |
| Healthcheck | Частично | live/ready API, PostgreSQL/queue healthcheck; readiness не проверяет все критические зависимости |
| README / API / схема | Частично | README, architecture Mermaid, OpenAPI есть; контракт отстаёт от последних routes, ошибки и DTO описаны не полностью |
| Code review через PR | Не выполнено | Git remote отсутствует, реальный PR и независимый review отсутствуют |

## Функциональные пробелы исходного описания

- Извлечение сущностей (NER) отсутствует: нельзя считать этот основной пункт реализованным.
- OCR через Tika включён, но нет подтверждённого постраничного RU/EN качества, лимитов страниц и корпуса форматов.
- Версии хранятся, сравнение текста есть; восстановление старой версии новой текущей ещё не завершено.
- Поиск использует PostgreSQL FTS и ранжирование с ACL; нет измеренного relevance/recall, веса сущностей не работают без NER, snippet пока не ведёт к точному месту.
- Комментарии и resolution есть; серверная идемпотентность создания и полное покрытие конфликтов не завершены.
- Массовые favorite/trash/restore есть; теги/папки/export ещё не включены в пакетный UI.
- Backup скрипт есть, независимая репетиция restore не выполнена.
- Последние изменения не оформлены цельными проверенными коммитами после переноса frontend/backend. До передачи проекта нужен staged review и commit с hooks.

## Что закрывать до новых расширений

1. NER: локальное извлечение дат/организаций/людей/сумм, хранение offsets/confidence и поиск; без исключённого владельцем Inbox сущностей.
2. Надёжность pipeline: постоянные состояния/attempts/heartbeat, reconciliation, failed jobs, повтор только безопасных операций.
3. Наблюдаемость: JSON logs, correlation IDs, latency/error/stage metrics, queue depth/outbox age, readiness.
4. Release: production Compose, immutable images, GitHub CI, локальный deploy/rollback и restore rehearsal.
5. Полный OpenAPI, тесты новой функциональности, PostgreSQL и E2E сценарии, реальный PR-review после настройки remote.

## Дополнительные возможности по результатам исследования

### Высокая польза

- Настраиваемые типы и поля документов: номер договора, контрагент, дата окончания. Это дополняет произвольные файлы структурированными фильтрами.
- Правила автоматической классификации: после обработки назначать тип/теги/папку по имени и содержимому; preview правила перед включением.
- Сроки действия и напоминания: приближение окончания договора, просроченные документы; очередь уведомлений локально.
- Связанные документы: договор → приложения → акты, с двусторонними ссылками и ACL на каждый файл.
- Импорт почтовых вложений через локальный IMAP-коннектор как дополнительный источник, с карантином и дедупликацией.
- Search quality dashboard на синтетическом корпусе: эталонные запросы, recall@k, ранжирование, задержка, OCR accuracy.

### После стабилизации ядра

- Check-out/check-in для предотвращения параллельного изменения исходного файла.
- Версионирование метаданных и история изменения полей, отдельно от версий содержимого.
- История поисковых запросов только локально и с возможностью очистки.
- Пакет экспорта с manifest/checksums: оригиналы + версии + метаданные; исключать документы после отзыва доступа.
- Источники и provenance: откуда пришёл документ, кто импортировал, когда и какой processing pipeline использовался.

Внешние публичные ссылки и семантический поиск через платные API не приоритетны для согласованного бесплатного локального продукта. Идеи №6 и №8 прежнего списка (Inbox сущностей и объяснение доступа) не возвращаются в scope.

## Источники

- Paperless-ngx, Basic Usage: custom fields, workflows и взаимодействие с permissions — https://docs.paperless-ngx.com/usage/
- Paperless-ngx REST API: пакетные операции и связь документов — https://docs.paperless-ngx.com/api/
- Mayan EDMS Features: metadata, versions, workflows, automatic indexing — https://docs.mayan-edms.com/chapters/features.html
- PostgreSQL: ranking и выделение фрагментов — https://www.postgresql.org/docs/17/textsearch-controls.html

Выводы о нашем коде основаны на локальном аудите, а не на возможностях этих продуктов. Все расширения в этом документе — предложения; статусы реализации приведены отдельно.

## Проверки этого аудита

31 октября 2026 повторно выполнены: frontend ESLint, Prettier check, TypeScript, Vitest (9 тестов), production build; backend Pint, Larastan, PHPUnit (19 тестов / 77 assertions); Compose config. Все прошли. `make smoke` прошёл на реальных локальных ClamAV → Tika → PostgreSQL, HTTP CSRF/login/logout и Gotenberg DOCX→PDF. Эти результаты не подтверждают отсутствие ошибок во всех требованиях и не закрывают перечисленные выше пробелы.

## Прогресс закрытия

Добавлены baseline extraction dates/email/amount/quoted RU organizations (полноценная статистическая NER ещё не завершена), admin metrics, HTTP request_id/duration и JSON formatter, Redis/cache readiness, bounded processing reconciliation и safe unknown transfer outcome. OpenAPI переэкспортирован, TS типы обновлены; добавлен password reset UI. 21 PHPUnit / 85 assertions, frontend 9 tests/lint/typecheck/build проходят. Production API и frontend images собраны. Backup PostgreSQL восстановлен в отдельную modern_restore_audit_20261031: 16 документов / 17 версий; рабочая БД не перезаписывалась. Проверка blob checksums, full restore application smoke и rollback ещё не завершены.
