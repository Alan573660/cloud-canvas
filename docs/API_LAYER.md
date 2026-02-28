# API_LAYER

## Зачем нужен единый API слой
- Убрать разнобой вызовов Edge Functions/HTTP по проекту.
- Получать единый формат ошибок (`code`, `message`, `details`, `status`, `correlationId`, `retryable`).
- Прокидывать `correlation_id` в запросы для упрощения трассировки frontend ↔ backend.
- Подготовить основу для постепенной миграции без ломки текущих флоу.

Новый каркас расположен в `src/lib/api/`:
- `client.ts` — unified invoke (`invokeEdge`, `requestHttp`)
- `errors.ts` — нормализация ошибок (`normalizeApiError`, `ApiError`)
- `contracts/` — базовые контракты запрос/ответ

## Пример 1: Edge Function
```ts
import { invokeEdge } from '@/lib/api/client';

const result = await invokeEdge<{ ok: boolean; data?: unknown }, { organization_id: string }>(
  'import-normalize',
  { body: { organization_id: orgId, op: 'stats' } }
);
```

## Пример 2: HTTP endpoint
```ts
import { requestHttp } from '@/lib/api/client';

const quote = await requestHttp<{ ok: boolean; price?: number }>('/api/pricing/quote', {
  method: 'POST',
  body: { sku: 'ABC-123', quantity: 10 },
});
```

## Как подключать без массовых замен
- Не делать одномоментный рефактор всех вызовов.
- Начать с 1 новой/изолированной точки, затем постепенно переносить остальные.
- Текущие import/normalization флоу не менять до отдельного согласованного PR.

## Будущая типизация от canonical контракта
- Canonical OpenAPI живет в backend: `maxim-saas/docs/api/openapi.yaml`.
- В будущем можно подключить генерацию типов в frontend (без внедрения сейчас):
  1. Backend обновляет canonical OpenAPI.
  2. Frontend обновляет сгенерированные DTO/типы в `src/lib/api/contracts`.
  3. `client.ts` остается единым transport/error слоем, а feature-код использует типизированные контракты.
