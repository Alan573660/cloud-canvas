# UI ↔ Backend Alignment Audit

> Дата: 2026-02-08  
> Scope: Catalog UI, Pricing UI, Import UI, Enrichment UI  
> Discounts: **OUT OF SCOPE**

---

## 1. CATALOG UI

### 1.1 ProductsTab (`src/pages/products/ProductsTab.tsx`)

| Аспект | Текущее состояние | Backend-контракт |
|--------|-------------------|------------------|
| **Endpoint** | `GET /api/catalog/items` (Cloud Run) | ✅ Совпадает |
| **Params sent** | `organization_id, limit, offset, q, unit, cat_name, sort` | ✅ Совпадает |
| **Response fields used** | `id, title, cat_name, cat_tree, unit, cur, price_rub_m2` | ✅ Совпадает |

**Расхождения:**

| # | Проблема | Severity |
|---|---------|----------|
| C1 | API в `docs/catalog-api-endpoints.md` описывает `page/page_size`, но `catalog-api.ts` использует `limit/offset`. **Нужно проверить** какой контракт актуален на Cloud Run | ⚠️ MEDIUM |
| C2 | Docs описывают поля `sku, profile, coating, thickness_mm, width_work_mm, width_full_mm, weight_kg_m2` в ответе, но `CatalogItem` type содержит только `id, title, cat_name, cat_tree, unit, cur, price_rub_m2`. **Если API уже возвращает расширенные поля — UI их игнорирует** | ⚠️ MEDIUM |
| C3 | Docs описывают фильтры `profile, coating, thickness_mm, is_active`, но UI использует `cat_name, unit`. **Если API уже поддерживает — UI не использует** | 🔵 LOW |
| C4 | `activeFilter` (is_active) в UI существует в Select, но **не передаётся** в `useCatalogItems` → фильтрация is_active не работает | 🔴 HIGH |
| C5 | `toLegacyProduct()` маппит `cat_name` → `profile`, что **семантически неверно** (cat_name = "Кровельные материалы", profile = "С20") | ⚠️ MEDIUM |

### 1.2 CatalogStatsCards (`src/pages/products/CatalogStatsCards.tsx`)

| Аспект | Текущее состояние | Backend-контракт |
|--------|-------------------|------------------|
| **Endpoint** | `GET /api/catalog/facets` → `total` | ✅ Совпадает |
| **Supabase** | `product_catalog.count(is_active=false)` | ✅ Совпадает |

**Расхождения:** Нет

### 1.3 ProductDetailSheet (`src/pages/products/ProductDetailSheet.tsx`)

| # | Проблема | Severity |
|---|---------|----------|
| D1 | Обновляет `notes` по `product_catalog.id` (UUID), но товар приходит из BQ с `id = bq_key` (string). **`.eq('id', product.id)` не найдёт запись**, т.к. в Supabase UUID, а передаётся BQ ключ | 🔴 HIGH |
| D2 | Показывает поля `profile, thickness_mm, coating, width_*`, но все `null` из-за `toLegacyProduct()` заглушек | ⚠️ MEDIUM |
| D3 | `created_at, updated_at` всегда пустые строки (BQ не возвращает, или поле `updated_at` есть но не маппится) | 🔵 LOW |

---

## 2. PRICING UI

### 2.1 PriceQuoteDialog (`src/pages/products/PriceQuoteDialog.tsx`)

| Аспект | Текущее состояние | Backend-контракт |
|--------|-------------------|------------------|
| **Endpoint** | `POST /api/pricing/quote` (relative URL) | ❌ **Сломан**: используется `/api/pricing/quote` без base URL. Это относительный путь → уходит на Lovable preview → 404 |
| **Payload** | `{ organization_id, items: [{ bq_id, qty_m2, ral? }], currency }` | Контракт не задокументирован, но payload выглядит разумно |
| **bq_id source** | `product.bq_key \|\| product.sku \|\| product.id` | ⚠️ Из-за `toLegacyProduct()`: `bq_key = id`, `sku = id` → всегда отправляет BQ key |

**Расхождения:**

| # | Проблема | Severity |
|---|---------|----------|
| P1 | **URL сломан**: `fetch('/api/pricing/quote')` — относительный путь, должен быть `${CATALOG_API_BASE}/api/pricing/quote` | 🔴 HIGH |
| P2 | Ответ парсится двумя try-ветками (`data.items[0]` и `data.total`), но **нет документации** на реальную структуру ответа — fragile | ⚠️ MEDIUM |
| P3 | `qty_m2` — название поля в payload, но docs не подтверждают. Может быть `qty` или `quantity` | ⚠️ MEDIUM |

### 2.2 PriceByColorDialog (`src/pages/products/PriceByColorDialog.tsx`)

