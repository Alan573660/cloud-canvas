# PR-1: P0 Контрактные фиксы main.py

**Файл**: `services/catalog-enricher/main.py` (4064 строк, текущий деплой Cloud Run)
**Приоритет**: P0 — production blocker
**Оценка**: ~80 строк изменений
**Риск**: Низкий (все изменения обратно-совместимы)

---

## КОНТЕКСТ

Фронтенд (React) вызывает Edge Function `import-normalize`, которая проксирует к Cloud Run `catalog-enricher/main.py`. Текущие ответы main.py не соответствуют контракту фронтенда (`src/lib/contract-types.ts`). Эти расхождения — причина пустых KPI, сломанных фильтров и неполных данных в UI.

---

## ЗАДАЧИ (все в main.py)

### 1. preview_rows: limit cap 500 → 5000

**Строка ~2618**, найти:
```python
limit = max(1, min(int(req.limit or 50), 500))
```

**Заменить на:**
```python
limit = max(1, min(int(req.limit or 50), 5000))
```

---

### 2. global_facets.by_kind: массив → объект с ready/needs_attention

**Строки ~2724-2777**. Текущий код возвращает:
```python
"by_kind": [{"kind": k, "count": v} for k, v in sorted(...)]
```

**Фронтенд ожидает** (contract-types.ts):
```typescript
by_kind?: Record<string, { total: number; ready: number; needs_attention: number }>;
```

**Заменить** два отдельных SQL (`global_facets_sql` + `global_ready_sql`) на ОДИН:

```python
sql_global = f"""
SELECT
  UPPER(COALESCE(NULLIF(TRIM(sheet_kind), ''), 'OTHER')) AS sk,
  COUNT(1) AS total,
  COUNTIF(
    COALESCE(TRIM(profile), '') != ''
    AND thickness_mm IS NOT NULL
    AND COALESCE(TRIM(coating), '') != ''
    AND width_work_mm IS NOT NULL
    AND width_full_mm IS NOT NULL
    AND (
      COALESCE(TRIM(color_system), '') != ''
      OR LOWER(COALESCE(coating, '')) LIKE '%оцинк%'
    )
  ) AS ready
FROM `{fq_table(BQ_TABLE_CURRENT)}`
WHERE organization_id=@org
GROUP BY 1
"""
params_global = [bigquery.ScalarQueryParameter("org", "STRING", org)]
rows_global = list(bq_client().query(sql_global, job_config=bigquery.QueryJobConfig(query_parameters=params_global)).result())

by_kind = {}
grand_total = 0
grand_ready = 0
for row in rows_global:
    sk = row["sk"]
    t = int(row["total"])
    r = int(row["ready"])
    by_kind[sk] = {"total": t, "ready": r, "needs_attention": t - r}
    grand_total += t
    grand_ready += r

global_facets = {
    "total": grand_total,
    "ready": grand_ready,
    "needs_attention": grand_total - grand_ready,
    "by_kind": by_kind,
}
```

**ВАЖНО**: Удалить старые `global_facets_sql` и `global_ready_sql` (два отдельных запроса). Теперь это 1 запрос вместо 2.

---

### 3. Унифицировать ready-логику (добавить color_system)

Во всех SQL где проверяется "ready" (строки ~2742-2751, и любые другие), убедиться что ready-условие включает color_system:

```sql
-- ПОЛНОЕ ready-условие (должно быть одинаковое ВЕЗДЕ):
COALESCE(TRIM(profile), '') != ''
AND thickness_mm IS NOT NULL
AND COALESCE(TRIM(coating), '') != ''
AND width_work_mm IS NOT NULL
AND width_full_mm IS NOT NULL
AND (
  COALESCE(TRIM(color_system), '') != ''
  OR LOWER(COALESCE(coating, '')) LIKE '%оцинк%'
)
```

Текущая ready-проверка **НЕ содержит** последние 4 строки (про color_system). Добавить их.

---

### 4. Добавить `contract_version: "v1"` во все ответы

Создать вспомогательную функцию (рядом с существующей `_json_safe`):

```python
def _response(data: dict) -> dict:
    """Wrap response with contract version."""
    data["contract_version"] = "v1"
    return _json_safe(data) if callable(_json_safe) else data
```

Применить `_response()` ко всем return-ам эндпоинтов:
- `preview_rows` 
- `dry_run`
- `confirm`
- `apply` / `apply_start` / `apply_status`
- `dashboard_progress_aggregate`
- `tree_and_progress`
- `stats`

---

### 5. preview_rows: добавить фильтры sheet_kind, profile, status, sort

В Pydantic модель `PreviewRowsRequest` (или аналогичную) добавить поля:

```python
sheet_kind: Optional[str] = None
profile: Optional[str] = None
status: Optional[str] = None    # "needs_attention" | "ready"
sort: Optional[str] = None      # "title" | "-title" | "profile" | etc.
```

