# ТЗ v3: Полный аудит и рефакторинг catalog-enricher main.py (4064 строк)

**Дата**: 2026-03-05  
**Статус**: P0 — production blocker  
**Файл**: `services/catalog-enricher/main.py` (reset-v2, 4064 строк)  
**Предыдущие ТЗ**: `CODEX_NORMALIZATION_FULL_FIX_V2.md` (частично выполнено)

---

## EXECUTIVE SUMMARY

Файл main.py — монолит на 4064 строк, совмещающий:
- FastAPI-приложение (13 эндпоинтов)
- Regex-классификатор товаров
- BigQuery CRUD (read/write/merge)
- Supabase REST-клиент
- Vertex AI интеграцию (Gemini)
- Cloud Tasks async apply
- NLP-парсер чат-команд

Основные проблемы: **производительность** (полный scan 71k строк на каждый dry_run), **архитектурные** (God Object, отсутствие кеширования), **контрактные** (расхождения с фронтендом), **безопасность** (SQL через f-strings).

---

## 1. КРИТИЧЕСКИЕ БАГИ (P0)

### 1.1 preview_rows: жёсткий cap limit=500 (строка 2618)

```python
# Строка 2618:
limit = max(1, min(int(req.limit or 50), 500))  # ← CAP!
```

**Проблема**: Фронтенд шлёт `limit: 2000`, бэкенд режет до 500. UI показывает 500 из 71к.

**Фикс**: Убрать cap или поднять до 5000:
```python
limit = max(1, min(int(req.limit or 50), 5000))
```

### 1.2 global_facets: by_kind — массив вместо объекта (строки 2771-2777)

**Текущее**: 
```python
"by_kind": [{"kind": k, "count": v} for k, v in sorted(...)]  # массив!
```

**Ожидание фронтенда** (contract-types.ts строка 281):
```typescript
by_kind?: Record<string, { total: number; ready: number; needs_attention: number }>;
```

**Фикс**: `by_kind` должен быть объектом с ready/needs_attention per kind:
```python
# Нужен отдельный SQL:
SELECT
  UPPER(IFNULL(sheet_kind, 'OTHER')) AS sheet_kind,
  COUNT(1) AS total,
  COUNTIF(
    IFNULL(TRIM(profile), '') != ''
    AND thickness_mm IS NOT NULL
    AND IFNULL(TRIM(coating), '') != ''
    AND width_work_mm IS NOT NULL
    AND width_full_mm IS NOT NULL
  ) AS ready
FROM `{fq}`
WHERE organization_id=@org
GROUP BY sheet_kind

# Формат ответа:
"by_kind": {
    "PROFNASTIL": {"total": 45000, "ready": 43000, "needs_attention": 2000},
    "METAL_TILE": {"total": 12000, "ready": 10000, "needs_attention": 2000},
    ...
}
```

### 1.3 global_facets: 3 отдельных BigQuery запроса (строки 2724-2757)

На каждый вызов `preview_rows` выполняются:
1. `sql_count` — COUNT для текущего фильтра
2. `sql_rows` — SELECT данных
3. `facets_sql` — GROUP BY по фильтру
4. `global_facets_sql` — COUNT без фильтра
5. `global_ready_sql` — COUNT ready без фильтра

**Итого 5 BigQuery запросов на один preview_rows!**

**Фикс**: Объединить запросы 4+5 в один (см. п.1.2). Запросы 1+3 можно объединить через window functions.

### 1.4 dry_run: загружает ВСЕ 71к строк в память (строка 2923)

```python
df = fetch_current(org, limit=req.scope.limit if req.scope.limit else 0)
# limit=0 → загружает ВСЕ строки в pandas DataFrame
```

Далее — полный Python-loop по каждой строке с `classify()` (строки 2940-3001).
Для 71к строк это **10-30 секунд** чистого CPU.

**Фикс**:
1. **Короткий путь**: Перенести классификацию в SQL (WHERE clauses + CASE WHEN для sheet_kind)
2. **Средний путь**: Кешировать результат classify по title hash (LRU cache)
3. **Долгий путь**: Предварительно классифицировать при импорте и хранить в BigQuery

