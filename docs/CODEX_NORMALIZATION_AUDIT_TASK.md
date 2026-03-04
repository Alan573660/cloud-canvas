# Codex Task: Полный аудит и доработка catalog-enricher для нормализации каталога

> **Дата**: 2026-03-04  
> **Приоритет**: P0  
> **Scope**: catalog-enricher (Cloud Run, Python/FastAPI) + import-normalize Edge Function (прокси)  
> **Цель**: Привести нормализацию к рабочему состоянию для каталогов 70k+ SKU

---

## 1. ТЕКУЩЕЕ СОСТОЯНИЕ (что сломано)

### 1.1 Показывается только 60 товаров из 71 316

**Причина**: `dry_run` возвращает `stats.sample: 60`, `target_sample: 300`. Enricher анализирует только малую выборку.

**Edge Function ограничения** (файл `supabase/functions/import-normalize/index.ts`):
- `dry_run`: `limit: Math.min(requestedScope.limit ?? 2000, 3000)` — жёсткий кап 3000
- `preview_rows`: `limit: Math.min(previewBody.limit ?? 500, 2000)` — жёсткий кап 2000

**Enricher ограничения** (предполагаемые):
- `/api/enrich/dry_run` возвращает `patches_sample` с максимум 60 записями
- `/api/enrich/preview_rows` не поддерживает `total_count` и серверную пагинацию
- Нет фильтрации по `sheet_kind` — возвращает записи алфавитно (Accessories первые)

### 1.2 Видны только доборные элементы

**Причина**: Enricher возвращает товары без сортировки по приоритету. Доборные (Accessories, Sandwich) идут первыми алфавитно. Профнастил, Металлочерепица не попадают в выборку.

### 1.3 Вопросы формируются неполно

Из live-данных видно:
```json
{
  "type": "WIDTH_MASTER",
  "affected_count": 202,
  "unknown_profile_count": 181,
  "profiles": [{"profile": "МП40", "count": 7}],
  "families": [
    {"family_key": "METAL_TILE:UNKNOWN", "count": 102},
    {"family_key": "PROFNASTIL:МП40", "count": 7}
  ]
}
```

Проблема: 181 строка с `UNKNOWN` профилем — enricher не извлёк профиль из title.

### 1.4 AI не запускается

```json
"ai_status": {
  "enabled": true,
  "attempted": false,
  "failed": false,
  "fail_reason": "not_attempted",
  "model": "gemini-2.5-flash-lite"
}
```

AI включён, но не пытается запуститься. Нужно разобраться почему.

---

## 2. ЧТО НУЖНО СДЕЛАТЬ В ENRICHER (catalog-enricher, Python)

### 2.1 P0: Увеличить покрытие dry_run

**Текущее**: анализирует ~60 строк из 71k.  
**Целевое**: анализировать ВСЕ уникальные паттерны (не строки), до 10k уникальных titles.

Изменения:
1. `dry_run` должен сканировать все строки организации, но группировать по уникальным паттернам title
2. Возвращать `patches_sample` сгруппированные по `sheet_kind`:
   ```json
   {
     "patches_sample": [...],
     "patches_by_kind": {
       "PROFNASTIL": { "count": 25000, "sample": [...10 items...] },
       "METAL_TILE": { "count": 15000, "sample": [...10 items...] },
       "ACCESSORY": { "count": 20000, "sample": [...10 items...] },
       "SANDWICH": { "count": 8000, "sample": [...10 items...] },
       "OTHER": { "count": 3316, "sample": [...10 items...] }
     },
     "stats": {
       "rows_scanned": 71316,
       "rows_total": 71316,
       "candidates": 50000,
       "patches_ready": 45000,
       "unique_patterns": 2400
     }
   }
   ```

### 2.2 P0: Исправить preview_rows — серверная пагинация

**Текущее**: возвращает до 500 строк без `total_count`.  
**Целевое**:

Request:
```json
{
  "organization_id": "uuid",
  "import_job_id": "current",
  "sheet_kind": "PROFNASTIL",   // NEW: фильтр по категории
  "profile": "С-20",            // NEW: фильтр по профилю  
  "q": "поиск",                 // Поиск по title
  "limit": 50,
  "offset": 0,
  "sort": "title_asc"           // NEW: сортировка
}
```

