# ТЗ v4: Рефакторинг catalog-enricher main.py — ПОЛНОЕ РУКОВОДСТВО

**Дата**: 2026-03-05  
**Статус**: P0 — production  
**Стратегия**: Инкрементальный патчинг текущего main.py (4064 строк)  
**Цель**: Уменьшить до ~2000-2500 строк, исправить все контрактные расхождения, ускорить 5-10x

---

## СОДЕРЖАНИЕ

1. [Общая архитектура (AS-IS / TO-BE)](#1-общая-архитектура)
2. [ЧТО УДАЛИТЬ (мёртвый код)](#2-что-удалить)
3. [ЧТО ИСПРАВИТЬ (P0 — контрактные баги)](#3-что-исправить-p0)
4. [ЧТО ДОБАВИТЬ (недостающая функциональность)](#4-что-добавить)
5. [КЛАССИФИКАЦИЯ — полная переработка](#5-классификация)
6. [ПРОФИЛЯ МЕТАЛЛОЧЕРЕПИЦЫ — универсальное распознавание](#6-профиля-металлочерепицы)
7. [PREVIEW_ROWS — рефакторинг](#7-preview_rows)
8. [CONFIRM — миграция на settings-merge](#8-confirm)
9. [AI_CHAT_V2 — миграция в Edge Function](#9-ai_chat_v2)
10. [ПРОИЗВОДИТЕЛЬНОСТЬ](#10-производительность)
11. [БЕЗОПАСНОСТЬ](#11-безопасность)
12. [ТЕСТ-ЧЕКЛИСТ](#12-тест-чеклист)
13. [ПЛАН РАБОТ по фазам](#13-план-работ)

---

## 1. ОБЩАЯ АРХИТЕКТУРА

### AS-IS (текущий main.py, 4064 строки)

```
main.py (МОНОЛИТ 4064 строк)
├── Config + env (строки 1-100)
├── Regex patterns (строки 100-300) — ДУБЛИРУЮТСЯ
├── BigQuery CRUD (строки 300-600) — bq_client() без кеша
├── Supabase REST (строки 600-1000) — load_bot_profile без TTL
├── classify() (строки 1000-1500) — God Function, вызывается 3x per row
├── build_questions v1 (строки 1655-1722) — МЁРТВЫЙ КОД
├── build_questions_v2 (строки 2015-2200) — дублирует classify()
├── _quality_stats (строки 1882-1930) — Python loop 71k, дублирует classify()
├── _tree_and_progress (строки 1931-2014) — дублирует classify()
├── preview_rows (строки 2618-2800) — 5 BQ запросов, limit cap 500
├── global_facets (строки 2724-2777) — by_kind МАССИВ (контракт = ОБЪЕКТ)
├── dry_run (строки 2900-3060) — загружает ВСЕ 71k в memory
├── questions_v2 endpoint (строки 3067-3090) — ДУБЛИРУЕТ dry_run logic
├── confirm (строки 3122-3400) — прямая мутация bot_settings (race condition)
├── apply (строки 3601-3660) — 3x fetch_current (before + materialize + after)
├── ai_chat_v2 (строки 3700-3900) — 200 строк NLP + Gemini
├── chat preview helpers (строки 3830-3900) — дублируют classify()
└── Health + startup (строки 3950-4064)
```

### TO-BE (после рефакторинга, ~2000-2500 строк)

```
main.py (ЧИСТЫЙ, ~2000-2500 строк)
├── Config + env (100 строк)
├── Regex patterns — ЕДИНЫЙ блок, скомпилированные (150 строк)
├── classify_item() — ЕДИНАЯ точка входа (80 строк)
├── enrich_row() — обогащение одной строки (60 строк)
├── BigQuery CRUD — singleton client, кеш fq_table (200 строк)
├── Supabase REST — TTL-кеш bot_settings, retry (150 строк)
├── build_questions_v2() — ширины + покрытия + цвета (250 строк)
├── preview_rows — ≤3 BQ запроса, limit до 5000, global_facets ОБЪЕКТ (200 строк)
├── dry_run — classify_cache per request (200 строк)
├── confirm — ПРОКСИ к settings-merge Edge Function (80 строк)
├── apply / apply_start / apply_worker — без тройного fetch (200 строк)
├── health + startup (50 строк)
└── УДАЛЕНО: ai_chat_v2, build_questions v1, questions_v2 endpoint, 
    chat preview helpers, _quality_stats Python loop, 
    дубли normalize_base_url/canonical_base_url
```

---

## 2. ЧТО УДАЛИТЬ (мёртвый код)

### 2.1 `build_questions()` v1 (строки ~1655-1722)
**Причина**: Полностью заменён `build_questions_v2()`. Не вызывается нигде.
**Действие**: Удалить полностью.

### 2.2 Эндпоинт `/api/enrich/questions` (строки ~3067-3090)
**Причина**: Дублирует логику dry_run (загружает ВСЕ строки + classify loop). Questions возвращаются как часть dry_run.
**Действие**: Удалить эндпоинт. Фронтенд уже получает questions из dry_run.

### 2.3 Эндпоинт `/api/enrich/ai_chat_v2` (~200 строк, строки 3700-3900)
**Причина**: Мигрирует в Edge Function `normalization-chat` (решение пользователя).
**Действие**: Удалить из main.py. См. раздел 9.

### 2.4 Chat preview helpers (строки ~3830-3900)
**Причина**: Вспомогательные функции для ai_chat_v2. Уходят вместе с ним.
**Действие**: Удалить.

### 2.5 Дубль `normalize_base_url()` vs `canonical_base_url()` (строки ~2525 и ~2540)
**Причина**: Две функции делают одно и то же.
**Действие**: Оставить одну функцию `_public_base_url()`.

### 2.6 `ConfirmRequest.model_rebuild()` (строка ~259)
**Причина**: Артефакт Pydantic v1, не нужен в v2.
**Действие**: Удалить.

### 2.7 Debug print `"!!! VERSION: FEB-07-v2-FIXED-HTTPS !!!"` (строка ~3695)
**Причина**: Артефакт дебага.
**Действие**: Заменить на structured log или удалить.

### 2.8 `_quality_stats()` Python loop (строки ~1882-1930)
**Причина**: Итерирует 71k строк в Python с classify() на каждой. 
**Действие**: Заменить на SQL-агрегацию (см. раздел 10.6).

### Итого удаляется: ~1200-1500 строк

---

## 3. ЧТО ИСПРАВИТЬ (P0 — контрактные баги)

### 3.1 preview_rows: limit cap 500 → 5000

**Текущее** (строка ~2618):
```python
limit = max(1, min(int(req.limit or 50), 500))  # ← ЖЁСТКИЙ CAP
```

**Исправить**:
```python
limit = max(1, min(int(req.limit or 50), 5000))
```

### 3.2 global_facets.by_kind: массив → объект

**Текущее** (строки ~2771-2777):
```python
"by_kind": [{"kind": k, "count": v} for k, v in sorted(...)]
```

**Фронтенд ожидает** (contract-types.ts строка 281):
```typescript
by_kind?: Record<string, { total: number; ready: number; needs_attention: number }>;
```

**Исправить** — SQL + Python:
```python
# Один SQL запрос для by_kind:
sql_by_kind = f"""
SELECT
  UPPER(COALESCE(NULLIF(TRIM(sheet_kind), ''), 'OTHER')) AS sheet_kind,
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
FROM `{fq}`
WHERE organization_id=@org
GROUP BY 1
"""

# Формирование объекта:
by_kind = {}
for row in bq_client().query(sql_by_kind, ...).result():
    kind = row["sheet_kind"]
    total = int(row["total"])
    ready = int(row["ready"])
    by_kind[kind] = {
        "total": total,
        "ready": ready,
        "needs_attention": total - ready
    }
```

### 3.3 global_facets.ready — отсутствует проверка color_system

**Текущее** (строки ~2742-2751):
```sql
-- НЕТ проверки color_system/color_code!
AND IFNULL(TRIM(profile), '') != ''
AND thickness_mm IS NOT NULL
AND IFNULL(TRIM(coating), '') != ''
```

**Исправить** — унифицировать с `dashboard_progress_aggregate`:
```sql
AND COALESCE(TRIM(profile), '') != ''
AND thickness_mm IS NOT NULL
AND COALESCE(TRIM(coating), '') != ''
AND width_work_mm IS NOT NULL
AND width_full_mm IS NOT NULL
AND (
  COALESCE(TRIM(color_system), '') != ''
  OR LOWER(COALESCE(coating, '')) LIKE '%оцинк%'
)
```

### 3.4 dry_run.stats.rows_total = len(df) → COUNT(*)

**Текущее** (строка ~3017):
```python
"rows_total": int(len(df)) if df is not None else 0,
```

Если scope.sheet_kind фильтрует, rows_total = отфильтрованное, а не полное.

**Исправить**:
```python
total_count = count_current(org)  # отдельный COUNT(*) без фильтров
# ...
"rows_total": total_count,
"rows_scanned": int(len(df)),
```

### 3.5 Добавить `contract_version: "v1"` во ВСЕ ответы

**Текущее**: Бэкенд НЕ возвращает contract_version.

**Исправить** — обёртка:
```python
def _response(data: dict) -> dict:
    data["contract_version"] = "v1"
    return _json_safe(data)
```

Применить в: dry_run, preview_rows, confirm, apply, apply_start, apply_status, dashboard, stats, tree.

### 3.6 preview_rows: отсутствуют фильтры sheet_kind, profile, status, sort

**Текущее**: preview_rows принимает только `group_type`, `filter_key`, `q`.

**Фронтенд отправляет** (import-normalize/index.ts строки 464-468):
```typescript
if (previewBody.sheet_kind) previewPayload.sheet_kind = previewBody.sheet_kind;
if (previewBody.profile) previewPayload.profile = previewBody.profile;
if (previewBody.sort) previewPayload.sort = previewBody.sort;
if (previewBody.status) previewPayload.status = previewBody.status;
```

**Исправить** — добавить в preview_rows request model:
```python
class PreviewRowsRequest(BaseModel):
    organization_id: str
    import_job_id: Optional[str] = None
    # Existing
    group_type: Optional[str] = None
    filter_key: Optional[str] = None
    q: Optional[str] = None
    limit: int = 50
    offset: int = 0
    # NEW — Contract v1 filters
    sheet_kind: Optional[str] = None
    profile: Optional[str] = None
    status: Optional[str] = None  # "needs_attention" | "ready"
    sort: Optional[str] = None    # "title" | "-title" | "profile" | etc.
```

И добавить WHERE clauses:
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

### 3.7 preview_rows: price_rub_m2 отсутствует в SELECT

**Текущее** SELECT (строка ~2702):
```sql
SELECT id, title, unit, profile, thickness_mm, ...
```

**Исправить** — добавить `price_rub_m2` и `cur`:
```sql
SELECT id, title, unit, cur,
    profile, thickness_mm, width_work_mm, width_full_mm,
    coating, notes,
    sheet_kind, color_system, color_code,
    price_rub_m2
FROM ...
```

---

## 4. ЧТО ДОБАВИТЬ

### 4.1 Singleton BigQuery client

```python
_bq_client: Optional[bigquery.Client] = None
_project_id_cache: Optional[str] = None

def bq_client() -> bigquery.Client:
    global _bq_client
    if _bq_client is None:
        _bq_client = bigquery.Client(project=PROJECT_ID) if PROJECT_ID else bigquery.Client()
    return _bq_client

def fq_table(table: str) -> str:
    global _project_id_cache
    if _project_id_cache is None:
        _project_id_cache = PROJECT_ID or bq_client().project
    return f"{_project_id_cache}.{BQ_DATASET}.{table}"
```

### 4.2 TTL-кеш для bot_settings

```python
_profile_cache: Dict[str, Tuple[float, Dict]] = {}
PROFILE_CACHE_TTL = 30.0

def load_pricing_profile(org: str) -> Dict[str, Any]:
    now = time.monotonic()
    cached = _profile_cache.get(org)
    if cached and (now - cached[0]) < PROFILE_CACHE_TTL:
        return cached[1]
    result = _load_pricing_profile_uncached(org)
    _profile_cache[org] = (now, result)
    return result
```

### 4.3 TTL-кеш для dim_profile_aliases

```python
_dim_aliases_cache: Dict[str, Tuple[float, Dict]] = {}
DIM_ALIASES_TTL = 300.0  # 5 минут

def load_dim_profile_aliases(org: str) -> Dict[str, str]:
    now = time.monotonic()
    cached = _dim_aliases_cache.get(org)
    if cached and (now - cached[0]) < DIM_ALIASES_TTL:
        return cached[1]
    result = _load_dim_aliases_uncached(org)
    _dim_aliases_cache[org] = (now, result)
    return result
```

### 4.4 Request-level classify cache

```python
def _make_classify_cache():
    """Create a per-request classify cache."""
    cache = {}
    def classify_cached(title, existing_profile, ral_whitelist):
        key = (title, existing_profile or "")
        if key not in cache:
            cache[key] = classify_item(title, existing_profile, ral_whitelist)
        return cache[key]
    return classify_cached
```

### 4.5 hmac.compare_digest для shared secret

```python
import hmac

def require_secret(x_internal_secret: Optional[str]) -> None:
    secret = _env("ENRICH_SHARED_SECRET")
    if not secret:
        raise HTTPException(status_code=500, detail="ENRICH_SHARED_SECRET not set")
    if not x_internal_secret or not hmac.compare_digest(x_internal_secret, secret):
        raise HTTPException(status_code=403, detail="Forbidden")
```

### 4.6 Table name validation при старте

```python
import re as _re

def _validate_table_names():
    pattern = _re.compile(r'^[a-zA-Z_][a-zA-Z0-9_]*$')
    for name in [BQ_DATASET, BQ_TABLE_CURRENT, BQ_TABLE_PATCHES]:
        if not pattern.fullmatch(name):
            raise RuntimeError(f"Invalid table name: {name}")

_validate_table_names()
```

---

## 5. КЛАССИФИКАЦИЯ — полная переработка

### 5.1 Текущая проблема

`classify()` в текущем main.py — это **God Function** на ~500 строк. Она:
1. Вызывается **2-3 раза per row** (в dry_run, questions, quality_stats)
2. Содержит смешанную логику: sheet_kind + color + profile + thickness + coating
3. Результат не кешируется

### 5.2 Целевая архитектура (взять из main-ideal.py)

```python
class ClassificationResult:
    """Результат классификации — ТОЛЬКО sheet_kind, color, profile, is_accessory."""
    def __init__(self):
        self.sheet_kind: str = "OTHER"
        self.color_system: Optional[str] = None
        self.color_code: Optional[str] = None
        self.profile: Optional[str] = None
        self.is_accessory: bool = False

def classify_item(
    title: str,
    existing_profile: Optional[str] = None,
    ral_whitelist: Optional[set] = None
) -> ClassificationResult:
    """
    ЕДИНАЯ точка входа. Порядок:
    1. Accessory guard
    2. Profile extraction (профнастил + металлочерепица)
    3. Sheet_kind determination
    4. Color extraction (RAL/RR/DECOR)
    """
```

### 5.3 Разделение ответственности

| Функция | Отвечает за | НЕ отвечает за |
|---------|-------------|----------------|
| `classify_item()` | sheet_kind, profile, color_system/code, is_accessory | thickness, coating, widths |
| `enrich_row()` | Полное обогащение одной строки (вызывает classify_item + thickness + coating + widths) | — |
| `build_questions_v2()` | Генерация вопросов пользователю | Мутация данных |

---

## 6. ПРОФИЛЯ МЕТАЛЛОЧЕРЕПИЦЫ — универсальное распознавание

### 6.1 Требование

Профиля металлочерепицы должны распознаваться из title **любого поставщика**. Нельзя ограничиваться фиксированным списком моделей — прайсы разные.

### 6.2 Стратегия: расширенный словарь + regex fallback + AI

**Уровень 1: Словарь известных моделей** (расширяемый через bot_settings)
```python
# BUILT-IN алиасы (покрывают 95% рынка)
METAL_TILE_MODEL_ALIASES: Dict[str, str] = {
    # Grand Line
    "монтеррей": "Monterrey", "монтерроса": "Monterrey", "monterrey": "Monterrey",
    "classic": "Classic", "классик": "Classic",
    "квинта плюс": "Kvinta Plus", "kvinta": "Kvinta Plus",
    "камея": "Kamea", "kamea": "Kamea",
    "кредо": "Kredo", "kredo": "Kredo",
    # Металл Профиль
    "макси": "Maxi", "maxi": "Maxi",
    "ламонтерра": "Lamonterra", "lamonterra": "Lamonterra",
    "ламонтерра x": "Lamonterra X",
    "монтекристо": "Montecristo", "montecristo": "Montecristo",
    "трамонтана": "Tramontana", "tramontana": "Tramontana",
    # Stynergy
    "стандарт": "Standard",
    # Ruukki
    "финнера": "Finnera", "finnera": "Finnera",
    "адаманте": "Adamante", "adamante": "Adamante",
    "декоррей": "Decorrey", "decorrey": "Decorrey",
    "эффект": "Effect", "effect": "Effect",
    # MeraSystem
    "ева": "Eva", "eva": "Eva",
    "анна": "Anna", "anna": "Anna",
    # Общие
    "каскад": "Kaskad", "kaskad": "Kaskad", "cascade": "Kaskad",
    "андалузия": "Andaluzia", "andaluzia": "Andaluzia", "andalusia": "Andaluzia",
    "банга": "Banga", "banga": "Banga",
    "венеция": "Venezia", "venezia": "Venezia",
    "арроуд": "Arrowud", "arrowud": "Arrowud",
    "модерн": "Modern", "modern": "Modern",
    "супермонтеррей": "Super Monterrey", "supermonterrey": "Super Monterrey",
}
```

**Уровень 2: Regex fallback для неизвестных** — извлечь токен после "металлочерепица":
```python
RE_MT_PROFILE_AFTER = re.compile(
    r'металлочерепиц[а-яё]*\s+(?:тип\s+)?([А-Яа-яA-Za-z][А-Яа-яA-Za-z0-9\s\-]+)',
    re.I
)

def _extract_metal_tile_profile(title: str) -> Optional[str]:
    """Extract metal tile profile: dictionary first, then regex fallback."""
    tl = title.lower()
    
    # Level 1: Dictionary lookup
    for alias, canonical in METAL_TILE_MODEL_ALIASES.items():
        if alias in tl:
            return canonical
    
    # Level 2: Regex fallback — extract word after "металлочерепица"
    m = RE_MT_PROFILE_AFTER.search(title)
    if m:
        raw = m.group(1).strip()
        # Trim to first meaningful word (до запятой, скобки, числа)
        raw = re.split(r'[,\(\d]', raw)[0].strip()
        if len(raw) >= 3 and len(raw) <= 30:
            return raw.title()  # "макси" → "Макси"
    
    return None
```

**Уровень 3: Custom aliases из bot_settings** — пользователь может добавить через UI:
```python
# В enrich_row() после встроенного словаря:
custom_aliases = prof.get("metal_tile_aliases") or {}
for alias, canonical in custom_aliases.items():
    if alias.lower() in title.lower():
        return canonical
```

### 6.3 Интеграция в classify_item()

```python
# В classify_item(), после STEP 3 (sheet_kind determination):
if result.sheet_kind == "METAL_TILE" and not result.profile:
    result.profile = _extract_metal_tile_profile(title)

# Также: если профиль обнаружен как металлочерепичный, но sheet_kind ещё OTHER:
if not result.is_accessory and result.profile:
    if result.profile in METAL_TILE_MODEL_ALIASES.values():
        result.sheet_kind = "METAL_TILE"
```

---

## 7. PREVIEW_ROWS — рефакторинг

### 7.1 Текущая проблема: 5 BigQuery запросов

```
1. sql_count — COUNT для текущего фильтра
2. sql_rows — SELECT данных
3. facets_sql — GROUP BY sheet_kind для текущего фильтра
4. global_facets_sql — COUNT без фильтра (total)
5. global_ready_sql — COUNT ready без фильтра
```

### 7.2 Целевое: максимум 3 BigQuery запроса

```
1. sql_count_and_rows — COUNT(*) OVER() + SELECT с пагинацией (1 запрос)
2. facets_sql — GROUP BY sheet_kind + profile (только если нет фильтров)
3. global_facets_with_by_kind — total + ready + by_kind (1 запрос, кешируемый)
```

### 7.3 Объединение count + rows через window function

```sql
SELECT
    COUNT(1) OVER() AS _total_count,
    id, title, unit, cur,
    profile, thickness_mm, width_work_mm, width_full_mm,
    coating, notes,
    sheet_kind, color_system, color_code,
    price_rub_m2
FROM `{fq}`
{where}
ORDER BY title
LIMIT @limit OFFSET @offset
```

### 7.4 Кеширование global_facets

Global facets не зависят от фильтров — можно кешировать на 30 сек:

```python
_global_facets_cache: Dict[str, Tuple[float, Dict]] = {}
GLOBAL_FACETS_TTL = 30.0

def _get_global_facets(org: str) -> Dict:
    now = time.monotonic()
    cached = _global_facets_cache.get(org)
    if cached and (now - cached[0]) < GLOBAL_FACETS_TTL:
        return cached[1]
    
    # Один SQL запрос для total + ready + by_kind
    sql = f"""
    SELECT
      UPPER(COALESCE(NULLIF(TRIM(sheet_kind), ''), 'OTHER')) AS sk,
      COUNT(1) AS total,
      COUNTIF(
        COALESCE(TRIM(profile), '') != ''
        AND thickness_mm IS NOT NULL
        AND COALESCE(TRIM(coating), '') != ''
        AND width_work_mm IS NOT NULL
        AND width_full_mm IS NOT NULL
        AND (COALESCE(TRIM(color_system), '') != '' OR LOWER(COALESCE(coating, '')) LIKE '%оцинк%')
      ) AS ready
    FROM `{fq_table(BQ_TABLE_CURRENT)}`
    WHERE organization_id=@org
    GROUP BY 1
    """
    
    by_kind = {}
    grand_total = 0
    grand_ready = 0
    
    for row in bq_client().query(sql, ...).result():
        sk = row["sk"]
        t = int(row["total"])
        r = int(row["ready"])
        by_kind[sk] = {"total": t, "ready": r, "needs_attention": t - r}
        grand_total += t
        grand_ready += r
    
    result = {
        "total": grand_total,
        "ready": grand_ready,
        "needs_attention": grand_total - grand_ready,
        "by_kind": by_kind
    }
    
    _global_facets_cache[org] = (now, result)
    return result
```

---

## 8. CONFIRM — миграция на settings-merge

### 8.1 Текущая проблема

Confirm endpoint в main.py:
1. Читает bot_settings через REST
2. Мутирует settings_json в Python memory
3. Записывает обратно через PATCH

**Race condition**: два оператора одновременно → последний перезатирает первого.

### 8.2 Целевая архитектура

Confirm endpoint в main.py становится **прокси** к `settings-merge` Edge Function:

```python
@app.post("/api/enrich/confirm")
def confirm(
    req: ConfirmRequest,
    x_internal_secret: Optional[str] = Header(default=None, alias="X-Internal-Secret")
):
    require_secret(x_internal_secret)
    org = req.organization_id
    
    # Собрать patch из actions
    settings_patch = _actions_to_settings_patch(req.actions or [{"type": req.type, "payload": req.payload}])
    
    # Вызвать settings-merge Edge Function
    supabase_url, service_key = _supabase_env()
    resp = requests.post(
        f"{supabase_url}/functions/v1/settings-merge",
        headers={
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
        },
        json={
            "organization_id": org,
            "patch": {"pricing": settings_patch},
        },
        timeout=15,
    )
    
    if resp.status_code >= 300:
        raise HTTPException(status_code=502, detail=f"settings-merge failed: {resp.status_code}")
    
    # Инвалидировать кеш
    _profile_cache.pop(org, None)
    
    return _response({
        "ok": True,
        "type": "BATCH",
        "organization_id": org,
        "affected_clusters": [a.get("type") for a in (req.actions or [])],
    })
```

### 8.3 `_actions_to_settings_patch()` — маппинг actions → pricing patch

```python
def _actions_to_settings_patch(actions: List[Dict]) -> Dict:
    patch = {}
    for action in actions:
        t = action.get("type", "")
        p = action.get("payload", {})
        
        if t == "WIDTH_MASTER":
            profile = p.get("profile", "")
            work_mm = p.get("work_mm")
            full_mm = p.get("full_mm")
            if profile:
                patch.setdefault("widths_selected", {})[profile] = {
                    "work_mm": work_mm, "full_mm": full_mm
                }
        
        elif t == "COATING_MAP":
            token = p.get("token", "")
            value = p.get("value", "")
            if token:
                patch.setdefault("coatings", {})[token] = value
        
        elif t == "COLOR_MAP":
            token = p.get("token", "")
            ral = p.get("ral", "")
            if token:
                patch.setdefault("colors", {}).setdefault("ral_aliases", {})[token] = ral
        
        elif t == "PROFILE_MAP":
            alias = p.get("alias", "")
            canonical = p.get("canonical", "")
            if alias and canonical:
                patch.setdefault("profile_aliases", {})[alias] = canonical
    
    return patch
```

---

## 9. AI_CHAT_V2 — миграция в Edge Function

### 9.1 Текущее

`ai_chat_v2` — ~200 строк в main.py: NLP-парсинг + Gemini вызов + формирование actions.

### 9.2 Целевое

Edge Function `normalization-chat` (уже есть заглушка) берёт на себя:
1. Получение message + context от фронтенда
2. Прокси к Gemini через Cloud Run **ИЛИ** прямой вызов Vertex AI REST
3. Формирование actions[] для confirmActions

### 9.3 Что остаётся в main.py

**Ничего**. Эндпоинт `/api/enrich/ai_chat_v2` полностью удаляется.

### 9.4 Маршрутизация в import-normalize Edge Function

В `import-normalize/index.ts`, блок `op === 'ai_chat_v2'`:
- **Текущее**: проксирует к `CATALOG_ENRICHER_URL/api/enrich/ai_chat_v2`
- **Новое**: вызывает `normalization-chat` Edge Function напрямую (межфункциональный вызов):

```typescript
if (op === 'ai_chat_v2') {
  // Вызвать normalization-chat Edge Function
  const chatResp = await fetch(
    `${supabaseUrl}/functions/v1/normalization-chat`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        organization_id,
        message: (body as AiChatV2Request).message,
        context: (body as AiChatV2Request).context,
        run_id: (body as AiChatV2Request).run_id,
      }),
    }
  );
  // ...
}
```

### 9.5 normalization-chat Edge Function — реализация

Отдельная задача. Основные компоненты:
1. Аутентификация + org membership check
2. Загрузка bot_settings для контекста
3. Вызов Gemini через Vertex AI REST API (используя GCP_SERVICE_ACCOUNT_JSON)
4. Парсинг ответа → actions[]
5. Возврат в формате AiChatV2Result

---

## 10. ПРОИЗВОДИТЕЛЬНОСТЬ

### 10.1 Singleton BigQuery client (см. 4.1)
**Эффект**: -200ms на запрос (устранение создания нового client)

### 10.2 TTL-кеш bot_settings (см. 4.2)
**Эффект**: -100ms на запрос (устранение HTTP call к Supabase)

### 10.3 TTL-кеш dim_profile_aliases (см. 4.3)
**Эффект**: Предотвращение stale data + -50ms

### 10.4 Кеш fq_table() (см. 4.1)
**Эффект**: -50ms на запрос (устранение bq_client() вызова)

### 10.5 Объединение BQ запросов в preview_rows (см. 7.3)
**Эффект**: 5 запросов → 3 максимум, -500ms

### 10.6 SQL-агрегация вместо Python loop для quality_stats

**Текущее**: `_quality_stats()` итерирует 71k строк в Python с classify() на каждой.

**Исправить** — SQL:
```sql
SELECT
  COUNT(1) AS total,
  COUNTIF(COALESCE(TRIM(profile), '') != '') AS profile_filled,
  COUNTIF(thickness_mm IS NOT NULL) AS thickness_filled,
  COUNTIF(COALESCE(TRIM(coating), '') != '') AS coating_filled,
  COUNTIF(width_work_mm IS NOT NULL) AS width_work_filled,
  COUNTIF(width_full_mm IS NOT NULL) AS width_full_filled,
  COUNTIF(COALESCE(TRIM(color_system), '') != '') AS color_system_filled,
  COUNTIF(COALESCE(TRIM(color_code), '') != '') AS color_code_filled,
  COUNTIF(UPPER(COALESCE(sheet_kind, '')) NOT IN ('OTHER', '')) AS kind_non_other
FROM `{fq_table(BQ_TABLE_CURRENT)}`
WHERE organization_id=@org
```

**Эффект**: -5-10 сек на apply (71k строк)

### 10.7 Убрать тройной fetch_current в apply

**Текущее** (строки ~3601-3624):
```python
df_before = fetch_current(org, limit=0)  # 71k строк
# materialize_patches внутри делает ещё fetch_current
df_after = fetch_current(org, limit=0)   # 71k строк ещё раз
```

**Исправить**: Один fetch_current, quality comparison через SQL после merge:
```python
# BEFORE: качество читаем одним SQL (10.6)
before_stats = _quality_stats_sql(org)

# Обогащение + merge
df = fetch_current(org, limit=0)  # ОДИН раз
patches = [enrich_row(r.to_dict() | {"organization_id": org}, prof, ral_wl) for _, r in df.iterrows()]
delete_staging(org, run_id)
write_patches_to_bq(run_id, patches)
merge_patches_into_current(org, run_id)

# AFTER: качество читаем SQL
after_stats = _quality_stats_sql(org)
```

**Эффект**: -10-20 сек на apply

### 10.8 classify() request-level cache (см. 4.4)

**Эффект**: -30% CPU на dry_run (71k строк × 2-3 вызова → 1 вызов per row)

---

## 11. БЕЗОПАСНОСТЬ

### 11.1 hmac.compare_digest (см. 4.5)
Предотвращение timing attacks.

### 11.2 Table name validation (см. 4.6)
Предотвращение table name injection.

### 11.3 Rate limiting (уже в main-ideal.py)
Token bucket rate limiter per IP.

### 11.4 MAX_BODY_BYTES middleware (уже в main-ideal.py)
Ограничение размера payload.

---

## 12. ТЕСТ-ЧЕКЛИСТ

### Контрактные тесты (P0)
- [ ] `preview_rows limit=2000` → response содержит 2000 строк (не 500)
- [ ] `preview_rows` → `global_facets.by_kind` = объект `Record<string, {total, ready, needs_attention}>`
- [ ] `preview_rows` → `global_facets.total` = реальное количество (71316)
- [ ] `preview_rows` → `global_facets.ready` включает color_system проверку
- [ ] `preview_rows` → `global_facets.needs_attention` = total - ready
- [ ] `preview_rows sheet_kind=PROFNASTIL` → фильтрует по sheet_kind
- [ ] `preview_rows status=needs_attention` → возвращает только незаполненные строки
- [ ] `preview_rows` → rows содержат price_rub_m2 и cur
- [ ] `dry_run` → `stats.rows_total` = полное количество (не len(df))
- [ ] `dry_run` → содержит `contract_version: "v1"`
- [ ] `confirm` → вызывает settings-merge Edge Function (не прямой PATCH)
- [ ] `confirm` → инвалидирует кеш bot_settings
- [ ] Все ответы содержат `contract_version: "v1"`

### Классификация (P0)
- [ ] "Профнастил С8 0.5 PE RAL3005" → sheet_kind=PROFNASTIL, profile=С8, color=RAL3005
- [ ] "Металлочерепица Монтеррей 0.45" → sheet_kind=METAL_TILE, profile=Monterrey
- [ ] "Металлочерепица Ламонтерра X (8017)" → sheet_kind=METAL_TILE, profile=Lamonterra X
- [ ] "Металлочерепица Камея 0.5 Puretan RR32" → sheet_kind=METAL_TILE, profile=Kamea, color=RR32
- [ ] "Планка конька для профнастила" → is_accessory=true, sheet_kind=OTHER
- [ ] "Металлочерепица Неизвестная Модель 0.5" → sheet_kind=METAL_TILE, profile="Неизвестная Модель" (regex fallback)
- [ ] "Гладкий лист 0.5 оцинк" → sheet_kind=SMOOTH_SHEET
- [ ] "Саморез 4.8x35 RAL3005" → is_accessory=true, color_code=RAL3005 (но sheet_kind=OTHER)

### Производительность
- [ ] `preview_rows` → ≤3 BigQuery запроса
- [ ] `preview_rows` → response time ≤ 5 сек для 2000 строк
- [ ] `dry_run` → classify() вызывается 1 раз per row (кеш)
- [ ] `apply` → 1 fetch_current (не 3)
- [ ] `_quality_stats` → SQL-based (не Python loop)
- [ ] BigQuery client создаётся 1 раз за жизнь процесса

### Безопасность
- [ ] hmac.compare_digest для shared secret
- [ ] Table names валидируются при старте
- [ ] Rate limiting работает (429 при превышении)

---

## 13. ПЛАН РАБОТ ПО ФАЗАМ

### Фаза 1: P0 контрактные фиксы (1-2 дня)

| # | Задача | Строки | Приоритет |
|---|--------|--------|-----------|
| 1 | Поднять cap `limit=500→5000` | ~2618 | P0 |
| 2 | global_facets.by_kind: массив→объект + ready/needs_attention | ~2724-2777 | P0 |
| 3 | Унифицировать ready-логику (color_system проверка) | ~2742-2751 | P0 |
| 4 | Добавить `contract_version: "v1"` во все ответы | Все эндпоинты | P0 |
| 5 | preview_rows: добавить sheet_kind/profile/status/sort фильтры | ~2618-2800 | P0 |
| 6 | preview_rows: добавить price_rub_m2 в SELECT | ~2702 | P0 |
| 7 | dry_run.stats.rows_total → COUNT(*) вместо len(df) | ~3017 | P0 |

### Фаза 2: Удаление мёртвого кода + производительность (2-3 дня)

| # | Задача | Эффект |
|---|--------|--------|
| 8 | Удалить build_questions v1 | -70 строк |
| 9 | Удалить questions_v2 endpoint | -25 строк |
| 10 | Удалить ai_chat_v2 + chat helpers | -200 строк |
| 11 | Удалить дубли normalize_base_url/canonical_base_url | -20 строк |
| 12 | Singleton BigQuery client | -200ms/req |
| 13 | TTL-кеш bot_settings (30 сек) | -100ms/req |
| 14 | TTL-кеш dim_profile_aliases (5 мин) | stale data fix |
| 15 | Кеш fq_table() | -50ms/req |
| 16 | Request-level classify cache | -30% CPU |

### Фаза 3: Архитектурные изменения (3-5 дней)

| # | Задача | Эффект |
|---|--------|--------|
| 17 | Рефакторинг classify_item() по модели main-ideal.py | Чистый код |
| 18 | Расширенный словарь металлочерепицы (30+ моделей) | 95%+ покрытие |
| 19 | _extract_metal_tile_profile() с regex fallback | 100% покрытие |
| 20 | Confirm → прокси к settings-merge | Thread safety |
| 21 | SQL-агрегация _quality_stats | -5-10 сек/apply |
| 22 | Убрать тройной fetch_current в apply | -10-20 сек/apply |
| 23 | Объединить count+rows через window function | -1 BQ запрос |
| 24 | Кеш global_facets (30 сек) | -1 BQ запрос |

### Фаза 4: Edge Function для AI Chat (параллельно)

| # | Задача |
|---|--------|
| 25 | Реализовать normalization-chat Edge Function |
| 26 | Маршрутизация ai_chat_v2 через import-normalize → normalization-chat |
| 27 | Тесты AI Chat → confirmActions pipeline |

### Фаза 5: Безопасность + мониторинг (параллельно)

| # | Задача |
|---|--------|
| 28 | hmac.compare_digest для shared secret |
| 29 | Table name validation при старте |
| 30 | Rate limiting middleware |
| 31 | Structured logging (JSON) для каждого эндпоинта |

---

## МЕТРИКИ ПОСЛЕ РЕФАКТОРИНГА

### SLO
| Эндпоинт | Текущий p95 | Целевой p95 |
|----------|-------------|-------------|
| preview_rows | ~8-10 сек | ≤3 сек |
| dry_run (71k) | ~30 сек | ≤15 сек |
| apply (71k) | ~60-90 сек | ≤30 сек |
| confirm | ~2 сек | ≤1 сек |

### Размер кода
| Метрика | Текущее | Целевое |
|---------|---------|---------|
| Строки main.py | 4064 | ~2000-2500 |
| BQ запросов на preview_rows | 5 | ≤3 |
| BQ запросов на apply | 3+ fetch_current | 1 fetch + SQL stats |
| classify() вызовов per row | 2-3 | 1 (кеш) |
