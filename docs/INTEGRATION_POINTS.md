# Integration points: frontend ↔ backend

Документ перечисляет основные точки интеграции в текущем frontend.

## 1) Базовая интеграция с Supabase
- Client: `src/integrations/supabase/client.ts`
  - `createClient(...)`
  - auth persistence в `localStorage`

## 2) Аутентификация и сессия
- Файл: `src/contexts/AuthContext.tsx`
- Основное:
  - `supabase.auth.onAuthStateChange`
  - `supabase.auth.getSession`
  - `supabase.auth.signInWithPassword`
  - таблица `profiles` для `organization_id`/`role`

## 3) Edge Functions

## 3.1 catalog-proxy
- Файл: `src/lib/catalog-api.ts`
- Назначение:
  - `fetchCatalogItems` → проксирует `/api/catalog/items`
  - `fetchCatalogFacets` → проксирует `/api/catalog/facets`

## 3.2 import-normalize
- Ключевые файлы:
  - `src/hooks/use-normalization.ts`
  - `src/components/normalization/NormalizationDialog.tsx`
- Операции `op`:
  - `dry_run`
  - `stats`
  - `dashboard`
  - `tree`
  - `confirm`
  - `ai_chat_v2`
  - `apply`
  - `apply_status`
  - `answer_question`
  - `preview_rows`

## 3.3 settings-merge
- Ключевые файлы:
  - `src/hooks/use-normalization.ts`
  - `src/components/normalization/NormalizationDialog.tsx`
  - `src/components/normalization/NormalizationWizard.tsx`
- Назначение: обновление/слияние confirmed settings нормализации.

## 3.4 import-validate / import-publish
- Константы gateway:
  - `src/lib/backend.ts` (`ImportGatewayApi.validate`, `ImportGatewayApi.publish`)
- Поток использования:
  - `src/pages/products/ImportPriceDialog.tsx`
- Связанные сущности:
  - `import_jobs`
  - `import_errors`
  - `import_staging_rows`
  - Storage bucket `imports`

## 4) Прямые таблицы Supabase (частые)
- Каталог/импорт:
  - `product_catalog`
  - `discount_rules`
  - `import_jobs`
  - `import_errors`
  - `import_staging_rows`
- CRM:
  - `contacts`, `buyer_companies`, `leads`, `orders`, `order_items`, `invoices`
- Коммуникации:
  - `call_sessions`, `email_threads`, `email_messages`, `email_outbox`, `email_accounts`
- Настройки/биллинг:
  - `org_channels`, `org_features`, `bot_settings`, `balances`, `billing_transactions`

## 5) Обязательные поля контекста
- Почти везде бизнес-операции завязаны на:
  - `profile.organization_id`
  - `profile.role`
- При отсутствии профиля возможна частичная недоступность разделов.

## 6) Единый API-слой (частично внедрен)
- Файл: `src/lib/api-client.ts`
- Содержит:
  - `invokeEdge(...)` с mandatory `organization_id`
  - `ApiContractError`
  - нормализацию ошибок edge/backend
- Рекомендация: использовать этот слой в новых интеграциях, чтобы не множить разную обработку ошибок.

