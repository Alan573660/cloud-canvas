# 📋 ПОЛНЫЙ РАЗБОР ПРОЕКТА: Каталог, Прайс и Нормализация

**Дата**: 2026-03-12  
**Для**: Новый разработчик  
**Автор**: ИИ-ассистент на базе анализа кодовой базы

---

## 📐 ОБЩАЯ АРХИТЕКТУРА

### Три слоя системы

```
┌────────────────────────────────────────────────────────────────┐
│  FRONTEND (React + Vite + TypeScript)                         │
│  Lovable-hosted SPA                                           │
│  src/pages/products/ + src/components/normalization/           │
├────────────────────────────────────────────────────────────────┤
│  MIDDLEWARE (Supabase Edge Functions — Deno)                   │
│  supabase/functions/                                          │
│  import-normalize, catalog-proxy, settings-merge,             │
│  import-validate, import-publish, normalization-chat           │
├────────────────────────────────────────────────────────────────┤
│  BACKEND (Python Cloud Run — main.py ~3932 строки)            │
│  catalog-enricher (pricing-api-saas)                          │
│  BigQuery ↔ Gemini AI                                         │
└────────────────────────────────────────────────────────────────┘
```

### Поток данных

```
Браузер → Supabase Edge Function → Cloud Run (Python) → BigQuery
           ↓ (JWT проверка)          ↓ (Бизнес-логика)    ↓ (Данные)
           ↓ (org membership)        ↓ (AI Gemini)        ↓ (70k+ SKU)
           ↓ (секреты)              ↓ (Нормализация)     ↓ 
           ← JSON ответ ←←←←←←←←←← ← Результат ←←←←←←←←
```

**ВАЖНО**: Фронтенд НИКОГДА не обращается напрямую к Cloud Run или BigQuery. Все идет через Edge Functions.

---

## 🗂 СТРУКТУРА ФАЙЛОВ (только каталог/нормализация)

### Frontend — Страницы

| Файл | Назначение |
|-------|-----------|
| `src/pages/products/ProductsPage.tsx` | Главная страница «Прайс и каталог» — 4 вкладки: Товары, Скидки, Импорт, Нормализация |
| `src/pages/products/ProductsTab.tsx` | Вкладка «Товары» — таблица из `product_catalog` (Supabase) |
| `src/pages/products/ImportTab.tsx` | Вкладка «Импорт» — загруженные файлы, статусы джобов |
| `src/pages/products/NormalizationTab.tsx` | Вкладка «Нормализация» — dashboard KPI + история сессий + кнопка «Запустить мастер» |
| `src/pages/products/ImportPriceDialog.tsx` | Диалог загрузки прайс-файла (CSV/XLSX/PDF) |
| `src/pages/products/DiscountRulesTab.tsx` | Вкладка скидок |
| `src/pages/products/PriceQuoteDialog.tsx` | Проверка цены товара |

### Frontend — Компоненты нормализации

| Файл | Назначение |
|-------|-----------|
| `src/components/normalization/NormalizationWizard.tsx` | **КЛЮЧЕВОЙ ФАЙЛ** (1545 строк). Полноэкранный мастер нормализации: категории → таблица товаров → вопросы/AI-чат. Resizable панели |
| `src/components/normalization/AIChatPanel.tsx` | Чат-панель AI-ассистента (компонент для `GroupsSidebar`, не основной — основной чат встроен в Wizard) |
| `src/components/normalization/ClusterTree.tsx` | Дерево кластеров (профиль → толщина → покрытие) |
| `src/components/normalization/ClusterDetailPanel.tsx` | Детали выбранного кластера |
| `src/components/normalization/ConfirmedSettingsEditor.tsx` | Редактор подтверждённых настроек (ширины, алиасы) |
| `src/components/normalization/CatalogTable.tsx` | Таблица каталога |
| `src/components/normalization/GroupsSidebar.tsx` | Боковая панель групп |
| `src/components/normalization/types.ts` | Типы: `CanonicalProduct`, `ProductType`, `AIQuestion`, `ClusterPath` |

### Frontend — Хуки

