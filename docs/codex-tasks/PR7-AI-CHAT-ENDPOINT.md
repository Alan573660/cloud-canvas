# PR-7: AI Chat Endpoint с Gemini для интеллектуального определения профилей

**Файл**: `services/catalog-enricher/main.py`
**Приоритет**: P0 — ключевая фича
**Оценка**: +200 строк
**Риск**: Средний
**Зависимость**: После PR-6 (удаление старого /chat)

---

## КОНТЕКСТ

Система нормализации умеет детерминистически определять профиль через regex (С8, МП20, НС35).
Но когда в названии нет стандартного паттерна, товар попадает в "PROFILE_MAP" вопрос или остаётся OTHER.

**Цель**: Добавить AI-endpoint `/api/enrich/ai_chat_v2`, который:
1. Принимает сообщение пользователя + контекст (текущая группа, примеры)
2. Использует Gemini (Vertex AI) для анализа
3. Возвращает `actions[]` для batch-подтверждения
4. Может определить профиль по контексту названия товара:
   - "Лист 0.5 1100x1150 RAL3005 Монтеррей" → profile=MONTERREY, sheet_kind=METAL_TILE
   - "Профнастил С-8 0.45 ПЭ Шоколад" → profile=С8, coating=Полиэстер, color=RAL8017
   - "Панель стеновая ПП 100" → sheet_kind=SANDWICH

---

## ЗАДАЧИ

### 1. Добавить Pydantic модель

```python
class AiChatV2Request(BaseModel):
    organization_id: str
    import_job_id: Optional[str] = None
    run_id: Optional[str] = None
    message: str
    context: Optional[Dict[str, Any]] = None
```

### 2. Создать эндпоинт `/api/enrich/ai_chat_v2`

```python
@app.post("/api/enrich/ai_chat_v2")
def ai_chat_v2(req: AiChatV2Request, x_internal_secret: Optional[str] = Header(default=None, alias="X-Internal-Secret")):
    require_secret(x_internal_secret)
    start_time = time.monotonic()
    
    org = safe_text(req.organization_id).strip()
    if not org:
        raise HTTPException(status_code=400, detail="organization_id required")
    
    _require_supabase("ai_chat_v2", org, req.import_job_id or "")
    
    # Загрузить профиль и настройки
    prof = load_bot_profile(org)
    ai_cfg = _ai_policy(prof)
    ral_wl = build_ral_whitelist(prof)
    
    if not ai_cfg.get("ai_enabled") or not AI_ENABLED or not vertexai:
        return _response({
            "ok": False,
            "ai_disabled": True,
            "ai_skip_reason": "AI отключен в настройках",
            "assistant_message": "ИИ-анализ отключён. Включите AI в настройках организации.",
            "actions": [],
        })
    
    # Собрать контекст для промпта
    context = req.context or {}
    prompt_context = _build_ai_chat_context(org, prof, ral_wl, context)
    
    # Вызвать Gemini
    try:
        result = _call_gemini_chat(req.message, prompt_context, prof)
    except Exception as e:
        elapsed_ms = int((time.monotonic() - start_time) * 1000)
        print(f"enrich.ai_chat_v2 organization_id={org} error={str(e)[:200]} elapsed_ms={elapsed_ms}")
        return _response({
            "ok": False,
            "code": "AI_ERROR",
            "error": str(e)[:400],
            "assistant_message": f"⚠️ Ошибка AI: {str(e)[:200]}",
            "actions": [],
        })
    
    elapsed_ms = int((time.monotonic() - start_time) * 1000)
    print(f"enrich.ai_chat_v2 organization_id={org} actions={len(result.get('actions', []))} elapsed_ms={elapsed_ms}")
    
    return _response({
        "ok": True,
        "assistant_message": result.get("assistant_message", ""),
        "actions": result.get("actions", []),
        "missing_fields": result.get("missing_fields"),
        "requires_confirm": bool(result.get("actions")),
    })
```

### 3. Реализовать `_build_ai_chat_context()`

