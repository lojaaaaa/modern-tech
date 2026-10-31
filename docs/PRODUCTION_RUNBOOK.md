# Production candidate: запуск и возврат

Конфигурация compose.production.yaml объединяется с compose.yaml (Compose 2.24.4+). Она использует собранные frontend/backend, не подключает исходники с хоста и выключает Vite. Вход локальный: 127.0.0.1:8089. Для внешнего hosting нужны TLS reverse proxy, APP_URL, secure session cookies и отдельные секреты окружения. Публичный сервер не развёрнут.

```sh
make backup
docker compose -f compose.yaml -f compose.production.yaml build api web
docker compose -f compose.yaml -f compose.production.yaml up -d api web worker worker-processing worker-transfers scheduler
docker compose -f compose.yaml -f compose.production.yaml exec -T api php artisan migrate --force
curl --fail http://localhost:8089/health/ready
```

Перед миграцией хранить backup БД/оригиналов/ключа и предыдущие immutable image digests. Не откатывать БД командой migrate:rollback вслепую. Для возврата приложения использовать предыдущие image digests; при несовместимой схеме — восстановление backup в отдельную БД с проверкой перед переключением. В текущей конфигурации нет автоматического удалённого CD и проверенного полного rollback; это блокирует объявление production-ready.

processing:reconcile каждые пять минут поднимает прерванные quarantined/scanning/extracting старше 20 минут при отсутствии активного lock и числе попыток менее пяти. После лимита состояние failed. Зависшие remote transfers получают OUTCOME_UNKNOWN и не перезаписывают облако автоматически. Не удалять lock активного worker.

Метрики доступны администратору на /api/v1/admin/metrics. Полный Prometheus scraper/dashboard и job latency histogram ещё требуют реализации.

## Проверенные локальные результаты

Production frontend image запущен отдельно на 8089, readiness ответил ready. PostgreSQL backup восстановлен в изолированную modern_restore_audit_20261031 (16 документов, 17 версий). Это проверяет восстановление БД, но не заменяет запуск полностью восстановленного приложения и проверку оригиналов.
