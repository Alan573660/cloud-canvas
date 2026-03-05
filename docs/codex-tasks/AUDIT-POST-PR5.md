# Аудит main.py после выполнения PR1-PR5

**Файл**: `services/catalog-enricher/main.py` (3932 строки, было 4064 → -132 строки)
**Дата аудита**: 2026-03-05

---

## СВОДКА ПО PR

| PR | Статус | Примечания |
|----|--------|------------|
| PR-1: Contract Fixes | ✅ ВЫПОЛНЕН | limit 5000, by_kind объект, color_system в ready, contract_version v1, фильтры, price_rub_m2, rows_total COUNT(*) |
| PR-2: Performance Caches | ✅ ВЫПОЛНЕН | Singleton BQ client (стр.311-318), fq_table cache (363-370), bot_profile TTL 30s (1101-1117), dim_aliases TTL 300s (321-360), classify cache (721-747) |
| PR-3: Dead Code Removal | ⚠️ ЧАСТИЧНО | build_questions v1 удалён, /api/enrich/questions удалён, URL helpers консолидированы. НО: model_rebuild() осталось (стр.250,261) |
| PR-4: SQL Aggregation | ✅ ВЫПОЛНЕН | _quality_stats_sql (1963-2040), COUNT(1) OVER() в preview_rows (2818), global_facets TTL cache (2695-2739) |
| PR-5: Confirm proxy + AI chat | ⚠️ ЧАСТИЧНО | confirm → settings-merge proxy ✅ (3188-3236), _actions_to_settings_patch ✅ (750-805), cache invalidation ✅. НО: /api/enrich/chat (3731-3901) и /api/enrich/voice_command (3904-3932) остались |

---

## ОСТАВШИЕСЯ ПРОБЛЕМЫ

### 1. Мёртвый код (мелкие артефакты)

| Строка | Код | Причина |
|--------|-----|---------|
| 250 | `ConfirmRequest.model_rebuild()` | Артефакт Pydantic v1, не нужен в v2 |
| 261 | `AnswerQuestionRequest.model_rebuild()` | Артефакт Pydantic v1 |

### 2. /api/enrich/chat — НЕ является AI-чатом

Текущий `/api/enrich/chat` (строки 3731-3901) — это **детерминистический regex-парсер**, НЕ AI.
Он парсит команды типа:
- `"MatPE это Полиэстер"` → COATING_MAP
- `"С-20: рабочая 1100 полная 1150"` → WIDTH_MASTER
- `"для НС-35 толщина 0.5"` → THICKNESS_SET

**Проблемы**:
- Не использует Gemini/Vertex AI для умного анализа
- Не может определить профиль товара по контексту
- Загружает ВЕСЬ каталог (`fetch_current(org, limit=0)`) на каждый запрос — ресурсоёмко
- Выполняет `classify()` в цикле по ВСЕМ строкам для каждой preview-функции

### 3. /api/enrich/voice_command (3904-3932) — обёртка над /chat

Просто пробрасывает `transcript` в `/chat`. Зависит от мёртвого кода.

### 4. _quality_stats() Python-версия всё ещё существует (1928-1960)

Рядом с SQL-версией `_quality_stats_sql()` (1963-2040) осталась старая Python-версия `_quality_stats()`, которая итерирует все строки DataFrame. Она ещё **используется** в `_tree_and_progress()` — но может быть заменена.

### 5. Нет AI-эндпоинта для умного определения профилей

Текущая архитектура:
- `classify()` определяет профиль детерминистически (regex)
- `build_questions_v2()` генерирует вопросы PROFILE_MAP для нераспознанных
- **Нет** AI-агента, который может интерактивно определять профиль по контексту названия товара

**Что нужно**: Endpoint `/api/enrich/ai_chat_v2` который:
1. Получает `message` + `context` (текущая группа, примеры, нерешённые вопросы)
2. Вызывает Gemini для анализа
3. Возвращает `actions[]` для batch-confirm
4. Может определить профиль по контексту: "Лист 0.5 1100x1150 RAL3005 Монтеррей" → profile=MONTERREY

---

## СТАТИСТИКА КОДА

- **Всего строк**: 3932
- **Удалено из 4064**: 132 строки (3.2%)
- **Цель**: удалить ещё ~400 строк (chat + voice_command + дубли)
- **Потенциальный размер после PR-6 + PR-7**: ~3500 строк