```python
def _build_ai_chat_context(
    org: str,
    prof: Dict[str, Any],
    ral_wl: set,
    context: Dict[str, Any],
) -> Dict[str, Any]:
    """Build context payload for Gemini prompt."""
    
    # Текущие настройки организации
    widths_selected = prof.get("widths_selected") or {}
    coatings = prof.get("coatings") or {}
    profile_aliases = prof.get("profile_aliases") or {}
    
    result = {
        "confirmed_widths": {k: v for k, v in widths_selected.items() if isinstance(v, dict)},
        "confirmed_coatings": list(coatings.keys()) if isinstance(coatings, dict) else [],
        "confirmed_profiles": list(profile_aliases.values()) if isinstance(profile_aliases, dict) else [],
        "ral_whitelist_count": len(ral_wl),
    }
    
    # Контекст из фронтенда (текущая группа, примеры)
    if context.get("group_type"):
        result["current_group"] = {
            "type": context.get("group_type"),
            "key": context.get("group_key"),
            "affected_count": context.get("affected_count"),
            "examples": (context.get("examples") or [])[:10],
        }
    
    # Загрузить sample из BQ для контекста (до 30 строк)
    if context.get("group_key"):
        try:
            sample = _fetch_context_sample(org, context)
            result["sample_items"] = sample
        except Exception:
            pass
    
    return result


def _fetch_context_sample(org: str, context: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Fetch sample rows from BigQuery for AI context."""
    fq = fq_table(BQ_TABLE_CURRENT)
    where = ["organization_id=@org"]
    params = [bigquery.ScalarQueryParameter("org", "STRING", org)]
    
    group_type = safe_text(context.get("group_type")).strip().upper()
    group_key = safe_text(context.get("group_key")).strip()
    
    if group_type == "PROFILE_MAP" and group_key:
        where.append("LOWER(title) LIKE @key")
        params.append(bigquery.ScalarQueryParameter("key", "STRING", f"%{group_key.lower()}%"))
    elif group_type == "WIDTH_MASTER" and group_key:
        # group_key is profile name
        norm_key = _norm_profile(group_key)
        where.append("REGEXP_REPLACE(UPPER(IFNULL(profile, '')), r'[^A-ZА-Я0-9]', '')=@profile")
        params.append(bigquery.ScalarQueryParameter("profile", "STRING", norm_key))
    elif group_type == "COATING_MAP" and group_key:
        where.append("LOWER(title) LIKE @key")
        params.append(bigquery.ScalarQueryParameter("key", "STRING", f"%{group_key.lower()}%"))
    
    sql = f"""
    SELECT id, title, profile, thickness_mm, coating, 
           sheet_kind, color_system, color_code,
           width_work_mm, width_full_mm, unit, notes
    FROM `{fq}`
    WHERE {' AND '.join(where)}
    LIMIT 30
    """
    rows = []
    for r in bq_client().query(sql, job_config=bigquery.QueryJobConfig(query_parameters=params)).result():
        rows.append({
            "title": safe_text(r.get("title")),
            "profile": safe_text(r.get("profile")),
            "thickness_mm": r.get("thickness_mm"),
            "coating": safe_text(r.get("coating")),
            "sheet_kind": safe_text(r.get("sheet_kind")),
            "color_system": safe_text(r.get("color_system")),
            "color_code": safe_text(r.get("color_code")),
        })
    return rows
```

### 4. Реализовать `_call_gemini_chat()`

