# Edge Function Contracts — полный реестр для Codex

> Источник истины: код Edge Functions из `supabase/functions/`.
> Все ответы фронту приходят с HTTP 200 (кроме auth 401/403), бизнес-ошибки внутри JSON.

---

## 0. Единый error-контракт

Все Edge Functions следуют одному паттерну:

### Успех
```jsonc
{ "ok": true, "contract_version": "v1", /* ...payload */ }
```

### Ошибка (бизнес)
```jsonc
{ "ok": false, "contract_version": "v1", "error": "Human-readable message", "code": "ERROR_CODE", "detail": "optional extra" }
```

### Ошибка (auth — HTTP 401/403)
```jsonc
{ "ok": false, "error": "Unauthorized" }          // 401
{ "ok": false, "error": "Access denied" }          // 403
```

### Важно для apiInvoke:
- **ВСЕГДА проверять `result.ok === false`** — Edge возвращает HTTP 200 даже для бизнес-ошибок.
- Поля ошибки: `error` (string, обязательно), `code` (string, опционально), `detail` (any, опционально), `error_code` (legacy alias для `code`).
- `code: "TIMEOUT"` → retryable.
- `code: "PROFILE_HASH_MISMATCH"` → нужен re-fetch dry_run.

---

## 1. import-normalize

**Endpoint:** `supabase.functions.invoke('import-normalize', { body })`

Все операции передают `op` + `organization_id` в body.

### 1.1 dry_run

**Request:**
```json
{
  "op": "dry_run",
  "organization_id": "uuid",
  "import_job_id": "uuid",
  "scope": { "only_where_null": true, "limit": 2000 },
  "ai_suggest": false
}
```

**Response OK:**
```json
{
  "ok": true,
  "contract_version": "v1",
  "run_id": "abc123",
  "profile_hash": "sha256hex",
  "ai_status": { "available": true, "reason": null },
  "questions": [
    {
      "question_text": "Как классифицировать 'Профнастил С-8'?",
      "affected_rows_count": 42,
      "suggested_actions": ["Профнастил", "Металлочерепица"],
      "needs_user_confirmation": true,
      "confidence": 0.7,
      "question_type": "CATEGORY",
      "token": "q_abc123",
      "ask": "Как классифицировать 'Профнастил С-8'?",
      "affected_count": 42,
      "suggested_variants": ["Профнастил", "Металлочерепица"]
    }
  ],
  "stats": { "total": 1500, "matched": 1200, "unmatched": 300 }
}
```

**Response ERROR:**
```json
{ "ok": false, "contract_version": "v1", "code": "TIMEOUT", "error": "Enricher request timed out (55s). Retry with smaller limit.", "recommended_limit": 250 }
```

### 1.2 confirm

**Request (Contract v1 batch):**
```json
{
  "op": "confirm",
  "organization_id": "uuid",
  "import_job_id": "uuid",
  "actions": [
    { "type": "SET_CATEGORY", "payload": { "cluster_key": "profnastil_c8", "category": "Профнастил" } }
  ]
}
```

**Request (legacy single):**
```json
{
  "op": "confirm",
  "organization_id": "uuid",
  "import_job_id": "uuid",
  "type": "SET_CATEGORY",
  "payload": { "cluster_key": "profnastil_c8", "category": "Профнастил" }
}
```

**Response OK:**
```json
{
  "ok": true,
  "contract_version": "v1",
  "type": "BATCH",
  "affected_clusters": ["profnastil_c8"],
  "apply_started": false,
  "apply_id": null,
  "mode": "sync",
  "stats": { "updates": 1 }
}
```

### 1.3 answer_question

**Request:**
```json
{
  "op": "answer_question",
  "organization_id": "uuid",
  "import_job_id": "uuid",
  "question_type": "CATEGORY",
  "token": "q_abc123",
  "value": "Профнастил"
}
```

**Response OK:**
```json
{ "ok": true, "contract_version": "v1", "applied": true, "affected_rows": 42 }
```

### 1.4 apply (async start + sync fallback)

