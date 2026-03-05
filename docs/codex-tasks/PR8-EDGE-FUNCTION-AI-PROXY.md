# PR-8: Edge Function import-normalize — добавить прокси к ai_chat_v2

**Файл**: `supabase/functions/import-normalize/index.ts`
**Приоритет**: P0 — блокер для фронтенда
**Оценка**: ~30 строк
**Риск**: Низкий
**Зависимость**: После PR-7 (AI endpoint на Cloud Run)

---

## КОНТЕКСТ

Фронтенд `AIChatPanel.tsx` вызывает:
```typescript
apiInvoke('import-normalize', { op: 'ai_chat_v2', ... })
```

Edge Function `import-normalize` должна проксировать этот запрос к Cloud Run endpoint `/api/enrich/ai_chat_v2`.

---

## ЗАДАЧИ

### 1. Добавить case `ai_chat_v2` в switch по `op`

В файле `supabase/functions/import-normalize/index.ts` найти switch/if по `op` и добавить:

```typescript
case 'ai_chat_v2': {
    const enricherUrl = Deno.env.get("CATALOG_ENRICHER_URL");
    const enricherSecret = Deno.env.get("ENRICH_SHARED_SECRET");
    
    if (!enricherUrl || !enricherSecret) {
        return new Response(
            JSON.stringify({ ok: false, error: "CATALOG_ENRICHER_URL not configured" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
    
    const resp = await fetch(`${enricherUrl}/api/enrich/ai_chat_v2`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Internal-Secret": enricherSecret,
        },
        body: JSON.stringify({
            organization_id: body.organization_id,
            import_job_id: body.import_job_id || null,
            run_id: body.run_id || null,
            message: body.message,
            context: body.context || null,
        }),
    });
    
    const data = await resp.json();
    return new Response(JSON.stringify(data), {
        status: resp.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}
```

### 2. Таймаут

AI запросы могут быть медленными (до 30 сек). Убедиться что:
- Edge Function имеет достаточный таймаут
- Fetch к Cloud Run имеет `signal: AbortSignal.timeout(60_000)`

---

## ТЕСТ-ЧЕКЛИСТ

```bash
# Через Edge Function:
curl -X POST https://okxnlbndsifsrisrgcst.supabase.co/functions/v1/import-normalize \
  -H "Authorization: Bearer ..." \
  -H "Content-Type: application/json" \
  -d '{
    "op": "ai_chat_v2",
    "organization_id": "...",
    "message": "Для С20 ширина 1100/1150"
  }'
# ✅ ok: true, actions: [...]
```

---

## ВАЖНО

Этот PR делается **НА СТОРОНЕ LOVABLE** (Edge Function), НЕ на Cloud Run.
Cloud Run PR-7 должен быть задеплоен ПЕРВЫМ.
