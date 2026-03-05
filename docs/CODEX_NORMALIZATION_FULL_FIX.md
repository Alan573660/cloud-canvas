# Codex Task: Полный аудит и исправление нормализации каталога

**Дата**: 2026-03-05  
**Статус**: P0 — CRITICAL  
**Контекст**: 71 316 SKU, бэкенд (catalog-enricher на Cloud Run), Edge Function (import-normalize) как прокси

---

## 0. ТЕКУЩАЯ СИТУАЦИЯ (что сломано)

| # | Проблема | Где баг | Влияние |
|---|----------|---------|---------|
| 1 | **Цена не отображается** | Backend: `cur` возвращается как string/number, но `price_rub_m2` не маппится | UI не показывает цену ни в одном товаре |
| 2 | **Металлочерепица не кластеризуется** | Backend: `classify()` не распознаёт модели (Монтеррей, Каскад и т.д.) как профили для METAL_TILE | Вся металлочерепица — в "без профиля" |
| 3 | **Вопросы нормализации не генерируются** | Backend: `build_questions_v2()` не создаёт PROFILE_MAP для METAL_TILE без профиля | Пользователь не может нормализовать через вопросы |
| 4 | **Готовность (KPI) не считается** | Backend: `dashboard` endpoint ограничен 500 строками | KPI показывает 10 ready / 410 problems вместо реальных цифр |
| 5 | **Категории показывают 10k, не 71k** | Backend: `preview_rows` facets считают только отфильтрованные строки | Статистика неполная |
| 6 | **Фильтр "только проблемные" отсутствует** | Backend: нет поля `normalization_status` в preview_rows | Нельзя отфильтровать товары с пустыми полями |

---

## 1. PRICE — Цена не отображается

### Текущее поведение
- Backend возвращает `cur` (string/number) в `preview_rows` и `patches_sample`
- Поле `price_rub_m2` НЕ возвращается ни в одном из этих endpoints
- UI ожидает `base_price_rub_m2` или `price_rub_m2`

### Что нужно сделать

**В `preview_rows` ответе** добавить поле `price_rub_m2`:
```python
# В SELECT запросе preview_rows
SELECT
  ...,
  CAST(IFNULL(cur, '0') AS FLOAT64) AS price_rub_m2,
  ...
```

**В `patches_sample` / `patches_by_kind`** добавить `price_rub_m2`:
```python
patch = {
    ...
    "price_rub_m2": float(coalesce_col_or_notes(row.get("cur"), notes, "cur") or 0),
    ...
}
```

### Acceptance criteria
- `preview_rows.rows[].price_rub_m2` — числовое поле (float)
- `patches_sample[].price_rub_m2` — числовое поле (float)
- Если `cur` — строка "123.45", она конвертируется в число 123.45

---

## 2. METAL_TILE — Металлочерепица не кластеризуется

### Текущее поведение
Функция `classify()` в `main.py` уже содержит `METAL_TILE_MODEL_ALIASES` и блок:
```python
if not r.profile and r.sheet_kind == "METAL_TILE":
    tile_model = _detect_tile_model_key(t)
    if tile_model != "UNKNOWN":
        r.profile = tile_model
```

**НО** этот блок находится ПОСЛЕ определения `sheet_kind`. Проблема:
1. Если товар не содержит ключевых слов для `RE_METAL_TILE`, он не получает `sheet_kind = "METAL_TILE"`
2. Даже если получает — `_detect_tile_model_key()` может не распознавать все варианты написания

### Что нужно сделать

**a) Расширить RE_METAL_TILE regex:**
```python
RE_METAL_TILE = re.compile(
    r'(металлочерепиц|metallocherepica|metal\s*tile'
    r'|монтеррей|monterrey|каскад|kaskad|cascade'
    r'|адамант|adamante|классик|classic'
    r'|финнер|finnera|банга|banga'
    r'|декоррей|decorrey|кредо|credo|kredo'
    r'|квинта|kvinta|камея|kamea'
    r'|ламонтерра|lamonterra|монтерроса|monterrosa'
    r'|трамонтана|tramontana|андалуз|andalusia'
    r'|андрия|andria|монтекристо|montecristo)',
    re.IGNORECASE
)
```