В WHERE-clause генерации добавить:

```python
if req.sheet_kind:
    where += " AND UPPER(COALESCE(sheet_kind, '')) = @sheet_kind"
    params.append(bigquery.ScalarQueryParameter("sheet_kind", "STRING", req.sheet_kind.upper()))

if req.profile:
    where += " AND UPPER(COALESCE(profile, '')) = @profile"
    params.append(bigquery.ScalarQueryParameter("profile", "STRING", req.profile.upper()))

if req.status == "ready":
    where += """ AND (
        COALESCE(TRIM(profile), '') != ''
        AND thickness_mm IS NOT NULL
        AND COALESCE(TRIM(coating), '') != ''
        AND width_work_mm IS NOT NULL
        AND width_full_mm IS NOT NULL
        AND (COALESCE(TRIM(color_system), '') != '' OR LOWER(COALESCE(coating, '')) LIKE '%оцинк%')
    )"""
elif req.status == "needs_attention":
    where += """ AND NOT (
        COALESCE(TRIM(profile), '') != ''
        AND thickness_mm IS NOT NULL
        AND COALESCE(TRIM(coating), '') != ''
        AND width_work_mm IS NOT NULL
        AND width_full_mm IS NOT NULL
        AND (COALESCE(TRIM(color_system), '') != '' OR LOWER(COALESCE(coating, '')) LIKE '%оцинк%')
    )"""
```

Для sort:
```python
order_clause = "ORDER BY title"
if req.sort:
    col = req.sort.lstrip("-")
    direction = "DESC" if req.sort.startswith("-") else "ASC"
    allowed_sort = {"title", "profile", "thickness_mm", "coating", "sheet_kind", "price_rub_m2"}
    if col in allowed_sort:
        order_clause = f"ORDER BY {col} {direction}"
```

---

### 6. preview_rows: добавить price_rub_m2 и cur в SELECT

В SQL SELECT (строка ~2702) убедиться что есть:
```sql
SELECT id, title, unit, cur,
    profile, thickness_mm, width_work_mm, width_full_mm,
    coating, notes,
    sheet_kind, color_system, color_code,
    price_rub_m2
FROM ...
```

---

### 7. dry_run.stats.rows_total → COUNT(*) без фильтров

**Строка ~3017**:
```python
"rows_total": int(len(df)) if df is not None else 0,
```

**Заменить** — добавить перед dry_run loop отдельный count:
```python
# Перед основным циклом:
count_sql = f"SELECT COUNT(1) AS cnt FROM `{fq_table(BQ_TABLE_CURRENT)}` WHERE organization_id=@org"
count_result = list(bq_client().query(count_sql, job_config=bigquery.QueryJobConfig(
    query_parameters=[bigquery.ScalarQueryParameter("org", "STRING", org)]
)).result())
total_count = int(count_result[0]["cnt"]) if count_result else 0

# В stats:
"rows_total": total_count,
"rows_scanned": int(len(df)) if df is not None else 0,
```

---

## ТЕСТ-ЧЕКЛИСТ

```
curl -X POST .../api/enrich/preview_rows \
  -H "X-Internal-Secret: $SECRET" \
  -d '{"organization_id":"...","limit":2000}'

# Проверить:
# ✅ response.rows length == 2000 (не 500)
# ✅ response.global_facets.by_kind — объект, НЕ массив
# ✅ response.global_facets.by_kind.PROFNASTIL.total > 0
# ✅ response.global_facets.by_kind.PROFNASTIL.ready > 0
# ✅ response.global_facets.by_kind.PROFNASTIL.needs_attention >= 0
# ✅ response.global_facets.ready включает color_system проверку
# ✅ response.contract_version == "v1"
# ✅ response.rows[0].price_rub_m2 — присутствует
# ✅ response.rows[0].cur — присутствует

curl -X POST .../api/enrich/preview_rows \
  -d '{"organization_id":"...","sheet_kind":"PROFNASTIL","limit":50}'
# ✅ Все строки имеют sheet_kind == "PROFNASTIL"

curl -X POST .../api/enrich/preview_rows \
  -d '{"organization_id":"...","status":"needs_attention","limit":50}'
# ✅ Все строки НЕ полностью заполнены

curl -X POST .../api/enrich/dry_run \
  -d '{"organization_id":"...","scope":{"sheet_kind":"PROFNASTIL"}}'
# ✅ response.stats.rows_total == полное количество (71316), НЕ отфильтрованное
# ✅ response.stats.rows_scanned — количество обработанных
# ✅ response.contract_version == "v1"
```

---

## НЕ ТРОГАТЬ

- НЕ менять логику classify()
- НЕ менять build_questions_v2()
- НЕ менять confirm/apply 
- НЕ удалять код
- НЕ менять Pydantic модели (кроме добавления полей в PreviewRowsRequest)
