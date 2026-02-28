# RUNBOOK DEV (frontend cloud-canvas)

Короткий runbook: как запустить, проверить и собрать проект локально.

## 1) Требования
- Node.js 18+ (рекомендуется LTS)
- npm

## 2) Установка
```bash
npm install
```

## 3) Запуск в dev
```bash
npm run dev
```
- По конфигу Vite проект поднимается на `http://localhost:8080`.

## 4) Проверки качества
```bash
npm run lint
npm run typecheck
npm run test
```

## 5) Production build
```bash
npm run build
npm run preview
```

## 6) Быстрая навигация по важным зонам
- Роутинг и провайдеры: `src/App.tsx`
- Auth/session/profile: `src/contexts/AuthContext.tsx`
- Импорт прайса: `src/pages/products/ImportPriceDialog.tsx`
- Нормализация: `src/hooks/use-normalization.ts`, `src/pages/products/NormalizationTab.tsx`
- API helper: `src/lib/api-client.ts`, `src/lib/catalog-api.ts`
- Переводы: `src/i18n/index.ts`, `src/i18n/locales/*.json`

## 7) Типовые проблемы
- Если часть экранов пустая/не грузится: проверить наличие `profile.organization_id`.
- Если импорт «завис»: смотреть `import_jobs` и edge function логи (`import-validate`, `import-publish`, `import-normalize`).
- Если не хватает переводов: сверить ключи в `ru.json` и `en.json`.