| Аспект | Текущее состояние | Backend-контракт |
|--------|-------------------|------------------|
| **Endpoint** | `supabase.rpc('get_price_by_color', { p_product_id, p_ral })` | ❓ **RPC может не существовать** — не в documented RPCs |
| **p_product_id** | Передаётся `product.id` (это BQ key из toLegacyProduct) | 🔴 **UUID vs string mismatch** |

**Расхождения:**

| # | Проблема | Severity |
|---|---------|----------|
| PB1 | RPC `get_price_by_color` не документирован. Если не существует — UI покажет ошибку | 🔴 HIGH |
| PB2 | `p_product_id` ожидает UUID (product_catalog.id), получает BQ string key | 🔴 HIGH |

### 2.3 RalColorsDialog (`src/pages/products/RalColorsDialog.tsx`)

| Аспект | Текущее состояние | Backend-контракт |
|--------|-------------------|------------------|
| **Endpoint** | `supabase.rpc('get_available_colors', { p_product_id })` | ❓ **RPC может не существовать** |
| **p_product_id** | `product.id` = BQ key (string) | 🔴 **UUID vs string** |

**Расхождения:**

| # | Проблема | Severity |
|---|---------|----------|
| R1 | RPC `get_available_colors` не документирован | 🔴 HIGH |
| R2 | UUID/string mismatch (same as PB2) | 🔴 HIGH |

---

## 3. IMPORT UI

### 3.1 ImportPriceDialog (`src/pages/products/ImportPriceDialog.tsx`)

| Аспект | Текущее состояние | Backend-контракт |
|--------|-------------------|------------------|
| **Upload** | Supabase Storage `imports` bucket | ✅ Совпадает |
| **Validate** | Edge Function `import-validate` | ✅ Совпадает |
| **Publish** | Edge Function `import-publish` (async, 202) | ✅ Совпадает |

**Validate payload:**
```json
{
  "organization_id": "uuid",
  "import_job_id": "uuid",
  "file_path": "org/job/price_job.csv",
  "file_format": "csv|xlsx|pdf",
  "mapping": { "id": "Артикул", "price_rub_m2": "Цена" },
  "options": {
    "transform": { "sanitize_id": true, "normalize_price": true, "trim_text": true },
    "strict_roofing_only_m2": true,
    "excluded_row_numbers": [5, 12]
  }
}
```

**Publish payload:**
```json
{
  "organization_id": "uuid",
  "import_job_id": "uuid",
  "file_path": "...",
  "file_format": "csv|xlsx",
  "archive_before_replace": true,
  "mapping": { ... },
  "options": { ... },
  "allow_partial": true
}
```

**Расхождения:**

| # | Проблема | Severity |
|---|---------|----------|
| I1 | Edge Function→Worker передаёт `dry_run: true/false`, но Worker может ожидать другое имя поля | 🔵 LOW (если worker работает) |
| I2 | `file_format: 'pdf'` поддержан в UI (`isFormatSupported`), но Edge Functions не обрабатывают PDF специально — передают as-is на Worker | 🔵 LOW |
| I3 | Polling uses `maxAttempts=300 × 3s = 15min` — адекватно для 70k rows | ✅ OK |

### 3.2 ImportTab (`src/pages/products/ImportTab.tsx`)

| Аспект | Текущее состояние |
|--------|-------------------|
| **Data source** | Supabase `import_jobs`, `import_errors`, `import_staging_rows` |
| **Statuses** | `QUEUED, VALIDATING, VALIDATED, APPLYING, COMPLETED, FAILED` |

**Расхождения:**

| # | Проблема | Severity |
|---|---------|----------|
| I4 | `validation_status: 'EXCLUDED'` used in staging rows, but DB check constraint may not include it | ⚠️ MEDIUM |
| I5 | Reset exclusions sets `validation_status = 'INVALID'`, but original status was `'VALID'` for valid rows — data loss | ⚠️ MEDIUM |

---

## 4. ENRICHMENT / NORMALIZATION UI

### 4.1 NormalizationTab (`src/pages/products/NormalizationTab.tsx`)

| Аспект | Текущее состояние |
|--------|-------------------|
| **Data source** | Supabase `import_jobs` (status in COMPLETED, VALIDATED, APPLYING) |
| **Action** | Opens `NormalizationWizard` with `importJobId` |

**Расхождения:** Нет существенных

### 4.2 NormalizationWizard (`src/components/normalization/NormalizationWizard.tsx`)