| Файл | Назначение |
|-------|-----------|
| `src/hooks/use-normalization.ts` | **КЛЮЧЕВОЙ ФАЙЛ** (856 строк). Все API-вызовы нормализации: `executeDryRun`, `confirmActions`, `executeApply`, `sendAiChatV2`, `fetchCatalogItems`, `answerQuestion`, `pollApplyStatus` |
| `src/hooks/use-normalization-flow.ts` | Стейт-машина поверх `use-normalization`: состояния IDLE → SCANNING → QUESTIONS_OPEN → CONFIRMING → APPLY_RUNNING → DONE |
| `src/hooks/use-active-import.ts` | Проверка наличия активного импорта |
| `src/hooks/use-catalog-items.ts` | Загрузка товаров каталога |

### Frontend — Библиотеки

| Файл | Назначение |
|-------|-----------|
| `src/lib/api-client.ts` | **Единый API-слой** — `apiInvoke()` и `invokeEdge()`. Все вызовы Edge Functions через него. Добавляет correlation ID, нормализует ошибки |
| `src/lib/contract-types.ts` | **Контракт v1** — все TypeScript типы для нормализации: `DryRunResult`, `ApplyStatusResult`, `ConfirmAction`, `AiChatV2Result`, `CatalogRow` и т.д. |
| `src/lib/catalog-api.ts` | API каталога — `fetchCatalogItems()`, `fetchCatalogFacets()`, `mergeWithOverrides()` |
| `src/lib/edge-error-utils.ts` | Парсинг ошибок Edge Functions — `parseEdgeFunctionError()`, `isHashMismatch()` |
| `src/lib/confirm-action-guards.ts` | Валидация confirm-действий — проверка WIDTH_MASTER.profile, нормализация payload |
| `src/lib/backend.ts` | Конфигурация импорта — bucket `imports`, форматы файлов, пути Storage |

### Edge Functions (Supabase)

| Функция | Файл | Назначение |
|---------|------|-----------|
| `import-normalize` | `supabase/functions/import-normalize/index.ts` | **ГЛАВНЫЙ ПРОКСИ** (844 строки). Проксирует ВСЕ операции нормализации в Cloud Run. Операции: `dry_run`, `apply`, `apply_status`, `preview_rows`, `ai_chat_v2`, `chat`, `confirm`, `answer_question`, `stats`, `dashboard`, `tree` |
| `catalog-proxy` | `supabase/functions/catalog-proxy/index.ts` | Проксирует запросы к Pricing API (`/api/catalog/items`, `/api/catalog/facets`). JWT + org membership проверка |
| `settings-merge` | `supabase/functions/settings-merge/index.ts` | Deep merge настроек в `bot_settings.settings_json`. Только owner/admin |
| `import-validate` | `supabase/functions/import-validate/index.ts` | Валидация импортного файла через Import Worker (Cloud Run). Получает signed URL из Storage |
| `import-publish` | `supabase/functions/import-publish/index.ts` | Публикация импорта — fire-and-forget вызов Import Worker. Возвращает 202 |
| `normalization-chat` | `supabase/functions/normalization-chat/index.ts` | Standalone AI-чат через Lovable AI Gateway (Gemini). **НЕ ИСПОЛЬЗУЕТСЯ основным потоком** — основной AI идёт через `import-normalize` → Cloud Run |

---

## 🔑 СЕКРЕТЫ (Supabase Edge Function Secrets)

| Секрет | Где используется | Что хранит |
|--------|-----------------|-----------|
| `CATALOG_ENRICHER_URL` | `import-normalize` | URL Cloud Run enricher (main.py) |
| `ENRICH_SHARED_SECRET` | `import-normalize`, `catalog-proxy` | Токен авторизации для Cloud Run |
| `PRICING_API_SAAS_URL` | `catalog-proxy` | URL Pricing API |
| `IMPORT_WORKER_URL` | `import-validate`, `import-publish` | URL Import Worker (Cloud Run) |
| `IMPORT_SHARED_SECRET` | `import-validate`, `import-publish` | Токен для Import Worker |
| `GCP_SERVICE_ACCOUNT_JSON` | Не используется в Edge (только в _shared/) | GCP сервисный аккаунт для BigQuery |
| `LOVABLE_API_KEY` | `normalization-chat` | API-ключ Lovable AI Gateway |

---

## 🔄 ПОТОК НОРМАЛИЗАЦИИ (пошагово)

