# Тестовый контур

Контур запускается независимо от разработки: `compose.staging.yaml`, проект `modern-tech-staging`, отдельные тома PostgreSQL, очереди и файлов. Исходники с хоста не подключаются; frontend собирается и обслуживается Nginx. По умолчанию доступ только с этой машины на http://localhost:8089. Если порт занят, поменяйте STAGING_PORT в `.local/staging/compose.env` и APP_URL/SANCTUM_STATEFUL_DOMAINS в `.local/staging/backend.env` до запуска.

Требуются Docker Compose, Python 3 и свободные ресурсы для OCR/антивируса. Сборка образов и первоначальная загрузка антивирусных баз требуют интернета.

```sh
make staging
curl --fail http://localhost:8089/health/ready
```

Скрипт сохраняет существующие секреты, собирает образы, запускает зависимости, выполняет миграции перед запуском обработчиков. ClamAV может готовить базы несколько минут: до готовности обработка файлов закрывается безопасно. Демо-учётные записи автоматически не создаются. Первого администратора создайте командой ниже; пароль вводится скрыто. Не используйте реальные документы в общедоступном демонстрационном контуре.

```sh
docker compose --env-file .local/staging/compose.env -f compose.staging.yaml exec api php artisan app:create-admin admin@example.com
docker compose --env-file .local/staging/compose.env -f compose.staging.yaml logs --tail=100 api worker-processing
docker compose --env-file .local/staging/compose.env -f compose.staging.yaml down
```

Не используйте `down --volumes`, если данные требуется сохранить. Не копируйте APP_KEY из другого окружения и сохраняйте ключ вместе с резервной копией: без него нельзя расшифровать подключения к облакам.

Для удалённого сервера настройте TLS reverse proxy, домен в APP_URL/SANCTUM_STATEFUL_DOMAINS, SESSION_SECURE_COOKIE=true, SMTP и резервные копии. Порт приложения остаётся на loopback; порты PostgreSQL/Redis/обработчиков наружу не опубликованы. Mailpit служит только тестовой почтой. Автоматический удалённый деплой не включён: сервер и доступ к нему ещё не заданы.

## Публикация репозитория

В Git идут исходники frontend/backend, миграции, тесты, схемы API, docs, Dockerfile/Compose и CI. `.env`, `.local/`, agents/, зависимости, сборки, журналы, ключи, приватные npm-настройки и дампы исключены. Готовое PDF ТЗ хранится в docs/. Вспомогательный генератор документации перенесён в локальную agents/ и не публикуется.

Перед push проверьте `git status --short` и `git diff --cached --stat`: игнорирование не удаляет секреты из уже существующей истории Git. Если секрет когда-либо публиковался, его нужно заменить. CI проверяет клиент, PHP и сборки обоих образов, а также структуру тестового Compose. Публикация в GitHub и запуск удалённого контура выполняются отдельно.
