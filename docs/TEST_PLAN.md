# Матрица проверок

Статус всех проверок приложения: NOT RUN. Их будущая реализация входит в tasks.json. Тесты документов/плана не заменяют эти проверки.

| ID | Предмет | Уровень | Основные задачи | Доказательство |
|---|---|---|---|---|
| T-001 | Upload → OCR → search → preview, offline core | E2E | 039,041,058 | Browser report и trace с отключённым интернетом |
| T-002 | Роли, ACL, revoke, admin exception | Unit/API | 014,032,043 | Матрица allow/deny по endpoint |
| T-003 | Login/CSRF/reset/block/last admin | API/E2E | 011-013,038 | Cookie/session и negative tests |
| T-004 | Форматы, MIME, size/page/zip limits | API/integration | 017,018 | Boundary fixtures и ответы |
| T-005 | Папки, теги, pagination, favorites | API/UI | 033,034,040 | Сценарии приватности и стабильности |
| T-006 | Версии, конкуренция, restore | Integration | 026,027 | Race tests на реальной БД |
| T-007 | Search relevance, filters, snippets | Integration/E2E | 030-032,041 | Корпус, expected ranking, ACL negatives |
| T-008 | Outbox/retry/cancel/reconciliation | Integration | 019,020 | Kill/restart, повтор и состояние БД |
| T-009 | ClamAV/Tika/OCR/Gotenberg/preview | Integration | 021-025 | Fixture outputs и ограничения ресурсов |
| T-010 | NER, spans и human review | Unit/integration | 028,029 | Разметка, повтор после исправления |
| T-011 | Комментарии и конфликты | API/UI | 035,043 | ACL, XSS, revision, tombstones |
| T-012 | Корзина, purge, audit | Integration | 015,036,044 | Проверка файлов/FK/audit rollback |
| T-013 | Яндекс OAuth/import | Contract/live | 002,046,048,059 | Обезличенный протокол реального smoke |
| T-014 | Mail WebDAV/import | Contract/live | 003,047,048,059 | XML/path/credentials tests и live smoke |
| T-015 | Export обоих провайдеров | Integration/live | 049-053,059 | Round-trip hash, quota/conflict/unknown |
| T-016 | UI/accessibility/responsive | Browser/manual | 037-044,053,057 | Скриншоты, keyboard и axe |
| T-017 | Схема, FK, unique, migrations | Integration | 009,026 | Real PostgreSQL tests |
| T-018 | OpenAPI и TS generation | Contract/build | 006,010,061 | Schema validation и clean generation diff |
| T-019 | Threat model, leaks, file attacks | Security | 056 | Отчёт по каждому abuse case |
| T-020 | Compose ARM64/restart/offline | System | 001,007,058 | Чистый запуск, ресурсы и exposed ports |
| T-021 | p95/OCR/CER/NER/нагрузка | Performance/quality | 004,060 | Dataset hash, hardware и измерения |
| T-022 | Backup/restore/observability | Recovery | 054,055 | Restore report, hashes, ACL и RPO/RTO |
| T-023 | Общий release gate | Acceptance | 064 | Сводный pass/fail/skipped с причинами |
| T-024 | CI/CD/PR/deploy/rollback | Delivery | 061-064 | Workflow/PR links и локальный deploy log |

## Правила evidence

Записывать дату, commit/image digest, окружение, команду либо последовательность UI, ожидаемый/фактический результат, ссылку на артефакт. Не хранить токены, app passwords, реальные тексты документов или подписанные download URL. Для live API достаточно ID теста, статуса и контрольной суммы безопасного файла.

При неизвестном исходе или отсутствии credentials ставить blocked/not run, а не passed. Использование mock фиксируется отдельно. Повторная проверка нужна после исправления дефекта или изменения затронутого поведения; неизменные успешные проверки не запускаются бесконечно.
