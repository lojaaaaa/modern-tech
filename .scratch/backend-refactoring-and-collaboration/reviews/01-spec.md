## Spec

Reviewed `git diff 9a7c9c8...HEAD` at `e4fcc52`, including implementation commit `5397254`, against canonical ticket 01 and its referenced specification. **No actionable implementation findings.**

Ticket 01 requires: «Проверки одного документа используют Policies владельца сущности; SQL-ограничение видимости остаётся частью Query». `DocumentPolicy` belongs to Documents, is explicitly registered, preserves the existing role/permission order and 404-versus-403 behavior, and is used by all former Access consumers, including the export worker. Listing/search SQL remains unchanged and applies visibility before pagination/count.

It also requires: «Удалена заменённая обёртка Access после переноса всех её потребителей» and «Сохранены текущие пользовательские результаты». The wrapper is deleted; no production consumer references remain. Existing version-parent checks remain, and new HTTP coverage exercises effective permissions, foreign-version rejection, preview/download data and private pagination/count.

No unrequested product behavior or mass refactoring was introduced. The ticket-plan explicitly says «Задача 01 — ограниченный предварительный перенос текущей авторизации»; deferred publication rules and tickets 02–46 are therefore outside this review's implementation scope. The separate-PR criterion remains visibly open, consistent with the stated missing GitHub authentication.

Findings: 0. No worst issue.
