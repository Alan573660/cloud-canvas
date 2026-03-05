# ТЗ для бэкенда: Полная кластеризация 71к+ товаров (v2)

**Дата**: 2026-03-05  
**Статус**: P0 — блокер для production  
**Контекст**: Frontend снял ограничения (2000→unlimited в edge, 10k→unlimited в UI). Теперь бэкенд — единственный bottleneck.

---

## 1. ПРОБЛЕМА: `preview_rows` не возвращает `global_facets`

**Симптом**: KPI в UI показывает "500 всего" вместо 71,316.

**Ожидание**: Каждый ответ `preview_rows` ДОЛЖЕН содержать:
```json
{
  "ok": true,
  "rows": [...],
  "total_count": 71316,
  "has_next": true,
  "facets": { "sheet_kinds": [...] },
  "global_facets": {
    "total": 71316,
    "ready": 65000,
    "needs_attention": 6316,
    "by_kind": {
      "PROFNASTIL": { "total": 45000, "ready": 43000, "needs_attention": 2000 },
      "METAL_TILE": { "total": 12000, "ready": 10000, "needs_attention": 2000 },
      "ACCESSORY": { "total": 8000, "ready": 7500, "needs_attention": 500 },
      "SANDWICH": { "total": 3000, "ready": 2800, "needs_attention": 200 },
      "OTHER": { "total": 3316, "ready": 1700, "needs_attention": 1616 }
    }
  }
}
```

**Текущее поведение**: `global_facets` = null → UI падает на подсчёт из загруженных строк → 500.

**Как исправить**: В `preview_rows` handler добавить SQL-агрегацию:
```sql
SELECT 
  sheet_kind,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE profile IS NOT NULL AND thickness_mm IS NOT NULL) as ready,
  COUNT(*) FILTER (WHERE profile IS NULL OR thickness_mm IS NULL) as needs_attention
FROM import_staging_rows  -- или master_products_current
WHERE organization_id = ?
GROUP BY sheet_kind
```

---

## 2. ПРОБЛЕМА: Металлочерепица — профиль не проставляется

**Симптом**: В UI металлочерепица показывается, но `profile = ""` (пустой).

**Ожидание**: Для каждого товара металлочерепицы поле `profile` должно содержать название серии:
- `Monterrey`, `Adamante`, `Cascade`, `Classic`, `Finnera`, `Banga`, `Decorrey`, `Kredo`, `Quadro`, и т.д.

**Текущее поведение**: `RE_METAL_TILE` regex распознаёт категорию (sheet_kind=METAL_TILE), но НЕ извлекает profile из title.

**Как исправить**: 
В classify/extract pipeline после определения `sheet_kind=METAL_TILE`:
```python
METAL_TILE_MODELS = [
    'Monterrey', 'SuperMonterrey', 'Cascade', 'Adamante', 'Classic',
    'Finnera', 'Banga', 'Decorrey', 'Kredo', 'Quadro', 'Genesis',
    'Dimos', 'Modern', 'Vintage', 'Country', 'Luxury', 'Maxi'
]

RE_MT_PROFILE = re.compile(
    r'(?:металлочерепица|metal\s*tile)\s+(' + '|'.join(METAL_TILE_MODELS) + ')',
    re.IGNORECASE
)

def extract_metal_tile_profile(title: str) -> str:
    m = RE_MT_PROFILE.search(title)
    return m.group(1).title() if m else ''
```

Далее проставить `row['profile'] = extract_metal_tile_profile(row['title'])`.

---

## 3. ПРОБЛЕМА: `price_rub_m2` не возвращается в `preview_rows`

**Симптом**: Колонка "Цена" в UI = 0 для всех товаров.

**Ожидание**: Каждая строка в `preview_rows.rows[]` содержит `price_rub_m2` (float).

**Текущее поведение**: Бэкенд возвращает поле `cur` (строка вида "1234.56 RUB") — UI не может его надёжно парсить.

**Как исправить**:
```python
# При формировании строки ответа:
row['price_rub_m2'] = float(row.get('cur', '0').split()[0]) if row.get('cur') else 0.0
```

---

## 4. ПРОБЛЕМА: Вопросы нормализации не генерируются для металлочерепицы

**Симптом**: `dry_run.questions` = [] для товаров с sheet_kind=METAL_TILE.

**Ожидание**: Для каждого уникального профиля металлочерепицы без заполненных ширин → вопрос `WIDTH_MASTER`. Для неизвестных покрытий → `COATING_MAP`.

**Как исправить**: В `generate_questions()` pipeline не фильтровать METAL_TILE:
```python
# Было (вероятно):
if sheet_kind != 'PROFNASTIL':
    continue  # skip non-profnastil

# Должно быть:
if sheet_kind not in ('PROFNASTIL', 'METAL_TILE'):
    continue  # skip only accessories and other
```

---

## 5. ПРОБЛЕМА: `total_count` не соответствует реальному количеству

**Симптом**: `total_count` возвращает количество строк в текущей выборке, а не общее.

**Ожидание**: `total_count` = полное количество строк в организации (или в фильтре), НЕ ограниченное limit/offset.

**Как исправить**:
```python
# Сначала считаем total
total_count = session.execute(
    "SELECT COUNT(*) FROM ... WHERE organization_id = ? AND [filters]"
).scalar()

# Потом берём rows с limit/offset
rows = session.execute(
    "SELECT * FROM ... WHERE organization_id = ? AND [filters] LIMIT ? OFFSET ?"
).fetchall()

return {"rows": rows, "total_count": total_count, "has_next": offset + len(rows) < total_count}
```

---

## 6. PERFORMANCE: Batch-запросы от фронтенда

Frontend теперь запрашивает батчи по 2000 строк (вместо 500). Edge function **больше не имеет cap** — лимит передаётся as-is.

Ожидаемый паттерн запросов:
```
POST preview_rows {limit: 2000, offset: 0}     → 2000 rows + total_count=71316
POST preview_rows {limit: 2000, offset: 2000}   → 2000 rows
POST preview_rows {limit: 2000, offset: 4000}   → 2000 rows
...
POST preview_rows {limit: 2000, offset: 70000}  → 1316 rows + has_next=false
```

**Требования к бэкенду**:
- Ответ на каждый batch ≤ 5 секунд (иначе edge timeout 30с)
- `total_count` — на каждом ответе (из кеша или COUNT)
- `global_facets` — только на первом ответе (offset=0), далее можно опускать

---

## 7. CHECKLIST ДЛЯ ПРОВЕРКИ

- [ ] `preview_rows` offset=0 → response содержит `global_facets` с `total`, `ready`, `needs_attention`, `by_kind`
- [ ] `preview_rows` → каждая строка содержит `price_rub_m2` (float, не string)
- [ ] `preview_rows` → `total_count` = общее количество строк (не len(rows))
- [ ] `dry_run` → `questions` включает вопросы для METAL_TILE (WIDTH_MASTER, COATING_MAP)
- [ ] `dry_run` → `patches_sample` для METAL_TILE товаров содержит заполненный `profile`
- [ ] `preview_rows` limit=2000 → ответ ≤ 5 сек
- [ ] `preview_rows` с status=needs_attention → фильтрует правильно