| Аспект | Текущее состояние | Backend-контракт |
|--------|-------------------|------------------|
| **dry_run** | Edge Fn `import-normalize` → `POST /api/enrich/dry_run` | ✅ Совпадает |
| **apply** | Edge Fn `import-normalize` → `POST /api/enrich/apply/start` (async) или fallback `POST /api/enrich/apply` (sync) | ✅ Совпадает |
| **apply_status** | Edge Fn `import-normalize` → `GET /api/enrich/apply_status` | ✅ Совпадает |
| **preview_rows** | Edge Fn `import-normalize` → `POST /api/enrich/preview_rows` | ✅ Совпадает |
| **chat** | Edge Fn `import-normalize` → `POST /api/enrich/chat` | ✅ Endpoint exists, **but UI не реализует full chat** |

**dry_run payload:**
```json
{
  "op": "dry_run",
  "organization_id": "uuid",
  "import_job_id": "uuid|current",
  "scope": { "only_where_null": true, "limit": 5000 },
  "ai_suggest": false
}
```

**dry_run response fields used:**
```
ok, run_id, profile_hash, stats.{rows_scanned, candidates, patches_ready},
patches_sample[].{id, title, profile, thickness_mm, coating, color_code, 
  width_work_mm, width_full_mm, price, unit, sheet_kind},
questions[].{type, cluster_path, token, examples, affected_count, suggestions, confidence}
```

**apply payload:**
```json
{
  "op": "apply",
  "organization_id": "uuid",
  "import_job_id": "uuid|current",
  "run_id": "string",
  "profile_hash": "string"
}
```

**Расхождения:**

| # | Проблема | Severity |
|---|---------|----------|
| N1 | `transformToCanonical()` маппит `item.color_code` → `color_or_ral`, но backend может возвращать `color_or_ral` напрямую. **Naming mismatch** возможен | ⚠️ MEDIUM |
| N2 | `thickness_mm` приходит как `string` в некоторых случаях — UI делает `parseFloat()`, но это fragile | 🔵 LOW |
| N3 | `sheet_kind` из backend: `PROFNASTIL, METAL_TILE, ACCESSORY, OTHER`. UI маппит `METAL_TILE` → `METALLOCHEREPICA`. **Naming mismatch**: backend `METAL_TILE` ≠ UI type `METALLOCHEREPICA` | ⚠️ MEDIUM |
| N4 | `handleComplete()` вызывает sync `apply` напрямую, **не используя async apply_start → polling** как задокументировано. Может таймаутить на больших датасетах | 🔴 HIGH |
| N5 | `handleAnswerQuestion()` — **TODO stub**, не сохраняет ответы в settings. AI-вопросы показываются но ответы теряются | 🔴 HIGH |

---

## 5. СВОДНАЯ ТАБЛИЦА РАСХОЖДЕНИЙ

### 🔴 HIGH (требуют исправления)

| ID | Компонент | Проблема | Решение |
|----|-----------|----------|---------|
| C4 | ProductsTab | `activeFilter` не передаётся в hook | Передать `isActive` param в `useCatalogItems`, добавить в URL params |
| D1 | ProductDetailSheet | `update notes` по BQ key вместо UUID | Использовать `bq_key` для upsert или показать read-only |
| P1 | PriceQuoteDialog | URL `/api/pricing/quote` без base URL → 404 | Использовать `CATALOG_API_BASE + '/api/pricing/quote'` |
| PB1 | PriceByColorDialog | RPC `get_price_by_color` может не существовать | Проверить RPC, или заменить на Pricing API |
| PB2 | PriceByColorDialog | UUID/string mismatch | Передавать Supabase UUID или bq_key в зависимости от RPC |
| R1 | RalColorsDialog | RPC `get_available_colors` может не существовать | Проверить RPC, или показать placeholder |
| R2 | RalColorsDialog | UUID/string mismatch | Аналогично PB2 |
| N4 | NormalizationWizard | Sync apply вместо async | Использовать `apply_start` → polling pattern |
| N5 | NormalizationWizard | AI answers не сохраняются | Имплементировать `settings-merge` для AI decisions |

### ⚠️ MEDIUM (рекомендуется исправить)

| ID | Компонент | Проблема | Решение |
|----|-----------|----------|---------|
| C1 | catalog-api.ts | `limit/offset` vs docs `page/page_size` | Проверить актуальный API контракт на Cloud Run |
| C2 | CatalogItem type | Отсутствуют поля `sku, profile, coating, thickness_mm` | Расширить тип если API возвращает |
| C5 | toLegacyProduct | `cat_name` → `profile` неверный маппинг | Маппить `cat_name` → отдельное поле, profile оставить null |
| P2 | PriceQuoteDialog | Fragile response parsing (два формата) | Задокументировать ответ API, убрать дублирование |
| P3 | PriceQuoteDialog | `qty_m2` — может быть неверное имя поля | Проверить контракт Pricing API |
| N1 | NormalizationWizard | `color_code` → `color_or_ral` naming | Привести в соответствие с backend |
| N3 | NormalizationWizard | `METAL_TILE` ≠ `METALLOCHEREPICA` | Нормализовать в маппинге |
| I4 | ImportTab | `EXCLUDED` может не быть в DB constraint | Проверить `import_staging_rows_validation_status_check` |
| I5 | ImportTab | Reset exclusions → INVALID вместо VALID | Сохранять оригинальный статус |
| D2 | ProductDetailSheet | Все спецификации null | Не показывать блок если нет данных |