Response:
```json
{
  "ok": true,
  "rows": [...],
  "total_count": 71316,         // ОБЯЗАТЕЛЬНО — общее количество с учётом фильтров
  "offset": 0,
  "limit": 50,
  "has_next": true,
  "facets": {                   // NEW: фасеты для фильтров
    "sheet_kinds": [
      { "kind": "PROFNASTIL", "count": 25000 },
      { "kind": "METAL_TILE", "count": 15000 },
      { "kind": "ACCESSORY", "count": 20000 }
    ],
    "profiles": [
      { "profile": "С-20", "count": 5000 },
      { "profile": "С-8", "count": 3000 }
    ]
  }
}
```

### 2.3 P0: Исправить извлечение профилей

181 строка с UNKNOWN профилем — это недопустимо. Enricher должен:

1. **Расширить regex для металлочерепицы**: Adamante, Монтеррей, Каскад, Монтекристо и др. должны извлекаться из title
2. **Использовать `dim_profiles`** из BigQuery как справочник алиасов
3. **Для ACCESSORY**: профиль НЕ требуется — не генерировать вопрос `PROFILE_MAP` для доборных
4. **Для неизвестных**: создавать вопрос `PROFILE_MAP` с примерами titles

### 2.4 P1: Запустить AI-обогащение

AI сейчас `not_attempted`. Нужно:

1. Проверить условия запуска AI в коде enricher
2. AI должен запускаться для:
   - Titles с неизвестным профилем (после regex-фейла)
   - Titles с неизвестным покрытием
   - Titles где толщина не извлечена
3. AI работает пакетно по 30 уникальных titles → Gemini → парсинг ответа
4. Логировать результаты в `enrich_ai_actions_log`

### 2.5 P1: Улучшить классификацию sheet_kind

Текущие категории: `PROFNASTIL | METAL_TILE | ACCESSORY | SANDWICH | OTHER`

Проверить что работает классификация по ключевым словам:
```
Профнастил, МП, НС, Н-, С-  →  PROFNASTIL
Металлочерепица, Монтеррей   →  METAL_TILE
Сэндвич, Сэндвич-панель      →  SANDWICH
Планка, Саморез, Конёк, ...   →  ACCESSORY
```

### 2.6 P1: Формирование вопросов по категориям

Сейчас все вопросы свалены в один массив. Нужно:

1. **WIDTH_MASTER**: только для листовых (PROFNASTIL, METAL_TILE), НЕ для ACCESSORY
2. **PROFILE_MAP**: только если профиль не извлечён regex, с конкретными примерами
3. **COATING_MAP**: если покрытие не определено для >10% строк
4. **COLOR_MAP**: если цветовая система не определена

Каждый вопрос должен содержать:
```json
{
  "type": "PROFILE_MAP",
  "question_text": "Не удалось определить профиль для 181 товара. Укажите профиль.",
  "affected_rows_count": 181,
  "sheet_kind": "METAL_TILE",        // NEW: к какой категории относится
  "examples": ["Металлочерепица Adamante 0.4 MattPE RAL6005", ...],
  "suggested_actions": [
    { "type": "SET_PROFILE", "payload": { "profile": "Adamante", "pattern": "Adamante" } }
  ],
  "confidence": 0.8,
  "needs_user_confirmation": true
}
```

---

## 3. ЧТО НУЖНО СДЕЛАТЬ В EDGE FUNCTION (import-normalize)

Файл: `supabase/functions/import-normalize/index.ts`

### 3.1 Убрать жёсткие лимиты

```typescript
// БЫЛО:
limit: Math.min(requestedScope.limit ?? 2000, 3000),  // dry_run
limit: Math.min(previewBody.limit ?? 500, 2000),       // preview_rows

// ДОЛЖНО БЫТЬ:
limit: Math.min(requestedScope.limit ?? 5000, 10000),  // dry_run  
limit: Math.min(previewBody.limit ?? 50, 500),          // preview_rows (с пагинацией не нужен большой лимит)
```

### 3.2 Пробросить новые фильтры в preview_rows

