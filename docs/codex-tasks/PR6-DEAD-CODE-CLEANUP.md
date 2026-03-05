# PR-6: Финальная чистка мёртвого кода

**Файл**: `services/catalog-enricher/main.py` (3932 строк)
**Приоритет**: P1 — cleanup before AI integration
**Оценка**: -250 строк (чистое удаление)
**Риск**: Низкий
**Зависимость**: Нет (независимый PR)

---

## КОНТЕКСТ

После PR1-PR5 в main.py остались артефакты, мёртвый код и устаревшие эндпоинты.
Удаление обязательно ПЕРЕД добавлением нового AI-эндпоинта (PR-7).

---

## ЗАДАЧИ

### 1. Удалить `ConfirmRequest.model_rebuild()` (строка 250)

```python
# УДАЛИТЬ эту строку:
ConfirmRequest.model_rebuild()
```

### 2. Удалить `AnswerQuestionRequest.model_rebuild()` (строка 261)

```python
# УДАЛИТЬ эту строку:
AnswerQuestionRequest.model_rebuild()
```

### 3. Удалить `/api/enrich/chat` endpoint (строки 3731-3901)

**Как найти**: `@app.post("/api/enrich/chat")`
**Причина**: Детерминистический regex-парсер, НЕ AI. Фронтенд использует Edge Function `normalization-chat`. Этот endpoint не вызывается из UI.

**УДАЛИТЬ ЦЕЛИКОМ**: от `@app.post("/api/enrich/chat")` (строка 3731) до конца функции `chat()` (строка 3901).

Также удалить:
- Все внутренние вложенные функции: `_preview_titles()`, `_preview_profile_widths()`, `_preview_profile_thickness()`, `_preview_stats()` — они определены ВНУТРИ `chat()`.

### 4. Удалить `/api/enrich/voice_command` endpoint (строки 3904-3932)

**Как найти**: `@app.post("/api/enrich/voice_command")`
**Причина**: Обёртка над `/chat`, который удаляется в п.3.
**Действие**: Удалить весь endpoint + Pydantic модель `VoiceCommandRequest` (строки 235-240).

### 5. Удалить Pydantic модели для удалённых эндпоинтов

Удалить:
- `class ChatRequest` (строки 222-227) — использовался только в `/api/enrich/chat`
- `class VoiceCommandRequest` (строки 235-240) — использовался только в `/api/enrich/voice_command`

**Проверка**: Поиск по файлу `ChatRequest` и `VoiceCommandRequest` — убедиться что нет других вызовов.

### 6. Удалить `_quality_stats()` Python-версию (строки 1928-1960)

**Как найти**: `def _quality_stats(df: pd.DataFrame,`
**Причина**: Заменена на `_quality_stats_sql()` (строки 1963-2040) в PR-4.

**Проверка перед удалением**: Поиск `_quality_stats(` (без `_sql`) в файле.
- Если вызывается из `_tree_and_progress()` или других мест — НЕ удалять, а пометить `# TODO: replace with SQL version`.
- Если не вызывается — удалить.

**ВАЖНО**: `_tree_and_progress()` (строка 2048) всё ещё использует `classify_cached` в цикле. Это отдельная задача (PR-8 будущий), не трогать в этом PR.

### 7. Проверить неиспользуемые импорты

После удаления кода проверить:
```python
# Кандидаты на удаление:
# - Если VoiceCommandRequest удалён, нет больше нужды в его импортах
# - Если ChatRequest удалён
```

---

## ТЕСТ-ЧЕКЛИСТ

```bash
# 1. Приложение запускается:
python main.py
# ✅ FastAPI стартует, health endpoint отвечает 200

# 2. Удалённые эндпоинты отдают 404:
curl -X POST .../api/enrich/chat \
  -H "X-Internal-Secret: $SECRET" \
  -d '{"organization_id":"...","message":"test"}'
# ✅ 404 или 405

curl -X POST .../api/enrich/voice_command \
  -H "X-Internal-Secret: $SECRET" \
  -d '{"organization_id":"...","transcript":"test"}'
# ✅ 404 или 405

# 3. Оставшиеся эндпоинты работают:
curl .../health
# ✅ 200

curl -X POST .../api/enrich/preview_rows \
  -H "X-Internal-Secret: $SECRET" \
  -d '{"organization_id":"...","limit":50}'
# ✅ 200

curl -X POST .../api/enrich/dry_run \
  -H "X-Internal-Secret: $SECRET" \
  -d '{"organization_id":"...","import_job_id":"test","scope":{}}'
# ✅ 200

curl -X POST .../api/enrich/confirm \
  -H "X-Internal-Secret: $SECRET" \
  -d '{"organization_id":"...","import_job_id":"test","actions":[{"type":"WIDTH_MASTER","payload":{"profile":"С8","work_mm":1150,"full_mm":1200}}]}'
# ✅ 200
```

---

## НЕ ТРОГАТЬ

- НЕ менять preview_rows, dry_run, confirm, apply, apply_start, apply_status, apply_worker, answer_question
- НЕ менять classify(), build_questions_v2()
- НЕ менять SQL запросы
- НЕ менять _tree_and_progress()
- НЕ менять Vertex AI / gemini_suggest logic