**b) `_detect_tile_model_key()` — проверить покрытие всех алиасов:**
Убедиться, что функция `_detect_tile_model_key` ищет по `METAL_TILE_MODEL_ALIASES` и покрывает ВСЕ варианты из заголовков товаров текущего прайса.

**c) Логировать нераспознанные:**
```python
if r.sheet_kind == "METAL_TILE" and not r.profile:
    print(f"[classify] METAL_TILE without profile: '{title[:80]}'")
```

### Acceptance criteria
- Все товары с названиями, содержащими "Монтеррей", "Каскад", "Адаманте", "Classic" и т.д., получают:
  - `sheet_kind = "METAL_TILE"`
  - `profile` = соответствующий ключ из METAL_TILE_MODEL_ALIASES
- В `patches_by_kind` есть запись `"METAL_TILE"` с ненулевым `count`

---

## 3. QUESTIONS — Вопросы не генерируются для металлочерепицы

### Текущее поведение
`build_questions_v2()` генерирует `PROFILE_MAP` только если `RE_PROFILE_HINT.search(title)` — а этот regex ищет паттерны типа `С-##`, которых нет в названиях металлочерепицы.

Новый код добавил `or cls.sheet_kind == "METAL_TILE"` в условие, но если `classify()` не распознаёт `sheet_kind` правильно (см. п.2), вопросы не генерируются.

### Что нужно сделать

**a) Убедиться, что после исправления п.2 вопросы генерируются автоматически.**

**b) Добавить вопрос WIDTH_MASTER для METAL_TILE:**
Металлочерепица имеет фиксированные ширины по моделям. Если ширины не заполнены — генерировать вопрос.

**c) Добавить вопрос COATING_MAP:**
Покрытия в металлочерепице часто отличаются от профнастила (Viking, Safari, Ecosteel). Убедиться, что `_collect_unknown_tokens()` ловит их.

### Acceptance criteria
- При dry_run на полный датасет, `questions[]` содержит:
  - `PROFILE_MAP` с `sheet_kind: "METAL_TILE"` (если есть товары без профиля)
  - `WIDTH_MASTER` с записями для моделей металлочерепицы
  - `COATING_MAP` с неизвестными покрытиями
- Каждый вопрос содержит: `type`, `affected_count > 0`, `examples[]`

---

## 4. DASHBOARD — KPI ограничен 500 строками

### Текущее поведение
```python
class DashboardRequest(BaseModel):
    ...
    limit: int = 500
```
Dashboard endpoint читает максимум 500 строк из BigQuery, поэтому KPI "Готово / Проблемы" считается только по 500 строкам.

### Что нужно сделать

**a) Добавить агрегированные KPI через SQL:**
```python
# В dashboard endpoint — считать KPI через BigQuery COUNT, а не len(df)
sql_kpi = f"""
SELECT
  COUNT(1) AS total,
  COUNTIF(
    profile IS NOT NULL AND profile != ''
    AND thickness_mm IS NOT NULL
    AND coating IS NOT NULL AND coating != ''
    AND (color_system IS NOT NULL OR LOWER(coating) LIKE '%оцинк%')
    AND width_work_mm IS NOT NULL
    AND width_full_mm IS NOT NULL
  ) AS ready,
FROM `{fq_table(BQ_TABLE_CURRENT)}`
WHERE organization_id=@org
"""
```

**b) Вернуть агрегат в `progress`:**
```json
{
  "progress": {
    "total": 71316,
    "ready": 45000,
    "needs_attention": 26316,
    "ready_pct": 63.1
  }
}
```

### Acceptance criteria
- `dashboard.progress.total` = реальное число строк (71316)
- `dashboard.progress.ready` = число полностью нормализованных
- `dashboard.progress.ready_pct` = процент готовности
- Эти числа вычисляются через SQL COUNT, а не через len(DataFrame)

