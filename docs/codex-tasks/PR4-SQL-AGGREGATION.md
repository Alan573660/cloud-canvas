# PR-4: SQL-агрегация + оптимизация apply

**Файл**: `services/catalog-enricher/main.py`
**Приоритет**: P1 — performance
**Оценка**: ~150 строк изменений
**Риск**: Средний (меняет логику apply и quality_stats)
**Зависимость**: После PR-3

---

## КОНТЕКСТ

Две ключевые проблемы производительности:
1. `_quality_stats()` итерирует 71k строк в Python с classify() на каждой (10-30 сек CPU)
2. `apply` делает 3 полных `fetch_current(org, limit=0)` — три загрузки 71k строк из BigQuery

---

## ЗАДАЧИ

### 1. Заменить _quality_stats() на SQL-агрегацию

**Найти** функцию `_quality_stats` (строки ~1882-1930). Она делает:
```python
def _quality_stats(df, profile, ral_wl, widths_selected_norm):
    for _, row in df.iterrows():
        cls = classify(...)  # 71k вызовов!
```

**Заменить на SQL-функцию:**

```python
def _quality_stats_sql(org: str) -> Dict[str, Any]:
    """Quality statistics via SQL aggregation (replaces Python loop)."""
    fq = fq_table(BQ_TABLE_CURRENT)
    sql = f"""
    SELECT
      COUNT(1) AS total,
      COUNTIF(COALESCE(TRIM(profile), '') != '') AS profile_filled,
      COUNTIF(thickness_mm IS NOT NULL) AS thickness_filled,
      COUNTIF(COALESCE(TRIM(coating), '') != '') AS coating_filled,
      COUNTIF(width_work_mm IS NOT NULL) AS width_work_filled,
      COUNTIF(width_full_mm IS NOT NULL) AS width_full_filled,
      COUNTIF(COALESCE(TRIM(color_system), '') != '') AS color_filled,
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
      ) AS fully_ready,
      COUNTIF(UPPER(COALESCE(sheet_kind, '')) NOT IN ('OTHER', '')) AS kind_classified
    FROM `{fq}`
    WHERE organization_id=@org
    """
    params = [bigquery.ScalarQueryParameter("org", "STRING", org)]
    result = list(bq_client().query(sql, job_config=bigquery.QueryJobConfig(query_parameters=params)).result())
    
    if not result:
        return {"total": 0, "ready": 0, "fields": {}}
    
    r = result[0]
    total = int(r["total"])
    return {
        "total": total,
        "ready": int(r["fully_ready"]),
        "needs_attention": total - int(r["fully_ready"]),
        "fields": {
            "profile": int(r["profile_filled"]),
            "thickness": int(r["thickness_filled"]),
            "coating": int(r["coating_filled"]),
            "width": int(r["width_work_filled"]),
            "color": int(r["color_filled"]),
            "kind": int(r["kind_classified"]),
        }
    }
```

**Заменить все вызовы** `_quality_stats(df, ...)` на `_quality_stats_sql(org)`.

---

### 2. Убрать тройной fetch_current в apply

**Найти** в функции apply (строки ~3601-3660):
```python
df_before = fetch_current(org, limit=0)   # 71k строк — 1-й раз
# ... materialize_patches внутри делает fetch_current — 2-й раз
df_after = fetch_current(org, limit=0)    # 71k строк — 3-й раз
```

**Заменить на:**

```python
# BEFORE: stats через SQL (1 BQ запрос, не full scan)
before_stats = _quality_stats_sql(org)

# Основная работа: один fetch + обогащение
df = fetch_current(org, limit=0)  # 1 раз
# ... enrich + patches + merge ...

# AFTER: stats через SQL (1 BQ запрос)
after_stats = _quality_stats_sql(org)

# Сравнение:
improvement = {
    "ready_before": before_stats["ready"],
    "ready_after": after_stats["ready"],
    "delta": after_stats["ready"] - before_stats["ready"],
}
```

**Итого**: 3 full scans → 1 full scan + 2 SQL агрегации.

---

### 3. Объединить count + rows через window function в preview_rows

**Найти** в preview_rows два отдельных запроса:
1. `sql_count` — `SELECT COUNT(1) FROM ... WHERE ...`
2. `sql_rows` — `SELECT ... FROM ... WHERE ... LIMIT ... OFFSET ...`

**Объединить в один** через window function:

```python
sql_combined = f"""
SELECT
    COUNT(1) OVER() AS _total_count,
    id, title, unit, cur,
    profile, thickness_mm, width_work_mm, width_full_mm,
    coating, notes,
    sheet_kind, color_system, color_code,
    price_rub_m2
FROM `{fq}`
{where}
{order_clause}
LIMIT @limit OFFSET @offset
"""

rows_raw = list(bq_client().query(sql_combined, ...).result())
total_count = int(rows_raw[0]["_total_count"]) if rows_raw else 0
rows = [{k: v for k, v in dict(r).items() if k != "_total_count"} for r in rows_raw]
```

Удалить отдельный `sql_count` запрос. Теперь 1 запрос вместо 2.

---

### 4. Кеш global_facets (30 сек)

**Добавить** кеш для global_facets (не зависят от фильтров):

```python
_global_facets_cache: Dict[str, Tuple[float, Dict]] = {}
GLOBAL_FACETS_TTL = 30.0

def _get_global_facets(org: str) -> Dict:
    """Global facets with 30s TTL cache."""
    now = time.monotonic()
    cached = _global_facets_cache.get(org)
    if cached and (now - cached[0]) < GLOBAL_FACETS_TTL:
        return cached[1]
    
    # SQL из PR-1 (by_kind объект с ready/needs_attention)
    # ... (код SQL уже реализован в PR-1)
    
    _global_facets_cache[org] = (now, result)
    return result
```

**Инвалидация**: после confirm и apply:
```python
_global_facets_cache.pop(org, None)
```

---

## ТЕСТ-ЧЕКЛИСТ

```bash
# 1. preview_rows — ≤3 BQ запроса:
# Добавить временный лог количества BQ запросов в preview_rows
# ✅ Максимум 3 запроса: combined(count+rows), facets(если нет кеша), global_facets(если нет кеша)

# 2. preview_rows — скорость:
time curl -X POST .../api/enrich/preview_rows \
  -d '{"organization_id":"...","limit":2000}'
# ✅ ≤ 5 сек

# 3. apply — скорость:
time curl -X POST .../api/enrich/apply \
  -d '{"organization_id":"...","scope":{}}'
# ✅ ≤ 30 сек (было 60-90)

# 4. _quality_stats возвращает корректные данные:
# ✅ before_stats.ready < after_stats.ready (после apply с enrichment)
# ✅ before_stats.total == after_stats.total (apply не добавляет/удаляет строки)

# 5. Повторный preview_rows — быстрее (кеш global_facets):
time curl -X POST .../api/enrich/preview_rows \
  -d '{"organization_id":"...","limit":50}'
# ✅ ≤ 2 сек (global_facets из кеша)
```

---

## НЕ ТРОГАТЬ

- НЕ менять classify() логику
- НЕ менять confirm endpoint
- НЕ менять dry_run (кроме замены _quality_stats вызовов)
- НЕ удалять эндпоинты