```typescript
// БЫЛО:
const previewPayload = {
  organization_id,
  import_job_id: previewBody.import_job_id || 'current',
  group_type: previewBody.group_type,
  filter_key: previewBody.filter_key,
  q: previewBody.q,
  limit: ...,
  offset: ...,
};

// ДОБАВИТЬ:
const previewPayload = {
  ...existing,
  sheet_kind: previewBody.sheet_kind,     // NEW
  profile: previewBody.profile,           // NEW
  sort: previewBody.sort || 'title_asc',  // NEW
};
```

### 3.3 Пробросить sheet_kind в dry_run scope

```typescript
const enricherPayload = {
  organization_id,
  import_job_id,
  scope: {
    only_where_null: requestedScope.only_where_null ?? true,
    limit: ...,
    sheet_kind: requestedScope.sheet_kind,  // NEW: фокус на конкретной категории
  },
  ai_suggest: dryRunBody.ai_suggest ?? false,
};
```

### 3.4 Обновить PreviewRowsRequest interface

```typescript
interface PreviewRowsRequest {
  op: 'preview_rows';
  organization_id: string;
  import_job_id?: string;
  group_type?: 'WIDTH' | 'COLOR' | 'COATING' | 'DECOR' | 'THICKNESS';
  filter_key?: string;
  q?: string;
  limit?: number;
  offset?: number;
  // NEW fields:
  sheet_kind?: string;
  profile?: string;
  sort?: string;
}
```

---

## 4. AI CHAT V2 — АУДИТ И ДОРАБОТКИ

### 4.1 Текущий контракт (работает)

```
POST /api/enrich/ai_chat_v2
{
  "organization_id": "uuid",
  "import_job_id": "current",
  "run_id": "...",
  "message": "user message",
  "context": {}
}
→ { "assistant_message": "...", "actions": [...], "requires_confirm": true }
```

### 4.2 Что нужно проверить/доработить

1. **Контекст сессии**: `run_id` передаётся — сохраняется ли контекст между сообщениями?
2. **Actions типы**: какие типы actions поддерживает enricher? Задокументировать полный список:
   - `SET_CATEGORY` — установить sheet_kind
   - `SET_PROFILE` — установить профиль
   - `SET_COATING` — установить покрытие
   - `SET_WIDTH` — установить ширины
   - `SKIP_ROWS` — пометить строки как пропущенные
   - Другие?
3. **Подтверждение**: при `requires_confirm: true` → UI вызывает `op: confirm` с actions[] → enricher применяет
4. **Shadow mode**: что это? Документировать.

### 4.3 Целевое поведение AI Chat

AI должен уметь:
- "Установи профиль Адаманте для всей металлочерепицы Adamante" → `SET_PROFILE` action
- "Пропусти все доборные" → `SKIP_ROWS` для sheet_kind=ACCESSORY
- "Покажи все товары без профиля" → возврат списка/фильтра, без actions
- "Какие категории есть?" → ответ из данных, без actions

---

## 5. ДАННЫЕ ДЛЯ ОТЛАДКИ

### 5.1 Live dry_run response (полный)

Текущий ответ enricher'а — см. `docs/EDGE_DEVTOOLS_PAYLOADS.md`, секция dry_run.

Ключевые наблюдения:
- `stats.sample: 60` — анализируется только 60 строк
- `questions`: 1 вопрос WIDTH_MASTER с 202 affected строками  
- `unknown_profile_count: 181` — массово не извлечены профили
- `patches_sample`: 60 записей, все из `cat_name: null` или `Металлочерепица`
- Нет ни одного PROFNASTIL в patches_sample — не попадают в выборку

### 5.2 Organization для тестирования

```
organization_id: d267278c-8a53-42db-a5a7-2871e946db66
import_job_id: b8dd6be8-5fc2-4508-b389-ee9fc52768ed
Total rows in BQ: 71,316
```

### 5.3 Ожидаемое распределение по sheet_kind (приблизительно)

| sheet_kind | Ожидаемая доля | Ожидаемое кол-во |
|-----------|----------------|------------------|
| PROFNASTIL | ~35% | ~25,000 |
| METAL_TILE | ~20% | ~14,000 |
| ACCESSORY | ~25% | ~18,000 |
| SANDWICH | ~10% | ~7,000 |
| OTHER | ~10% | ~7,000 |

---

## 6. ТЕСТИРОВАНИЕ

### 6.1 Минимальные acceptance criteria

