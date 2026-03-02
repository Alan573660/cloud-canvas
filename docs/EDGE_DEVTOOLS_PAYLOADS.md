# Edge Functions — DevTools Network Payloads (Real Examples)

> Все примеры ниже взяты из реальных сессий (март 2026).
> Organization ID: `d267278c-8a53-42db-a5a7-2871e946db66`
> Import Job ID: `b8dd6be8-5fc2-4508-b389-ee9fc52768ed`

---

## 1. import-normalize / dry_run

**Request:**
```
POST https://<project>.supabase.co/functions/v1/import-normalize
Authorization: Bearer <JWT>
Content-Type: application/json
```

```json
{
  "op": "dry_run",
  "organization_id": "d267278c-8a53-42db-a5a7-2871e946db66",
  "import_job_id": "b8dd6be8-5fc2-4508-b389-ee9fc52768ed",
  "scope": { "only_where_null": true, "limit": 2000 },
  "ai_suggest": false
}
```

**Response: HTTP 200**
```json
{
  "ok": true,
  "organization_id": "d267278c-8a53-42db-a5a7-2871e946db66",
  "import_job_id": "b8dd6be8-5fc2-4508-b389-ee9fc52768ed",
  "run_id": "d63d70ca-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "profile_hash": "d4b33f67b423ba44045a97421099a27c1c473ef2fb4acfcf4bf772afaedfb166",
  "contract_version": "v1",
  "patches_sample": [
    {
      "id": "Металлочерепица Adamante 0.4 MattPE RAL6005",
      "title": "Металлочерепица Adamante 0.4 MattPE RAL6005",
      "unit": null,
      "cur": "706",
      "cat_name": "Металлочерепица",
      "cat_tree": "Металлочерепица\\0.4\\RAL6005",
      "sheet_kind": "METAL_TILE",
      "profile": "",
      "thickness_mm": 0.4,
      "coating": null,
      "color_system": "RAL",
      "color_code": "6005"
    }
  ],
  "questions": [
    {
      "type": "WIDTH_MASTER",
      "profiles": [
        {
          "profile": "МП40",
          "count": 7,
          "examples": ["Профнастил MP40 0.45 Agneta RAL5005"]
        }
      ],
      "families": [
        { "family_key": "METAL_TILE:UNKNOWN", "count": 102, "examples": ["Металлочерепица Adamante 0.4 MattPE RAL6005"] },
        { "family_key": "PROFNASTIL:МП40", "count": 7, "examples": ["Профнастил MP40 0.45 Agneta RAL5005"] }
      ],
      "affected_count": 202,
      "unknown_profile_count": 181,
      "unknown_profile_examples": ["Металлочерепица Adamante 0.4 MattPE RAL6005"],
      "note": "Профили без ширин. Заполните widths_selected (work/full) в настройках.",
      "token": "МП40",
      "examples": ["Профнастил MP40 0.45 Agneta RAL5005"],
      "suggested_variants": [{ "type": "WIDTH_MASTER", "payload": {} }],
      "confidence": 0.7,
      "affected_rows_count": 202,
      "needs_user_confirmation": true,
      "suggested_actions": [{ "type": "WIDTH_MASTER", "payload": {} }],
      "question_text": "Для листовых материалов не хватает ширин. Подтвердите рабочую и полную ширину профилей.",
      "ask": "Для листовых материалов не хватает ширин. Подтвердите рабочую и полную ширину профилей."
    }
  ],
  "stats": {
    "sample": 60,
    "target_sample": 300,
    "questions": 1,
    "ai": true,
    "shadow_mode": true,
    "ai_status": {
      "enabled": true,
      "attempted": false,
      "failed": false,
      "fail_reason": "not_attempted",
      "model": "gemini-2.5-flash-lite"
    }
  }
}
```

### dry_run — Timeout Error

**Response: HTTP 200**
```json
{
  "ok": false,
  "contract_version": "v1",
  "code": "TIMEOUT",
  "error": "Enricher request timed out (55s). Retry with smaller limit.",
  "recommended_limit": 250
}
```

---

## 2. import-normalize / confirm

**Request:**
```
POST https://<project>.supabase.co/functions/v1/import-normalize
Authorization: Bearer <JWT>
Content-Type: application/json
```

```json
{
  "op": "confirm",
  "organization_id": "d267278c-8a53-42db-a5a7-2871e946db66",
  "import_job_id": "b8dd6be8-5fc2-4508-b389-ee9fc52768ed",
  "actions": [
    {
      "type": "SET_CATEGORY",
      "payload": { "cluster_key": "profnastil_c8", "category": "Профнастил" }
    }
  ]
}
```

