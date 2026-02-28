# Аудит frontend-репозитория `cloud-canvas`

> Цель: дать новичку понятную карту проекта без изменения кода. Этот документ описывает текущую реализацию и риски.

## 1) Быстрое дерево проекта и ответственность папок

## Корень
- `src/` — весь клиентский код React + TypeScript.
- `public/` — статические ассеты для Vite.
- `supabase/` — edge functions и SQL-миграции (бэкенд-часть рядом с фронтом).
- `docs/` — проектная документация.

## Внутри `src/`
- `main.tsx` — точка входа React-приложения (монтирует `<App />`).
- `App.tsx` — композиция провайдеров и вся маршрутизация (React Router).
- `pages/` — страницы уровня роутов (Dashboard, Products, Import, Settings и т.д.).
- `components/` — переиспользуемые UI-компоненты и feature-компоненты.
  - `components/ui/` — дизайн-система на базе Radix/shadcn (кнопки, таблицы, диалоги, тосты, табы).
  - `components/layout/` — каркас приложения (`AppLayout`, хедер, сайдбар).
  - `components/normalization/`, `components/import/`, `components/calls/` — предметные блоки.
- `hooks/` — прикладные React-хуки (данные каталога, импорт, нормализация, active import и т.д.).
- `lib/` — инфраструктурная логика/утилиты:
  - API-обертки (`api-client.ts`, `catalog-api.ts`),
  - контрактные типы (`contract-types.ts`),
  - backend-конфиг импорта (`backend.ts`),
  - обработка ошибок, аудит/безопасность утилиты.
- `contexts/` — контексты приложения (сейчас ключевой — `AuthContext`).
- `i18n/` — инициализация i18next + словари `ru.json` / `en.json`.
- `integrations/supabase/` — Supabase client и типы DB.
- `test/` — базовый setup Vitest.

## Точка входа и роутинг
1. `src/main.tsx` рендерит `App` в `#root`.
2. `src/App.tsx` подключает:
   - `QueryClientProvider` (react-query),
   - `AuthProvider`,
   - UI-провайдеры (`Tooltip`, `Toaster`, `Sonner`),
   - `BrowserRouter` + `Routes`.
3. Вложенный роут `path="/" element={<AppLayout />}` оборачивает основные приватные страницы.
4. Публичные страницы (`/login`, `/register`, `/onboarding`) определены отдельно.

Практически: маршрутизация централизована в одном файле (`App.tsx`), что удобно для быстрого обзора.

---

## 2) Технологический стек и сборка

## Стек
- **Сборка**: Vite 5 (`vite`, `@vitejs/plugin-react-swc`).
- **UI**: React 18 + TypeScript, Radix UI, shadcn-подобные компоненты, TailwindCSS.
- **Данные**: `@tanstack/react-query`.
- **Роутинг**: `react-router-dom` v6.
- **Формы/валидация**: `react-hook-form`, `zod`.
- **Backend SDK**: `@supabase/supabase-js`.
- **i18n**: `i18next`, `react-i18next`, browser language detector.
- **Тесты**: Vitest + Testing Library + jsdom.

## Команды из `package.json`
- `npm run dev` — старт dev-сервера Vite.
- `npm run build` — production build.
- `npm run build:dev` — build в режиме development.
- `npm run preview` — локальный просмотр production build.
- `npm run lint` — ESLint по проекту.
- `npm run typecheck` — `tsc --noEmit`.
- `npm run test` — запуск Vitest.

## Линтинг/форматирование/тесты
- ESLint: есть (`eslint.config.js`), включает `typescript-eslint`, `react-hooks`, `react-refresh`.
- Prettier: отдельной конфигурации не найдено.
- Typecheck: отдельный скрипт есть, но строгие TS-флаги частично ослаблены (`strictNullChecks: false`, `noImplicitAny: false`).
- Unit-тесты: инфраструктура подключена, но покрытие очень скромное (фактически smoke-тест setup).

---

## 3) Архитектура UI (как это устроено сейчас)

## Основные страницы
По маршрутам в `App.tsx`:
- CRM/операционные: `Dashboard`, `Contacts`, `Companies`, `Leads`, `Orders`, `Invoices`.
- Коммуникации: `Email`, `Calls`.
- Каталог: `Products`, `Import`.
- Сервисные: `Analytics`, `Billing`, `Settings`, `NotFound`, auth-страницы.

## Блок каталога (самый сложный)
`ProductsPage` реализует табы:
- `ProductsTab` — работа с товарами,
- `DiscountRulesTab` — скидки,
- `ImportTab` — история/контроль импорта,
- `NormalizationTab` — запуск/мониторинг нормализации.

Есть модальные flow:
- загрузка прайса (`ImportPriceDialog`),
- проверка цены (`PriceQuoteDialog`),
- создание скидок (`DiscountRuleDialog`).

## Где состояние
- **Server state** — в основном через React Query (`useQuery`, `useMutation`).
- **Auth/session/profile** — через `AuthContext` + Supabase auth listener.
- **Локальный UI state** — `useState` в страницах/диалогах.
- Redux/Zustand не используются.

## Таблицы/формы/модалки
- Таблицы: комбинируются `Table`/кастомные колонки и обвязка пагинации/filter.
- Формы: чаще локальный state + частично react-hook-form.
- Модалки: через `Dialog` из UI-библиотеки (`components/ui/dialog.tsx`).

---

## 4) Интеграция с backend

## Общая модель
Frontend в основном общается с backend через **Supabase**:
1. Прямые запросы к таблицам (`supabase.from(...)`) для CRUD.
2. Вызовы Edge Functions (`supabase.functions.invoke(...)`) для сложных сценариев (импорт/нормализация/прокси каталога).

