# PR-3: Удаление мёртвого кода

**Файл**: `services/catalog-enricher/main.py`
**Приоритет**: P2 — cleanup
**Оценка**: -200 строк (чистое удаление)
**Риск**: Нулевой (код не используется)
**Зависимость**: После PR-2

---

## КОНТЕКСТ

main.py содержит ~200 строк мёртвого кода: устаревшие функции, дублирующие утилиты и артефакты дебага. Удаление упрощает файл и снижает когнитивную нагрузку.

---

## ЗАДАЧИ

### 1. Удалить `build_questions()` v1 (строки ~1655-1722)

**Как найти**: Функция `def build_questions(` (НЕ `build_questions_v2`).
**Причина удаления**: Полностью заменена `build_questions_v2()`. Не вызывается нигде в коде.
**Действие**: Удалить определение функции целиком (~70 строк).

**Проверка перед удалением**: Поиск по файлу `build_questions(` (без `_v2`) — убедиться что нет вызовов.

---

### 2. Удалить эндпоинт `/api/enrich/questions` (строки ~3067-3090)

**Как найти**: `@app.post("/api/enrich/questions")` или `def questions_v2(`.
**Причина удаления**: Дублирует логику dry_run — загружает ВСЕ 71k строк + classify loop. Фронтенд уже получает questions из dry_run response.
**Действие**: Удалить весь эндпоинт (~25 строк).

---

### 3. Удалить дубль `normalize_base_url()` / `canonical_base_url()` (строки ~2525 и ~2540)

**Как найти**: Две функции с похожими названиями: `normalize_base_url` и `canonical_base_url`.
**Причина удаления**: Обе делают одно и то же — формируют base URL из ENV.
**Действие**:
1. Оставить ОДНУ функцию, назвать `_public_base_url()`:
```python
def _public_base_url() -> str:
    return (os.getenv("PUBLIC_BASE_URL") or os.getenv("SERVICE_BASE_URL") or "").rstrip("/")
```
2. Заменить все вызовы `normalize_base_url(...)` и `canonical_base_url(...)` на `_public_base_url()`.
3. Удалить обе старые функции.

---

### 4. Удалить `ConfirmRequest.model_rebuild()` (строка ~259)

**Как найти**: `ConfirmRequest.model_rebuild()`.
**Причина удаления**: Артефакт Pydantic v1, не нужен в v2.
**Действие**: Удалить строку.

---

### 5. Удалить debug print (строка ~3695)

**Как найти**:
```python
print("!!! VERSION: FEB-07-v2-FIXED-HTTPS !!!")
```
**Причина удаления**: Артефакт дебага.
**Действие**: Удалить или заменить на:
```python
import logging
logger = logging.getLogger("enricher")
logger.info("enricher started", extra={"version": "v4"})
```

---

### 6. Удалить неиспользуемые импорты

После удаления вышеуказанного кода, проверить неиспользуемые импорты. Типичные кандидаты:
- Импорты связанные с build_questions v1
- Импорты связанные с удалёнными функциями

---

## ТЕСТ-ЧЕКЛИСТ

```bash
# 1. Приложение запускается без ошибок:
python main.py
# ✅ FastAPI стартует, health endpoint отвечает 200

# 2. Все оставшиеся эндпоинты работают:
curl .../api/enrich/health
# ✅ 200

curl -X POST .../api/enrich/preview_rows \
  -H "X-Internal-Secret: $SECRET" \
  -d '{"organization_id":"...","limit":50}'
# ✅ 200, данные возвращаются

curl -X POST .../api/enrich/dry_run \
  -H "X-Internal-Secret: $SECRET" \
  -d '{"organization_id":"...","scope":{}}'
# ✅ 200, questions присутствуют

# 3. Удалённый endpoint отвечает 404/405:
curl -X POST .../api/enrich/questions
# ✅ 404 (эндпоинт удалён)
```

---

## НЕ ТРОГАТЬ

- НЕ менять логику работающих функций
- НЕ менять SQL запросы
- НЕ менять Pydantic модели
- НЕ менять эндпоинты которые остаются
- НЕ удалять ai_chat_v2 (будет удалён в PR-5)