**Response: HTTP 200**
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

---

## 3. import-normalize / apply + apply_status

### 3a. apply (start)

**Request:**
```json
{
  "op": "apply",
  "organization_id": "d267278c-8a53-42db-a5a7-2871e946db66",
  "import_job_id": "b8dd6be8-5fc2-4508-b389-ee9fc52768ed",
  "run_id": "d63d70ca-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "profile_hash": "d4b33f67b423ba44045a97421099a27c1c473ef2fb4acfcf4bf772afaedfb166"
}
```

**Response: HTTP 200 (async started)**
```json
{
  "ok": true,
  "contract_version": "v1",
  "apply_id": "apply_abc123",
  "status": "PENDING"
}
```

**Response: HTTP 200 (sync fallback)**
```json
{
  "ok": true,
  "contract_version": "v1",
  "applied": true,
  "stats": { "updated": 1200 }
}
```

### apply — Hash Mismatch Error

**Response: HTTP 200**
```json
{
  "ok": false,
  "contract_version": "v1",
  "code": "PROFILE_HASH_MISMATCH",
  "error": "Settings changed since dry_run. Re-run dry_run."
}
```

### 3b. apply_status (polling)

**Request:**
```json
{
  "op": "apply_status",
  "organization_id": "d267278c-8a53-42db-a5a7-2871e946db66",
  "import_job_id": "b8dd6be8-5fc2-4508-b389-ee9fc52768ed",
  "apply_id": "apply_abc123"
}
```

**Response: HTTP 200 (in progress)**
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

**Response: HTTP 200 (completed)**
```json
{
  "ok": true,
  "contract_version": "v1",
  "status": "COMPLETED",
  "phase": "done",
  "progress_percent": 100,
  "last_error": null,
  "report": {
    "metrics": {
      "profile_filled": 85.2,
      "coating_filled": 72.1,
      "color_filled": 91.0,
      "category_filled": 100.0
    }
  }
}
```

---

## 4. settings-merge

**Request:**
```
POST https://<project>.supabase.co/functions/v1/settings-merge
Authorization: Bearer <JWT>
Content-Type: application/json
```

```json
{
  "organization_id": "d267278c-8a53-42db-a5a7-2871e946db66",
  "patch": {
    "pricing": {
      "widths_selected": {
        "МП40": { "work": 1100, "full": 1150 }
      }
    }
  }
}
```

**Response: HTTP 200**
```json
{ "ok": true }
```

### settings-merge — 403 (insufficient permissions)

**Response: HTTP 403**
```json
{ "ok": false, "error": "Insufficient permissions" }
```

### settings-merge — 401 (no auth)

**Response: HTTP 401**
```json
{ "ok": false, "error": "Unauthorized" }
```

---

## 5. import-validate

**Request:**
```
POST https://<project>.supabase.co/functions/v1/import-validate
Authorization: Bearer <JWT>
Content-Type: application/json
```

```json
{
  "organization_id": "d267278c-8a53-42db-a5a7-2871e946db66",
  "import_job_id": "b8dd6be8-5fc2-4508-b389-ee9fc52768ed",
  "file_path": "d267278c-8a53-42db-a5a7-2871e946db66/b8dd6be8-5fc2-4508-b389-ee9fc52768ed/price.xlsx",
  "file_format": "xlsx",
  "mapping": { "id": "Артикул", "price_rub_m2": "Цена" },
  "options": { "strict_roofing_only_m2": true }
}
```

**Response: HTTP 200 (success)**
```json
{
  "ok": true,
  "import_job_id": "b8dd6be8-5fc2-4508-b389-ee9fc52768ed"
}
```

> **NB:** Статистика (total_rows, valid_rows, invalid_rows) обновляется в таблице `import_jobs`, а не в ответе.

### import-validate — Missing Columns Error

**Response: HTTP 200**
```json
{
  "ok": false,
  "import_job_id": "b8dd6be8-5fc2-4508-b389-ee9fc52768ed",
  "error_code": "MISSING_REQUIRED_COLUMNS",
  "error": "Missing required columns: id, price_rub_m2",
  "detected_columns": ["Артикул", "Название", "Цена"],
  "missing_required": ["id", "price_rub_m2"],
  "suggestions": { "id": ["Артикул"], "price_rub_m2": ["Цена"] }
}
```

### import-validate — Worker Error

**Response: HTTP 200**
```json
{
  "ok": false,
  "import_job_id": "b8dd6be8-5fc2-4508-b389-ee9fc52768ed",
  "error": "Worker returned 500: Internal server error",
  "error_code": "WORKER_ERROR"
}
```