### 1. Пользователь открывает вкладку «Нормализация»

```
NormalizationTab.tsx
  ↓
  useNormalization({ organizationId }) 
  ↓
  fetchDashboard() → import-normalize (op: 'dashboard') → Cloud Run /api/enrich/dashboard
  ↓
  Показывает KPI: Всего товаров, Готово, Требуют внимания, % готовности
  + Карточки вопросов по типам (WIDTH_MASTER, COATING_MAP и т.д.)
```

### 2. Пользователь нажимает «Запустить мастер»

```
NormalizationWizard.tsx открывается как полноэкранный Dialog
  ↓
  useNormalizationFlow({ organizationId, importJobId })
  ↓
  Автоматически вызывает:
    1) startScan() → executeDryRun() → import-normalize (op: 'dry_run')
    2) fetchCatalogItems() → import-normalize (op: 'preview_rows')
```

### 3. Dry Run (анализ каталога)

```
Frontend: executeDryRun({ limit: 0, aiSuggest: true })
  ↓
  Edge: import-normalize → POST /api/enrich/dry_run
  ↓
  Cloud Run: 
    - Загружает ВСЕ строки из BigQuery (organization_id)
    - Запускает 8-шаговый pipeline:
      1. Guard (отделяет доборные элементы)
      2. Profile extraction (regex)
      3. Kind determination (sheet_kind)
      4. Thickness extraction
      5. Coating identification
      6. Color/RAL recognition
      7. Width lookup
      8. Validation
    - Генерирует вопросы (questions[]) для нераспознанных атрибутов
    - Возвращает patches_sample[], stats{}, questions[]
  ↓
  Frontend получает:
    - run_id (идентификатор сессии)
    - profile_hash (хэш текущих настроек — для обнаружения изменений)
    - questions[] — массив вопросов
    - stats: { rows_scanned, patches_ready, candidates }
```

### 4. Пользователь отвечает на вопросы

```
Вопросы бывают:
  - WIDTH_MASTER: «Какие ширины у профиля С8?» → {profile: "С8", full_mm: 1200, work_mm: 1150}
  - COATING_MAP: «Что значит MatPE?» → {token: "MatPE", canonical: "Матовый полиэстер"}
  - COLOR_MAP: «Какой это цвет?» → {token: "вишня", canonical: "RAL3005"}
  - THICKNESS_SET: «Какая толщина у НС35?» → {token: "НС35", value: 0.5}
  - PROFILE_MAP: «Какой это профиль?» → {token: "Монт", canonical: "Monterrey"}
  
Ответ отправляется через:
  confirmActions([{ type: "WIDTH_MASTER", payload: { profile: "С8", full_mm: 1200, work_mm: 1150 }}])
  ↓
  import-normalize (op: 'confirm', actions: [...])
  ↓
  Cloud Run /api/enrich/confirm → сохраняет в bot_settings.settings_json.pricing через settings-merge
```

### 5. Apply (применение изменений)

```
Frontend: executeApply()
  ↓
  import-normalize (op: 'apply', run_id, profile_hash)
  ↓
  Cloud Run: /api/enrich/apply_start (async) или /api/enrich/apply (sync fallback)
  ↓
  Возвращает apply_id
  ↓
  Frontend начинает polling:
    pollApplyStatus(apply_id) каждые 3 секунды
    → import-normalize (op: 'apply_status')
    → GET /api/enrich/apply_status
    → Возвращает: status (QUEUED|RUNNING|DONE|FAILED), progress_percent, phase
  ↓
  Ограничения polling: макс 7 минут, макс 300 запросов, макс 3 ошибки подряд
```

### 6. AI Chat (ИИ-ассистент)

```
Пользователь пишет в чат: "Установи покрытие MattPE → Матовый полиэстер"
  ↓
  sendAiChatV2(message, context)
  ↓
  import-normalize (op: 'ai_chat_v2', message, context)
  ↓
  Cloud Run /api/enrich/ai_chat_v2 (если доступен)
    ИЛИ fallback → /api/enrich/chat (legacy regex-парсер)
  ↓
  Возвращает:
    - assistant_message: "Установлено покрытие..."
    - actions: [{ type: "COATING_MAP", payload: { token: "MattPE", canonical: "Матовый полиэстер" }}]
  ↓
  Пользователь нажимает «Применить» → confirmActions(actions)
```

