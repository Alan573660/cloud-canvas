# OPENAPI SOURCE (frontend note)

## Canonical источник контракта
- `maxim-saas/docs/api/openapi.yaml`
- `maxim-saas/docs/api/README.md`

## Правило владения контрактом
- OpenAPI-контракт правится **только** в backend-репозитории `maxim-saas`.
- Frontend-репозиторий `cloud-canvas` не является источником истины по API-спеке.

## Как frontend обновляется после backend PR
1. Дождаться merge backend PR с изменением контракта.
2. Изучить изменения в `openapi.yaml` и примечания в backend `docs/api/README.md`.
3. Сверить affected endpoints/DTO с frontend кодом (`src/lib`, `src/hooks`, feature-страницы).
4. Обновить frontend типы/адаптеры/обработку ошибок под новый контракт.
5. Проверить i18n-строки для новых ошибок/статусов (если затронуто поведение).
6. Прогнать локальные проверки (`lint`, `typecheck`, `test`, если доступны).
7. Создать PR в `lovable-dev` с обязательным Handoff (что нужно от backend/QA).

## Важно
- Если frontend видит расхождение со спекой, исправление вносится сначала в canonical backend-контракт,
  а затем фронт синхронизируется отдельным PR.