1. ✅ `dry_run` сканирует ≥10,000 строк (не 60)
2. ✅ `dry_run` возвращает `patches_by_kind` со всеми категориями
3. ✅ `preview_rows` поддерживает `sheet_kind` фильтр
4. ✅ `preview_rows` возвращает `total_count`
5. ✅ Профили извлекаются для Металлочерепицы (Adamante, Монтеррей, etc.)
6. ✅ Вопрос `WIDTH_MASTER` НЕ генерируется для ACCESSORY
7. ✅ AI хотя бы `attempted: true` (не `not_attempted`)
8. ✅ `ai_chat_v2` отвечает на базовые команды (SET_PROFILE, SET_CATEGORY)
9. ✅ `confirm` с batch actions[] работает и возвращает `stats.updates > 0`

### 6.2 curl примеры для тестирования

```bash
# Dry run
curl -X POST https://YOUR_ENRICHER_URL/api/enrich/dry_run \
  -H "Content-Type: application/json" \
  -H "X-Internal-Secret: YOUR_SECRET" \
  -d '{
    "organization_id": "d267278c-8a53-42db-a5a7-2871e946db66",
    "import_job_id": "current",
    "scope": { "limit": 10000, "only_where_null": false },
    "ai_suggest": true
  }'

# Preview rows with sheet_kind filter
curl -X POST https://YOUR_ENRICHER_URL/api/enrich/preview_rows \
  -H "Content-Type: application/json" \
  -H "X-Internal-Secret: YOUR_SECRET" \
  -d '{
    "organization_id": "d267278c-8a53-42db-a5a7-2871e946db66",
    "sheet_kind": "PROFNASTIL",
    "limit": 10,
    "offset": 0
  }'

# AI Chat
curl -X POST https://YOUR_ENRICHER_URL/api/enrich/ai_chat_v2 \
  -H "Content-Type: application/json" \
  -H "X-Internal-Secret: YOUR_SECRET" \
  -d '{
    "organization_id": "d267278c-8a53-42db-a5a7-2871e946db66",
    "message": "Покажи распределение товаров по категориям"
  }'
```

---

## 7. ФАЙЛЫ, КОТОРЫЕ НУЖНО ИЗМЕНИТЬ

### Backend (catalog-enricher, Python):
1. **`/api/enrich/dry_run`** — увеличить покрытие, добавить `patches_by_kind`, исправить profile extraction
2. **`/api/enrich/preview_rows`** — добавить `total_count`, `sheet_kind` filter, `facets`, серверную пагинацию
3. **`/api/enrich/ai_chat_v2`** — убедиться что AI запускается, задокументировать action types
4. **Pipeline классификации** — расширить regex для металлочерепицы, не спрашивать ширины для ACCESSORY
5. **Profile extraction** — добавить алиасы из `dim_profiles`

### Edge Function (import-normalize):
6. **`supabase/functions/import-normalize/index.ts`** — убрать лимиты, пробросить новые фильтры

### Frontend (после backend-фиксов):
7. Обновить UI для работы с `patches_by_kind`, `total_count`, `facets`
8. Добавить фильтры по `sheet_kind` в wizard

---

## 8. ПОРЯДОК ВЫПОЛНЕНИЯ

```
Этап 1 (P0): preview_rows + total_count + sheet_kind filter
Этап 2 (P0): dry_run покрытие + patches_by_kind  
Этап 3 (P0): Profile extraction fix (regex + dim_profiles)
Этап 4 (P1): AI запуск (not_attempted → attempted)
Этап 5 (P1): Вопросы по категориям (не спрашивать ширины для ACCESSORY)
Этап 6 (P1): ai_chat_v2 полный аудит + документация actions
Этап 7: Edge Function лимиты и проброс фильтров
```

---

## 9. ССЫЛКИ НА ДОКУМЕНТАЦИЮ

- Мастер-спецификация: `docs/NORMALIZATION_MASTER_SPEC.md` (v7.0)
- Контракты Edge Functions: `docs/EDGE_CONTRACTS.md`
- Live payloads: `docs/EDGE_DEVTOOLS_PAYLOADS.md`
- BigQuery схема: `docs/NORMALIZATION_MASTER_SPEC.md`, секция 4
- Edge Function код: `supabase/functions/import-normalize/index.ts`
- Frontend contract types: `src/lib/contract-types.ts`