---

## 🔧 EDGE FUNCTION `import-normalize` — ДЕТАЛЬНЫЙ РАЗБОР

Это **центральный прокси** (844 строки). Все нормализационные операции идут через него.

### Безопасность (каждый запрос):
1. Проверяет JWT (`Authorization: Bearer ...`)
2. Проверяет членство в организации (profiles таблица)
3. Для `dry_run`, `apply`, `apply_status` — проверяет import_job принадлежность
4. Добавляет `X-Internal-Secret` в запросы к Cloud Run

### Операции:

| op | Cloud Run endpoint | Метод | Таймаут |
|----|-------------------|-------|---------|
| `dry_run` | `/api/enrich/dry_run` | POST | 55с |
| `apply` | `/api/enrich/apply_start` → fallback `/api/enrich/apply` | POST | 10с / 55с |
| `apply_status` | `/api/enrich/apply_status` | GET | 15с |
| `preview_rows` | `/api/enrich/preview_rows` | POST | 30с |
| `ai_chat_v2` | `/api/enrich/ai_chat_v2` → fallback `/api/enrich/chat` | POST | 45с |
| `chat` | `/api/enrich/chat` | POST | 45с |
| `confirm` | `/api/enrich/confirm` (batch → fallback sequential) | POST | 30с |
| `answer_question` | `/api/enrich/answer_question` | POST | 30с |
| `stats` | `/api/enrich/stats` | POST | 30с |
| `dashboard` | `/api/enrich/dashboard` | POST | 30с |
| `tree` | `/api/enrich/tree` | GET | 20с |

### Особенности:
- **Contract v1**: Все ответы оборачиваются в `{ ..., contract_version: "v1" }`
- **Question normalization**: Маппит legacy-поля (`ask`, `affected_count`) в v1-поля (`question_text`, `affected_rows_count`)
- **Confirm fallback**: Если batch confirm (actions[]) не поддерживается бэкендом (404), выполняет последовательные single confirms
- **AI fallback**: Если `/api/enrich/ai_chat_v2` возвращает 404, падает на legacy `/api/enrich/chat`

---

## 📊 ТАБЛИЦЫ SUPABASE (связанные с каталогом)

| Таблица | Назначение |
|---------|-----------|
| `product_catalog` | Товары с Supabase overrides (is_active, base_price) |
| `discount_rules` | Правила скидок |
| `import_jobs` | Журнал импортов — статус, файл, итоги |
| `import_errors` | Ошибки импорта (строка, тип, сообщение) |
| `import_staging_rows` | Промежуточные строки импорта |
| `bot_settings` | Настройки организации. **settings_json.pricing** — правила нормализации |
| `enrich_ai_actions_log` | Лог AI-действий |
| `enrich_ai_sessions` | Сессии AI |
| `enrich_user_decisions` | Решения пользователя по вопросам |
| `ral_colors` | Справочник RAL-цветов |
| `color_group_rules` | Наценки по группам цветов |

### Ключевая таблица: `bot_settings.settings_json.pricing`

```json
{
  "pricing": {
    "widths_selected": {
      "С8": { "work_mm": 1150, "full_mm": 1200 },
      "МП20": { "work_mm": 1100, "full_mm": 1150 }
    },
    "profile_aliases": {
      "Монт": "Monterrey",
      "Монтеррей": "Monterrey"
    },
    "coatings": {
      "MatPE": "Матовый полиэстер",
      "PE": "Полиэстер"
    },
    "colors": {
      "ral_aliases": { "вишня": "RAL3005" },
      "decor_aliases": { "Античный дуб": { "kind": "DECOR", "label": "Античный дуб" } }
    }
  }
}
```

Эти правила:
- Записываются через Edge Function `settings-merge` (deep merge)
- Читаются Cloud Run enricher при `dry_run` и `apply`
- Определяют, как нормализуются товары

---

## 🗃 BIGQUERY (внешнее хранилище данных)

- **Проект**: `my-project-39021-1686504586397`
- **Датасет**: `roofing_saas`
- **Таблицы**:
  - `master_products_current` — текущий каталог (70k+ SKU)
  - `master_products_history` — история с `version_id`
