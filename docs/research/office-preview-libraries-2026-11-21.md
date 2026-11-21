# Библиотеки для предпросмотра офисных файлов

Проверено 21 ноября 2026 года.

## Как это работает в проекте

DOCX, XLSX и PPTX уже конвертирует LibreOffice в отдельном контейнере Gotenberg 8.24.0. `GeneratePreview` отправляет файл версии и получает PDF. Laravel управляет состоянием версии, исключает параллельную конвертацию, ограничивает скачивание 100 МиБ и сохраняет результат в приватном хранилище. Это соответствует требованию об изолированной конвертации. [Задание](../../backend/app/Modules/Processing/Jobs/GeneratePreview.php), [Compose](../../compose.yaml), [FR-032](../SPECIFICATION.md#10-антивирус-извлечение-и-preview).

## Готовые решения

| Решение | Применимость |
| --- | --- |
| `gotenberg/gotenberg-php` 2.x | Официальный клиент для Gotenberg 8. Собирает multipart-запрос `libreOffice()->convert()`, принимает поток PSR-7 и возвращает ответ PSR-7 через `send()`. Требования v2.27.0 совместимы с PHP 8.4 и PSR-7 3.2 из проекта. Клиент использует PSR-18, поэтому можно передать уже установленный Guzzle с нужными параметрами. [Матрица версий](https://gotenberg.dev/docs/getting-started/clients), [зависимости](https://raw.githubusercontent.com/gotenberg/gotenberg-php/v2.27.0/composer.json), [потоки](https://raw.githubusercontent.com/gotenberg/gotenberg-php/v2.27.0/src/Stream.php), [composer.lock](../../backend/composer.lock). |
| `spatie/laravel-pdf` | Драйвер Gotenberg передаёт HTML в Chromium. В проекте включён офисный маршрут LibreOffice, а маршруты Chromium отключены. [Исходник драйвера](https://raw.githubusercontent.com/spatie/laravel-pdf/main/src/Drivers/GotenbergDriver.php), [Compose](../../compose.yaml). |
| `ncjoes/office-converter` | Конвертирует те же три формата через установленный LibreOffice, используя пути к файлам. Потребуется запуск LibreOffice в окружении процесса PHP или отдельный сервис для обёртки. [Документация пакета](https://github.com/ncjoes/office-converter). |
| ONLYOFFICE Docs Conversion API | Самостоятельная альтернатива на другом движке. Поддерживает конвертацию в PDF и приём файла в запросе. Это смена конвертера с отдельной проверкой на контрольных документах. [Conversion API](https://api.onlyoffice.com/docs/docs-api/additional-api/conversion-api/request), [приём файла](https://api.onlyoffice.com/docs/docs-api/additional-api/conversion-api/request-from-file). |

## Что упрощается

SDK Gotenberg берёт на себя формирование запроса и проверку HTTP-статуса. Его `save()` получает имя из `Content-Disposition` и читает тело целиком в строку через `getContents()`. Для сохранения текущего лимита и потоковой записи нужен `send()` с настроенным HTTP-клиентом. Прямой Guzzle потребует отдельного способа подмены транспорта в тестах, поскольку `Http::fake()` относится к клиенту Laravel. Привязка PDF к версии и проверка записи в приватное хранилище остаются задачами приложения. [Исходник SDK](https://raw.githubusercontent.com/gotenberg/gotenberg-php/v2.27.0/src/Gotenberg.php), [параметры Guzzle](https://docs.guzzlephp.org/en/stable/request-options.html), [подмена запросов Laravel](https://laravel.com/docs/13.x/http-client#faking-responses).

Для одного HTTP-маршрута я бы оставил текущий клиент Laravel. Вызовы `sink()` и `withoutRedirecting()` выражают уже используемые параметры напрямую. Для лимита скачивания остаётся `progress`. `Cache::lock()->get($callback)` освобождает блокировку после выполнения callback, в том числе при исключении. [Laravel PendingRequest](https://api.laravel.com/docs/13.x/Illuminate/Http/Client/PendingRequest.html), [блокировки Laravel](https://laravel.com/docs/13.x/cache#managing-locks).

В задании есть две отдельные детали. У диска `local` задано `throw=false`, поэтому при ошибке записи `put()` может вернуть `false`. Сейчас результат записи игнорируется и `preview_key` может указывать на отсутствующий PDF. Лимит 200 страниц из FR-032 в задании пока не задан. Текущий Gotenberg 8.24.0 уже принимает `nativePageRanges`, поэтому первые 200 страниц можно запросить параметром `1-200` и проверить на контрольных файлах. [Настройка диска](../../backend/config/filesystems.php), [ошибки записи Laravel](https://laravel.com/docs/13.x/filesystem#failed-writes), [задание](../../backend/app/Modules/Processing/Jobs/GeneratePreview.php), [исходник маршрута Gotenberg 8.24.0](https://github.com/gotenberg/gotenberg/blob/v8.24.0/pkg/modules/libreoffice/routes.go#L67-L77).