**Request:**
```json
{
  "op": "apply",
  "organization_id": "uuid",
  "import_job_id": "uuid",
  "run_id": "abc123",
  "profile_hash": "sha256hex"
}
```

**Response OK (async started):**
```json
{ "ok": true, "contract_version": "v1", "apply_id": "apply_xyz", "status": "PENDING" }
```

**Response OK (sync fallback completed):**
```json
{ "ok": true, "contract_version": "v1", "applied": true, "stats": { "updated": 1200 } }
```

**Response ERROR (hash mismatch):**
```json
{ "ok": false, "contract_version": "v1", "code": "PROFILE_HASH_MISMATCH", "error": "Settings changed since dry_run. Re-run dry_run." }
```

### 1.5 apply_status

**Request:**
```json
{
  "op": "apply_status",
  "organization_id": "uuid",
  "import_job_id": "uuid",
  "apply_id": "apply_xyz"
}
```

**Response OK:**
```json
{
  "ok": true,
  "contract_version": "v1",
  "status": "RUNNING",
  "phase": "writing_bq",
  "progress_percent": 45,
  "last_error": null
}
```

**Особенность:** `status` нормализуется в UPPERCASE: `PENDING | RUNNING | COMPLETED | FAILED | UNKNOWN`.

### 1.6 ai_chat_v2

**Request:**
```json
{
  "op": "ai_chat_v2",
  "organization_id": "uuid",
  "import_job_id": "uuid",
  "run_id": "abc123",
  "message": "Установи категорию 'Профнастил' для всех С-8",
  "context": { "group_type": "WIDTH", "group_key": "1150" }
}
```

**Response OK:**
```json
{
  "ok": true,
  "contract_version": "v1",
  "assistant_message": "Готово! Установил категорию 'Профнастил' для 42 позиций.",
  "actions": [
    { "type": "SET_CATEGORY", "payload": { "cluster_key": "profnastil_c8", "category": "Профнастил" } }
  ],
  "missing_fields": [],
  "requires_confirm": true,
  "shadow_mode": false
}
```

### 1.7 stats / dashboard / tree

**Response OK (одинаковый паттерн — ok:true + spread данных из enricher):**
```json
{ "ok": true, "contract_version": "v1", "total_products": 1500, "categories": 12, "...": "..." }
```

### 1.8 preview_rows

**Response OK:**
```json
{
  "ok": true,
  "contract_version": "v1",
  "rows": [ { "id": "...", "title": "...", "normalized_key": "..." } ],
  "total": 500
}
```

---

## 2. settings-merge

**Endpoint:** `supabase.functions.invoke('settings-merge', { body })`

**Request:**
```json
{
  "organization_id": "uuid",
  "patch": {
    "pricing": { "default_margin": 15 }
  }
}
```

**Response OK:**
```json
{ "ok": true }
```

**Response ERROR (role):**
```json
{ "ok": false, "error": "Insufficient permissions" }
```

**Особенность:** НЕ содержит `contract_version`. HTTP status коды: 401, 403, 400, 500 (не всегда 200).

---

## 3. import-validate

**Endpoint:** `supabase.functions.invoke('import-validate', { body })`

**Request:**
```json
{
  "organization_id": "uuid",
  "import_job_id": "uuid",
  "file_path": "org_id/job_id/file.xlsx",
  "file_format": "xlsx",
  "mapping": { "id": "Артикул", "price_rub_m2": "Цена" },
  "options": { "strict_roofing_only_m2": true }
}
```

**Response OK:**
```json
{
  "ok": true,
  "import_job_id": "uuid",
  "total_rows": 1500,
  "valid_rows": 1480,
  "invalid_rows": 20
}
```

**Response ERROR (missing columns → triggers mapping UI):**
```json
{
  "ok": false,
  "import_job_id": "uuid",
  "error_code": "MISSING_REQUIRED_COLUMNS",
  "error": "Missing required columns: id, price_rub_m2",
  "detected_columns": ["Артикул", "Название", "Цена"],
  "missing_required": ["id", "price_rub_m2"],
  "suggestions": { "id": ["Артикул"], "price_rub_m2": ["Цена"] }
}
```

