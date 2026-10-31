# Modern Tech

Платформа для работы с документами внутри команды. Загружайте файлы, ищите по их содержимому, просматривайте версии и обсуждайте нужные фрагменты в комментариях. Доступ к документам настраивается по ролям и участникам. Есть распознавание текста, журнал действий и импорт и экспорт через Яндекс Диск и Облако Mail.

**Стек:** React, TypeScript, Zustand, TanStack Query, Laravel, PostgreSQL, Redis. Обработка файлов — Apache Tika, Tesseract, Gotenberg и ClamAV. Всё запускается через Docker Compose.

Для локального запуска нужны Docker Compose, Make, Python 3 и OpenSSL:

```sh
make up
```

Приложение откроется на http://localhost:8088.