---

## 6. import-publish

**Request:**
```
POST https://<project>.supabase.co/functions/v1/import-publish
Authorization: Bearer <JWT>
Content-Type: application/json
```

```json
{
  "organization_id": "d267278c-8a53-42db-a5a7-2871e946db66",
  "import_job_id": "b8dd6be8-5fc2-4508-b389-ee9fc52768ed",
  "file_path": "d267278c-8a53-42db-a5a7-2871e946db66/b8dd6be8-5fc2-4508-b389-ee9fc52768ed/price.xlsx",
  "file_format": "xlsx",
  "archive_before_replace": true,
  "mapping": { "id": "Артикул" },
  "allow_partial": true
}
```

**Response: HTTP 202 (Accepted)**
```json
{
  "ok": true,
  "import_job_id": "b8dd6be8-5fc2-4508-b389-ee9fc52768ed",
  "status": "APPLYING",
  "message": "Import started. Processing in background. Poll import_jobs for status updates."
}
```

> **NB:** Fire-and-forget. UI должен поллить таблицу `import_jobs` для отслеживания статуса.

---

## 7. catalog-proxy / /api/catalog/facets

**Request:**
```
POST https://<project>.supabase.co/functions/v1/catalog-proxy
Authorization: Bearer <JWT>
Content-Type: application/json
```

```json
{
  "endpoint": "/api/catalog/facets",
  "organization_id": "d267278c-8a53-42db-a5a7-2871e946db66",
  "params": {}
}
```

**Response: HTTP 200**
```json
{
  "ok": true,
  "organization_id": "d267278c-8a53-42db-a5a7-2871e946db66",
  "units": [{ "unit": null, "cnt": 300 }],
  "categories": [{ "cat_name": null, "cnt": 300 }],
  "price_min": 461.0,
  "price_max": 1393.0,
  "total": 300
}
```

---

## 8. catalog-proxy / /api/catalog/items

**Request:**
```json
{
  "endpoint": "/api/catalog/items",
  "organization_id": "d267278c-8a53-42db-a5a7-2871e946db66",
  "params": { "limit": "15", "offset": "0", "sort": "updated_desc" }
}
```

**Response: HTTP 200**
```json
{
  "ok": true,
  "organization_id": "d267278c-8a53-42db-a5a7-2871e946db66",
  "q": "",
  "cat_name": "",
  "unit": "",
  "limit": 15,
  "offset": 0,
  "sort": "updated_desc",
  "total": 300,
  "items": [
    {
      "id": "Профнастил C21 0.45 Pural RAL7024",
      "title": "Профнастил C21 0.45 Pural RAL7024",
      "price_rub_m2": 1000.0,
      "unit": null,
      "cur": "1000",
      "cat_name": null,
      "cat_tree": null,
      "updated_at": "2026-03-01 15:50:03.135000+00:00"
    }
  ]
}
```

---

## 9. Примеры ошибок (auth / business)

### 401 — Unauthorized (любая Edge Function)

**Response: HTTP 401**
```json
{ "ok": false, "error": "Unauthorized" }
```

### 403 — Access Denied (org membership check)

**Response: HTTP 403**
```json
{ "ok": false, "error": "Access denied: not a member of this organization" }
```

### catalog-proxy — Upstream Error

**Response: HTTP 200**
```json
{ "ok": false, "error": "Upstream error: 500" }
```

### catalog-proxy — Timeout

**Response: HTTP 200**
```json
{ "ok": false, "error": "Request timed out" }
```

### catalog-proxy — Forbidden Endpoint

**Response: HTTP 403**
```json
{ "ok": false, "error": "Endpoint not allowed: /api/admin/reset" }
```

---

## 10. Как получить свежие payload из DevTools

Если нужно обновить примеры:

1. Открой Chrome DevTools → **Network** tab
2. Включи фильтр **Fetch/XHR**
3. Выполни действие в UI (например, запусти dry_run или откройте каталог)
4. Найди запрос к `functions/v1/<function-name>`
5. **Request:** Правый клик → «Copy» → «Copy request headers» и «Copy request body»
6. **Response:** Кликни на запрос → вкладка «Response» → скопируй JSON
7. HTTP status виден в колонке «Status» таблицы Network

**Совет:** Чтобы поймать ошибки (timeout, 403), можно:
- Для timeout: запустить dry_run с `limit: 5000` на большом прайсе
- Для 403: выйти из аккаунта и повторить запрос
- Для MISSING_REQUIRED_COLUMNS: загрузить файл без маппинга колонок