```python
def _call_gemini_chat(
    user_message: str,
    context: Dict[str, Any],
    prof: Dict[str, Any],
) -> Dict[str, Any]:
    """Call Gemini for intelligent catalog analysis."""
    _vertex_init_once()
    model = GenerativeModel(AI_MODEL_NAME)
    cfg = GenerationConfig(temperature=0.3, max_output_tokens=2048)
    
    overrides = _ai_prompt_overrides(prof)
    
    system = """Ты — ИИ-ассистент нормализации каталога кровельных материалов.

## Типы товаров
- PROFNASTIL (профнастил): С8, С10, С20, С21, НС35, Н57, Н60, Н75, Н114, МП20, МП40
- METAL_TILE (металлочерепица): Монтеррей, Каскад, Адаманте, Ламонтерра, Монтекристо, Трамонтана, Кредо, Квинта, Камея, Андрия, Classic, Genesis, Modern, Finnera, Banga, Decorrey
- SANDWICH (сэндвич-панели): ПП, ППС, ППУ, МВ
- ACCESSORY (доборные): планки, коньки, ендовы, саморезы, кронштейны
- SMOOTH_SHEET (гладкий лист)

## Стандартные ширины профнастила (полная:рабочая)
С8: 1200:1150, С10: 1150:1100, С20: 1150:1100, С21: 1051:1000,
НС35: 1060:1000, Н60: 902:845, Н75: 800:750, МП20: 1150:1100

## Покрытия
Полиэстер, Матовый полиэстер, Пурал, Пуретан, Пластизол, PVDF, Оцинковка, Printech, Agneta, VikingMP, Safari, Ecosteel

## Твоя задача
1. Анализируй вопрос пользователя
2. Если пользователь просит изменение — верни JSON actions
3. Если определяешь профиль по контексту — используй PROFILE_MAP
4. Для каждого действия всегда указывай ВСЕ обязательные поля

## Формат ответа
ОБЯЗАТЕЛЬНО верни JSON объект:
{
    "assistant_message": "Текст ответа пользователю",
    "actions": [
        {"type": "PROFILE_MAP", "payload": {"token": "исходное", "canonical": "С21"}},
        {"type": "WIDTH_MASTER", "payload": {"profile": "С21", "full_mm": 1051, "work_mm": 1000}},
        {"type": "COATING_MAP", "payload": {"token": "матпэ", "canonical": "Матовый полиэстер"}},
        {"type": "COLOR_MAP", "payload": {"token": "шоколад", "ral": "RAL8017"}},
        {"type": "THICKNESS_SET", "payload": {"values": [0.5], "cluster_key": "PROFNASTIL|С21"}}
    ],
    "missing_fields": ["profile"]  // если не хватает данных
}

Если нет действий, верни actions: [].
Отвечай ТОЛЬКО валидным JSON, без markdown.
"""
    
    if isinstance(overrides, dict) and overrides:
        system += "\nOrg-specific: " + json.dumps(overrides, ensure_ascii=False)
    
    user_payload = {
        "message": user_message,
        "context": context,
    }
    
    resp = model.generate_content(
        [system, json.dumps(user_payload, ensure_ascii=False)],
        generation_config=cfg,
    )
    txt = getattr(resp, "text", "") or ""
    
    parsed = _extract_json(txt)
    if isinstance(parsed, dict):
        # Валидация actions
        actions = parsed.get("actions") or []
        validated_actions = []
        for a in actions:
            if not isinstance(a, dict):
                continue
            atype = safe_text(a.get("type")).strip().upper()
            payload = a.get("payload") if isinstance(a.get("payload"), dict) else {}
            
            # WIDTH_MASTER: обязательно profile
            if atype == "WIDTH_MASTER" and not payload.get("profile"):
                continue
            # COATING_MAP: обязательно token
            if atype == "COATING_MAP" and not payload.get("token"):
                continue
            # COLOR_MAP: обязательно token
            if atype == "COLOR_MAP" and not payload.get("token"):
                continue
            # PROFILE_MAP: обязательно token/alias + canonical
            if atype == "PROFILE_MAP":
                if not (payload.get("token") or payload.get("alias")) or not (payload.get("canonical") or payload.get("value")):
                    continue
            
            validated_actions.append({"type": atype, "payload": payload})
        
        return {
            "assistant_message": safe_text(parsed.get("assistant_message")).strip() or "Готово.",
            "actions": validated_actions,
            "missing_fields": parsed.get("missing_fields"),
        }
    
    # Fallback: если AI вернул текст без JSON
    return {
        "assistant_message": txt.strip()[:2000] if txt.strip() else "Не удалось обработать запрос.",
        "actions": [],
    }
```