---

## 5. FACETS — Неполная статистика по категориям

### Текущее поведение
`preview_rows` уже возвращает `facets`, но они считаются только в контексте текущего WHERE-фильтра. Если фильтр по `sheet_kind = PROFNASTIL`, facets показывают только профнастил.

### Что нужно сделать

**Добавить `global_facets` — без фильтров:**
```python
# Всегда считать глобальные facets (без sheet_kind/profile фильтров)
global_facets_sql = f"""
SELECT
  UPPER(IFNULL(sheet_kind, 'OTHER')) AS sheet_kind,
  COUNT(1) AS cnt
FROM `{fq}`
WHERE organization_id=@org
GROUP BY sheet_kind
"""
```

**Вернуть оба набора:**
```json
{
  "facets": { ... },          // filtered facets (текущие)
  "global_facets": {          // NEW: без фильтров
    "sheet_kinds": [
      {"kind": "PROFNASTIL", "count": 45000},
      {"kind": "METAL_TILE", "count": 8000},
      {"kind": "ACCESSORY", "count": 15000},
      {"kind": "OTHER", "count": 3316}
    ]
  }
}
```

### Acceptance criteria
- `preview_rows.global_facets.sheet_kinds` содержит ВСЕ категории с полными счётчиками
- Сумма `global_facets.sheet_kinds[].count` = общее число строк организации

---

## 6. ФИЛЬТР "Только проблемные"

### Что нужно сделать

**Добавить параметр `status` в `PreviewRowsRequest`:**
```python
class PreviewRowsRequest(BaseModel):
    ...
    status: Optional[str] = None  # "needs_attention" | "ready" | None
```

**В SQL:**
```python
if status == "needs_attention":
    where.append("""(
      profile IS NULL OR profile = ''
      OR thickness_mm IS NULL
      OR coating IS NULL OR coating = ''
      OR width_work_mm IS NULL
      OR width_full_mm IS NULL
    )""")
elif status == "ready":
    where.append("""(
      profile IS NOT NULL AND profile != ''
      AND thickness_mm IS NOT NULL
      AND coating IS NOT NULL AND coating != ''
      AND width_work_mm IS NOT NULL
      AND width_full_mm IS NOT NULL
    )""")
```

### Acceptance criteria
- `preview_rows` с `status=needs_attention` возвращает только товары с пустыми полями
- `preview_rows` с `status=ready` возвращает только полностью заполненные
- `total_count` корректно отражает количество в фильтрованном наборе

---

## 7. ТЕСТИРОВАНИЕ

### Команды для проверки после исправлений:

```bash
# 1. Проверка classify для металлочерепицы
python -c "
from main import classify, Classif
r = classify('Металлочерепица Монтеррей 0.5 Полиэстер RAL3005', '', set(), {})
print(f'sheet_kind={r.sheet_kind} profile={r.profile} coating={r.coating} color={r.color_code}')
assert r.sheet_kind == 'METAL_TILE'
assert r.profile == 'MONTERREY'
"

# 2. Проверка dry_run возвращает patches_by_kind с METAL_TILE
curl -s -X POST http://localhost:8080/api/enrich/dry_run \
  -H "X-Internal-Secret: $SECRET" \
  -H "Content-Type: application/json" \
  -d '{"organization_id":"ORG","import_job_id":"current","scope":{"limit":0},"ai_suggest":false}' \
  | jq '.patches_by_kind | keys'
# Ожидание: ["ACCESSORY","METAL_TILE","OTHER","PROFNASTIL","SANDWICH","SMOOTH_SHEET"]

# 3. Проверка price_rub_m2
curl -s -X POST http://localhost:8080/api/enrich/preview_rows \
  -H "X-Internal-Secret: $SECRET" \
  -H "Content-Type: application/json" \
  -d '{"organization_id":"ORG","limit":5}' \
  | jq '.rows[0].price_rub_m2'
# Ожидание: число (не null, не строка)

# 4. Проверка dashboard KPI
curl -s -X POST http://localhost:8080/api/enrich/dashboard \
  -H "X-Internal-Secret: $SECRET" \
  -H "Content-Type: application/json" \
  -d '{"organization_id":"ORG"}' \
  | jq '.progress'
# Ожидание: {"total":71316,"ready":XXXXX,"needs_attention":XXXXX,"ready_pct":XX.X}

# 5. Проверка фильтра needs_attention
curl -s -X POST http://localhost:8080/api/enrich/preview_rows \
  -H "X-Internal-Secret: $SECRET" \
  -H "Content-Type: application/json" \
  -d '{"organization_id":"ORG","status":"needs_attention","limit":5}' \
  | jq '.total_count'
# Ожидание: число < 71316

# 6. Проверка global_facets
curl -s -X POST http://localhost:8080/api/enrich/preview_rows \
  -H "X-Internal-Secret: $SECRET" \
  -H "Content-Type: application/json" \
  -d '{"organization_id":"ORG","sheet_kind":"PROFNASTIL","limit":1}' \
  | jq '.global_facets.sheet_kinds'
# Ожидание: массив со ВСЕМИ категориями и полными счётчиками
```