### 1.5 questions_v2 (строка 3067): ещё раз загружает ВСЕ строки

Отдельный эндпоинт `/api/enrich/questions` делает `fetch_current(org)` + полный loop classify — **дублируя** логику dry_run.

**Фикс**: Убрать дублирование, вернуть questions как часть dry_run (уже делается), а отдельный endpoint сделать кешированным.

---

## 2. ПРОИЗВОДИТЕЛЬНОСТЬ (P1)

### 2.1 Нет кеширования BigQuery-запросов

Каждый вызов создаёт новый `bigquery.Client()` (строка 321):
```python
def bq_client() -> bigquery.Client:
    return bigquery.Client(project=PROJECT_ID) if PROJECT_ID else bigquery.Client()
```

**Фикс**: Singleton BigQuery client:
```python
_bq_client: Optional[bigquery.Client] = None

def bq_client() -> bigquery.Client:
    global _bq_client
    if _bq_client is None:
        _bq_client = bigquery.Client(project=PROJECT_ID) if PROJECT_ID else bigquery.Client()
    return _bq_client
```

### 2.2 Нет кеширования bot_settings

`load_bot_profile(org)` (строка ~960) вызывает Supabase REST API на **каждый** запрос. При 5 запросах от фронтенда = 5 HTTP calls к Supabase.

**Фикс**: TTL-кеш (30-60 сек):
```python
from functools import lru_cache
import time

_profile_cache: Dict[str, Tuple[float, Dict]] = {}
PROFILE_CACHE_TTL = 30.0

def load_bot_profile(org: str) -> Dict[str, Any]:
    now = time.monotonic()
    cached = _profile_cache.get(org)
    if cached and (now - cached[0]) < PROFILE_CACHE_TTL:
        return cached[1]
    result = _load_bot_profile_uncached(org)
    _profile_cache[org] = (now, result)
    return result
```

### 2.3 dim_profile_aliases кешируется навечно (строка 324)

```python
_dim_profile_aliases_cache: Dict[str, Dict[str, str]] = {}
```

Кеш **никогда не инвалидируется**. При изменении dim_profiles в BigQuery — старые данные до рестарта.

**Фикс**: Добавить TTL (5-10 минут).

### 2.4 fq_table() создаёт новый BigQuery client каждый раз (строка 360)

```python
def fq_table(table: str) -> str:
    c = bq_client()  # создаёт новый client!
    return f"{c.project}.{BQ_DATASET}.{table}"
```

Вызывается **десятки раз** за один запрос.

**Фикс**: Кешировать project_id:
```python
_project_id_cache: Optional[str] = None

def fq_table(table: str) -> str:
    global _project_id_cache
    if _project_id_cache is None:
        _project_id_cache = PROJECT_ID or bq_client().project
    return f"{_project_id_cache}.{BQ_DATASET}.{table}"
```

### 2.5 apply: загружает ВСЕ данные дважды (строки 3601-3624)

```python
df_before = fetch_current(org, limit=0)  # 71k строк
# ... materialize_patches внутри делает ещё fetch_current
df_after = fetch_current(org, limit=0)   # 71k строк ещё раз
```

**Итого**: 3 полных scan BigQuery за один apply. Для 71k строк это ~15-30 сек только на I/O.

**Фикс**: Убрать before/after quality comparison или делать через SQL-агрегацию вместо полной загрузки.

### 2.6 _quality_stats: Python-loop с classify на каждой строке (строка 1882)

```python
def _quality_stats(df, profile, ral_wl, widths_selected_norm):
    for _, row in df.iterrows():
        cls = classify(...)  # вызывается 71к раз
```

**Фикс**: Заменить на SQL-агрегацию (см. `dashboard_progress_aggregate` который уже делает это правильно).

---

## 3. АРХИТЕКТУРНЫЕ ПРОБЛЕМЫ (P1)

### 3.1 God Object: 4064 строки в одном файле

