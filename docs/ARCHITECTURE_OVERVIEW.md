# ARCHITECTURE OVERVIEW (frontend cloud-canvas)

Короткая схема для быстрого входа новичка.

## 1. Runtime-слои
- **UI layer**: `src/pages/*`, `src/components/*`.
- **State/Data layer**: React Query + custom hooks (`src/hooks/*`).
- **Integration layer**: Supabase client (`src/integrations/supabase/client.ts`), API helpers (`src/lib/*`).
- **Platform**: Vite + React + TypeScript.

## 2. Точка входа
- `src/main.tsx` → монтирует `App`.
- `src/App.tsx` → провайдеры (`QueryClientProvider`, `AuthProvider`, i18n init) и маршруты.

## 3. Навигация
- Базовый layout: `AppLayout`.
- Основные route-группы:
  - CRM: contacts / companies / leads / orders / invoices
  - Коммуникации: email / calls
  - Каталог: products / import
  - Сервис: analytics / billing / settings

## 4. Данные и состояние
- **Server state**: React Query (`useQuery/useMutation`).
- **Auth + organization context**: `AuthContext` (`profiles.organization_id`).
- **Локальный state**: `useState` в компонентах.

## 5. Backend integration
- Прямой доступ к таблицам Supabase (`supabase.from`).
- Edge functions через `supabase.functions.invoke`:
  - `catalog-proxy`
  - `import-normalize`
  - `settings-merge`
  - import gateway (`import-validate`, `import-publish`).

## 6. i18n
- `src/i18n/index.ts` + `ru.json/en.json`.
- Fallback: `ru`.

## 7. Где самая сложная доменная логика
- Импорт прайса: `src/pages/products/ImportPriceDialog.tsx`, `src/pages/products/ImportTab.tsx`.
- Нормализация: `src/hooks/use-normalization.ts`, `src/pages/products/NormalizationTab.tsx`, `src/components/normalization/*`.