---

## 8. ПРИОРИТЕТ ИСПРАВЛЕНИЙ

| Порядок | Задача | Оценка |
|---------|--------|--------|
| 1 | **classify()** — METAL_TILE regex + профили | 1-2 часа |
| 2 | **price_rub_m2** — добавить в preview_rows и patches | 30 мин |
| 3 | **dashboard KPI** — SQL COUNT вместо len(df) | 1 час |
| 4 | **global_facets** — без фильтров | 30 мин |
| 5 | **status filter** — needs_attention/ready | 1 час |
| 6 | **Тесты** — unit tests на classify + integration | 1-2 часа |

**Общая оценка: 5-7 часов работы.**

---

## 9. КОНТРАКТ ОТВЕТОВ (что фронтенд ожидает)

### `preview_rows` response:
```json
{
  "ok": true,
  "total_count": 71316,
  "offset": 0,
  "limit": 500,
  "has_next": true,
  "rows": [
    {
      "id": "...",
      "title": "...",
      "profile": "С8",
      "thickness_mm": 0.5,
      "coating": "Полиэстер",
      "color_system": "RAL",
      "color_code": "3005",
      "width_work_mm": 1150,
      "width_full_mm": 1200,
      "sheet_kind": "PROFNASTIL",
      "price_rub_m2": 450.00,
      "unit": "m2",
      "cat_name": "...",
      "cat_tree": "..."
    }
  ],
  "facets": {
    "sheet_kinds": [{"kind": "PROFNASTIL", "count": 12000}],
    "profiles": [{"profile": "С8", "count": 3000}]
  },
  "global_facets": {
    "sheet_kinds": [
      {"kind": "PROFNASTIL", "count": 45000},
      {"kind": "METAL_TILE", "count": 8000},
      {"kind": "ACCESSORY", "count": 15000},
      {"kind": "OTHER", "count": 3316}
    ]
  }
}
```

### `dashboard` response:
```json
{
  "ok": true,
  "progress": {
    "total": 71316,
    "ready": 45000,
    "needs_attention": 26316,
    "ready_pct": 63.1
  },
  "questions": [...],
  "tree": [...]
}
```

### `dry_run` response — `patches_sample[]` и `patches_by_kind{}`:
```json
{
  "patches_sample": [
    {
      "id": "...",
      "title": "...",
      "profile": "MONTERREY",
      "sheet_kind": "METAL_TILE",
      "price_rub_m2": 620.00,
      ...
    }
  ],
  "patches_by_kind": {
    "PROFNASTIL": {"count": 45000, "sample": [...]},
    "METAL_TILE": {"count": 8000, "sample": [...]},
    "ACCESSORY": {"count": 15000, "sample": [...]},
    "OTHER": {"count": 3316, "sample": [...]}
  }
}
```