### 🔵 LOW (nice to have)

| ID | Компонент | Проблема |
|----|-----------|----------|
| C3 | ProductsTab | Расширенные фильтры не используются |
| D3 | ProductDetailSheet | Даты пустые |
| I1 | Import Edge Fn | `dry_run` naming |
| I2 | ImportPriceDialog | PDF support passthrough |
| N2 | NormalizationWizard | thickness_mm string→number |

---

## 6. РЕКОМЕНДУЕМЫЙ ПОРЯДОК ИСПРАВЛЕНИЙ

### Phase 1 — Критичные (не работает)
1. **P1**: Исправить URL в PriceQuoteDialog → `CATALOG_API_BASE`
2. **PB1/R1**: Проверить существование RPC `get_price_by_color` и `get_available_colors`. Если нет → показать placeholder "Coming soon" вместо ошибки
3. **D1**: ProductDetailSheet notes update → upsert by `bq_key` вместо `id`
4. **C4**: Передать activeFilter в useCatalogItems → в API params

### Phase 2 — Архитектурные
5. **N4**: NormalizationWizard `handleComplete()` → async apply_start + polling
6. **N5**: Implement AI question persistence via `settings-merge`
7. **PB2/R2**: Resolve UUID vs BQ key — определить стратегию (lazy-create или RPC по bq_key)

### Phase 3 — Полировка
8. **C2/C5**: Расширить `CatalogItem` если API уже возвращает расширенные поля
9. **D2**: Скрыть пустые спецификации в ProductDetailSheet
10. **N1/N3**: Унифицировать naming (`color_code`/`color_or_ral`, `METAL_TILE`/`METALLOCHEREPICA`)

---

## 7. ENDPOINT MAP

```
┌─────────────────────────────┬──────────────────────────────────────────────────────┐
│ UI Component                │ Endpoint                                             │
├─────────────────────────────┼──────────────────────────────────────────────────────┤
│ ProductsTab                 │ GET  pricing-api-saas/api/catalog/items              │
│                             │ GET  pricing-api-saas/api/catalog/facets             │
│                             │ Supabase: product_catalog (overrides)                │
├─────────────────────────────┼──────────────────────────────────────────────────────┤
│ CatalogStatsCards           │ GET  pricing-api-saas/api/catalog/facets (.total)    │
│                             │ Supabase: product_catalog count(is_active=false)     │
│                             │ Supabase: discount_rules count                      │
│                             │ Supabase: import_jobs (last)                         │
├─────────────────────────────┼──────────────────────────────────────────────────────┤
│ PriceQuoteDialog            │ POST pricing-api-saas/api/pricing/quote  ❌BROKEN    │
├─────────────────────────────┼──────────────────────────────────────────────────────┤
│ PriceByColorDialog          │ RPC  get_price_by_color(p_product_id, p_ral) ❓      │
├─────────────────────────────┼──────────────────────────────────────────────────────┤
│ RalColorsDialog             │ RPC  get_available_colors(p_product_id)    ❓         │
├─────────────────────────────┼──────────────────────────────────────────────────────┤
│ ProductDetailSheet          │ Supabase: product_catalog.update(notes)   ❌BROKEN   │
├─────────────────────────────┼──────────────────────────────────────────────────────┤
│ ImportPriceDialog           │ Supabase Storage: imports bucket                     │
│                             │ Edge Fn: import-validate → Cloud Run Worker          │
│                             │ Edge Fn: import-publish → Cloud Run Worker (async)   │
├─────────────────────────────┼──────────────────────────────────────────────────────┤
│ ImportTab                   │ Supabase: import_jobs, import_errors,                │
│                             │           import_staging_rows                        │
├─────────────────────────────┼──────────────────────────────────────────────────────┤
│ NormalizationWizard         │ Edge Fn: import-normalize                            │
│                             │   → POST /api/enrich/dry_run                         │
│                             │   → POST /api/enrich/apply/start (async)             │
│                             │   → GET  /api/enrich/apply_status                    │
│                             │   → POST /api/enrich/preview_rows                    │
│                             │   → POST /api/enrich/chat (stub)                     │
├─────────────────────────────┼──────────────────────────────────────────────────────┤
│ NormalizationTab            │ Supabase: import_jobs (history)                      │
└─────────────────────────────┴──────────────────────────────────────────────────────┘
```
