# Техническое задание: catalog-enricher v6.0

> **Сервис**: `catalog-enricher` (Cloud Run, Python/FastAPI)  
> **Дата**: 2026-02-09  
> **Автор**: Архитектурный анализ на основе production codebase  
> **Статус**: Полное ТЗ для production-ready реализации

---

## Оглавление

1. [Обзор системы и цели](#1-обзор-системы-и-цели)
2. [Архитектура данных](#2-архитектура-данных)
3. [Полный жизненный цикл прайс-листа](#3-полный-жизненный-цикл-прайс-листа)
4. [Каноническая схема товара](#4-каноническая-схема-товара)
5. [Vertex AI Pipeline — детальная спецификация](#5-vertex-ai-pipeline)
6. [API-контракт catalog-enricher](#6-api-контракт-catalog-enricher)
7. [Правила нормализации (bot_settings.settings_json.pricing)](#7-правила-нормализации)
8. [BigQuery — схема и индексация](#8-bigquery-схема-и-индексация)
9. [Supabase — Control Plane](#9-supabase-control-plane)
10. [UI Wizard — функциональная спецификация](#10-ui-wizard)
11. [Масштабирование на другие отрасли](#11-масштабирование-на-другие-отрасли)
12. [Обработка ошибок и Edge Cases](#12-обработка-ошибок)
13. [Метрики и мониторинг](#13-метрики-и-мониторинг)
14. [Порядок реализации (Roadmap)](#14-roadmap)

---

## 1. Обзор системы и цели

### 1.1 Что это

**catalog-enricher** — микросервис на Cloud Run, который принимает "сырые" прайс-листы поставщиков (после парсинга CSV/XLSX/PDF) и трансформирует каждую строку в каноническую запись каталога. Это "мозг" нормализации.

### 1.2 Бизнес-задача

Поставщик отправляет прайс-лист в произвольном формате:

```
"Профнастил С-20 0,5мм Полиэстер RAL3005 100×1150мм  |  650 руб/м²"
"МП-20-R-0.5-PE-3005                                   |  650"
"С20 полиэстер красное вино 0,5                        |  650р"
```

**Цель**: превратить ВСЕ эти варианты в единую каноническую запись:

```json
{
  "profile": "С-20",
  "thickness_mm": 0.5,
  "coating": "Полиэстер",
  "color_code": "RAL3005",
  "color_system": "RAL",
  "width_work_mm": 1100,
  "width_full_mm": 1150,
  "price": 650.0,
  "unit": "m2",
  "sheet_kind": "PROFNASTIL"
}
```

### 1.3 Ключевые метрики

| Метрика | Целевое значение |
|---------|-----------------|
| Точность автоматического распознавания | ≥ 92% строк без ручного вмешательства |
| Время обработки 70k строк (dry_run) | ≤ 30 сек |
| Время apply 70k строк | ≤ 120 сек (async) |
| Поддержка отраслей | Кровля → Автозапчасти → Метизы → Universal |
| Время ответа AI-чата | ≤ 5 сек |

---

## 2. Архитектура данных

### 2.1 Трёхуровневая модель

```
┌────────────────────────────────────────────────────────────────────────┐
│                           УРОВЕНЬ 1: INGRESS                          │
│                                                                        │
│   Supabase Storage (bucket: imports)                                   │
│   ├── {org_id}/{job_id}/price_{job_id}.csv                            │
│   └── {org_id}/{job_id}/price_{job_id}.xlsx                           │
│                                                                        │
│   → Edge Function: import-validate                                     │
│   → Cloud Run: price-import-worker (парсинг, канонизация колонок)      │
│   → Результат: import_staging_rows (sample 300 строк) + BigQuery      │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                       УРОВЕНЬ 2: ENRICHMENT                           │
│                                                                        │
│   Cloud Run: catalog-enricher (ЭТО ТЗ)                                │
│                                                                        │
│   Вход: BigQuery master_products_current (сырые строки)               │
│   Процесс:                                                            │
│   ├── 1. Классификация (sheet_kind, product_type)                     │
│   ├── 2. Извлечение атрибутов (profile, thickness, coating, color)    │
│   ├── 3. Разрешение конфликтов (AI + правила из settings_json)        │
│   ├── 4. Валидация (9 обязательных полей)                             │
│   └── 5. Запись обогащённых данных обратно в BigQuery                  │
│                                                                        │
│   Выход: BigQuery master_products_current (обогащённые строки)        │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        УРОВЕНЬ 3: SERVING                             │
│                                                                        │
│   Cloud Run: pricing-api-saas                                          │
│   ├── GET /api/catalog/items     (чтение из BQ)                       │
│   ├── GET /api/catalog/facets    (агрегации из BQ)                    │
│   └── POST /api/pricing/quote    (расчёт цены с учётом скидок)        │
│                                                                        │
│   Supabase (Control Plane):                                            │
│   ├── product_catalog    (overrides: is_active, bq_key link)          │
│   ├── discount_rules     (скидки по UUID → product_catalog.id)        │
│   ├── bot_settings       (правила нормализации в settings_json)       │
│   └── ral_colors         (справочник RAL, 213 записей)                │
└────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Поток данных (Sequence Diagram)

```
Пользователь → UI Upload → Supabase Storage
                              │
                     import-validate (Edge Fn)
                              │
                     price-import-worker (Cloud Run)
                     ├── Парсинг CSV/XLSX/PDF
                     ├── Канонизация колонок (id, title, price_rub_m2)
                     ├── Валидация данных
                     ├── Запись в BigQuery (master_products_current)
                     └── Обновление import_jobs (status=COMPLETED)
                              │
                     UI: Кнопка "Нормализация"
                              │
                     import-normalize (Edge Fn proxy)
                              │
                     catalog-enricher (Cloud Run) ◀── ЭТО ТЗ
                     ├── dry_run: анализ + patches_sample
                     ├── UI Wizard: пользователь проверяет
                     ├── settings-merge: сохранение правил
                     ├── apply_start: асинхронное применение
                     └── apply_status: polling до DONE
                              │
                     pricing-api-saas (Cloud Run)
                     └── Обслуживает каталог для агентов и UI
```

---

## 3. Полный жизненный цикл прайс-листа

### Фаза 1: Загрузка (Ingress)

| Шаг | Компонент | Действие |
|-----|-----------|----------|
| 1.1 | UI `ImportPriceDialog` | Пользователь выбирает файл (CSV/XLSX/PDF, ≤100MB) |
| 1.2 | UI | Создаёт `import_jobs` запись (status=QUEUED) |
| 1.3 | UI | Загружает файл в Supabase Storage `imports/{org_id}/{job_id}/price_{job_id}.ext` |
| 1.4 | Edge Fn `import-validate` | Генерирует signed URL, отправляет на Worker |
| 1.5 | Worker `price-import-worker` | Парсит файл, определяет колонки |
| 1.6 | Worker | Если колонки не маппятся → возвращает `MISSING_REQUIRED_COLUMNS` + `detected_columns` |
| 1.7 | UI `ColumnMappingStep` | Пользователь маппит колонки вручную |
| 1.8 | Worker (retry с маппингом) | Парсит с маппингом, канонизирует данные |
| 1.9 | Worker | Пишет в BigQuery `master_products_current` + sample в `import_staging_rows` |
| 1.10 | Worker | Обновляет `import_jobs.status = COMPLETED` |

### Фаза 2: Обогащение (Enrichment) — SCOPE ЭТОГО ТЗ

| Шаг | Компонент | Действие |
|-----|-----------|----------|
| 2.1 | UI `NormalizationTab` | Показывает завершённые импорты с кнопкой "Нормализовать" |
| 2.2 | UI `NormalizationWizard` | Открывает Wizard, вызывает `dry_run` |
| 2.3 | Edge Fn `import-normalize` | Проксирует на `catalog-enricher` |
| 2.4 | `catalog-enricher` | Читает строки из BQ, классифицирует, извлекает атрибуты |
| 2.5 | `catalog-enricher` | Возвращает `patches_sample` + `questions` |
| 2.6 | UI Wizard | Показывает кластерное дерево с подсветкой |
| 2.7 | UI AI Chat | Пользователь задаёт вопросы ИИ, получает structured patches |
| 2.8 | UI | Сохраняет решения через `settings-merge` |
| 2.9 | UI | Вызывает `apply_start` → polling `apply_status` → DONE |
| 2.10 | `catalog-enricher` | Обновляет строки в BQ с обогащёнными атрибутами |

### Фаза 3: Обслуживание (Serving)

| Шаг | Компонент | Действие |
|-----|-----------|----------|
| 3.1 | `pricing-api-saas` | `/api/catalog/items` — возвращает обогащённые товары |
| 3.2 | `pricing-api-saas` | `/api/catalog/facets` — агрегации (профили, покрытия, толщины) |
| 3.3 | `pricing-api-saas` | `/api/pricing/quote` — расчёт цены с учётом скидок Supabase |
| 3.4 | Dialogflow CX / AI Agent | Использует каталог для ответов клиентам |

---

## 4. Каноническая схема товара

### 4.1 Обязательные поля (9 полей)

| # | Поле | Тип | Пример | Источник |
|---|------|-----|--------|----------|
| 1 | `profile` | string | "С-20", "МП-20", "Монтеррей" | Regex + AI из title |
| 2 | `thickness_mm` | float | 0.45, 0.5, 0.7 | Regex из title/sku |
| 3 | `coating` | string | "Полиэстер", "Пурал", "Оцинковка" | Token matching + AI |
| 4 | `color_code` | string | "RAL3005", "RR32", "Zn" | Regex + RAL whitelist |
| 5 | `color_system` | string | "RAL", "RR", "CUSTOM", "NONE" | Детерминированный |
| 6 | `width_work_mm` | int | 1100 | Из profile DB или title |
| 7 | `width_full_mm` | int | 1150 | Из profile DB (ВСЕГДА) |
| 8 | `price` | float | 650.0 | Из исходного прайса |
| 9 | `unit` | string | "m2", "sht" | Из исходного прайса |

### 4.2 Служебные поля

| Поле | Тип | Описание |
|------|-----|----------|
| `sheet_kind` | enum | `PROFNASTIL`, `METAL_TILE`, `ACCESSORY`, `OTHER` |
| `product_type` | string | Человекочитаемый тип (= sheet_kind для UI) |
| `bq_id` | string | Первичный ключ BigQuery: `{org_id}_{sku}` |
| `organization_id` | string | UUID организации |
| `enrichment_status` | enum | `RAW`, `PARTIAL`, `COMPLETE`, `FAILED` |
| `enrichment_version` | string | Версия enricher (e.g., "v6.0") |
| `enriched_at` | timestamp | Время последнего обогащения |

### 4.3 Правила определения полей

#### Profile (профиль)

```python
# Приоритет паттернов:
PROFILE_PATTERNS = [
    # Русские буквы
    r'(С|Н|НС|МП|HC)-?\d{1,3}',          # С-20, С8, НС35, МП20
    # Латинские буквы  
    r'(C|H|HC|MP)-?\d{1,3}',              # C-20, H60, HC35
    # Металлочерепица — именные профили
    r'(Монтеррей|Каскад|Супермонтеррей)',  # Монтеррей
    r'(Monterrey|Cascade|SuperMonterrey)',  # Monterrey (EN)
]

# Нормализация:
# "С20" → "С-20"
# "C-20" → "С-20" (латиница → кириллица)
# "МП20" → "МП-20"
```

#### Thickness (толщина)

```python
THICKNESS_PATTERNS = [
    r'(\d+[.,]\d+)\s*мм',                 # "0,5 мм" → 0.5
    r'(\d+[.,]\d+)\s*mm',                 # "0.5mm" → 0.5
    r't[=:]?\s*(\d+[.,]\d+)',              # "t=0.5" → 0.5
    r'-(\d+[.,]\d+)-',                     # "...-0.5-..." → 0.5
]

# Валидация: 0.3 ≤ thickness_mm ≤ 1.5
# Если вне диапазона → отметить для ручной проверки
```

#### Coating (покрытие)

```python
COATING_TOKENS = {
    # token → каноническое имя
    'ПЭ': 'Полиэстер',
    'PE': 'Полиэстер',
    'Полиэстер': 'Полиэстер',
    'Polyester': 'Полиэстер',
    'ПВДФ': 'PVDF',
    'PVDF': 'PVDF',
    'Пурал': 'Пурал',
    'Pural': 'Пурал',
    'Пластизол': 'Пластизол',
    'PVC': 'Пластизол',
    'Оцинковка': 'Оцинковка',
    'Zn': 'Оцинковка',
    'оц': 'Оцинковка',
}

# Организация может добавить свои токены через settings-merge:
# bot_settings.settings_json.pricing.coatings = { "МатПЭ": "Полиэстер матовый" }
```

#### Color (цвет)

```python
# 1. RAL: 4-значный код, проверка по whitelist (213 записей в ral_colors)
RAL_PATTERN = r'RAL\s*(\d{4})'           # "RAL3005" → "RAL3005"
RAL_NAKED = r'\b(\d{4})\b'               # "3005" → проверить в whitelist

# 2. RR: Finnish standard
RR_PATTERN = r'RR\s*(\d{2})'             # "RR32" → "RR32"

# 3. Оцинковка: нет цвета
# Если coating == "Оцинковка" → color_code = "Zn", color_system = "NONE"

# 4. Декоративные покрытия (через aliases):
# bot_settings.settings_json.pricing.colors.decor_aliases = {
#   "красное вино": { "kind": "DECOR", "label": "Красное вино" },
#   "шоколад":      { "kind": "RAL", "ral": "RAL8017" }
# }
```

---

## 5. Vertex AI Pipeline — детальная спецификация

### 5.1 Архитектура AI

```
┌─────────────────────────────────────────────────────────┐
│                    catalog-enricher                       │
│                                                          │
│  ┌──────────────┐    ┌──────────────┐    ┌────────────┐ │
│  │ Deterministic │───▶│  AI Resolver  │───▶│  Validator  │ │
│  │   Pipeline    │    │  (Vertex AI)  │    │            │ │
│  └──────────────┘    └──────────────┘    └────────────┘ │
│        │                     │                   │       │
│   90%+ строк            ~8% строк           100%        │
│   (regex+tokens)       (ambiguous)        (все строки)  │
│                                                          │
│  Принцип: AI НЕ заменяет regex.                         │
│  AI решает ТОЛЬКО конфликты,                            │
│  которые детерминистика не смогла.                      │
└─────────────────────────────────────────────────────────┘
```

### 5.2 Deterministic Pipeline (Первый проход)

```python
def classify_row(title: str, sku: str, profile: str = None) -> EnrichedRow:
    """
    Единый детерминированный классификатор.
    Порядок приоритетов:
    1. ACCESSORY_GUARD — планки, саморезы, водостоки → sheet_kind=OTHER
    2. PROFILE_EXTRACT — извлечь профиль (С-20, МП-20, Монтеррей)
    3. SHEET_KIND — определить тип (PROFNASTIL / METAL_TILE)
    4. THICKNESS — извлечь толщину
    5. COATING — определить покрытие
    6. COLOR — определить цвет/RAL
    7. WIDTHS — подтянуть ширины из базы профилей
    """
    
    # STEP 1: Accessory guard (highest priority)
    if RE_ACCESSORY.search(title):
        return EnrichedRow(sheet_kind='OTHER', ...)
    
    # STEP 2: Extract profile
    profile = extract_profile(title, sku)
    
    # STEP 3: Classify sheet kind
    sheet_kind = classify_sheet_kind(profile, title)
    
    # STEP 4-7: Extract attributes
    thickness = extract_thickness(title, sku)
    coating = resolve_coating(title, org_settings)
    color_code, color_system = resolve_color(title, ral_whitelist, org_settings)
    work_w, full_w = lookup_widths(profile, profile_db)
    
    return EnrichedRow(
        sheet_kind=sheet_kind,
        profile=profile,
        thickness_mm=thickness,
        coating=coating,
        color_code=color_code,
        color_system=color_system,
        width_work_mm=work_w,
        width_full_mm=full_w,
        enrichment_status='COMPLETE' if all_filled else 'PARTIAL',
    )
```

### 5.3 AI Resolver (Второй проход — Vertex AI Gemini)

**Когда вызывается**: ТОЛЬКО для строк со статусом `PARTIAL` после первого прохода.

**Модель**: `gemini-2.5-flash` (через Vertex AI, НЕ через Lovable AI Gateway)

**Почему Vertex AI напрямую**:
- Сервис работает в GCP Cloud Run → прямой доступ к Vertex AI
- Нет необходимости проксировать через Lovable Gateway
- Аутентификация через Service Account (Application Default Credentials)

```python
from google.cloud import aiplatform
from vertexai.generative_models import GenerativeModel

model = GenerativeModel("gemini-2.5-flash")

SYSTEM_PROMPT = """
Ты — эксперт по нормализации промышленных каталогов (кровельные материалы, металлопрокат).

ЗАДАЧА: На вход получаешь строку прайс-листа, в которой детерминистический парсер 
не смог определить одно или несколько полей. Ты должен вернуть ТОЛЬКО недостающие значения.

ФОРМАТ ОТВЕТА: JSON (tool_call), никакого текста.

ПРАВИЛА:
1. thickness_mm: число от 0.3 до 1.5
2. coating: одно из ["Полиэстер", "Полиэстер матовый", "Пурал", "PVDF", "Пластизол", "Оцинковка"]
3. color_code: RAL####, RR##, или "Zn"
4. profile: стандартный профиль (С-20, НС-35, Н-60, МП-20, Монтеррей)
5. Если НЕ можешь определить поле с уверенностью >0.7 → верни null
6. НИКОГДА не придумывай значения. Если не уверен — null.
"""

async def ai_resolve_batch(
    rows: list[PartialRow],
    org_settings: dict
) -> list[AIPatch]:
    """
    Batch resolve ambiguous rows using Vertex AI.
    Groups similar rows to minimize API calls.
    """
    
    # Group by missing field type for efficiency
    groups = group_by_missing_fields(rows)
    
    patches = []
    for field_type, group_rows in groups.items():
        # Build prompt with examples from org_settings
        prompt = build_prompt(field_type, group_rows, org_settings)
        
        # Call Vertex AI with tool_use for structured output
        response = await model.generate_content_async(
            [SYSTEM_PROMPT, prompt],
            tools=[ENRICHMENT_TOOL],
            tool_config={"function_calling_config": {"mode": "ANY"}},
        )
        
        # Extract structured patches from tool calls
        for tool_call in response.candidates[0].content.parts:
            if tool_call.function_call:
                patch = parse_tool_call(tool_call.function_call)
                patches.append(patch)
    
    return patches
```

### 5.4 Tool Definition для Gemini

```python
ENRICHMENT_TOOL = {
    "function_declarations": [{
        "name": "enrich_product",
        "description": "Заполнить недостающие атрибуты товара",
        "parameters": {
            "type": "object",
            "properties": {
                "row_id": {"type": "string", "description": "ID строки"},
                "profile": {"type": "string", "description": "Профиль (С-20, МП-20, Монтеррей)", "nullable": True},
                "thickness_mm": {"type": "number", "description": "Толщина в мм (0.3-1.5)", "nullable": True},
                "coating": {
                    "type": "string",
                    "description": "Тип покрытия",
                    "enum": ["Полиэстер", "Полиэстер матовый", "Пурал", "PVDF", "Пластизол", "Оцинковка"],
                    "nullable": True
                },
                "color_code": {"type": "string", "description": "RAL/RR код или Zn", "nullable": True},
                "confidence": {"type": "number", "description": "Уверенность 0.0-1.0"},
            },
            "required": ["row_id", "confidence"]
        }
    }]
}
```

### 5.5 AI Chat (Интерактивный помощник)

```python
@app.post("/api/enrich/chat")
async def chat_endpoint(req: ChatRequest) -> ChatResponse:
    """
    Интерактивный чат для ручной корректировки.
    
    Пользователь: "Все строки с токеном 'МатПЭ' — это Полиэстер матовый"
    AI: Возвращает structured patch для ВСЕХ строк с этим токеном.
    
    ВАЖНО: AI возвращает ТОЛЬКО JSON patches, НИКОГДА разговорный текст.
    """
    
    CHAT_SYSTEM = """
    Ты — AI-ассистент нормализации каталога.
    Пользователь дает команды по исправлению данных.
    Ты ВСЕГДА отвечаешь через tool_call с патчами.
    
    Примеры команд:
    - "МатПЭ = Полиэстер матовый" → patch coating для всех строк с МатПЭ
    - "Толщина 45 = 0.45мм" → patch thickness_mm
    - "Все 3005 = RAL3005" → patch color_code
    - "Убери строки с саморезами" → mark as ACCESSORY
    """
    
    # Получить контекст текущего кластера
    context_rows = fetch_context_rows(
        req.organization_id,
        req.context.group_type,
        req.context.group_key,
        limit=50
    )
    
    # Вызвать Gemini с контекстом
    response = await model.generate_content_async(
        [CHAT_SYSTEM, format_context(context_rows), req.message],
        tools=[BATCH_PATCH_TOOL],
        tool_config={"function_calling_config": {"mode": "ANY"}},
    )
    
    patches = extract_patches(response)
    
    return ChatResponse(
        ok=True,
        patches=patches,
        affected_count=len(patches),
        preview=format_preview(patches),  # Before/After таблица
    )
```

### 5.6 AI Questions (Проактивные вопросы)

При `dry_run` сервис анализирует "мёртвые зоны" — кластеры с низкой уверенностью:

```python
def generate_questions(rows: list[EnrichedRow], settings: dict) -> list[AIQuestion]:
    """
    Генерирует вопросы для пользователя по неразрешённым группам.
    
    Приоритет:
    1. Неизвестные токены покрытия (affected_count > 10)
    2. Неопределённые цвета (4-значные числа не в RAL whitelist)
    3. Неизвестные профили
    4. Спорные толщины (несколько вариантов в одной строке)
    """
    
    questions = []
    
    # Анализ неизвестных токенов покрытия
    unknown_coatings = find_unknown_coating_tokens(rows, settings)
    for token, affected in unknown_coatings.items():
        if affected.count >= 10:  # Только массовые
            questions.append(AIQuestion(
                type='coating',
                token=token,
                examples=affected.sample_titles[:5],
                affected_count=affected.count,
                suggestions=ai_suggest_coating(token),  # Gemini suggestion
                confidence=0.6,
                cluster_path=affected.dominant_cluster,
            ))
    
    # Аналогично для цветов и профилей
    unknown_colors = find_ambiguous_colors(rows)
    unknown_profiles = find_unknown_profiles(rows)
    
    # Сортировка по impact (affected_count DESC)
    questions.sort(key=lambda q: q.affected_count, reverse=True)
    
    return questions[:20]  # Max 20 вопросов за раз
```

---

## 6. API-контракт catalog-enricher

### 6.1 POST /api/enrich/dry_run

**Назначение**: Анализ данных без изменений. Возвращает preview + вопросы.

**Request**:
```json
{
  "organization_id": "uuid",
  "import_job_id": "uuid | current",
  "scope": {
    "only_where_null": true,
    "limit": 2000
  },
  "ai_suggest": false
}
```

**Response**:
```json
{
  "ok": true,
  "run_id": "run_abc123",
  "profile_hash": "sha256_of_profile_db_state",
  "stats": {
    "rows_scanned": 71316,
    "candidates": 68500,
    "patches_ready": 63200,
    "partial": 5300,
    "failed": 0
  },
  "patches_sample": [
    {
      "id": "org123_sku456",
      "title": "Профнастил С-20 0,5мм Полиэстер RAL3005",
      "profile": "С-20",
      "thickness_mm": 0.5,
      "coating": "Полиэстер",
      "color_code": "RAL3005",
      "color_system": "RAL",
      "width_work_mm": 1100,
      "width_full_mm": 1150,
      "price": 650.0,
      "unit": "m2",
      "sheet_kind": "PROFNASTIL",
      "enrichment_status": "COMPLETE"
    }
  ],
  "questions": [
    {
      "type": "coating",
      "cluster_path": { "product_type": "PROFNASTIL", "profile": "С-20" },
      "token": "МатПЭ",
      "examples": ["С-20 0.5 МатПЭ 3005", "С-20 0.45 МатПЭ 8017"],
      "affected_count": 340,
      "suggestions": ["Полиэстер матовый", "Полиэстер"],
      "confidence": 0.85
    }
  ]
}
```

### 6.2 POST /api/enrich/preview_rows

**Назначение**: Получить реальные строки из BQ с фильтрацией по кластеру.

**Request**:
```json
{
  "organization_id": "uuid",
  "import_job_id": "current",
  "group_type": "COATING",
  "filter_key": "МатПЭ",
  "q": "С-20",
  "limit": 50,
  "offset": 0
}
```

**Response**:
```json
{
  "ok": true,
  "rows": [
    {
      "bq_id": "org123_sku456",
      "title": "С-20 0.5 МатПЭ 3005",
      "profile": "С-20",
      "thickness_mm": 0.5,
      "coating": null,
      "color_code": "RAL3005",
      "sheet_kind": "PROFNASTIL",
      "enrichment_status": "PARTIAL"
    }
  ],
  "total": 340,
  "has_next": true
}
```

### 6.3 POST /api/enrich/chat

**Request**:
```json
{
  "organization_id": "uuid",
  "message": "МатПЭ = Полиэстер матовый",
  "context": {
    "group_type": "COATING",
    "group_key": "МатПЭ",
    "affected_count": 340,
    "examples": ["С-20 0.5 МатПЭ 3005", "НС-35 0.7 МатПЭ 8017"]
  }
}
```

**Response**:
```json
{
  "ok": true,
  "action": "PATCH_COATING",
  "patches": [
    {
      "field": "coating",
      "from_token": "МатПЭ",
      "to_value": "Полиэстер матовый",
      "affected_bq_ids": ["org123_sku1", "org123_sku2", "...340 total"],
      "affected_count": 340
    }
  ],
  "settings_patch": {
    "pricing": {
      "coatings": {
        "МатПЭ": "Полиэстер матовый"
      }
    }
  },
  "preview": {
    "before": [
      {"title": "С-20 0.5 МатПЭ 3005", "coating": null}
    ],
    "after": [
      {"title": "С-20 0.5 МатПЭ 3005", "coating": "Полиэстер матовый"}
    ]
  }
}
```

### 6.4 POST /api/enrich/apply/start

**Назначение**: Запуск асинхронного обогащения.

**Request**:
```json
{
  "organization_id": "uuid",
  "import_job_id": "uuid",
  "run_id": "run_abc123",
  "profile_hash": "sha256_..."
}
```

**Response**:
```json
{
  "ok": true,
  "apply_id": "apply_xyz789",
  "status": "PENDING",
  "estimated_seconds": 90
}
```

### 6.5 GET /api/enrich/apply_status

**Query params**: `import_job_id`, `apply_id`

**Response**:
```json
{
  "ok": true,
  "apply_id": "apply_xyz789",
  "status": "DONE",
  "patched_rows": 63200,
  "failed_rows": 0,
  "elapsed_seconds": 75
}
```

**Statuses**: `PENDING` → `RUNNING` → `DONE` | `FAILED`

### 6.6 POST /api/enrich/bulk_preview

**Назначение**: Предпросмотр массового изменения по кластеру.

**Request**:
```json
{
  "organization_id": "uuid",
  "filter": {
    "sheet_kind": "PROFNASTIL",
    "profile": "С-20",
    "coating_token": "МатПЭ"
  },
  "patch": {
    "coating": "Полиэстер матовый"
  }
}
```

**Response**:
```json
{
  "ok": true,
  "affected_count": 340,
  "preview_sample": [
    {
      "bq_id": "...",
      "title": "...",
      "before": { "coating": null },
      "after": { "coating": "Полиэстер матовый" }
    }
  ]
}
```

### 6.7 POST /api/enrich/bulk_apply/start

**Request**: Аналогичен `bulk_preview`, но выполняет UPDATE в BigQuery.

**Response**: `{ apply_id, status: "PENDING" }` — polling через `apply_status`.

---

## 7. Правила нормализации (bot_settings.settings_json.pricing)

### 7.1 Структура правил

```json
{
  "pricing": {
    
    "widths_selected": {
      "С-20": { "work": 1100, "full": 1150 },
      "МП-20": { "work": 1100, "full": 1150 },
      "Монтеррей": { "work": 1100, "full": 1190 }
    },
    
    "profile_aliases": {
      "C20": "С-20",
      "С20": "С-20",
      "C-20": "С-20",
      "MP20": "МП-20",
      "МП20": "МП-20"
    },
    
    "coatings": {
      "ПЭ": "Полиэстер",
      "PE": "Полиэстер",
      "МатПЭ": "Полиэстер матовый",
      "MatPE": "Полиэстер матовый",
      "Пурал": "Пурал",
      "Pural": "Пурал",
      "оц": "Оцинковка"
    },
    
    "colors": {
      "ral_aliases": {
        "3005": "RAL3005",
        "красное вино": "RAL3005",
        "шоколад": "RAL8017",
        "зелёный мох": "RAL6005"
      },
      "decor_aliases": {
        "под дерево": { "kind": "DECOR", "label": "Под дерево" },
        "камуфляж": { "kind": "DECOR", "label": "Камуфляж" }
      }
    },
    
    "defaults": {
      "widths_suggested": {
        "С-8": { "work": 1150, "full": 1200 }
      },
      "coatings_suggested": {
        "ВикингМП": "Полиэстер матовый"
      },
      "ral_classic_codes": ["RAL1014", "RAL1015", "RAL3003", "RAL3005", "..."],
      "coating_family_map": {
        "Полиэстер": "PE_FAMILY",
        "Полиэстер матовый": "PE_FAMILY",
        "Пурал": "PU_FAMILY"
      }
    }
  }
}
```

### 7.2 Жизненный цикл правила

```
1. dry_run выявляет неизвестный токен "МатПЭ"
2. AI генерирует question: { token: "МатПЭ", suggestions: ["Полиэстер матовый"] }
3. Пользователь подтверждает через UI или AI Chat
4. UI вызывает settings-merge с patch:
   { "pricing": { "coatings": { "МатПЭ": "Полиэстер матовый" } } }
5. settings-merge делает deep merge в bot_settings.settings_json
6. При следующем dry_run/apply — enricher читает обновлённые правила
7. Токен "МатПЭ" теперь разрешается автоматически
```

### 7.3 Приоритет источников

```
1. Explicit settings (bot_settings.settings_json.pricing.coatings) — ВЫСШИЙ
2. Deterministic regex (встроенные паттерны enricher)
3. AI suggestion (Vertex AI Gemini) — ТОЛЬКО если confidence ≥ 0.7
4. null (не определено) — помечается для ручной проверки
```

---

## 8. BigQuery — схема и индексация

### 8.1 Таблица `master_products_current`

```sql
CREATE TABLE IF NOT EXISTS `{project}.roofing_saas.master_products_current` (
  -- Identity
  id STRING NOT NULL,                    -- bq_key: "{org_id}_{sku}"
  organization_id STRING NOT NULL,
  sku STRING,
  
  -- Source data (из парсера)
  title STRING,
  notes STRING,
  base_price FLOAT64,                   -- Базовая цена руб/м²
  unit STRING,                           -- "m2" | "sht" | "p.m."
  currency STRING DEFAULT 'RUB',
  
  -- Category (из enricher)
  cat_name STRING,                       -- "Кровельные материалы"
  cat_tree STRING,                       -- "Кровля > Профнастил > С-20"
  
  -- Enriched attributes (заполняются catalog-enricher)
  sheet_kind STRING,                     -- PROFNASTIL | METAL_TILE | ACCESSORY | OTHER
  profile STRING,                        -- С-20, МП-20, Монтеррей
  thickness_mm FLOAT64,                  -- 0.45, 0.5, 0.7
  coating STRING,                        -- Полиэстер, Пурал, Оцинковка
  color_code STRING,                     -- RAL3005, RR32, Zn
  color_system STRING,                   -- RAL | RR | CUSTOM | NONE
  width_work_mm INT64,                   -- 1100
  width_full_mm INT64,                   -- 1150
  weight_kg_m2 FLOAT64,                  -- 4.2
  
  -- Enrichment metadata
  enrichment_status STRING,              -- RAW | PARTIAL | COMPLETE | FAILED
  enrichment_version STRING,             -- "v6.0"
  enriched_at TIMESTAMP,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
)
PARTITION BY DATE(updated_at)
CLUSTER BY organization_id, sheet_kind, profile;
```

### 8.2 Таблица `master_products_history`

```sql
-- Архив: копия перед каждым импортом
CREATE TABLE IF NOT EXISTS `{project}.roofing_saas.master_products_history` (
  -- Все колонки из master_products_current +
  archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  archived_reason STRING,               -- "import_job_{job_id}"
)
PARTITION BY DATE(archived_at)
CLUSTER BY organization_id;
```

### 8.3 Таблица `profile_dimensions` (справочник ширин)

```sql
CREATE TABLE IF NOT EXISTS `{project}.roofing_saas.profile_dimensions` (
  profile STRING NOT NULL,              -- Канонический профиль: "С-20"
  work_width_mm INT64 NOT NULL,          -- 1100
  full_width_mm INT64 NOT NULL,          -- 1150
  weight_kg_m2 FLOAT64,                  -- 4.2
  product_type STRING,                   -- PROFNASTIL | METAL_TILE
  aliases STRING ARRAY,                  -- ["С20", "C-20", "C20"]
  source STRING DEFAULT 'MANUAL',        -- MANUAL | GOST | SUPPLIER
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
);
```

### 8.4 Индексация и Clustering

```
master_products_current:
  PARTITION BY DATE(updated_at)          -- Быстрая очистка старых данных
  CLUSTER BY organization_id, sheet_kind, profile  -- Быстрые фильтры

master_products_history:
  PARTITION BY DATE(archived_at)
  CLUSTER BY organization_id

Стоимость: ~$5/TB scanned. При 70k строк × 1KB = ~70MB → $0.0003 за запрос.
```

---

## 9. Supabase — Control Plane

### 9.1 Роль Supabase в архитектуре

| Таблица | Назначение | Связь с BQ |
|---------|-----------|------------|
| `bot_settings.settings_json.pricing` | Правила нормализации для enricher | Enricher читает при каждом запуске |
| `product_catalog` | Overrides (is_active) + lazy-create для скидок | `bq_key` == BQ `id` |
| `discount_rules` | Скидки (FK → product_catalog.id UUID) | Lazy-create при назначении |
| `ral_colors` | Справочник RAL (213 записей, read-only) | Enricher загружает при старте |
| `import_jobs` | Статусы импорта (UI polling) | Worker обновляет |
| `import_staging_rows` | Sample данных (300 строк для UI) | Читает из того же файла |

### 9.2 Settings-merge Flow

```
UI → Edge Fn "settings-merge" → Supabase bot_settings

Payload:
{
  "organization_id": "uuid",
  "patch": {
    "pricing": {
      "coatings": { "МатПЭ": "Полиэстер матовый" }
    }
  }
}

Результат: deep merge в settings_json без перезаписи других ключей.
```

### 9.3 Lazy-Create для Скидок (вне scope enricher, но важно для контекста)

```
1. UI DiscountRuleDialog → поиск товара через pricing-api-saas
2. Пользователь выбирает товар (bq_id = "org123_sku456")
3. UI делает upsert в product_catalog:
   INSERT INTO product_catalog (organization_id, bq_key, sku, title, is_active)
   VALUES ($org_id, $bq_id, $sku, $title, true)
   ON CONFLICT (organization_id, bq_key) DO UPDATE SET updated_at = now()
4. Получает UUID (product_catalog.id)
5. Сохраняет discount_rule с product_id = UUID
```

---

## 10. UI Wizard — функциональная спецификация

### 10.1 Layout (три панели)

```
┌──────────────────────────────────────────────────────────────────┐
│  [Sparkles] Нормализация каталога       ✅ 63200/68500  [████] │
│                                      [Обновить] [Завершить]     │
├──────────┬──────────────┬────────────────────────────────────────┤
│ CATEGORIES│ CLUSTER TREE │           DETAIL PANEL                │
│          │              │                                        │
│ ▸ Все    │ ▸ С-20       │  ┌─────────────────────────────────┐  │
│   71316  │   ├ 0.45     │  │ Таблица товаров кластера        │  │
│          │   ├ 0.50     │  │ title | profile | thick | coat  │  │
│ ▸ Профн. │   │ ├ ПЭ     │  │ ─── Before ─── │ ─── After ─── │  │
│   45200  │   │ │ ├ 3005  │  │ С-20 0.5 МатПЭ │ С-20|0.5|ПЭМ │  │
│          │   │ │ ├ 8017  │  │ ...             │ ...           │  │
│ ▸ Черепица│   │ └ Пурал  │  └─────────────────────────────────┘  │
│   23300  │   ├ 0.55     │                                        │
│          │   └ 0.70     │  ┌─────────────────────────────────┐  │
│ ▸ Доборн.│              │  │ AI Chat                         │  │
│   2500   │ ▸ НС-35      │  │ ┌───────────────────────┐      │  │
│          │ ▸ Н-60       │  │ │ МатПЭ = ?             │      │  │
│ ▸ Прочее │ ▸ Монтеррей  │  │ │ [Полиэстер матовый]   │      │  │
│   316    │              │  │ │ [Применить к 340 стр.] │      │  │
│          │              │  │ └───────────────────────┘      │  │
└──────────┴──────────────┴────────────────────────────────────────┘
```

### 10.2 Category Filter (левая панель, 256px)

- **ALL**: Все товары (badge: total)
- **PROFNASTIL**: Профнастил (badge: count, progress ring)
- **METALLOCHEREPICA**: Металлочерепица
- **DOBOR**: Доборные элементы (без нормализации, только просмотр)
- **SANDWICH**: Сэндвич-панели (без нормализации)
- **OTHER**: Прочее

### 10.3 Cluster Tree (центральная панель, 320px)

```
Иерархия: product_type → profile → thickness_mm → coating → color_code

Каждый узел показывает:
- Название (С-20, 0.5мм, Полиэстер)
- Badge: items_count
- Цвет: 🟢 ready / 🟡 partial / 🔴 needs_attention
- AI suggestion icon (✨) если есть
```

### 10.4 Detail Panel (правая панель, flex-1)

**Верхняя часть: Таблица товаров**

| Колонка | Содержимое |
|---------|-----------|
| Title | Исходное название из прайса |
| Profile | До → После (подсветка изменений) |
| Thickness | До → После |
| Coating | До → После |
| Color | До → После |
| Price | Цена |
| Status | 🟢/🔴 |

**Нижняя часть: AI Chat**

- Показывает вопросы для текущего кластера
- Input для команд ("МатПЭ = Полиэстер матовый")
- Кнопки быстрых действий из suggestions
- Кнопка "Применить к N строкам" с confirmation dialog

### 10.5 Процесс подтверждения

```
1. Пользователь видит вопрос: "Что такое 'МатПЭ'? (340 строк)"
2. Варианты: [Полиэстер матовый] [Полиэстер] [Другое...]
3. Клик → показывает preview (Before/After)
4. Кнопка "Подтвердить и сохранить правило"
5. UI вызывает settings-merge с patch
6. UI вызывает apply или bulk_apply для этого кластера
7. Дерево обновляется: 🔴 → 🟢
```

---

## 11. Масштабирование на другие отрасли

### 11.1 Модель расширения

```
Текущее:
  roofing (кровля) → 9 фиксированных полей

Целевое (v7+):
  roofing       → profile, thickness_mm, coating, color, widths, price, unit
  auto_parts    → brand, part_number, oem_ref, vehicle_model, year_range, price
  fasteners     → material, grade, diameter_mm, length_mm, thread, coating, price
  universal     → title, sku, category, price, unit + JSON attributes
```

### 11.2 Industry Template Architecture

```python
# Каждая отрасль — это набор:
class IndustryTemplate:
    code: str                    # "roofing", "auto_parts", "fasteners"
    display_name: dict           # {"ru": "Кровля", "en": "Roofing"}
    
    # Обязательные поля
    required_fields: list[FieldDefinition]
    
    # Опциональные поля
    optional_fields: list[FieldDefinition]
    
    # Regex-паттерны для извлечения
    extraction_patterns: dict[str, list[str]]
    
    # Token-словари
    token_dictionaries: dict[str, dict[str, str]]
    
    # Hierarchical clustering order
    cluster_hierarchy: list[str]  # ["brand", "part_number", "year_range"]
    
    # AI system prompt for this industry
    ai_system_prompt: str
    
    # Validation rules
    validators: list[Callable]

class FieldDefinition:
    name: str                    # "thickness_mm"
    display_name: dict           # {"ru": "Толщина (мм)", "en": "Thickness (mm)"}
    type: str                    # "float", "string", "enum", "int"
    validation: dict             # {"min": 0.3, "max": 1.5}
    extraction_patterns: list[str]
    enum_values: list[str] | None
```

### 11.3 BigQuery Schema для Universal

```sql
CREATE TABLE `{project}.{dataset}.master_products_current` (
  -- Common fields (all industries)
  id STRING NOT NULL,
  organization_id STRING NOT NULL,
  sku STRING,
  title STRING,
  base_price FLOAT64,
  unit STRING,
  currency STRING,
  cat_name STRING,
  cat_tree STRING,
  
  -- Industry identifier
  industry_code STRING,          -- "roofing", "auto_parts", "fasteners"
  
  -- Industry-specific attributes (JSON)
  attributes JSON,               -- Flexible schema per industry
  
  -- Enrichment metadata
  enrichment_status STRING,
  enrichment_version STRING,
  enriched_at TIMESTAMP,
  
  -- Timestamps
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
)
PARTITION BY DATE(updated_at)
CLUSTER BY organization_id, industry_code, cat_name;
```

### 11.4 Пример: Автозапчасти

```json
{
  "industry_code": "auto_parts",
  "title": "Колодки тормозные TRW GDB1234",
  "attributes": {
    "brand": "TRW",
    "part_number": "GDB1234",
    "oem_refs": ["04465-33471", "04465-33450"],
    "vehicle_models": ["Toyota Camry", "Lexus ES"],
    "year_range": "2012-2023",
    "position": "front",
    "material": "ceramic"
  }
}
```

### 11.5 Маршрут добавления новой отрасли

```
1. Определить industry_code и required_fields
2. Написать extraction_patterns (regex)
3. Создать token_dictionaries (если есть стандартные коды)
4. Написать AI system prompt для Gemini
5. Определить cluster_hierarchy для UI
6. Добавить IndustryTemplate в catalog-enricher
7. UI автоматически адаптируется (поля из template)
```

---

## 12. Обработка ошибок и Edge Cases

### 12.1 Edge Cases при нормализации

| Случай | Решение |
|--------|---------|
| Строка содержит два RAL кода | Брать первый, пометить для проверки |
| Толщина "45" (без точки) | Если ≤ 15 → делить на 10 (0.45). Если > 15 → пометить |
| Профиль "МП-20" встречается как "МП20", "MP-20", "MP20" | Все → "МП-20" через profile_aliases |
| Цена = 0 | Пропустить (не обогащать, но оставить в BQ) |
| Строка = "Саморезы кровельные 4.8×35" | RE_ACCESSORY → sheet_kind=OTHER, skip enrichment |
| Один SKU — две строки с разной ценой | Брать последнюю (by updated_at), логировать конфликт |
| RAL "9003" не в whitelist | Проверить whitelist. Если нет — пометить unknown_color |
| Покрытие = "Викинг МП Е" | Без match в coatings → question для пользователя |

### 12.2 Retry и Timeout Strategy

```python
# Timeouts (от Edge Function ≤ 60s)
DRY_RUN_TIMEOUT = 55       # Edge Function abort после 55s
APPLY_SYNC_TIMEOUT = 55    # Sync apply (fallback)
APPLY_ASYNC_TIMEOUT = 300  # Cloud Tasks (5 min)
CHAT_TIMEOUT = 45          # AI Chat
PREVIEW_TIMEOUT = 30       # Preview rows

# Retry policy
VERTEX_AI_RETRIES = 3      # Retry Gemini calls
BQ_WRITE_RETRIES = 2       # Retry BigQuery writes
BATCH_SIZE = 500            # Rows per BQ write batch
```

### 12.3 Conflict Resolution

```python
# Порядок разрешения конфликтов:
1. Explicit user rule (settings_json.pricing.*)    → ALWAYS WINS
2. Deterministic regex with single match            → ACCEPT
3. Deterministic regex with multiple matches         → TAKE FIRST, FLAG
4. AI with confidence ≥ 0.85                         → AUTO-ACCEPT
5. AI with confidence 0.7-0.85                       → SUGGEST (question)
6. AI with confidence < 0.7                          → SKIP (leave null)
```

---

## 13. Метрики и мониторинг

### 13.1 Logging Contract

Каждый вызов enricher логирует:

```json
{
  "event": "dry_run_complete",
  "organization_id": "uuid",
  "import_job_id": "uuid",
  "stats": {
    "total_scanned": 71316,
    "auto_resolved": 65800,
    "ai_resolved": 2400,
    "partial": 3116,
    "questions_generated": 12,
    "elapsed_ms": 28500,
    "vertex_ai_calls": 8,
    "vertex_ai_tokens_in": 45000,
    "vertex_ai_tokens_out": 3200
  },
  "version": "v6.0"
}
```

### 13.2 SLO

| Метрика | Target | Alert threshold |
|---------|--------|-----------------|
| dry_run p95 latency | ≤ 30s | > 45s |
| apply p95 latency | ≤ 120s | > 180s |
| auto_resolution_rate | ≥ 92% | < 85% |
| AI error rate | ≤ 2% | > 5% |
| BQ write success rate | ≥ 99.5% | < 98% |

---

## 14. Roadmap

### Phase 1: Стабилизация (2 недели)

- [ ] Исправить sync apply → async apply_start + polling в UI
- [ ] Реализовать AI question persistence через settings-merge
- [ ] Исправить naming mismatch (METAL_TILE ↔ METALLOCHEREPICA)
- [ ] Добавить enrichment_status в BQ schema
- [ ] UI: before/after highlighting в таблице

### Phase 2: AI Chat (2 недели)

- [ ] Реализовать `/api/enrich/chat` с Vertex AI tool_use
- [ ] UI: интегрировать AIChatPanel с settings-merge
- [ ] Реализовать bulk_preview / bulk_apply endpoints
- [ ] Speech-to-text input (Web Speech API)

### Phase 3: Preview & Pagination (1 неделя)

- [ ] Реализовать `/api/enrich/preview_rows` с offset support
- [ ] UI: подгрузка строк при скролле (virtual scroll)
- [ ] UI: поиск внутри кластера

### Phase 4: Multi-Industry (3 недели)

- [ ] Абстрагировать IndustryTemplate
- [ ] Мигрировать BQ на attributes JSON
- [ ] Добавить industry_code в UI Wizard
- [ ] Реализовать template для auto_parts

### Phase 5: Optimisation (1 неделя)

- [ ] Batch AI calls (группировка по типу ошибки)
- [ ] Кэширование profile_dimensions в Redis/Memorystore
- [ ] Streaming response для dry_run (SSE)
- [ ] Параллельная обработка кластеров

---

## Приложения

### A. Regex Library (встроенные паттерны)

```python
# Profiles
RE_PROFILE_RU = re.compile(r'(С|Н|НС|МП|HC)-?\d{1,3}', re.I)
RE_PROFILE_EN = re.compile(r'(C|H|HC|MP)-?\d{1,3}', re.I)
RE_METAL_TILE = re.compile(r'(Монтеррей|Каскад|Супермонтеррей|Monterrey)', re.I)

# Thickness
RE_THICKNESS = re.compile(r'(\d+[.,]\d+)\s*(?:мм|mm)', re.I)
RE_THICKNESS_INLINE = re.compile(r'(?:^|[-_/])(\d+[.,]\d{1,2})(?:[-_/]|$)')

# Colors
RE_RAL = re.compile(r'RAL\s*(\d{4})', re.I)
RE_RAL_NAKED = re.compile(r'\b(\d{4})\b')
RE_RR = re.compile(r'RR\s*(\d{2})', re.I)

# Accessories (HIGHEST PRIORITY — blocks everything else)
RE_ACCESSORY = re.compile(
    r'(планка|конёк|конек|отлив|водосток|саморез|ветровая|карнизная|'
    r'примыкани|ендова|снегозадержат|проходной|вентиляц|лента|уплотнит|'
    r'гидроизоляц|пароизоляц|мембран|буклет|брошюр|каталог)',
    re.I
)
```

### B. RAL Whitelist (частичный)

```
RAL1000, RAL1001, RAL1002, RAL1003, RAL1004, RAL1005, RAL1006, RAL1007,
RAL1011, RAL1012, RAL1013, RAL1014, RAL1015, RAL1016, RAL1017, RAL1018,
RAL1019, RAL1020, RAL1021, RAL1023, RAL1024, RAL1026, RAL1027, RAL1028,
...
RAL9001, RAL9002, RAL9003, RAL9004, RAL9005, RAL9006, RAL9007, RAL9010,
RAL9011, RAL9016, RAL9017, RAL9018, RAL9022, RAL9023
```

Полный список: 213 записей в `ral_colors` таблице Supabase.

### C. Profile Dimensions Reference

| Profile | Work Width (mm) | Full Width (mm) | Type |
|---------|----------------|-----------------|------|
| С-8 | 1150 | 1200 | PROFNASTIL |
| С-10 | 1100 | 1180 | PROFNASTIL |
| С-20 | 1100 | 1150 | PROFNASTIL |
| С-21 | 1000 | 1051 | PROFNASTIL |
| НС-35 | 1000 | 1060 | PROFNASTIL |
| Н-60 | 845 | 902 | PROFNASTIL |
| Н-75 | 750 | 800 | PROFNASTIL |
| МП-20 | 1100 | 1150 | PROFNASTIL |
| Монтеррей | 1100 | 1190 | METAL_TILE |
| Супермонтеррей | 1100 | 1190 | METAL_TILE |
| Каскад | 1000 | 1115 | METAL_TILE |

### D. Edge Function Proxy Map

| UI Operation | Edge Function | Cloud Run Endpoint |
|-------------|---------------|-------------------|
| dry_run | `import-normalize` (op: dry_run) | POST `/api/enrich/dry_run` |
| apply | `import-normalize` (op: apply) | POST `/api/enrich/apply/start` → GET `/api/enrich/apply_status` |
| preview_rows | `import-normalize` (op: preview_rows) | POST `/api/enrich/preview_rows` |
| chat | `import-normalize` (op: chat) | POST `/api/enrich/chat` |
| save rules | `settings-merge` | Supabase `bot_settings` (direct) |
| validate import | `import-validate` | Cloud Run `price-import-worker` |
| publish import | `import-publish` | Cloud Run `price-import-worker` |