Рекомендуемая структура:
```
services/catalog-enricher/
├── main.py              # FastAPI app + endpoints (500 строк)
├── classifier.py        # classify() + regexes (400 строк)
├── questions.py          # build_questions_v2() (400 строк)
├── bq_ops.py            # BigQuery operations (300 строк)
├── supabase_client.py   # Supabase REST helpers (200 строк)
├── ai_suggest.py        # Gemini integration (200 строк)
├── models.py            # Pydantic models (100 строк)
├── helpers.py           # safe_text, normalize, etc. (200 строк)
├── cloud_tasks.py       # Cloud Tasks async (100 строк)
├── chat.py              # Chat/voice NLP (300 строк)
└── config.py            # ENV config + constants (100 строк)
```

### 3.2 Дублирование classify() логики

`classify()` вызывается в:
- `dry_run` (строка 2944)
- `build_questions_v2` (строка 2036)
- `_quality_stats` (строка 1890)
- `_tree_and_progress` (строка 1931)
- `_normalization_status_for_row` (строка 1917)
- `materialize_patches` (строка 3434)
- `chat` preview functions (строки 3832, 3858)
- `ai_chat_v2` — нет, но парсит сообщения

За один dry_run `classify()` вызывается **2-3 раза для каждой строки** (questions + patches + stats).

**Фикс**: Кешировать результат classify по (title, profile) на время запроса:
```python
from functools import lru_cache

# В рамках одного request:
classify_cache: Dict[Tuple[str, str], Classif] = {}

def classify_cached(title, profile, ...):
    key = (title, profile)
    if key not in classify_cache:
        classify_cache[key] = classify(title, profile, ...)
    return classify_cache[key]
```

### 3.3 Supabase REST — нет retry/timeout handling

```python
def sb_get_bot_settings(org: str):
    r = requests.get(url, headers=sb_headers(), timeout=30)
    if r.status_code >= 300:
        return None  # молча глотает ошибки
```

**Фикс**: Добавить retry (tenacity), structured logging ошибок.

### 3.4 confirm: прямая мутация settings_json в памяти (строка 3122)

```python
settings_json = bot_settings.get("settings_json") or {}
# ... мутирует settings_json в цикле ...
sb_update_bot_settings(org, settings_json)
```

**Риск**: Race condition при параллельных confirm-запросах (два оператора одновременно).

**Фикс**: Использовать `settings-merge` Edge Function (уже есть) или optimistic locking (version counter).

---

## 4. КОНТРАКТНЫЕ РАСХОЖДЕНИЯ С ФРОНТЕНДОМ (P0)

### 4.1 preview_rows.global_facets.by_kind — формат

| Поле | Бэкенд (текущий) | Фронтенд (ожидает) |
|------|-------------------|---------------------|
| `by_kind` | `[{kind, count}]` (массив) | `Record<string, {total, ready, needs_attention}>` (объект) |
| `by_kind[].ready` | отсутствует | **обязательно** |
| `by_kind[].needs_attention` | отсутствует | **обязательно** |

### 4.2 Отсутствует `color_system`/`color_code` в ready-проверке global_facets

```sql
-- Строка 2746 (global_ready_sql):
AND IFNULL(TRIM(profile), '') != ''
AND thickness_mm IS NOT NULL
AND IFNULL(TRIM(coating), '') != ''
AND width_work_mm IS NOT NULL
AND width_full_mm IS NOT NULL
-- НЕТ проверки color_system/color_code!
```

**vs** `dashboard_progress_aggregate` (строка 2366):
```sql
AND (
  IFNULL(TRIM(color_system), '') != ''
  OR LOWER(IFNULL(coating, '')) LIKE '%оцинк%'
)
```

**Фикс**: Унифицировать ready-логику. Добавить color проверку в global_ready_sql.

### 4.3 dry_run.stats.rows_total = len(df), а не COUNT(*)

```python
# Строка 3017:
"rows_total": int(len(df)) if df is not None else 0,
```

Если `scope.sheet_kind` фильтрует (строка 2926), `rows_total` отражает отфильтрованное количество, а не полное. Фронтенд ожидает **полное** количество.

**Фикс**: Добавить отдельный `count_current(org)` и вернуть его как `rows_total`.