- **Фильтр**: Всегда `WHERE organization_id = ?`
- **Стратегия публикации**: Delete-before-Insert (удаляет все записи org, затем вставляет новые)

---

## ⚡ CLOUD RUN BACKEND (main.py)

**URL**: хранится в секрете `CATALOG_ENRICHER_URL`  
**Размер**: ~3932 строки Python  
**Фреймворк**: FastAPI  

### Основные endpoints:

| Endpoint | Метод | Назначение |
|----------|-------|-----------|
| `/api/enrich/dry_run` | POST | Анализ каталога, генерация вопросов |
| `/api/enrich/apply_start` | POST | Асинхронный запуск применения |
| `/api/enrich/apply` | POST | Синхронное применение (fallback) |
| `/api/enrich/apply_status` | GET | Статус применения |
| `/api/enrich/preview_rows` | POST | Постраничная загрузка строк с фильтрами |
| `/api/enrich/confirm` | POST | Подтверждение правил (batch/single) |
| `/api/enrich/answer_question` | POST | Ответ на единичный вопрос |
| `/api/enrich/dashboard` | POST | KPI сводка |
| `/api/enrich/tree` | GET | Дерево категорий |
| `/api/enrich/stats` | POST | Метрики качества |
| `/api/enrich/chat` | POST | Legacy regex-парсер команд |
| `/api/enrich/voice_command` | POST | Обёртка над /chat |
| `/api/catalog/items` | GET | Список товаров каталога |
| `/api/catalog/facets` | GET | Фасеты для фильтров |

### Pipeline нормализации (8 шагов):
1. **Guard** — отделяет доборные элементы от листовых
2. **Profile extraction** — regex: С8, НС35, МП20, Монтеррей...
3. **Kind determination** — PROFNASTIL, METAL_TILE, ACCESSORY, SANDWICH
4. **Thickness** — 0.4, 0.45, 0.5, 0.55, 0.7
5. **Coating** — Полиэстер, Пурал, PVDF, Оцинковка
6. **Color/RAL** — RAL3005, RAL8017, RR32
7. **Width** — из справочника ширин по профилю
8. **Validation** — Ready ✅ или Needs Attention ⚠️

---

## ⚠️ ТЕКУЩИЕ ПРОБЛЕМЫ И НЕЗАВЕРШЁННЫЕ ЗАДАЧИ

### 1. AI Chat — НЕ подключён настоящий ИИ ‼️

**Проблема**: Endpoint `/api/enrich/chat` на Cloud Run — это **regex-парсер**, НЕ ИИ. Он распознаёт только фиксированные шаблоны команд.

**Что нужно**: Реализовать `/api/enrich/ai_chat_v2` на Cloud Run с использованием **Vertex AI (Gemini)**:
- Умное определение профилей по контексту
- Анализ неизвестных товаров
- Предложение маппингов покрытий и цветов

**ТЗ**: `docs/codex-tasks/PR7-AI-CHAT-ENDPOINT.md`

**Статус Edge Function**: `import-normalize` уже поддерживает `ai_chat_v2` op и автоматически fallback-ит на legacy `/chat`. Когда бэкенд реализует `/api/enrich/ai_chat_v2`, фронт заработает автоматически.

### 2. Мёртвый код в main.py

**Проблема**: 
- `/api/enrich/chat` (строки 3731-3901) — regex-парсер, загружает ВЕСЬ каталог на каждый запрос
- `/api/enrich/voice_command` (строки 3904-3932) — обёртка над /chat
- `model_rebuild()` (строки 250, 261) — Pydantic v1 артефакт
- `_quality_stats()` Python-версия (строки 1928-1960) — дубль SQL-версии

**ТЗ**: `docs/codex-tasks/PR6-DEAD-CODE-CLEANUP.md`

### 3. Edge Function `normalization-chat` — НЕ ИНТЕГРИРОВАНА

**Файл**: `supabase/functions/normalization-chat/index.ts`

Эта Edge Function использует **Lovable AI Gateway** (Gemini 3 Flash) для AI-чата. Но она:
- НЕ вызывается из основного потока
- Использует **streaming** (SSE), который не совместим с текущим UI
- Не имеет доступа к `run_id` и сессии нормализации

