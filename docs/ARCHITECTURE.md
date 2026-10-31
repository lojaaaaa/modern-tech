# Архитектура 1.0

Источник требований: SPECIFICATION.md. Статус: baseline для реализации, код ещё не создан.

## Контекст

```mermaid
flowchart LR
 U[Сотрудник / наблюдатель / администратор] --> P[Платформа документов]
 P <--> Y[Яндекс Диск REST OAuth]
 P <--> M[Облако Mail WebDAV]
 P --> L[Mailpit: локальные письма]
```

## Контейнеры и границы

```mermaid
flowchart TB
 B[Браузер React] --> N[Reverse proxy: один origin]
 N --> A[Laravel API: доменные модули]
 A --> DB[(PostgreSQL: ACL, метаданные, FTS, outbox)]
 A --> FS[(Приватные оригиналы и артефакты)]
 A --> C[(Redis cache)]
 D[Outbox dispatcher] --> DB
 D --> Q[(Redis queue)]
 Q --> W[Workers: short / OCR / transfers]
 W --> DB
 W --> FS
 W --> AV[ClamAV]
 W --> T[Tika / Tesseract]
 W --> G[Gotenberg]
 W --> NLP[Локальный NLP]
 W --> CLOUD[Яндекс / Mail]
 S[Scheduler / reconciliation] --> DB
 O[Prometheus / Grafana] --> A
 O --> W
```

Клиент не обращается напрямую к БД, парсерам или credentials провайдера. Публичные порты обработчиков не открыты. Queue и cache используют разные экземпляры Redis. Все мутации ACL и связанный audit транзакционны.

## Загрузка и публикация

```mermaid
sequenceDiagram
 participant U as Пользователь
 participant A as API
 participant D as БД/outbox
 participant Q as Очередь
 participant W as Worker
 participant P as Парсеры
 U->>A: Файл + Idempotency-Key
 A->>A: Проверка / приватный временный blob
 A->>D: Tx: документ, версия, outbox, audit
 A-->>U: 202 + version_id
 D->>Q: Dispatcher (возможны повторы)
 Q->>W: stage job
 W->>P: Scan, extract/OCR
 P-->>W: Результат / контролируемая ошибка
 W->>D: Идемпотентный результат этапа
 W->>D: Publish только desired и не deleted
 U->>A: Поиск
 A->>D: FTS + актуальная ACL до count
 A-->>U: Доступные результаты
```

## Экспорт при неопределённом исходе

```mermaid
sequenceDiagram
 participant U as Пользователь
 participant A as API
 participant W as Transfer worker
 participant C as Облако
 U->>A: version_id + connection_id + папка
 A->>A: ACL + владение подключением
 A-->>U: transfer_id
 W->>W: Проверить актуальные права и фиксированную версию
 W->>C: Запись без перезаписи
 alt Провайдер подтвердил завершение
 C-->>W: Успех
 W->>A: succeeded + remote metadata
 else Сеть оборвалась
 W->>C: Проверить назначение и содержимое
 W->>A: succeeded либо outcome_unknown
 end
```

## Модель связей

```mermaid
erDiagram
 USERS ||--o{ DOCUMENTS : owns
 DOCUMENTS ||--o{ VERSIONS : contains
 BLOBS ||--o{ VERSIONS : stores
 DOCUMENTS ||--o{ DOCUMENT_GRANTS : protects
 USERS ||--o{ DOCUMENT_GRANTS : receives
 VERSIONS ||--o{ PROCESSING_RUNS : processes
 VERSIONS ||--o{ TEXT_SEGMENTS : indexes
 VERSIONS ||--o{ ENTITY_CANDIDATES : extracts
 ENTITY_CANDIDATES ||--o{ ENTITY_REVIEWS : reviews
 DOCUMENTS ||--o{ COMMENTS : discusses
 USERS ||--o{ CONNECTIONS : owns
 CONNECTIONS ||--o{ TRANSFERS : executes
 VERSIONS ||--o{ TRANSFERS : exports
```

Точный словарь полей, индексов и ограничений: раздел 20 ТЗ. desired/published принадлежат тому же документу; это дополнительно проверяется на уровне целостности/транзакции.

## Структура будущего репозитория

- frontend/src/{app,pages,features,shared}
- backend/app/Modules/{Identity,Access,Documents,Processing,Search,Entities,Collaboration,Audit,Integrations}
- services/nlp; infra/compose; contracts/openapi.yaml
- tests/fixtures; tests/e2e; docs; tools

Не создавать слои и абстракции только ради структуры: модуль владеет правилами, внешние вызовы находятся в адаптерах. Конкретные файлы приложения появятся при выполнении tasks.json.