---

## КОНТРАКТ ОТВЕТА

```json
{
    "ok": true,
    "contract_version": "v1",
    "assistant_message": "Для профнастила С21 рабочая ширина 1000 мм, полная 1051 мм. Применяю.",
    "actions": [
        {
            "type": "WIDTH_MASTER",
            "payload": {
                "profile": "С21",
                "work_mm": 1000,
                "full_mm": 1051
            }
        }
    ],
    "missing_fields": null,
    "requires_confirm": true
}
```

**Типы actions:**
- `WIDTH_MASTER` — payload: `{ profile, work_mm, full_mm }`
- `COATING_MAP` — payload: `{ token, canonical }`
- `COLOR_MAP` — payload: `{ token, ral, system? }`
- `THICKNESS_SET` — payload: `{ values, cluster_key? }`
- `PROFILE_MAP` — payload: `{ token/alias, canonical/value }`
- `RAL_WHITELIST` — payload: `{ codes: string[] }`
- `PRODUCT_KIND_MAP` — payload: `{ token, value }`

---

## ИНТЕГРАЦИЯ С ФРОНТЕНДОМ

Edge Function `import-normalize` (op: `ai_chat_v2`) проксирует к этому endpoint.
Фронтенд `AIChatPanel.tsx` уже отправляет:
```json
{
    "op": "ai_chat_v2",
    "organization_id": "...",
    "import_job_id": "...",
    "run_id": "...",
    "message": "Для С20 ширина 1100/1150",
    "context": {
        "group_type": "WIDTH_MASTER",
        "group_key": "С20",
        "affected_count": 450,
        "examples": ["Профнастил С20 0.5 ПЭ RAL3005", ...]
    }
}
```

Edge Function должна конвертировать в вызов к Cloud Run:
```
POST {CATALOG_ENRICHER_URL}/api/enrich/ai_chat_v2
X-Internal-Secret: {ENRICH_SHARED_SECRET}
Body: { organization_id, import_job_id, run_id, message, context }
```

---

## ТЕСТ-ЧЕКЛИСТ

```bash
# 1. Базовый запрос:
curl -X POST .../api/enrich/ai_chat_v2 \
  -H "X-Internal-Secret: $SECRET" \
  -d '{"organization_id":"...","message":"Для С20 поставь ширину рабочую 1100, полную 1150"}'
# ✅ ok: true
# ✅ actions содержит WIDTH_MASTER с profile=С20
# ✅ assistant_message — текст на русском

# 2. Определение профиля:
curl -X POST .../api/enrich/ai_chat_v2 \
  -H "X-Internal-Secret: $SECRET" \
  -d '{"organization_id":"...","message":"Что за профиль у товара: Лист 0.5 1100x1150 Монтеррей RAL3005?"}'
# ✅ actions содержит PROFILE_MAP с canonical=MONTERREY

# 3. Маппинг покрытия:
curl -X POST .../api/enrich/ai_chat_v2 \
  -H "X-Internal-Secret: $SECRET" \
  -d '{"organization_id":"...","message":"MatPE это матовый полиэстер"}'
# ✅ actions содержит COATING_MAP с token=MatPE, canonical=Матовый полиэстер

# 4. AI отключён:
# (В bot_settings ai_policy.ai_enabled = false)
# ✅ ok: false, ai_disabled: true

# 5. Ошибка Vertex AI:
# ✅ ok: false, code: AI_ERROR, assistant_message содержит описание
```

---

## НЕ ТРОГАТЬ

- НЕ менять classify() — AI дополняет, не заменяет
- НЕ менять build_questions_v2() — вопросы генерируются независимо от AI
- НЕ менять confirm — он уже проксирует к settings-merge
- НЕ менять dry_run, apply, preview_rows
- НЕ удалять gemini_suggest() — используется в dry_run для suggestions