**Как используется**: Standalone чат через `normalization-chat` Edge Function. 
**Как должно быть**: AI-чат идёт через `import-normalize` → Cloud Run `/api/enrich/ai_chat_v2`.

### 4. Дублирование AIChatPanel

Есть ДВА компонента AI-чата:
1. `src/components/normalization/AIChatPanel.tsx` (388 строк) — standalone, используется через `GroupsSidebar`
2. Встроенный `AIChatPanel` внутри `NormalizationWizard.tsx` (строки 439-641) — основной

**Рекомендация**: Вынести встроенный чат в отдельный компонент и удалить дублирование.

### 5. NormalizationWizard.tsx слишком большой

1545 строк в одном файле. Включает:
- Хелпер-функции классификации (regex)
- Sub-компоненты (QuestionCard, QuestionAnswerForm, AIChatPanel, CategorySidebar, KpiTile)
- Основной компонент с логикой состояния

**Рекомендация**: Разбить на:
- `components/normalization/wizard/QuestionCard.tsx`
- `components/normalization/wizard/QuestionAnswerForm.tsx`
- `components/normalization/wizard/AIChatPanel.tsx`
- `components/normalization/wizard/CategorySidebar.tsx`
- `components/normalization/wizard/helpers.ts` (regex, categorization)
- `components/normalization/wizard/NormalizationWizard.tsx` (оркестрация)

### 6. contract-types.ts растёт (364 строки)

Файл содержит ВСЕ типы. Пока терпимо, но при добавлении AI v2 типов стоит разделить:
- `contract-types/normalization.ts`
- `contract-types/catalog.ts`
- `contract-types/api.ts`

### 7. catalog-proxy НЕ передаёт ENRICH_SHARED_SECRET

В `catalog-proxy/index.ts` нет заголовка `X-Internal-Secret` при запросах к Pricing API. Если Pricing API требует авторизацию — запросы будут отклонены.

**Проверить**: Нужна ли авторизация для `/api/catalog/items` и `/api/catalog/facets`.

### 8. import-publish — fire-and-forget без гарантий

Edge Function `import-publish` отправляет запрос к Import Worker и сразу возвращает 202. Если Worker упал — job помечается FAILED через `.catch()`. Но если Edge Function сама упала после отправки fetch — Worker может выполнить работу, но status не обновится.

---

## 🔐 БЕЗОПАСНОСТЬ

### Что реализовано ✅:
- JWT проверка во всех Edge Functions
- Organization membership проверка (profiles таблица)
- Роли owner/admin для settings-merge и import-publish
- Секреты НЕ экспонируются во фронтенд
- RLS на всех таблицах Supabase

### Что НЕ реализовано ⚠️:
- ILIKE-запросы без санитизации `%` и `_` (SQL injection risk)
- `profiles` SELECT policy не проверяет org membership
- Финансовые данные (invoices, orders) не ограничены по ролям через RLS

### Конфигурация:
- Фронтенд использует ТОЛЬКО `anon key` + JWT пользователя
- `service_role` НИКОГДА не передаётся в браузер
- Все секреты Cloud Run (URL, токены) — только в Supabase Edge Function Secrets

---

## 📦 ИМПОРТ ФАЙЛОВ — ПОТОК

```
1. Пользователь загружает файл (CSV/XLSX/PDF)
   ↓
2. Файл → Supabase Storage bucket 'imports' ({org_id}/{job_id}/price_{job_id}.xlsx)
   ↓
3. Создаётся import_jobs запись (status: QUEUED)
   ↓
4. import-validate Edge Function:
   - Получает signed URL файла из Storage
   - Отправляет в Import Worker (Cloud Run)
   - Worker парсит файл, проверяет колонки
   - Если нет обязательных колонок → MISSING_REQUIRED_COLUMNS → UI показывает маппинг
   - Если OK → status: VALIDATED
   ↓
5. import-publish Edge Function:
   - Fire-and-forget → Import Worker
   - Worker: Delete-before-Insert в BigQuery
   - status: APPLYING → COMPLETED/FAILED
   ↓
6. После публикации → Нормализация (dry_run + apply)
```

---

## 🧪 ТЕСТЫ

