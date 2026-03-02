# OPENAPI_SOURCE

## Canonical контракт
- `maxim-saas/docs/api/openapi.yaml`
- `maxim-saas/docs/api/README.md`

## Правило
- API-контракт правится **только** в backend-репозитории `maxim-saas`.
- `cloud-canvas` использует контракт как потребитель и не редактирует его как source of truth.

## Как frontend обновляется после backend PR
1. Дождаться merge backend PR с изменением контракта.
2. Проверить diff в `maxim-saas/docs/api/openapi.yaml` и пояснения в `maxim-saas/docs/api/README.md`.
3. Обновить frontend-код под новый контракт: типы, API-клиенты, адаптеры, обработку ошибок.
4. Актуализировать тесты и документацию frontend (если затронуто поведение).
5. Прогнать локальные проверки (`lint`, `typecheck`, `test`, если доступны).
6. Открыть PR в `lovable-dev` с явным Handoff по изменениям контракта/поведения.

## Важно
- При расхождении между frontend и API сначала исправляется canonical контракт в backend,
  затем выполняется синхронизация frontend отдельным PR.
