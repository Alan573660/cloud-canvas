# PR-5: Confirm → settings-merge proxy + удаление ai_chat_v2

**Файл**: `services/catalog-enricher/main.py`
**Приоритет**: P1 — architecture
**Оценка**: ~80 строк добавлено, ~400 строк удалено = net -320 строк
**Риск**: Средний
**Зависимость**: После PR-4

---

## КОНТЕКСТ

Две архитектурные проблемы:
1. **confirm** — прямая мутация `bot_settings.settings_json` в Python memory → race condition при параллельных запросах
2. **ai_chat_v2** — 200 строк NLP + Gemini в main.py → мигрирует в Edge Function `normalization-chat`

---

## ЗАДАЧИ

### 1. Confirm → прокси к settings-merge Edge Function

**Найти** функцию confirm endpoint (строки ~3122-3400). Текущая логика:
```python
# Читает bot_settings через REST
settings_json = bot_settings.get("settings_json") or {}
# Мутирует в Python memory
settings_json["pricing"]["widths_selected"]["C8"] = {"work_mm": 1150, ...}
# Записывает обратно через PATCH
sb_update_bot_settings(org, settings_json)
```

**Заменить ВСЮ логику** на прокси:

```python
@app.post("/api/enrich/confirm")
def confirm(
    req: ConfirmRequest,
    x_internal_secret: Optional[str] = Header(default=None, alias="X-Internal-Secret"),
):
    require_secret(x_internal_secret)
    org = req.organization_id

    # Собрать actions: либо batch (req.actions), либо single (req.type + req.payload)
    actions = req.actions or []
    if not actions and req.type:
        actions = [{"type": req.type, "payload": req.payload or {}}]

    if not actions:
        return _response({"ok": False, "error": "no actions provided"})

    # Конвертировать actions → settings patch
    settings_patch = _actions_to_settings_patch(actions)

    if not settings_patch:
        return _response({"ok": True, "type": "NOOP", "organization_id": org})

    # Вызвать settings-merge Edge Function
    supabase_url = os.getenv("SUPABASE_URL", "")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

    if not supabase_url or not service_key:
        raise HTTPException(status_code=500, detail="SUPABASE_URL/SERVICE_ROLE_KEY not configured")

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
        error_body = resp.text[:500]
        raise HTTPException(status_code=502, detail=f"settings-merge failed ({resp.status_code}): {error_body}")

    # Инвалидировать кеши
    _profile_cache.pop(org, None)
    _global_facets_cache.pop(org, None)

    return _response({
        "ok": True,
        "type": "BATCH",
        "organization_id": org,
        "affected_clusters": [a.get("type") for a in actions],
        "actions_count": len(actions),
    })
```

### 2. Добавить `_actions_to_settings_patch()`

```python
def _actions_to_settings_patch(actions: List[Dict]) -> Dict:
    """Convert confirm actions to a settings_json.pricing patch for settings-merge."""
    patch = {}
    for action in actions:
        t = action.get("type", "")
        p = action.get("payload", {})

        if t == "WIDTH_MASTER":
            profile = p.get("profile", "")
            if profile:
                work_mm = p.get("work_mm")
                full_mm = p.get("full_mm")
                # Формат: "full:work" или объект
                if isinstance(p.get("value"), str) and ":" in p["value"]:
                    parts = p["value"].split(":")
                    full_mm = int(parts[0])
                    work_mm = int(parts[1])
                patch.setdefault("widths_selected", {})[profile] = {
                    "work_mm": work_mm,
                    "full_mm": full_mm,
                }

        elif t == "THICKNESS_SET":
            values = p.get("values") or p.get("value")
            if values:
                if isinstance(values, str):
                    values = [float(v.strip()) for v in values.split(",") if v.strip()]
                patch["thickness_set"] = values

        elif t == "COATING_MAP":
            token = p.get("token", "")
            value = p.get("value", "")
            if token:
                patch.setdefault("coatings", {})[token] = value

        elif t == "COLOR_MAP":
            token = p.get("token", "")
            ral = p.get("ral", "") or p.get("value", "")
            if token:
                patch.setdefault("colors", {}).setdefault("ral_aliases", {})[token] = ral

        elif t == "PROFILE_MAP":
            alias = p.get("alias", "") or p.get("token", "")
            canonical = p.get("canonical", "") or p.get("value", "")
            if alias and canonical:
                patch.setdefault("profile_aliases", {})[alias] = canonical

        elif t == "RAL_WHITELIST":
            codes = p.get("codes") or p.get("value")
            if codes:
                if isinstance(codes, str):
                    codes = [c.strip() for c in codes.split(",") if c.strip()]
                patch.setdefault("colors", {})["ral_whitelist"] = codes

    return patch
```