### 4.4 Нет поля `price_rub_m2` в dry_run patches

`dry_run` возвращает `price_rub_m2` в patches_sample (строка 2983) — **OK**.
Но `preview_rows` (строка 2702) тоже добавляет `price_rub_m2` — **OK**.

✅ Этот пункт из CODEX_NORMALIZATION_FULL_FIX_V2.md **исправлен**.

### 4.5 Нет `contract_version` в ответах

Фронтенд проверяет `contract_version` (contract-types.ts строки 101, 175). Бэкенд не возвращает это поле.

**Фикс**: Добавить `"contract_version": "v1"` во все ответы dry_run, confirm, ai_chat_v2.

---

## 5. БЕЗОПАСНОСТЬ (P1)

### 5.1 SQL Injection через f-strings

```python
# Строка 2401:
sql = f"""SELECT ... FROM `{fq_table(BQ_TABLE_CURRENT)}` WHERE ..."""
```

`fq_table()` использует конфигурационные ENV-переменные (не user input), но **table name injection** теоретически возможен при некорректном BQ_DATASET/BQ_TABLE.

**Фикс**: Валидировать table names при старте:
```python
assert re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_]*", BQ_DATASET)
assert re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_]*", BQ_TABLE_CURRENT)
```

### 5.2 Нет rate limiting

Все эндпоинты доступны без ограничений (только shared secret). При компрометации секрета — полный доступ к BigQuery.

**Рекомендация**: Cloud Armor / rate limiting на уровне Cloud Run.

### 5.3 Shared secret в заголовке без HMAC

```python
if not x_internal_secret or x_internal_secret != ENRICH_SHARED_SECRET:
    raise HTTPException(status_code=403, detail="Forbidden")
```

Простое сравнение строк — уязвимо к timing attacks.

**Фикс**: `hmac.compare_digest(x_internal_secret, ENRICH_SHARED_SECRET)`

---

## 6. МЕТАЛЛОЧЕРЕПИЦА: ТЕКУЩИЙ СТАТУС

### 6.1 ✅ Исправлено: `_extract_metal_tile_profile` (строки 822-836)

Работает корректно:
1. Сначала проверяет `METAL_TILE_MODEL_ALIASES` (12 моделей)
2. Fallback: regex после "металлочерепиц*"

### 6.2 ✅ Исправлено: classify() проставляет profile для METAL_TILE (строка 1367-1368)

```python
if not r.profile and r.sheet_kind == "METAL_TILE":
    r.profile = _extract_metal_tile_profile(t)
```

### 6.3 ⚠️ Частично: questions генерируются для METAL_TILE

`build_questions_v2` (строка 2015) обрабатывает METAL_TILE для WIDTH_MASTER, THICKNESS_SET, PROFILE_MAP. ✅

Но `_collect_unknown_tokens` (строка 1552) ищет токены только **в скобках** `()`. Для металлочерепицы покрытие часто не в скобках.

**Рекомендация**: Расширить `_collect_unknown_tokens` для METAL_TILE строк — парсить по пробелам после профиля.

---

## 7. ЧИСТКА МЁРТВОГО / ДУБЛИРУЮЩЕГО КОДА

### 7.1 Дублирование normalize_base_url vs canonical_base_url

Две функции делают одно и то же (строки 2525 и 2540):
- `canonical_base_url(request)` — использует `PUBLIC_BASE_URL`
- `normalize_base_url(fallback)` — использует `SERVICE_BASE_URL`

**Фикс**: Оставить одну функцию.

### 7.2 build_questions (v1) — мёртвый код (строка 1655)

`build_questions()` (v1) не используется — его заменил `build_questions_v2()` (строка 2015). 

**Фикс**: Удалить build_questions (строки 1655-1722).

### 7.3 Unused `ConfirmRequest.model_rebuild()` (строка 259)

Не нужен для текущей версии Pydantic v2.

### 7.4 Версия в print (строка 3695)

```python
print("!!! VERSION: FEB-07-v2-FIXED-HTTPS !!!")
```

Артефакт дебага. Удалить или заменить на structured logging.

---