| Файл | Что тестирует |
|------|-------------|
| `src/test/normalization-confirm.test.ts` | `normalizeAndValidateConfirmActions()` — валидация confirm-действий, проверка WIDTH_MASTER.profile |
| `src/test/example.test.ts` | Пример теста |

**Запуск**: `bunx vitest` или через Lovable UI

---

## 🌐 i18n

- Языки: RU (основной), EN
- Файлы: `src/i18n/locales/ru.json`, `src/i18n/locales/en.json`
- Библиотека: `i18next` + `react-i18next`
- **НЕ ВСЕ** строки переведены в нормализации — часть захардкожена на русском (QuestionCard, CategorySidebar)

---

## 📚 ДОКУМЕНТАЦИЯ (существующие файлы)

| Файл | Содержание |
|------|-----------|
| `docs/ARCHITECTURE_OVERVIEW.md` | Общая архитектура фронтенда |
| `docs/INTEGRATION_POINTS.md` | Точки интеграции frontend ↔ backend |
| `docs/NORMALIZATION_MASTER_SPEC.md` | Мастер-спецификация нормализации (v7.0) |
| `docs/EDGE_CONTRACTS.md` | Контракты Edge Functions |
| `docs/EDGE_DEVTOOLS_PAYLOADS.md` | Реальные JSON payloads для отладки |
| `docs/CODEX_TASK_FULL_FIX.md` | ТЗ стабилизации февраль 2025 |
| `docs/codex-tasks/PR1-PR8` | ТЗ для рефакторинга main.py |
| `docs/codex-tasks/AUDIT-POST-PR5.md` | Аудит после PR1-PR5 |

---

## 🚀 БЫСТРЫЙ СТАРТ ДЛЯ РАЗРАБОТЧИКА

### Чтобы понять систему:
1. Прочитай `docs/NORMALIZATION_MASTER_SPEC.md`
2. Открой `src/hooks/use-normalization.ts` — все API-вызовы тут
3. Открой `supabase/functions/import-normalize/index.ts` — как прокси работает
4. Открой `src/components/normalization/NormalizationWizard.tsx` — основной UI

### Чтобы отладить:
1. Логи Edge Functions: Supabase Dashboard → Functions → import-normalize → Logs
2. Логи Cloud Run: GCP Console → Cloud Run → Logs
3. Фронтенд: Console → ищи `[import-normalize]`, `[polling]`, `[fetchCatalogItems]`
4. Корреляция: Каждый запрос имеет `x-correlation-id` (UUID)

### Чтобы добавить новый тип вопроса:
1. Добавь тип в `src/lib/contract-types.ts` → `QuestionType`
2. Добавь конфиг в `NormalizationWizard.tsx` → `Q_TYPE_CONFIG`
3. Добавь маппинг в `mapQuestionType()`
4. Бэкенд: добавь обработку в main.py → `build_questions_v2()`

### Чтобы подключить настоящий AI:
1. Реализуй `/api/enrich/ai_chat_v2` в main.py (ТЗ: `docs/codex-tasks/PR7-AI-CHAT-ENDPOINT.md`)
2. Фронтенд и Edge Function уже готовы — fallback автоматически переключится

---

## 📌 ИТОГО: ЧТО РАБОТАЕТ И ЧТО НЕТ

| Функция | Статус | Примечание |
|---------|--------|-----------|
| Загрузка прайса (CSV/XLSX/PDF) | ✅ Работает | Через import-validate → import-publish |
| Нормализация (dry_run + questions) | ✅ Работает | 70k+ SKU, regex-классификация |
| Ответы на вопросы (confirm) | ✅ Работает | Batch confirm через settings-merge |
| Apply (применение) | ✅ Работает | Async polling с fallback |
| AI Chat (ИИ-ассистент) | ⚠️ Частично | Legacy regex-парсер. Настоящий AI (Gemini) не подключён |
| Dashboard KPI | ✅ Работает | total/ready/needs_attention |
| Каталог (просмотр товаров) | ✅ Работает | Через catalog-proxy → Pricing API |
| Скидки | ✅ Работает | CRUD через Supabase |
| Автоматическое определение профилей | ❌ Не работает | Требует AI endpoint (PR7) |
| Streaming AI Chat | ❌ Не работает | normalization-chat Edge Function не интегрирована |