## Где API-вызовы
- Централизованные helper-слои:
  - `src/lib/api-client.ts` — унифицированный invoke с `organization_id` и `ApiContractError`.
  - `src/lib/catalog-api.ts` — `catalog-proxy` обертки (`items`, `facets`) + merge override.
  - `src/hooks/use-normalization.ts` — полный orchestration по `import-normalize` и `settings-merge`.
- Feature-уровень:
  - `ImportPriceDialog`, `ImportTab`, `NormalizationTab`, `NormalizationDialog` и т.д.

## Base URL и конфигурация
- Supabase URL/anon key сейчас захардкожены в `src/integrations/supabase/client.ts`.
- Для import-flow есть `src/lib/backend.ts`:
  - bucket: `imports`,
  - edge gateway имена: `import-validate`, `import-publish`,
  - генерация storage path.

## Основные edge endpoints (по коду)
- `catalog-proxy` — чтение каталога/фасетов (`src/lib/catalog-api.ts`).
- `import-normalize` — операции:
  - `dry_run`, `stats`, `dashboard`, `tree`, `confirm`, `ai_chat_v2`, `apply`, `apply_status`, `answer_question`, `preview_rows`.
- `settings-merge` — сохранение/мердж настроек нормализации.
- `import-validate` / `import-publish` — валидация и публикация прайса (через gateway-имена).

## Auth/session и organization_id
- Auth/session: `AuthContext` подписывается на `supabase.auth.onAuthStateChange`, держит `user`, `session`, `profile`.
- Профиль берется из таблицы `profiles`, в нем хранится `organization_id`.
- `organization_id` прокидывается в бизнес-операции (особенно import/normalization).

---

## 5) i18n / переводы

## Как устроено
- Инициализация в `src/i18n/index.ts`.
- Ресурсы: `src/i18n/locales/ru.json`, `src/i18n/locales/en.json`.
- Fallback язык: `ru`.
- Детекция языка: сначала `localStorage`, потом `navigator`.

## Что будет при отсутствии ключа
- `react-i18next` обычно возвращает key как строку, если перевода нет.
- Во многих местах используется `t('key', 'fallback')`, что снижает риск пустых UI-строк.

## Практическое правило изменения текстов
1. Добавлять ключи синхронно в `ru.json` и `en.json`.
2. Использовать неймспейсную структуру (`catalog.*`, `import.*`, `common.*`).
3. В коде по возможности оставлять второй аргумент fallback.
4. Не переименовывать массово существующие ключи без миграционного плана.

---

## 6) Топ-10 рисков/проблем (приоритетно для продакшена)

1. **Захардкоженный Supabase URL и publishable key в клиенте** — риски окружений и ротации ключей.
2. **Слабая строгость TypeScript** (`noImplicitAny: false`, `strictNullChecks: false`) — больше runtime-ошибок.
3. **Низкое тестовое покрытие** — фактически нет автотестов на критичные user flows (импорт/нормализация).
4. **Часть бизнес-логики находится прямо в UI-компонентах** (крупные диалоги/страницы) — сложно сопровождать.
5. **Повторение API-вызовов в нескольких местах** (нормализация в hook + компоненты) — риск расхождения поведения.
6. **Нет явного ErrorBoundary на уровне приложения** — падение дочернего дерева может ронять экран.
7. **Смешанная модель работы с API**: где-то через обертки (`api-client`), где-то прямые `supabase` вызовы.
8. **Большие файлы компонентов** (в т.ч. import/normalization) — сложность ревью и роста технического долга.
9. **i18n-ключи масштабные и потенциально не валидируются автоматически** — риск пропусков/опечаток.
10. **Сильная завязка на organization_id/profile** — при сбоях профиля многие разделы неочевидно деградируют.

## Что критично закрыть первым делом
- Контроль конфигурации окружений + ключей.
- Контрактные/интеграционные тесты для import/normalization.
- Повышение TS-строгости хотя бы поэтапно.
- Унификация вызовов API (через единый слой с типами ошибок).

---

## 7) План улучшений (минимально-инвазивный roadmap)

## A) Быстрые победы (1 день)
- Добавить/обновить docs по архитектуре и API-точкам (этот PR).
- Добавить checklist для PR: i18n parity RU/EN, organization_id, обработка ошибок.
- Включить базовые smoke-tests на критичные рендеры страниц.
- Проверить и документировать переменные окружения для dev/stage/prod.

## B) Улучшения на неделю
- Вынести крупные API-вызовы из UI в единый слой (`lib/api` + хуки).
- Добавить тесты на import flow (валидация, publish, ошибки).
- Добавить проверки отсутствующих i18n ключей (script/CI).
- Начать поднимать strictness TS (минимум для новых/изменяемых модулей).
- Добавить App-level ErrorBoundary + единый fallback UI.

## C) Улучшения на месяц
- Стабилизировать API-контракты: строгие DTO и runtime validation (zod schemas на вход/выход).
- Расслоить feature-модули (UI/logic/data) для import и normalization.
- Добавить e2e сценарии (минимум: login → import → normalize → publish).
- Внедрить метрики надежности (error rate edge invoke, timeout %, retry success).
- Упорядочить систему прав/ролей и деградацию UI при отсутствии профиля/организации.

---

## 8) Рекомендации без изменения функционала

Ниже только рекомендации (без массовых рефакторов и без изменений дизайна):
- Перевести Supabase URL/key на env-конфигурацию сборки.
- Зафиксировать договор по слоям: UI не делает прямой сложный orchestration.
- Ввести легковесный quality-gate в CI: `lint + typecheck + test`.
- Добавить шаблон runbook для инцидентов импорта (timeouts, worker unavailable, mapping errors).