## 8. ПЛАН РЕФАКТОРИНГА (приоритезированный)

### Фаза 1: Критические фиксы (1-2 дня)

| # | Задача | Строки | Приоритет |
|---|--------|--------|-----------|
| 1 | Убрать cap `limit=500` в preview_rows | 2618 | P0 |
| 2 | Исправить `by_kind` формат (объект + ready/needs_attention per kind) | 2724-2777 | P0 |
| 3 | Объединить 5 BigQuery запросов в preview_rows в 2-3 | 2662-2757 | P0 |
| 4 | Добавить `contract_version: "v1"` во все ответы | Все эндпоинты | P0 |
| 5 | Унифицировать ready-логику (добавить color_system в global_ready) | 2742-2751 | P0 |

### Фаза 2: Производительность (3-5 дней)

| # | Задача | Эффект |
|---|--------|--------|
| 6 | Singleton BigQuery client | -200ms на запрос |
| 7 | TTL-кеш для bot_settings | -100ms на запрос |
| 8 | TTL-кеш для dim_profile_aliases | Предотвращение stale data |
| 9 | Кеш fq_table() | -50ms на запрос |
| 10 | SQL-агрегация вместо Python loop для quality_stats | -5-10 сек на apply |
| 11 | Убрать тройной fetch_current в apply | -10-20 сек на apply |
| 12 | classify() request-level cache | -30% CPU на dry_run |

### Фаза 3: Архитектурный рефакторинг (1-2 недели)

| # | Задача |
|---|--------|
| 13 | Разбить main.py на 10 модулей (см. п.3.1) |
| 14 | Удалить build_questions v1 |
| 15 | Удалить дубли normalize_base_url / canonical_base_url |
| 16 | Добавить structured logging (JSON) |
| 17 | Добавить tenacity retry для Supabase calls |
| 18 | Перенести classify() в SQL (BigQuery UDF или pre-materialize) |
| 19 | Оптимистичная блокировка для confirm (version counter) |

### Фаза 4: Безопасность (параллельно)

| # | Задача |
|---|--------|
| 20 | hmac.compare_digest для shared secret |
| 21 | Валидация table names при старте |
| 22 | Rate limiting (Cloud Armor) |

---

## 9. ТЕСТ-ЧЕКЛИСТ ПОСЛЕ ФИКСОВ

- [ ] `preview_rows limit=2000` → response содержит 2000 строк (не 500)
- [ ] `preview_rows` → `global_facets.by_kind` = объект `Record<string, {total, ready, needs_attention}>`
- [ ] `preview_rows` → `global_facets.total` = 71316 (полное количество)
- [ ] `preview_rows` → `global_facets.ready` включает color_system проверку
- [ ] `preview_rows` → ≤3 BigQuery запроса (было 5)
- [ ] `preview_rows` → response time ≤ 5 сек для 2000 строк
- [ ] `dry_run` → `stats.rows_total` = полное количество строк (не len(df))
- [ ] `dry_run` → содержит `contract_version: "v1"`
- [ ] `dry_run` → classify() вызывается 1 раз per row (не 2-3)
- [ ] `apply` → не делает 3 fetch_current (максимум 1)
- [ ] `confirm` → thread-safe для параллельных запросов
- [ ] Все ответы содержат `contract_version: "v1"`
- [ ] METAL_TILE → profile заполнен для известных моделей (Monterrey, Kaskad, etc.)
- [ ] `_quality_stats` → SQL-based (не Python loop)

---

## 10. МЕТРИКИ ДЛЯ МОНИТОРИНГА

После рефакторинга добавить:

```python
# Каждый эндпоинт:
print(json.dumps({
    "event": "enrich.preview_rows",
    "organization_id": org,
    "bq_queries_count": N,
    "bq_total_ms": M,
    "rows_returned": len(rows),
    "total_ms": elapsed_ms,
}))
```

Ключевые SLO:
- `preview_rows` p95 ≤ 3 сек
- `dry_run` p95 ≤ 15 сек (для 71k)
- `apply` p95 ≤ 60 сек (для 71k)
- BigQuery queries per request ≤ 3
