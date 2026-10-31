# Соглашения кода

Источник: локальный ex/client (eslint.config.js, .prettierrc и страницы src/pages). Адаптация: React 19/TS strict, pages-first app/pages/features/shared; дополнительные entities/widgets из ex не переносятся.

Страница экспортируется через index.ts, реализация находится в ui/Name.tsx. Состояние и операции выносятся в model, чистые преобразования — в lib по мере появления самостоятельной ответственности. Shared не импортирует верхние слои; features не импортируют pages/app. Клиентские функции — стрелочные. Формат: 4 пробела, одинарные кавычки, trailingComma es5, LF, 120 колонок.

ESLint проверяет Hooks, типовые импорты, отсутствие any, фигурные скобки и запрет function declarations/expressions. Prettier проверяется отдельно, чтобы не дублировать formatter в lint. PHP: Laravel Pint (strict_types), Larastan level 5 без baseline.

Установка hooks: scripts/install-hooks.sh. Pre-commit проверяет клиент и при серверных изменениях Pint/Larastan через Docker. Проверки не исправляют и не добавляют файлы в индекс автоматически. Docker должен быть запущен для PHP-проверок.
