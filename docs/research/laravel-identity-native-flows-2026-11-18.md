# Нативные сценарии Identity в Laravel 13.39

Дата проверки: 18 ноября 2026 года. Основание: установленный `backend/vendor/laravel/framework` версии `v13.39.0`, официальный код этого тега и документация Laravel 13.x. Исследование ограничено сбросом пароля, подтверждением email, проверкой активности и отзывом сессий; тесты в рамках исследования не запускались.

## Сброс пароля

`Password::reset($credentials, $callback)` обращается к настроенному broker. Broker получает пользователя через user provider, проверяет reset token, вызывает callback, **после его успешного возврата удаляет token** и возвращает статус. Если callback выбрасывает исключение, до удаления token выполнение не доходит. Невалидный пользователь/token возвращаются статусом, а не автоматически сформированной HTTP-ошибкой. [PasswordBroker v13.39.0](https://github.com/laravel/framework/blob/v13.39.0/src/Illuminate/Auth/Passwords/PasswordBroker.php).

Для database driver `DatabaseTokenRepository` хранит хеш reset token, проверяет совпадение и срок действия по `created_at`; при создании нового token удаляет предыдущий token пользователя. Значение `expire` задаётся в минутах в конфигурации broker и преобразуется в секунды manager. В проекте сейчас `expire = 60`, `throttle = 60` секунд в [config/auth.php](../../backend/config/auth.php). [DatabaseTokenRepository v13.39.0](https://github.com/laravel/framework/blob/v13.39.0/src/Illuminate/Auth/Passwords/DatabaseTokenRepository.php), [PasswordBrokerManager v13.39.0](https://github.com/laravel/framework/blob/v13.39.0/src/Illuminate/Auth/Passwords/PasswordBrokerManager.php).

| Действие | Что делает нативный broker |
|---|---|
| Найти пользователя, проверить reset token и expiry | Выполняет через provider и token repository |
| Удалить использованный token | Выполняет после callback |
| Проверить форму нового пароля и confirmation | Оставляет HTTP-валидации приложения |
| Хешировать и сохранить новый пароль | Оставляет callback/модели |
| Обновить `remember_token` | Оставляет callback |
| Отправить событие `PasswordReset` | Оставляет callback/приложению |
| Удалить активные сессии пользователя | Не выполняет |
| Записать аудит, открыть транзакцию, взять row lock | Не выполняет |

Это различие прямо видно в `PasswordBroker::reset`; официальный пример самостоятельно сохраняет хеш, обновляет remember token и отправляет `PasswordReset`. [Laravel: Handling the Form Submission](https://laravel.com/framework/docs/13.x/passwords#handling-the-form-submission), [исходный broker](https://github.com/laravel/framework/blob/v13.39.0/src/Illuminate/Auth/Passwords/PasswordBroker.php).

В [User](../../backend/app/Models/User.php) уже есть `password => hashed`: присвоение открытого пароля через Eloquent вызывает нативный `Hash::make` при сохранении атрибута. Поэтому отсутствие явного `Hash::make` в callback не означает хранение открытого пароля; это работа cast, а не broker. [HasAttributes::castAttributeAsHashedString v13.39.0](https://github.com/laravel/framework/blob/v13.39.0/src/Illuminate/Database/Eloquent/Concerns/HasAttributes.php).

Нативный `EloquentUserProvider` использует дополнительные credentials как условия поиска, исключая поля с `password`; поэтому `active => true` в вызове broker — штатное ограничение выборки, не собственная проверка token. [EloquentUserProvider::retrieveByCredentials v13.39.0](https://github.com/laravel/framework/blob/v13.39.0/src/Illuminate/Auth/EloquentUserProvider.php).

**Ответственность проекта:** один reset должен атомарно изменить пароль, сохранить аудит и погасить token. Сам broker не сериализует два одновременных reset: проверка token и удаление разделены callback. Нужны существующая транзакция и блокировка пользователя до вызова broker с повторной проверкой актуальной активности. Это вывод из последовательности установленного кода, а не встроенная гарантия `Password::reset`. Атомарность распространяется на операции одной DB connection; общая транзакция с независимым хранилищем сессий из неё не следует. [PasswordBroker v13.39.0](https://github.com/laravel/framework/blob/v13.39.0/src/Illuminate/Auth/Passwords/PasswordBroker.php), [Laravel: Database Transactions](https://laravel.com/framework/docs/13.x/database#database-transactions).

## Подтверждение email

`EmailVerificationRequest` — штатный Form Request. Его `authorize()` сравнивает текущего пользователя с route `id` и SHA-1 текущего email с route `hash`, используя `hash_equals`. Подпись URL, expiry и `User.active` этот метод не проверяет. `fulfill()` проверяет `hasVerifiedEmail()`, вызывает `markEmailAsVerified()` и отправляет `Verified` только для ещё не подтверждённого пользователя. [установленный EmailVerificationRequest](../../backend/vendor/laravel/framework/src/Illuminate/Foundation/Auth/EmailVerificationRequest.php), [Laravel API: EmailVerificationRequest](https://api.laravel.com/docs/13.x/Illuminate/Foundation/Auth/EmailVerificationRequest.html).

Это идемпотентность относительно состояния переданного объекта User: уже подтверждённый объект не меняется повторно. В `fulfill()` нет refresh, row lock, транзакции или аудита. **Вывод из кода:** два одновременно загруженных неподтверждённых объекта сами по себе не обеспечивают ровно одно событие/аудит. Для существующего договора проекта состояние пользователя перечитывается под блокировкой; нативные проверки и `markEmailAsVerified()` не заменяют эту ответственность. [установленный исходный код](../../backend/vendor/laravel/framework/src/Illuminate/Foundation/Auth/EmailVerificationRequest.php), [MustVerifyEmail v13.39.0](https://github.com/laravel/framework/blob/v13.39.0/src/Illuminate/Auth/MustVerifyEmail.php).

Подпись и срок действия ссылки проверяет отдельный `signed` middleware: `hasValidSignature()` объединяет проверку подписи с `signatureHasNotExpired()`. Поэтому замена общего Request на `EmailVerificationRequest` не позволяет убрать `signed`. Официальный verification handler использует `auth` + `signed`. [Laravel: Email Verification Handler](https://laravel.com/framework/docs/13.x/verification#the-email-verification-handler), [UrlGenerator v13.39.0](https://github.com/laravel/framework/blob/v13.39.0/src/Illuminate/Routing/UrlGenerator.php), [ValidateSignature v13.39.0](https://github.com/laravel/framework/blob/v13.39.0/src/Illuminate/Routing/Middleware/ValidateSignature.php).

## Где нужен `verified`, а где `EnsureActive`

Нативный alias `verified` соответствует `EnsureEmailIsVerified`. Для пользователя с `MustVerifyEmail`, у которого email ещё не подтверждён, middleware возвращает JSON 403 либо перенаправляет на `verification.notice`. Он защищает операции, требующие уже подтверждённого адреса. [Laravel: Protecting Routes](https://laravel.com/framework/docs/13.x/verification#protecting-routes), [установленный EnsureEmailIsVerified](../../backend/vendor/laravel/framework/src/Illuminate/Auth/Middleware/EnsureEmailIsVerified.php).

**На маршрутах подтверждения и повторной отправки `verified` ставить нельзя:** они нужны неподтверждённому пользователю. Официальная схема: verification handler — `auth`, `signed`; resend — `auth`, throttle. Текущий [routes/web.php](../../backend/routes/web.php) уже держит оба маршрута в группе `auth`, `EnsureActive`, `auth.session`, а для verification добавляет `signed`. [Laravel: Verification Routing](https://laravel.com/framework/docs/13.x/verification#routing).

У Laravel 13.39 нет штатного middleware для произвольного проектного поля `User.active`: `auth` удостоверяет вход, `verified` проверяет email, `auth.session` отслеживает пароль сессии. Нативный `Auth::attempt([... 'active' => true])` добавляет условие только при попытке входа; он не проверяет дальнейшие запросы уже вошедшего пользователя. Проектный [EnsureActive](../../backend/app/Http/Middleware/EnsureActive.php) поэтому выполняет отдельную нужную функцию: logout, invalidation текущей сессии и HTTP 401 для заблокированной учётной записи. [Laravel: Additional Authentication Conditions](https://laravel.com/framework/docs/13.x/authentication#specifying-additional-conditions), [штатные aliases v13.39.0](https://github.com/laravel/framework/blob/v13.39.0/src/Illuminate/Foundation/Configuration/Middleware.php).

## Отзыв сессий

`Password::reset()` не удаляет сессии. Нативный `auth.session` сравнивает сохранённый fingerprint пароля с актуальным и при несовпадении завершает авторизацию на следующем запросе через этот middleware. Это отдельный механизм; он не перечисляет и не удаляет все строки пользователя в таблице сессий. [AuthenticateSession v13.39.0](https://github.com/laravel/framework/blob/v13.39.0/src/Illuminate/Session/Middleware/AuthenticateSession.php).

При согласованной для проекта таблице `sessions` нужные ID выбирает приложение по `user_id`, а `Session::getHandler()->destroy($id)` удаляет конкретную сессию через штатный handler. У `DatabaseSessionHandler::destroy` реализация — удаление записи по `id`; операции «удалить все сессии пользователя» этот Interface не предоставляет. Поэтому выбор ID и вызовы `destroy` остаются небольшой явной частью Action. Это применение штатного механизма к выбранному проектному хранению, не основание добавлять динамические драйверы или слой абстракций. [DatabaseSessionHandler v13.39.0](https://github.com/laravel/framework/blob/v13.39.0/src/Illuminate/Session/DatabaseSessionHandler.php).

## Сохраняемый HTTP-договор проекта

Следующее установлено по текущим контроллерам, маршрутам и [RegistrationTest](../../backend/tests/Feature/RegistrationTest.php), а не навязано Laravel:

| Сценарий | Текущий договор |
|---|---|
| Resend для активного неподтверждённого пользователя | 202, уведомление отправляется |
| Resend для уже подтверждённого пользователя | 200, без нового уведомления |
| Resend для заблокированного пользователя | 401 из `EnsureActive` до Action |
| Verification: изменённая/истёкшая подпись, чужие `id`/`hash` | 403 |
| Успешная verification | JSON с пользователем либо redirect `/?email_verified=1` |
| Forgot password | Одинаковое сообщение независимо от существования/активности аккаунта |
| Reset с невалидным/истёкшим/погашенным token | 422 |
| Успешный reset | Отзыв сессий по договору проекта, logout/invalidate текущего HTTP-запроса, новое значение CSRF token |

DTO, суффикс `Action`, `DB`/`Password`/`Event`/`Session` facades, явный `User::query()`, строки из `lang` и отсутствие Gate внутри Actions — согласованный стиль текущего рефакторинга. Нативные механизмы выше совместимы с ним; сами эти соглашения не являются требованиями Laravel. Исследование не меняет принятые доменные решения и не утверждает, что атомарность/конкурентное поведение уже доказаны тестами.
