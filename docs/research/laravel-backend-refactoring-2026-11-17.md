# Практики ответственного рефакторинга PHP / Laravel

Дата исследования: 17 ноября 2026 года. Статус: исследование и рекомендации для согласования; правила и изменения отдельных модулей этим документом не утверждаются.

## Контекст и метод

Проверены первичные источники: документация Laravel **13.x**, исходный код framework **v13.39.0**, руководство PHP, PHP-FIG, документация PHPUnit и авторов инструментов. Нормы фреймворка отделены ниже от инженерных рекомендаций для Modern Tech. Универсальная «единственно правильная архитектура Laravel» из этих источников не следует: Laravel разрешает произвольное расположение классов, если их загружает Composer. [Laravel: Directory Structure](https://laravel.com/framework/docs/13.x/structure#introduction).

Версии репозитория установлены по [composer.json](../../backend/composer.json) и [composer.lock](../../backend/composer.lock), без обновления зависимостей:

| Позиция | Значение |
|---|---|
| PHP | Требование `^8.4`; Composer platform `8.4.1`, что само по себе не доказывает версию запущенного интерпретатора |
| Laravel | Требование `^13.17`, lock `v13.39.0` |
| PHPUnit | `12.5.42` |
| Larastan | `v3.13.2` |
| Pint | `v1.32.1` |
| Scramble | `v0.13.52` |
| PostgreSQL | Образ `postgres:18-alpine` в [compose.yaml](../../compose.yaml), без утверждения о фактически запущенном patch-релизе |

Доменные решения проекта имеют приоритет над стилистическими рецептами. [ADR-003](../adr/0003-business-modules.md) уже определяет пять бизнес-модулей: Identity, Documents, Collaboration, Processing, Integrations; аудит и наблюдаемость относятся к общей инфраструктуре. [ADR-004](../adr/0004-drafts-and-publication.md) и [ADR-005](../adr/0005-discussions-and-version-history.md) закрепляют публикацию владельцем, подтверждённый снимок, неизменяемые версии и историю обсуждений. Это принятые требования, а не выводы внешнего исследования.

## Что следует из официальных механизмов

### HTTP, валидация и авторизация

**Документировано.** Form Request объединяет правила входных данных и `authorize()`; проверка выполняется до вызова метода контроллера. Доступны `validated()` и `safe()`. Laravel также поддерживает обычную inline-валидацию, поэтому Form Request — средство организации кода, а не обязательная церемония для каждого запроса. [Laravel: Form Request Validation](https://laravel.com/framework/docs/13.x/validation#form-request-validation).

**Для загрузок.** `mimes` определяет MIME по содержимому, хотя параметры названы расширениями; `extensions` проверяет пользовательское расширение. Одного имени недостаточно. Неверный рецепт «mimes проверяет только расширение» применять нельзя. [Laravel: MIME Types and Extensions](https://laravel.com/framework/docs/13.x/validation#rule-mimes).

**Рекомендация для проекта.** Контроллер принимает HTTP-ввод, передаёт проверенные значения и действующего пользователя в сценарий, формирует ответ. Транзакции, переходы состояния, координацию файлов, аудита и outbox следует держать внутри соответствующего Module. Проверка «это строка допустимой длины» относится к вводу; «документ разрешено публиковать в этом состоянии» — инвариант сценария, который должен действовать также при вызове из job или команды. Это проектное разделение ответственности на основе механизмов валидации, не отдельное требование Laravel. [Laravel: Validation](https://laravel.com/framework/docs/13.x/validation), [Laravel: Controllers](https://laravel.com/framework/docs/13.x/controllers).

**Документировано.** Policies группируют разрешения вокруг модели или ресурса; Gates подходят также для операций без модели. Проверку можно вызвать вне контроллера через Gate. Policy может возвращать отказ с выбранным статусом, включая сокрытие существования ресурса. [Laravel: Authorization](https://laravel.com/framework/docs/13.x/authorization).

**Рекомендация для проекта.** Вынесенный сценарий должен иметь явный договор об авторизации: кто действует, какие права проверяются и какие проверки повторяются после блокировки изменяемого состояния. Для сценария с HTTP, queue и CLI нельзя оставлять единственную проверку в Form Request. Повторно используем одну Policy; дублировать её условия в Action не нужно. Внутренний системный сценарий получает явно описанные полномочия, вместо неявного обхода через `auth()`. Общий административный `before()` обязан сохранять исключение owner-only publication из ADR-004. Основание: механизмы Policies и принятый доменный контракт. [Laravel: Policy Filters](https://laravel.com/framework/docs/13.x/authorization#policy-filters), [ADR-004](../adr/0004-drafts-and-publication.md).

### Actions, Queries, Interface и зависимости

**Документировано.** Контейнер автоматически разрешает конкретные классы и умеет связывать контракт с реализацией. Контроллеры поддерживают **и constructor injection, и method injection**. Запрет method injection не является правилом Laravel. [Laravel: Service Container](https://laravel.com/framework/docs/13.x/container#zero-configuration-resolution), [Laravel: Controller Dependency Injection](https://laravel.com/framework/docs/13.x/controllers#dependency-injection-and-controllers).

**Рекомендация для проекта.** Actions — локальная конвенция именования пользовательских сценариев из ADR-003. Queries нужны для самостоятельных выборок; DTO — когда типизированный набор значений действительно упрощает Interface. Название `Action` или перенос метода в `Service` сами по себе не создают Depth. Следуем `codebase-design`: маленький Interface должен скрывать инварианты и согласованность всей операции, давать Locality и Leverage повторным вызывающим местам. Не вводим обязательную цепочку Controller → Service → Repository для каждой таблицы. Конкретный Eloquent-класс внутри Module допустим; контракт и Adapter оправданы реальной вариативностью или управляемой внешней зависимостью. Это проектная рекомендация, согласующаяся со свободой структуры и автоматическим разрешением конкретных зависимостей. [Laravel: Directory Structure](https://laravel.com/framework/docs/13.x/structure#introduction), [Laravel: Container](https://laravel.com/framework/docs/13.x/container#binding-interfaces-to-implementations), [ADR-003](../adr/0003-business-modules.md).

**Практический критерий.** Если удалить новый класс и сложность исчезнет, класс был лишним перенаправлением. Если инварианты, блокировки и повторяемая координация вновь разойдутся по нескольким вызывающим местам, выделенный Module полезен. Это критерий применяемого навыка `codebase-design`, не формальное правило Laravel.

### Выборки, Eloquent и сериализация

**Документировано.** Eloquent предоставляет relationships и scopes; eager loading уменьшает N+1, а запрет lazy loading помогает находить скрытые запросы. [Laravel: Query Scopes](https://laravel.com/framework/docs/13.x/eloquent#query-scopes), [Laravel: Eager Loading](https://laravel.com/framework/docs/13.x/eloquent-relationships#eager-loading), [Laravel: Preventing Lazy Loading](https://laravel.com/framework/docs/13.x/eloquent-relationships#preventing-lazy-loading).

**Рекомендация для проекта.** Повторяющиеся ACL-условия и библиотечные фильтры помещаем в осмысленные Queries/scopes; фильтруем доступность в SQL до пагинации. Для курсора описываем устойчивую сортировку и уникальный дополнительный ключ. Оптимизируем по наблюдаемым запросам и планам, а не через механическое добавление кэша. Query Builder связывает значения параметрами, но имена SQL-колонок нельзя принимать из недоверенного ввода без списка разрешённых. [Laravel: Query Builder](https://laravel.com/framework/docs/13.x/queries#introduction).

**Документировано.** Resources управляют JSON-представлением и условным включением загруженных отношений. Внешний ресурс по умолчанию оборачивается в `data`; пагинация имеет собственные правила `data`, `links`, `meta`. Поэтому механическая замена существующего ответа Resource может изменить контракт. [Laravel: Resources](https://laravel.com/framework/docs/13.x/eloquent-resources#data-wrapping), [Laravel: Conditional Relationships](https://laravel.com/framework/docs/13.x/eloquent-resources#conditional-relationships).

**Рекомендация для проекта.** Перед заменой контроллера фиксируем HTTP-статусы, JSON, порядок, cursor, nullable-поля, ошибки и разрешения тестами поведения. Resource занимается представлением; доступ к отношениям должен быть подготовлен выборкой. Экспорт OpenAPI и его diff дополняют тесты исполнения. ADR-001 закрепляет Scramble → OpenAPI → клиентские типы; успешный экспорт не доказывает совместимость поведения. [ADR-001](../adr/0001-baseline.md), [Scramble: Getting Started](https://scramble.dedoc.co/usage/getting-started).

### Транзакции, конкуренция и внешние эффекты

**Документировано.** `DB::transaction()` откатывает изменения при исключении; можно задать повторные попытки при deadlock. `lockForUpdate()` предоставляет пессимистическую блокировку, которую документация рекомендует использовать в транзакции. [Laravel: Database Transactions](https://laravel.com/framework/docs/13.x/database#database-transactions), [Laravel: Pessimistic Locking](https://laravel.com/framework/docs/13.x/queries#pessimistic-locking).

**Рекомендация для проекта.** Сценарий владеет транзакцией изменения своей модели и связанного аудита/outbox. После захвата блокировки проверяем актуальное состояние и инвариант; блокировать следует запись, защищающую весь инвариант, а не произвольную дочернюю строку. Для пакетной операции заранее выбираем договор: атомарный пакет или результаты отдельных элементов. Внешний HTTP, отправку email и изменение файлов нельзя считать откатываемыми вместе с SQL. Особенно опасен повтор транзакции, внутри которой уже выполнен внешний эффект: он может повториться. Это инженерный вывод из семантики транзакций и повторов. [Laravel: Transactions](https://laravel.com/framework/docs/13.x/database#database-transactions), [PostgreSQL 18: Explicit Locking](https://www.postgresql.org/docs/18/explicit-locking.html).

**Документировано.** `after_commit` / `afterCommit()` откладывает постановку задания до фиксации родительских транзакций; при rollback такое задание отбрасывается. Это решает порядок видимости данных для worker. [Laravel: Jobs and Database Transactions](https://laravel.com/framework/docs/13.x/queues#jobs-and-database-transactions).

**Критическое различие.** Callback после commit не равен устойчивому transactional outbox. В framework v13.39.0 callbacks хранятся в массиве объекта `DatabaseTransactionRecord` и вызываются в процессе PHP. **Вывод из исходного кода:** завершение процесса после SQL commit, но до доставки в Redis оставляет окно потери уведомления. Для обязательного запуска обработки сохраняем outbox в той же транзакции, что и данные; dispatcher повторяет доставку, обработчик переносит дубликаты. Такой принцип уже принят ADR-001. [Laravel v13.39.0: DatabaseTransactionRecord](https://github.com/laravel/framework/blob/v13.39.0/src/Illuminate/Database/DatabaseTransactionRecord.php), [AWS: Transactional Outbox](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html), [ADR-001](../adr/0001-baseline.md).

### Очереди и интеграции

**Документировано.** Для jobs настраиваются попытки, backoff, timeout и предотвращение overlap/дубликатов постановки. Timeout worker должен быть короче `retry_after`, иначе возможна повторная обработка ещё работающего задания. Долгий сетевой вызов требует собственного таймаута. [Laravel: Queues](https://laravel.com/framework/docs/13.x/queues#job-expirations-and-timeouts).

**Рекомендация для проекта.** Unique job и lock не заменяют идемпотентность результата. Повтор `ProcessVersion`/`ProcessTransfer` не должен создавать второй опубликованный результат или повторно экспортировать документ без согласованного правила. Идентификатор операции, уникальные ограничения и переходы состояния проектируем вместе. Проверяем сбой после внешнего эффекта и до отметки завершения. Это вывод из возможности повторов и outbox-доставки. [AWS: Outbox — Issues and Considerations](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html#issues-and-considerations), [ADR-001](../adr/0001-baseline.md).

**Документировано.** HTTP client Laravel имеет `timeout`, `connectTimeout`, `retry`, `fake`, `preventStrayRequests`. По умолчанию ответы 4xx/5xx не превращаются в исключения автоматически. [Laravel: HTTP Client](https://laravel.com/framework/docs/13.x/http-client#timeout), [Laravel: HTTP Client Error Handling](https://laravel.com/framework/docs/13.x/http-client#error-handling).

**Рекомендация для проекта.** Внешний Adapter переводит ответы провайдера в ограниченный набор результатов/ошибок, проверяет схему ответа, скрывает credentials и допускает осмысленный fake в тестах. Повторяем автоматически только операции с безопасной семантикой повторов; «сетевой timeout» не доказывает, что удалённая запись не произошла. Это проектное решение о контракте интеграции, не гарантия `Http::retry()`. [Laravel: Retries](https://laravel.com/framework/docs/13.x/http-client#retries), [PHPUnit 12.5: Test Doubles](https://docs.phpunit.de/en/12.5/test-doubles.html).

**Документировано и следствие.** `defer()` запускает closure после ответа и по умолчанию пропускает её при неуспешном завершении запроса. Это подходит для необязательной работы; обязательный аудит, публикация и обработка требуют другого договора надёжности. Последнее — рекомендация из семантики `defer`, не запрет Laravel. [Laravel: Deferred Functions](https://laravel.com/framework/docs/13.x/helpers#deferred-functions).

### Ошибки, PHP и проверки качества

**Документировано.** Laravel позволяет централизовать reporting/rendering исключений в `bootstrap/app.php`; в production `APP_DEBUG` должен быть выключен, чтобы не раскрывать конфигурацию. [Laravel: Error Handling](https://laravel.com/framework/docs/13.x/errors#configuration).

**Рекомендация для проекта.** Ожидаемые отказы сценария различаем по смыслу; перевод в существующий HTTP-контракт выполняем у HTTP-входа или центральным renderer. Не перехватываем любой `Throwable` с успешным ответом и не дублируем большой `try/catch` по контроллерам. Изменение формы ошибок согласовываем отдельно от переноса логики. Основание: документированные механизмы rendering/reporting. [Laravel: Rendering Exceptions](https://laravel.com/framework/docs/13.x/errors#rendering-exceptions).

**Документировано.** PHP поддерживает типы аргументов, возвращаемых значений и свойств; `strict_types` действует на уровне файла для скалярных вызовов и не превращает произвольный массив в проверенный DTO. PSR-12 регулирует оформление, а не доменную архитектуру. [PHP: Type Declarations](https://www.php.net/manual/en/language.types.declarations.php), [PHP-FIG: PSR-12](https://www.php-fig.org/psr/psr-12/).

**Рекомендация для проекта.** Сохраняем уже принятые `declare(strict_types=1)`, native types, Pint preset `laravel` и Larastan level 5 без baseline. PHPDoc используется для collection generics и array shapes, когда native types недостаточно. Повышение уровня анализа обсуждаем отдельно: подавления и baseline ради зелёного статуса не заменяют исправление причин. Pint и Larastan решают разные задачи; оба не доказывают сохранение бизнес-поведения. [Pint: Configuration](https://laravel.com/framework/docs/13.x/pint#configuring-pint), [Larastan v3.13.2](https://raw.githubusercontent.com/larastan/larastan/v3.13.2/README.md), [текущие соглашения](../CODE_CONVENTIONS.md), [pint.json](../../backend/pint.json), [phpstan.neon](../../backend/phpstan.neon).

## Проверки поведения до и после переноса

**Документировано.** Laravel рекомендует большинство проверок писать как feature tests; они могут охватывать целый JSON-запрос. PHPUnit уже поддерживается, смена тестового фреймворка ради рефакторинга не требуется. HTTP helpers позволяют проверять ответы, а database helpers — состояние базы. [Laravel: Testing](https://laravel.com/framework/docs/13.x/testing#introduction), [Laravel: HTTP Tests](https://laravel.com/framework/docs/13.x/http-tests), [Laravel: Database Testing](https://laravel.com/framework/docs/13.x/database-testing).

**Рекомендация для проекта.** Основная тестовая поверхность — Interface сценария и его наблюдаемые результаты: права, изменения данных, аудит, outbox, ошибки и HTTP-контракт. Не закрепляем тестами число внутренних классов, private-методы и последовательность вызовов Eloquent. Чистые преобразования проверяем изолированно; внешние системы подменяем управляемыми doubles. Выбор `RefreshDatabase`/`LazilyRefreshDatabase` обусловлен изоляцией и требованиями к реальному commit; массовая смена trait сама по себе не улучшает покрытие. Это проектная стратегия на основе возможностей инструментов и `codebase-design`. [Laravel: Database Testing](https://laravel.com/framework/docs/13.x/database-testing#resetting-the-database-after-each-test), [PHPUnit: Test Doubles](https://docs.phpunit.de/en/12.5/test-doubles.html).

**Установленное ограничение репозитория.** [phpunit.xml](../../backend/phpunit.xml) принудительно задаёт SQLite `:memory:`, array cache и sync queue. [Tests\TestCase](../../backend/tests/TestCase.php) дополнительно отказывается создавать приложение с другой базой. Поэтому существующий стандартный suite сам по себе не подтверждает PostgreSQL FTS, PostgreSQL locks, межпроцессные Redis locks и доставку через worker. Это наблюдение по коду, не результат запуска тестов и не утверждение, что все эти сценарии сломаны.

**Рекомендация для проекта.** Для затронутых инвариантов конкуренции, FTS и фоновой доставки требуется отдельный изолированный набор PostgreSQL 18 / Redis с несколькими соединениями/процессами и безопасным test-only хранилищем. Простой запуск feature tests на PostgreSQL без конкурирующих транзакций тоже не доказывает отсутствие гонки. Не ослабляем текущую защиту тестовой базы до согласования безопасной замены. Основание: backend-specific семантика блокировок и общий lock store для нескольких процессов. [PostgreSQL 18: Row-Level Locks](https://www.postgresql.org/docs/18/explicit-locking.html#LOCKING-ROWS), [Laravel: Atomic Locks](https://laravel.com/framework/docs/13.x/cache#atomic-locks).

## Какие категоричные рецепты применять не следует

Следующие выводы — интерпретация источников применительно к этому проекту:

| Рецепт | Почему не принимать автоматически |
|---|---|
| «Каждый метод контроллера до 10 строк» | Счётчик строк не выражает Interface и инварианты. Критерий — ответственность; официальная документация не задаёт такой предел. [Controllers](https://laravel.com/framework/docs/13.x/controllers) |
| «Только constructor injection» | Method injection явно поддерживается фреймворком. Для Action, используемого одним HTTP-методом, оно может точнее выразить зависимость. [Controller DI](https://laravel.com/framework/docs/13.x/controllers#dependency-injection-and-controllers) |
| «Repository и PHP interface над каждой моделью» | Laravel допускает непосредственный Eloquent и auto-resolve конкретных классов. Дополнительный seam требует объяснения пользы. [Eloquent](https://laravel.com/framework/docs/13.x/eloquent), [Container](https://laravel.com/framework/docs/13.x/container#zero-configuration-resolution) |
| «Любая проверка живёт в Form Request» | Это HTTP-механизм; доменные инварианты нужны и другим входам сценария. [Form Requests](https://laravel.com/framework/docs/13.x/validation#form-request-validation) |
| «Везде заменить ручной поиск implicit binding» | Binding возвращает 404 при отсутствии модели; отдельная авторизация остаётся нужна. Сохраняем договор 403/404, вложенность, soft delete и порядок проверок. [Route Model Binding](https://laravel.com/framework/docs/13.x/routing#route-model-binding) |
| «afterCommit гарантирует доставку» | Он задаёт порядок запуска; durable outbox решает другой риск. [Callbacks framework v13.39.0](https://github.com/laravel/framework/blob/v13.39.0/src/Illuminate/Database/DatabaseTransactionRecord.php) |
| «defer подходит для любого лёгкого действия» | Стоимость действия и допустимость его потери — разные вопросы. [Deferred Functions](https://laravel.com/framework/docs/13.x/helpers#deferred-functions) |
| «Любой sync job или lock можно проверить на SQLite/array» | In-process проверка не воспроизводит реальные конкурентные соединения и общий lock store. [Atomic Locks](https://laravel.com/framework/docs/13.x/cache#atomic-locks), [PostgreSQL locks](https://www.postgresql.org/docs/18/explicit-locking.html) |

## Применение к модулям: вопросы для отдельного согласования

Это направления обследования и договоры будущих Interface, а не утверждение текущей реализации:

| Module | Что согласовать перед изменениями | Основание проекта |
|---|---|---|
| Documents | Сценарии метаданных, ACL, корзины и пакетов; SQL-видимость; атомарность изменения и аудита; отдельный этап для загрузки и публикации | ADR-003, ADR-004 |
| Identity | Учётная запись, подтверждение email, роли, блокировки; HTTP-сессия отдельно от общего сценария; защита последнего администратора | ADR-002, ADR-003 |
| Collaboration | Места редакторов, общий черновик, callback офисного редактора, подтверждение сохранения, неизменяемый снимок обсуждений | ADR-002, ADR-004, ADR-005 |
| Processing | Переходы состояния версии, повторяемость этапов, outbox, восстановление после аварии | ADR-001, ADR-003 |
| Integrations | Контракт облачного Adapter, credentials, safe retry, импорт/экспорт через документные сценарии | ADR-001, ADR-003 |

Перед началом каждого Module фиксируем: затронутые сценарии и файлы; текущие контракты; предлагаемый Interface и seam; инварианты; правила авторизации/транзакции/ошибок; проверки и ограничения; способ отката. Владелец согласует этот конкретный объём и применяемые правила. Само исследование не даёт разрешения переписать все модули. Это порядок работы, явно запрошенный пользователем.

## Ограничения исследования

Это исследование практик и чтение конфигурации, без исполнения бизнес-сценариев, нагрузочных измерений, тестов конкуренции или проверки живых облачных аккаунтов. Документация `13.x` обновляется внутри major-ветки; детали реализации зафиксированы исходным кодом **v13.39.0** там, где это существенно. Конкретный метод перед изменением проверяется также по установленному framework. Советы о структуре Actions/Queries/DTO, обработке ошибок и стратегии тестов являются предлагаемыми инженерными решениями и требуют согласования на уровне Module.
