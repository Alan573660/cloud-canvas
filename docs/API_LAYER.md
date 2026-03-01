# API_LAYER

## Зачем единый API-слой
Единая точка вызовов API снижает дублирование и расхождения по обработке ошибок между фичами.
Слой стандартизирует transport (Edge Functions / HTTP), заголовки и формат ошибок.
Это позволяет внедрять изменения контракта и логирования централизованно, без массовых правок UI-кода.

## Что добавлено
- `src/lib/api/client.ts` — единый `apiInvoke` для `supabase.functions.invoke` и опционального `fetch`.
- `src/lib/api/errors.ts` — нормализация ошибок в единый формат: `code / message / details` (+status/correlationId).
- `src/lib/api/contracts/index.ts` — минимальные общие типы для контрактов API.

## Пример 1: Edge Function
```ts
const result = await apiInvoke<MyResponse>({
  endpoint: 'import-normalize',
  body: { op: 'validate', organization_id: orgId },
});
```

## Пример 2: HTTP fetch
```ts
const result = await apiInvoke<MyResponse>({
  transport: 'fetch',
  fetchUrl: '/api/v1/catalog/search',
  method: 'POST',
  body: { query: 'milk' },
});
```

## Как подключать дальше (без массовой замены)
Рекомендуется мигрировать на слой по одной точке за PR, начиная с новых интеграций.
Текущие флоу импорта/нормализации не изменяются в рамках этого шага.

## Будущая типизация от canonical контракта
Источник истины: `maxim-saas/docs/api/openapi.yaml` (+ `docs/api/README.md` в backend).
Следующий шаг: добавить генерацию types из canonical OpenAPI в backend-пайплайне или отдельном tooling-скрипте,
после чего подключить сгенерированные типы в `src/lib/api/contracts` без изменения UI-компонентов.