---

### 3. Удалить ai_chat_v2 + chat helpers

**Найти и удалить**:
1. Эндпоинт `@app.post("/api/enrich/ai_chat_v2")` или `def ai_chat_v2(` (строки ~3700-3900)
2. Вспомогательные функции для chat (строки ~3830-3900): `_chat_preview_*`, `_parse_chat_*` и подобные
3. Gemini/Vertex AI вызовы связанные с chat (если есть отдельные от других эндпоинтов)

**ВАЖНО**: НЕ удалять Vertex AI imports/helpers если они используются другими эндпоинтами (например, `ai_suggest` для dry_run).

**Проверка перед удалением**: Для каждой удаляемой функции — поиск по файлу что она не вызывается из оставшегося кода.

---

### 4. Удалить мёртвый код от confirm (старую логику)

После замены confirm на прокси, внутренние функции старого confirm становятся мёртвым кодом:
- Прямые вызовы `sb_update_bot_settings(org, settings_json)` из confirm — удалить
- Внутренние helper-ы для мутации settings_json — удалить (если не используются из других мест)

**Проверка**: `sb_update_bot_settings` может использоваться в других местах (apply, dry_run). Удалять ТОЛЬКО если нет других вызовов.

---

## ENV-ПЕРЕМЕННЫЕ (ОБЯЗАТЕЛЬНО)

Для работы прокси к settings-merge нужны:
- `SUPABASE_URL` — URL Supabase проекта (уже должна быть)
- `SUPABASE_SERVICE_ROLE_KEY` — service role key для вызова Edge Function

**Проверить** что эти ENV уже есть в Cloud Run конфигурации. Если нет — сообщить.

---

## ТЕСТ-ЧЕКЛИСТ

```bash
# 1. Confirm через settings-merge:
curl -X POST .../api/enrich/confirm \
  -H "X-Internal-Secret: $SECRET" \
  -d '{
    "organization_id": "...",
    "actions": [
      {"type": "WIDTH_MASTER", "payload": {"profile": "C8", "value": "1200:1150"}},
      {"type": "COATING_MAP", "payload": {"token": "PE", "value": "Полиэстер"}}
    ]
  }'
# ✅ 200, ok: true
# ✅ affected_clusters: ["WIDTH_MASTER", "COATING_MAP"]
# ✅ contract_version: "v1"

# 2. Проверить что settings-merge был вызван:
# В логах Edge Function settings-merge должен быть запрос

# 3. Проверить что кеш инвалидирован:
# Следующий preview_rows должен показать обновлённые данные

# 4. ai_chat_v2 endpoint удалён:
curl -X POST .../api/enrich/ai_chat_v2 \
  -d '{"organization_id":"...","message":"test"}'
# ✅ 404 или 405

# 5. Все остальные эндпоинты работают:
curl .../api/enrich/health
# ✅ 200

curl -X POST .../api/enrich/preview_rows \
  -d '{"organization_id":"...","limit":50}'
# ✅ 200

curl -X POST .../api/enrich/dry_run \
  -d '{"organization_id":"...","scope":{}}'
# ✅ 200
```

---

## НЕ ТРОГАТЬ

- НЕ менять preview_rows
- НЕ менять dry_run
- НЕ менять apply (кроме инвалидации кешей)
- НЕ менять classify()
- НЕ создавать новые эндпоинты
- НЕ менять Pydantic модели (кроме удаления моделей для ai_chat_v2)