**Response ERROR (generic):**
```json
{
  "ok": false,
  "import_job_id": "uuid",
  "error": "Worker returned 500: Internal server error",
  "error_code": "WORKER_ERROR"
}
```

**Особенность:** НЕ содержит `contract_version`. Поле `error_code` (не `code`).

---

## 4. import-publish

**Endpoint:** `supabase.functions.invoke('import-publish', { body })`

**Request:**
```json
{
  "organization_id": "uuid",
  "import_job_id": "uuid",
  "file_path": "org_id/job_id/file.xlsx",
  "file_format": "xlsx",
  "archive_before_replace": true,
  "mapping": { "id": "Артикул" },
  "allow_partial": true
}
```

**Response OK (HTTP 202):**
```json
{
  "ok": true,
  "import_job_id": "uuid",
  "status": "APPLYING",
  "message": "Import started. Processing in background. Poll import_jobs for status updates."
}
```

**Особенности:**
- Возвращает **HTTP 202** (не 200) при успехе.
- Fire-and-forget: воркер обновляет `import_jobs.status` напрямую (COMPLETED/FAILED).
- UI должен **поллить** таблицу `import_jobs`.
- НЕ содержит `contract_version`.

---

## 5. catalog-proxy

**Endpoint:** `supabase.functions.invoke('catalog-proxy', { body })`

**Request:**
```json
{
  "endpoint": "/api/catalog/items",
  "organization_id": "uuid",
  "params": { "limit": "50", "offset": "0", "q": "профнастил" }
}
```

**Response OK (passthrough from pricing-api-saas):**
```json
{
  "items": [ { "id": "...", "title": "...", "base_price_rub_m2": 450 } ],
  "total": 1500,
  "facets": {}
}
```

**Особенности:**
- Ответ НЕ обёрнут в `{ ok: true }` — проксируется as-is от upstream.
- Ошибки обёрнуты: `{ "ok": false, "error": "Upstream error: 500" }`.
- Allowed endpoints: `/api/catalog/items`, `/api/catalog/facets`.

---

## 6. Сводная таблица для apiInvoke

| Edge Function     | `ok` field | `contract_version` | error key     | HTTP status | Retryable codes |
|-------------------|------------|---------------------|---------------|-------------|-----------------|
| import-normalize  | ✅ always  | ✅ v1               | `error`+`code`| always 200  | TIMEOUT         |
| settings-merge    | ✅ always  | ❌                  | `error`       | real codes  | —               |
| import-validate   | ✅ always  | ❌                  | `error`+`error_code` | mostly 200 | —         |
| import-publish    | ✅ always  | ❌                  | `error`+`error_code` | 202/4xx/5xx| —         |
| catalog-proxy     | ❌ passthru| ❌                  | `error` (only on fail)| 200     | —               |

---

## 7. Рекомендации для apiInvoke / Codex

1. **`invokeEdge` ОБЯЗАН проверять `result.ok === false`** и бросать `ApiContractError`. Текущий код это делает ✅.
2. **`catalog-proxy` — особый случай**: ответ upstream не содержит `ok` при успехе. `invokeEdge` должен НЕ применять `ok===false` check если `ok` отсутствует в ответе.
3. **`import-publish`** возвращает HTTP 202 — `supabase.functions.invoke` может интерпретировать это как ошибку. Нужен guard.
4. **Поля ошибки не унифицированы**: `code` (normalize) vs `error_code` (validate/publish). `parseEdgeFunctionError` уже обрабатывает оба.
5. **`settings-merge`** возвращает реальные HTTP коды (401, 403, 500), а не 200. `supabase.functions.invoke` бросит Error для non-2xx.

---

## 8. Заголовки

| Header | Кто шлёт | Куда |
|--------|----------|------|
| `Authorization: Bearer <JWT>` | Браузер | Edge Function |
| `X-Internal-Secret` | Edge Function | Cloud Run enricher |
| `X-Import-Secret` | Edge Function | Cloud Run worker |
| `x-correlation-id` | (TODO) Браузер | Edge Function → Cloud Run |

**Браузер НИКОГДА не шлёт** `X-Internal-Secret` / `X-Import-Secret`.
