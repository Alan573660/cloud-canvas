# Evals для нормализации

Этот документ описывает бизнес-тесты для регрессий в цепочке **questions / patches / apply**.

## Структура

- `tests/evals/harness.py` — офлайн-harness (детерминированный, без Gemini).
- `tests/evals/offline/` — стабильные тесты, должны проходить всегда.
- `tests/evals/ai_slow/` — опциональные медленные AI-тесты.
- `tests/evals/fixtures/` — JSON-фикстуры кейсов.

## Что делает harness

`evaluate_title(EvalInput(...))` принимает входной `title` и возвращает:

- `extracted_fields` — извлечённые/нормализованные поля;
- `questions` — вопросы для user-in-the-loop;
- `suggested_patches` — предложенные патчи.

Офлайн-режим использует только детерминированные правила (regex + simple mapping), поэтому не зависит от внешнего AI и стабилен в CI.

## Как запускать

### Только offline (рекомендуется, и используется по умолчанию)

```bash
pytest -q tests/evals/offline
```

или

```bash
pytest -q
```

(`ai_slow` исключён через `pytest.ini`.)

### Запуск ai_slow

```bash
ENABLE_AI_EVALS=1 pytest -q -m ai_slow tests/evals/ai_slow
```

Если переменная не задана, тесты `ai_slow` будут `skip`.

## Почему AI-тесты optional

- AI может быть недоступен в окружении (ключи/квоты/сеть).
- Ответы AI могут быть менее стабильными, чем deterministic правила.
- Поэтому регрессионный baseline держим в `offline`, а `ai_slow` запускаем отдельно как расширенную проверку.
