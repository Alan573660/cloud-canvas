# PR-2: Singleton BQ Client + TTL кеши

**Файл**: `services/catalog-enricher/main.py`
**Приоритет**: P1 — performance
**Оценка**: ~60 строк изменений
**Риск**: Низкий
**Зависимость**: После PR-1

---

## КОНТЕКСТ

Каждый HTTP-запрос создаёт новый `bigquery.Client()`, новые HTTP-соединения к Supabase для bot_settings, и заново вычисляет fq_table(). При 5 параллельных вызовах от UI это 5 клиентов + 5 HTTP calls + десятки вычислений fq_table.

---

## ЗАДАЧИ

### 1. Singleton BigQuery client

**Найти** (строка ~321):
```python
def bq_client() -> bigquery.Client:
    return bigquery.Client(project=PROJECT_ID) if PROJECT_ID else bigquery.Client()
```

**Заменить на:**
```python
_bq_client: Optional[bigquery.Client] = None

def bq_client() -> bigquery.Client:
    global _bq_client
    if _bq_client is None:
        _bq_client = bigquery.Client(project=PROJECT_ID) if PROJECT_ID else bigquery.Client()
    return _bq_client
```

---

### 2. Кеш fq_table()

**Найти** (строка ~360):
```python
def fq_table(table: str) -> str:
    c = bq_client()
    return f"{c.project}.{BQ_DATASET}.{table}"
```

**Заменить на:**
```python
_project_id_cache: Optional[str] = None

def fq_table(table: str) -> str:
    global _project_id_cache
    if _project_id_cache is None:
        _project_id_cache = PROJECT_ID or bq_client().project
    return f"{_project_id_cache}.{BQ_DATASET}.{table}"
```

---

### 3. TTL-кеш для bot_settings / load_bot_profile

**Найти** функцию `load_bot_profile(org)` или `sb_get_bot_settings(org)` (строка ~960).

**Добавить** TTL-кеш (30 сек):
```python
import time

_profile_cache: Dict[str, Tuple[float, Any]] = {}
PROFILE_CACHE_TTL = 30.0

def load_bot_profile(org: str):
    """Load bot_settings with 30s TTL cache."""
    now = time.monotonic()
    cached = _profile_cache.get(org)
    if cached and (now - cached[0]) < PROFILE_CACHE_TTL:
        return cached[1]
    result = _load_bot_profile_uncached(org)  # Переименовать текущую функцию
    _profile_cache[org] = (now, result)
    return result
```

Переименовать текущую `load_bot_profile` → `_load_bot_profile_uncached`.

**ВАЖНО**: После confirm/apply, инвалидировать кеш:
```python
_profile_cache.pop(org, None)
```

---

### 4. TTL-кеш для dim_profile_aliases

**Найти** (строка ~324):
```python
_dim_profile_aliases_cache: Dict[str, Dict[str, str]] = {}
```

Текущий кеш **никогда не инвалидируется**. Добавить TTL 5 минут:

```python
_dim_aliases_cache: Dict[str, Tuple[float, Dict[str, str]]] = {}
DIM_ALIASES_TTL = 300.0  # 5 минут

def load_dim_profile_aliases(org: str) -> Dict[str, str]:
    now = time.monotonic()
    cached = _dim_aliases_cache.get(org)
    if cached and (now - cached[0]) < DIM_ALIASES_TTL:
        return cached[1]
    result = _load_dim_aliases_uncached(org)  # Текущая логика
    _dim_aliases_cache[org] = (now, result)
    return result
```

---

### 5. Request-level classify cache

Добавить фабрику кеша для использования в рамках одного запроса:

```python
def _make_classify_cache():
    """Per-request classify cache to avoid duplicate classify() calls."""
    _cache = {}
    def cached_classify(title, existing_profile=None, ral_whitelist=None):
        key = (title, existing_profile or "")
        if key not in _cache:
            _cache[key] = classify(title, existing_profile, ral_whitelist)
        return _cache[key]
    return cached_classify
```

**Использование** в dry_run, build_questions_v2, _quality_stats — везде где classify() вызывается в loop:
```python
# В начале dry_run:
classify_cached = _make_classify_cache()

# Заменить все вызовы classify(...) на classify_cached(...)
for _, row in df.iterrows():
    cls = classify_cached(row["title"], row.get("profile"), ral_wl)
```

---

## ТЕСТ-ЧЕКЛИСТ

```
# 1. Отправить 3 запроса preview_rows подряд:
for i in 1 2 3; do
  time curl -X POST .../api/enrich/preview_rows \
    -H "X-Internal-Secret: $SECRET" \
    -d '{"organization_id":"...","limit":50}'
done
# ✅ Второй и третий запрос быстрее первого (кеш bot_settings + global_facets)

# 2. Проверить что BigQuery client создаётся 1 раз:
# В логах Cloud Run должно быть только 1 сообщение инициализации BQ client

# 3. Dry run скорость:
time curl -X POST .../api/enrich/dry_run \
  -d '{"organization_id":"...","scope":{}}'
# ✅ Время ≤15 сек (было ~30 сек) благодаря classify cache
```

---

## НЕ ТРОГАТЬ

- НЕ менять логику classify() — только оборачивать в кеш
- НЕ менять SQL запросы (они исправлены в PR-1)
- НЕ удалять код
- НЕ менять эндпоинты / маршруты
