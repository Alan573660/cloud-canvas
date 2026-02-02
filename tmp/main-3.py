import os
import io
import re

# ===== kind/color regex (V1) =====
RE_COLOR_RAL = re.compile(r"\bRAL\s*(\d{4})\b", re.I)
RE_COLOR_RR  = re.compile(r"\bRR\s*-?\s*(\d{2})\b", re.I)
RE_DECOR     = re.compile(r"\b(ДУБ|ОРЕХ|КИРПИЧ|КАМЕНЬ|МОРЕНЫЙ\s*ДУБ|МРАМОР|ГРАНИТ)\b", re.I)
RE_SMOOTH    = re.compile(r"(гладк(ий|ого)\s*лист|плос(кий|кого)\s*лист)", re.I)

# ===== profile extraction from title (V1) =====
RE_PROFILE_SHEET = re.compile(r'(^|[^A-ZА-Я0-9])((?:НС|HC|С|C|Н|H|МП|MP)\s*[-–]?\s*(\d{1,3}))([^A-ZА-Я0-9]|$)', re.I)

def extract_profile_from_title(title: str) -> str:
    """
    Extracts sheet profile token from title, returns canonical like:
      С21, Н60, НС35, МП20
    """
    t = (title or "").upper()
    m = RE_PROFILE_SHEET.search(t)
    if not m:
        return ""
    raw = m.group(2) or ""
    raw = raw.replace("–", "-").replace("—", "-")
    raw = re.sub(r"\s+", "", raw)
    # normalize cyr/lat
    raw = raw.replace("HC", "НС").replace("H", "Н").replace("C", "С").replace("MP", "МП")
    # remove dash: "С-21" -> "С21"
    raw = raw.replace("-", "")
    return raw


import json
import uuid
import time
import hashlib
import datetime as dt
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
import requests
from fastapi import FastAPI, HTTPException, Header, Request
from pydantic import BaseModel, Field

from google.cloud import bigquery

import vertexai
from vertexai.generative_models import GenerativeModel, GenerationConfig

app = FastAPI(title="catalog-enricher", version="4.1-stable")

# -----------------------------
# ENV
# -----------------------------
PROJECT_ID = os.environ.get("PROJECT_ID", "")
BQ_DATASET = os.environ.get("BQ_DATASET", "roofing_saas")
BQ_TABLE_CURRENT = os.environ.get("BQ_TABLE_CURRENT", "master_products_current")
BQ_TABLE_PATCHES = os.environ.get("BQ_TABLE_PATCHES", "enrich_patches_staging")
BQ_JSON_CHUNK_SIZE = int(os.environ.get("BQ_JSON_CHUNK_SIZE", "2000"))

MAX_BODY_BYTES = int(os.environ.get("MAX_BODY_BYTES", str(256 * 1024)))
RATE_LIMIT_RPS = float(os.environ.get("RATE_LIMIT_RPS", "3.0"))
RATE_LIMIT_BURST = int(os.environ.get("RATE_LIMIT_BURST", "10"))

AI_MODEL_NAME = os.environ.get("AI_MODEL_NAME", "gemini-2.5-flash-lite")
AI_LOCATION = os.environ.get("AI_LOCATION", "us-central1")
AI_MAX_TITLES = int(os.environ.get("AI_MAX_TITLES", "80"))

# -----------------------------
# SECURITY
# -----------------------------
_rl_state: Dict[str, Tuple[float, float]] = {}  # ip -> (tokens,last_ts)

def _rate_limit_allow(ip: str) -> bool:
    now = time.time()
    tokens, last_ts = _rl_state.get(ip, (float(RATE_LIMIT_BURST), now))
    elapsed = max(0.0, now - last_ts)
    tokens = min(float(RATE_LIMIT_BURST), tokens + elapsed * RATE_LIMIT_RPS)
    if tokens < 1.0:
        _rl_state[ip] = (tokens, now)
        return False
    tokens -= 1.0
    _rl_state[ip] = (tokens, now)
    return True

@app.middleware("http")
async def security_middleware(request: Request, call_next):
    cl = request.headers.get("content-length")
    if cl:
        try:
            if int(cl) > MAX_BODY_BYTES:
                raise HTTPException(status_code=413, detail="Payload too large")
        except ValueError:
            pass

    ip = request.client.host if request.client else "unknown"
    if not _rate_limit_allow(ip):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")

    return await call_next(request)

def require_secret(x_internal_secret: Optional[str]) -> None:
    secret = os.environ.get("ENRICH_SHARED_SECRET", "")
    if not secret:
        raise HTTPException(status_code=500, detail="ENRICH_SHARED_SECRET is not set")
    if not x_internal_secret or x_internal_secret != secret:
        raise HTTPException(status_code=403, detail="Forbidden: invalid X-Internal-Secret")

# -----------------------------
# JSON SAFE
# -----------------------------
def _json_safe(obj: Any) -> Any:
    import math
    if obj is None:
        return None
    if isinstance(obj, (str, int, bool)):
        return obj
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    if isinstance(obj, (dt.datetime, dt.date)):
        try:
            return obj.isoformat()
        except Exception:
            return str(obj)
    try:
        if pd.isna(obj):
            return None
    except Exception:
        pass
    if isinstance(obj, dict):
        return {str(k): _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_json_safe(x) for x in obj]
    return str(obj)

# -----------------------------
# SUPABASE (ENV SAFE)
# -----------------------------
def _supabase_env() -> Tuple[str, str]:
    supabase_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    service_key = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""
    return supabase_url, service_key

def load_pricing_profile(organization_id: str) -> Dict[str, Any]:
    """Return merged root+pricing dict from bot_settings.settings_json."""
    supabase_url, service_key = _supabase_env()
    if not supabase_url or not service_key:
        return {}

    url = f"{supabase_url}/rest/v1/bot_settings?select=settings_json&organization_id=eq.{organization_id}&limit=1"
    headers = {"apikey": service_key, "Authorization": f"Bearer {service_key}", "Content-Type": "application/json"}
    r = requests.get(url, headers=headers, timeout=30)
    if r.status_code >= 300:
        return {}
    rows = r.json() or []
    if not rows:
        return {}
    settings = rows[0].get("settings_json") or {}
    if not isinstance(settings, dict):
        return {}
    pr = settings.get("pricing")
    if isinstance(pr, dict):
        merged = dict(settings)
        merged.update(pr)
        return merged
    return settings

def profile_hash(profile: Dict[str, Any]) -> str:
    raw = json.dumps(profile or {}, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()

def sb_headers() -> Dict[str, str]:
    supabase_url, service_key = _supabase_env()
    if not supabase_url or not service_key:
        raise RuntimeError("Supabase env missing")
    return {"apikey": service_key, "Authorization": f"Bearer {service_key}", "Content-Type": "application/json"}

def sb_url(path: str) -> str:
    supabase_url, _ = _supabase_env()
    return supabase_url + path

def deep_merge(a: Any, b: Any) -> Any:
    if isinstance(a, dict) and isinstance(b, dict):
        out = dict(a)
        for k, v in b.items():
            out[k] = deep_merge(out.get(k), v)
        return out
    return b

def sb_get_import_job(import_job_id: str) -> Optional[Dict[str, Any]]:
    if not import_job_id:
        return None
    url = sb_url(f"/rest/v1/import_jobs?select=*&id=eq.{import_job_id}&limit=1")
    r = requests.get(url, headers=sb_headers(), timeout=30)
    if r.status_code >= 300:
        raise HTTPException(status_code=502, detail=f"Supabase read import_jobs failed: {r.status_code}")
    rows = r.json() or []
    return rows[0] if rows else None

def sb_patch_import_job_summary(import_job_id: str, patch_obj: Dict[str, Any]) -> None:
    job = sb_get_import_job(import_job_id)
    if not job:
        return
    cur = job.get("summary") or {}
    if not isinstance(cur, dict):
        cur = {}
    merged = deep_merge(cur, patch_obj)
    merged = _json_safe(merged)
    url = sb_url(f"/rest/v1/import_jobs?id=eq.{import_job_id}")
    r = requests.patch(url, headers=sb_headers(), json={"summary": merged}, timeout=30)
    if r.status_code >= 300:
        raise HTTPException(status_code=502, detail=f"Supabase patch import_jobs.summary failed: {r.status_code}")

def sb_get_enrich_state(import_job_id: str) -> Optional[Dict[str, Any]]:
    job = sb_get_import_job(import_job_id)
    if not job:
        return None
    s = job.get("summary") or {}
    if not isinstance(s, dict):
        return None
    e = s.get("enrich")
    return e if isinstance(e, dict) else None

# -----------------------------
# BIGQUERY
# -----------------------------
def bq_client() -> bigquery.Client:
    return bigquery.Client(project=PROJECT_ID) if PROJECT_ID else bigquery.Client()

def fq_table(table: str) -> str:
    c = bq_client()
    return f"{c.project}.{BQ_DATASET}.{table}"

def fetch_current(org: str, limit: int = 0) -> pd.DataFrame:
    lim = f"LIMIT {int(limit)}" if limit and limit > 0 else ""
    sql = f"""
    SELECT organization_id, id, title, notes, profile, thickness_mm, coating, width_work_mm, width_full_mm, weight_kg_m2
    FROM `{fq_table(BQ_TABLE_CURRENT)}`
    WHERE organization_id=@org
ORDER BY
  CASE
    WHEN REGEXP_CONTAINS(UPPER(title), r'(^|[^A-ZА-Я0-9])((С|C)\s*-?\s*\d{1,3}|(Н|H)\s*-?\s*\d{1,3}|(НС|HC)\s*-?\s*\d{1,3}|(МП|MP)\s*-?\s*\d{1,3})([^A-ZА-Я0-9]|$)') THEN 0
    WHEN REGEXP_CONTAINS(LOWER(title), r'(профнастил|профлист|металлочерепиц)') THEN 1
    ELSE 9
  END,
  title

    {lim}
    
    """
    job = bq_client().query(sql, job_config=bigquery.QueryJobConfig(
        query_parameters=[bigquery.ScalarQueryParameter("org", "STRING", org)]
    ))
    return job.to_dataframe()

# -----------------------------
# GEMINI
# -----------------------------
_vertex_inited = False
def _vertex_init_once():
    global _vertex_inited
    if _vertex_inited:
        return
    vertexai.init(project=(PROJECT_ID or os.environ.get("PROJECT_ID","")), location=AI_LOCATION)
    _vertex_inited = True

def _extract_json_array(text: str) -> Optional[List[Any]]:
    if not text:
        return None
    text = text.strip()
    try:
        v = json.loads(text)
        return v if isinstance(v, list) else None
    except Exception:
        pass
    i = text.find("[")
    j = text.rfind("]")
    if i != -1 and j != -1 and j > i:
        chunk = text[i:j+1]
        try:
            v = json.loads(chunk)
            return v if isinstance(v, list) else None
        except Exception:
            return None
    return None

def gemini_suggest(profile: Dict[str, Any], titles: List[str], payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    _vertex_init_once()
    model = GenerativeModel(AI_MODEL_NAME)
    cfg = GenerationConfig(temperature=0.2)
    system = "Return ONLY JSON array. No markdown. No comments. If cannot comply return []."
    user = {"profile": profile or {}, "payload": payload or {}, "examples": (titles or [])[:AI_MAX_TITLES]}
    resp = model.generate_content([system, json.dumps(user, ensure_ascii=False)], generation_config=cfg)
    txt = getattr(resp, "text", "") or ""
    arr = _extract_json_array(txt) or []
    out = []
    for x in arr:
        if isinstance(x, dict):
            out.append(x)
    return out

# -----------------------------
# QUESTIONS
# -----------------------------
_RE_TOKEN = re.compile(r'(?<!\w)([A-Za-zА-Яа-я]{1,4}\s*[-–]?\s*\d{1,3}(?:\s*[-–]\s*\d{2,4})?)(?!\w)', re.U)

def safe_text(v: Any) -> str:
    try:
        if v is None:
            return ""
        if isinstance(v, float) and pd.isna(v):
            return ""
        if pd.isna(v):
            return ""
    except Exception:
        pass
    return v if isinstance(v, str) else str(v)

def _tok_norm(tok: str) -> str:
    t = safe_text(tok).strip()
    t = t.replace("–","-").replace("—","-")
    t = re.sub(r"\s+","",t)
    return t.upper()

def _tok_variants(tok: str) -> List[str]:
    t = _tok_norm(tok)
    if not t:
        return []
    vs = {t}
    pairs = [("С","C"),("Н","H"),("М","M"),("Р","P"),("Х","X"),("В","B"),("Т","T"),("К","K")]
    for a,b in pairs:
        vs.add(t.replace(a,b)); vs.add(t.replace(b,a))
    return sorted({re.sub(r"-{2,}","-",x) for x in vs})

def extract_tokens(title: str) -> List[str]:
    t = safe_text(title)
    return [m.group(1) for m in _RE_TOKEN.finditer(t)] if t else []

def build_width_questions(profile_cfg: Dict[str, Any], titles: List[str], max_profiles: int = 60) -> List[Dict[str, Any]]:
    cfg = profile_cfg or {}
    defaults = cfg.get("defaults") or {}
    widths_suggested = (defaults.get("widths_suggested") or {})
    widths_selected = (cfg.get("widths_selected") or {})
    alias_map = (cfg.get("profile_aliases") or {})

    from collections import Counter
    raw_counter = Counter()
    raw_example = {}

    for t in (titles or [])[:5000]:
        for raw in extract_tokens(t):
            tok = _tok_norm(raw)
            if not tok:
                continue
            
            # _WIDTH_TOKEN_FILTER_V1
            # Skip non-width tokens: RRxx, RALxxxx, E-20-xxxx, plain 4-digit colors, and obvious color words
            if re.match(r"^RR\d{2}$", tok):
                continue
            if re.match(r"^(?:RAL)?\d{4}$", tok):
                continue
            if re.match(r"^E-\d{2}(?:-\d{4})?$", tok):
                continue
            if tok in ("GREY","GRAY","BROWN","CHOCOLATE","GRAPHITE","BLACK","WHITE"):
                continue
            # _WIDTH_PROFILE_STRICT_V2
            # Accept only roof sheet profile marks:
            #   С/Н/НС/МП (and latin C/H/HC/MP) + 1..3 digits
            # Everything else (RR/RAL/ПЭ-01/ДУБ/Z-100-1000/E-20/...) is NOT a width profile.
            if not re.match(r"^(?:С|C|Н|H|НС|HC|МП|MP)-?\d{1,3}$", tok):
                continue
            # extra exclusions
            if re.match(r"^RR\d{2}$", tok):  # RR colors
                continue
            if re.match(r"^(?:RAL)?\d{4}$", tok):  # RAL or 4-digit
                continue
            raw_counter[tok] += 1
            raw_example.setdefault(tok, safe_text(t)[:200])

    resolved = Counter()
    canon_examples = {}
    for raw_tok, cnt in raw_counter.most_common(500):
        canon = None
        for v in _tok_variants(raw_tok):
            if v in alias_map:
                canon = alias_map[v]
                break
        canon = _tok_norm(canon or raw_tok)
        resolved[canon] += cnt
        canon_examples.setdefault(canon, raw_example.get(raw_tok, ""))

    questions = []
    for canon, found in resolved.most_common(max_profiles):
        if isinstance(widths_selected, dict) and canon in widths_selected:
            continue
        item = widths_suggested.get(canon) if isinstance(widths_suggested, dict) else None
        if isinstance(item, dict):
            variants = item.get("variants") or []
            norm_vars = []
            for v in variants[:10]:
                work = v.get("work_mm"); full = v.get("full_mm")
                if work is None and full is None:
                    continue
                norm_vars.append({"work_mm": int(work) if work is not None else None,
                                  "full_mm": int(full) if full is not None else None})
            ex = [canon_examples.get(canon,"")] if canon_examples.get(canon) else []
            if len(norm_vars) == 1:
                questions.append({"type":"WIDTH_CONFIRM","profile":canon,"suggested":norm_vars[0],"examples":ex})
            elif len(norm_vars) > 1:
                questions.append({"type":"WIDTH_CHOOSE_VARIANT","profile":canon,"suggested_variants":norm_vars,"examples":ex})
            else:
                questions.append({"type":"WIDTH_MANUAL","profile":canon,"examples":ex})
        else:
            ex = [canon_examples.get(canon,"")] if canon_examples.get(canon) else []
            questions.append({"type":"WIDTH_MANUAL","profile":canon,"examples":ex})
    return questions

def build_coating_color_map(profile_cfg: Dict[str, Any], titles: List[str]) -> Dict[str, Any]:
    cfg = profile_cfg or {}
    existing_coatings = cfg.get("coatings") or {}
    existing_ral_aliases = ((cfg.get("colors") or {}).get("ral_aliases") or {})

    def _norm_token(x: Any) -> str:
        t = safe_text(x).strip()
        t = t.replace("–","-").replace("—","-")
        t = re.sub(r"\s+","",t)
        return t.upper()

    coatings_out = []
    if isinstance(existing_coatings, dict):
        for token, aliases in existing_coatings.items():
            tok = _norm_token(token)
            als = aliases if isinstance(aliases, list) else []
            coatings_out.append({"token": tok, "aliases": [safe_text(a) for a in als if safe_text(a)]})

    colors_out = []
    if isinstance(existing_ral_aliases, dict):
        for token, ral in existing_ral_aliases.items():
            tok = _norm_token(token)
            ral_s = safe_text(ral).strip().upper()
            if ral_s and not ral_s.startswith("RAL"):
                ral_s = f"RAL{ral_s}"
            colors_out.append({"token": tok, "suggested_ral": ral_s, "aliases": [tok, ral_s] if ral_s else [tok]})

    out: Dict[str, Any] = {"type":"COATING_COLOR_MAP","coatings":coatings_out,"colors":colors_out}

    payload = {
        "task":"Extract coatings and colors/RAL from titles.",
        "contract":{
            "type":"COATING_COLOR_MAP",
            "coatings":[{"token":"PE","aliases":["пэ","polyester"]}],
            "colors":[{"token":"RR32","suggested_ral":"RAL8017","aliases":["шоколад","8017"]}]
        },
        "existing_coatings": existing_coatings,
        "existing_ral_aliases": existing_ral_aliases
    }
    try:
        ai = gemini_suggest(cfg, (titles or [])[:AI_MAX_TITLES], payload)
        if ai and isinstance(ai[0], dict) and ai[0].get("type") == "COATING_COLOR_MAP":
            obj = ai[0]
            # normalize keys
            for c in obj.get("coatings", []) or []:
                if isinstance(c, dict):
                    if "canon" in c and "token" not in c: c["token"]=c.pop("canon")
                    if "synonyms" in c and "aliases" not in c: c["aliases"]=c.pop("synonyms")
            for c in obj.get("colors", []) or []:
                if isinstance(c, dict):
                    if "canon_ral" in c and "suggested_ral" not in c: c["suggested_ral"]=c.pop("canon_ral")
                    if "synonyms" in c and "aliases" not in c: c["aliases"]=c.pop("synonyms")
            if isinstance(obj.get("coatings"), list): out["coatings"]=obj["coatings"]
            if isinstance(obj.get("colors"), list): out["colors"]=obj["colors"]
    except Exception:
        pass

    return out

# -----------------------------
# API MODELS
# -----------------------------
class Scope(BaseModel):
    only_where_null: bool = True
    limit: int = 0

class DryRunRequest(BaseModel):
    organization_id: str
    import_job_id: str
    scope: Scope = Field(default_factory=Scope)
    ai_suggest: bool = True


class ApplyRequest(BaseModel):
    organization_id: str
    import_job_id: str
    run_id: str
    profile_hash: str

# -----------------------------
# ENDPOINTS
# -----------------------------


# -----------------------------
# APPLY PIPELINE (BQ staging -> MERGE)
# -----------------------------
def delete_staging(org: str, run_id: str) -> None:
    sql = f"DELETE FROM `{fq_table(BQ_TABLE_PATCHES)}` WHERE organization_id=@org AND run_id=@run_id"
    bq_client().query(
        sql,
        job_config=bigquery.QueryJobConfig(query_parameters=[
            bigquery.ScalarQueryParameter("org","STRING",org),
            bigquery.ScalarQueryParameter("run_id","STRING",run_id),
        ])
    ).result()

def write_patches_to_bq(run_id: str, patches: List[Dict[str, Any]]) -> int:
    if not patches:
        return 0
    dfp = pd.DataFrame(patches)
    dfp["run_id"] = run_id
    dfp["updated_at"] = dfp["updated_at"].apply(lambda x: x.isoformat() if hasattr(x, "isoformat") else str(x))

    # numeric cleanup
    for c in ["thickness_mm","width_work_mm","width_full_mm","weight_kg_m2","price_rub_m2"]:
        if c in dfp.columns:
            dfp[c] = pd.to_numeric(dfp[c], errors="coerce")
            dfp[c] = dfp[c].where(pd.notna(dfp[c]), None)

    client = bq_client()
    fq = fq_table(BQ_TABLE_PATCHES)
    job_config = bigquery.LoadJobConfig(
        source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
        write_disposition=bigquery.WriteDisposition.WRITE_APPEND,
        ignore_unknown_values=True,
        max_bad_records=0,
    )

    chunk = max(1, int(os.environ.get("BQ_JSON_CHUNK_SIZE","2000")))
    for i in range(0, len(dfp), chunk):
        part = dfp.iloc[i:i+chunk]
        ndjson = part.to_json(orient="records", lines=True, date_format="iso", force_ascii=False)
        job = client.load_table_from_file(io.BytesIO(ndjson.encode("utf-8")), fq, job_config=job_config)
        job.result()

    return int(len(dfp))

def merge_patches_into_current(org: str, run_id: str) -> None:
    fq_cur = fq_table(BQ_TABLE_CURRENT)
    fq_pat = fq_table(BQ_TABLE_PATCHES)

    sql = f"""
    MERGE `{fq_cur}` T
    USING (
      SELECT
        organization_id, id,
        ANY_VALUE(profile) AS profile,
        ANY_VALUE(thickness_mm) AS thickness_mm,
        ANY_VALUE(coating) AS coating,
        ANY_VALUE(width_work_mm) AS width_work_mm,
        ANY_VALUE(width_full_mm) AS width_full_mm,
        ANY_VALUE(weight_kg_m2) AS weight_kg_m2,
        ANY_VALUE(sheet_kind) AS sheet_kind,
        ANY_VALUE(color_system) AS color_system,
        ANY_VALUE(color_code) AS color_code,
        ANY_VALUE(notes_append) AS notes_append,
        MAX(TIMESTAMP(updated_at)) AS updated_at
      FROM `{fq_pat}`
      WHERE organization_id=@org AND run_id=@run_id
      GROUP BY organization_id, id
    ) S
    ON T.organization_id = S.organization_id AND T.id = S.id
    WHEN MATCHED THEN UPDATE SET
      profile = COALESCE(T.profile, S.profile),
      thickness_mm = COALESCE(T.thickness_mm, S.thickness_mm),
      coating = COALESCE(T.coating, S.coating),
      width_work_mm = COALESCE(T.width_work_mm, S.width_work_mm),
      width_full_mm = COALESCE(T.width_full_mm, S.width_full_mm),
      weight_kg_m2 = COALESCE(T.weight_kg_m2, S.weight_kg_m2),
      notes = CASE
        WHEN S.notes_append IS NULL THEN T.notes
        WHEN T.notes IS NULL OR T.notes = '' THEN S.notes_append
        ELSE CONCAT(T.notes, ' | ', S.notes_append)
      END,
      sheet_kind = COALESCE(T.sheet_kind, S.sheet_kind),
      color_system = COALESCE(T.color_system, S.color_system),
      color_code = COALESCE(T.color_code, S.color_code),
      updated_at = CURRENT_TIMESTAMP()
    """
    bq_client().query(
        sql,
        job_config=bigquery.QueryJobConfig(query_parameters=[
            bigquery.ScalarQueryParameter("org","STRING",org),
            bigquery.ScalarQueryParameter("run_id","STRING",run_id),
        ])
    ).result()

@app.get("/health")
def health():
    return {
        "ok": True,
        "project_id": PROJECT_ID or None,
        "dataset": BQ_DATASET,
        "table_current": BQ_TABLE_CURRENT,
        "table_patches": BQ_TABLE_PATCHES,
        "supabase_url_set": bool(os.environ.get("SUPABASE_URL")),
        "secret_set": bool(os.environ.get("ENRICH_SHARED_SECRET")),
        "ai_model": AI_MODEL_NAME,
        "ai_location": AI_LOCATION,
    }



# ============================
# PREVIEW + CHAT ENDPOINTS (V1)
# ============================

class PreviewRowsRequest(BaseModel):
    organization_id: str
    import_job_id: Optional[str] = None
    group_type: Optional[str] = None
    filter_key: Optional[str] = None
    q: Optional[str] = None
    limit: int = 50
    offset: int = 0

@app.post("/api/enrich/preview_rows")
def preview_rows(req: PreviewRowsRequest, x_internal_secret: Optional[str] = Header(default=None, alias="X-Internal-Secret")):
    require_secret(x_internal_secret)

    org = req.organization_id
    limit = max(1, min(int(req.limit or 50), 500))     # hard cap to protect BQ
    offset = max(0, int(req.offset or 0))

    # Simple filter:
    # - q: generic search substring in title/id
    # - filter_key: substring search in title OR exact match against profile
    q = (req.q or "").strip().lower()
    key = (req.filter_key or "").strip()
    key_l = key.lower()

    where = "WHERE organization_id=@org"
    params = [bigquery.ScalarQueryParameter("org", "STRING", org)]

    if key:
        # match profile EXACT or title contains key
        where += " AND (LOWER(title) LIKE @key_like OR profile=@key_exact OR LOWER(id) LIKE @key_like)"
        params.append(bigquery.ScalarQueryParameter("key_like", "STRING", f"%{key_l}%"))
        params.append(bigquery.ScalarQueryParameter("key_exact", "STRING", key))

    if q:
        where += " AND (LOWER(title) LIKE @q_like OR LOWER(id) LIKE @q_like)"
        params.append(bigquery.ScalarQueryParameter("q_like", "STRING", f"%{q}%"))

    fq = f"`{PROJECT_ID}.{BQ_DATASET}.{BQ_TABLE_CURRENT}`"

    # total_count (cheap enough; if becomes heavy later we can remove)
    sql_count = f"SELECT COUNT(1) AS cnt FROM {fq} {where}"
    cnt_row = bq_client().query(sql_count, job_config=bigquery.QueryJobConfig(query_parameters=params)).result()
    total_count = 0
    for r in cnt_row:
        total_count = int(r["cnt"])
        break

    # rows
    sql_rows = f"""
    SELECT
      id, title, unit,
      profile, thickness_mm, width_work_mm, width_full_mm,
      coating, notes,
      sheet_kind, color_system, color_code
    FROM {fq}
    {where}
    ORDER BY title
    LIMIT @limit OFFSET @offset
    """
    params2 = params + [
        bigquery.ScalarQueryParameter("limit", "INT64", limit),
        bigquery.ScalarQueryParameter("offset", "INT64", offset),
    ]

    it = bq_client().query(sql_rows, job_config=bigquery.QueryJobConfig(query_parameters=params2)).result()
    rows = []
    for r in it:
        rows.append({
            "id": r.get("id"),
            "title": r.get("title"),
            "unit": r.get("unit"),
            "profile": r.get("profile"),
            "thickness_mm": r.get("thickness_mm"),
            "width_work_mm": r.get("width_work_mm"),
            "width_full_mm": r.get("width_full_mm"),
            "coating": r.get("coating"),
            "notes": r.get("notes"),
            "sheet_kind": r.get("sheet_kind"),
            "color_system": r.get("color_system"),
            "color_code": r.get("color_code"),
        })

    return _json_safe({"ok": True, "total_count": total_count, "rows": rows})

class ChatRequest(BaseModel):
    organization_id: str
    import_job_id: Optional[str] = None
    message: str
    context: Optional[Dict[str, Any]] = None

@app.post("/api/enrich/chat")
def chat(req: ChatRequest, x_internal_secret: Optional[str] = Header(default=None, alias="X-Internal-Secret")):
    require_secret(x_internal_secret)

    # V1: пока только заглушка (НЕ 404), чтобы UI/Edge не падали.
    # Следующий шаг: Gemini -> structured patch -> settings-merge.
    return _json_safe({
        "ok": False,
        "error": "CHAT_NOT_IMPLEMENTED_YET",
        "message": "AI chat endpoint is not implemented yet. Deploy V2 to enable Gemini patches."
    })
@app.post("/api/enrich/dry_run")
def dry_run(req: DryRunRequest, x_internal_secret: Optional[str] = Header(default=None, alias="X-Internal-Secret")):
    require_secret(x_internal_secret)

    org = req.organization_id
    run_id = str(uuid.uuid4())

    prof = load_pricing_profile(org)
    ph = profile_hash(prof)

    df = fetch_current(org, limit=req.scope.limit if req.scope.limit else 0)
    titles_all = [safe_text(x) for x in (df["title"].tolist() if not df.empty and "title" in df.columns else [])]

    # SAMPLE PRIORITY: sheet items first (roof sheets), then the rest
    def _is_sheet_title(t: str) -> bool:
        tl = (t or "").lower()
        if re.search(r"(профнастил|профлист|металлочерепиц|монтеррей|каскад|андалуз|гладк(ий|ого)\s*лист|плос(кий|кого)\s*лист)", tl):
            return True
        # also accept if profile token is present
        try:
            if 'extract_profile_from_title' in globals() and extract_profile_from_title(t):
                return True
        except Exception:
            pass
        return False

    titles_sheet = [t for t in titles_all if _is_sheet_title(t)]
    titles_other = [t for t in titles_all if not _is_sheet_title(t)]
    titles = titles_sheet + titles_other

    questions = build_width_questions(prof, titles, max_profiles=60)

    # ALWAYS append COATING_COLOR_MAP when ai_suggest=true
    if req.ai_suggest:
        questions.append(build_coating_color_map(prof, titles[:AI_MAX_TITLES]))

    # ===== DRY_RUN_PATCHES_V1 =====
    # Build patches for preview (UI). Apply() will still do the real write.
    patches = []
    for _, r in df.iterrows():
        pid = safe_text(r.get("id"))
        title = safe_text(r.get("title"))
        pprof = safe_text(r.get("profile"))

        if not pprof:

            pprof = extract_profile_from_title(title)
        notes = safe_text(r.get("notes"))

        # Compute sheet_kind + color_system/color_code from title/profile
        sheet_kind = "OTHER"
        if RE_SMOOTH.search(title or ""):
            sheet_kind = "SMOOTH_SHEET"
        else:
            pcanon = (pprof or "").upper().replace("–","-").replace("—","-")
            pcanon = re.sub(r"\s+", "", pcanon)
            if re.match(r"^(С|C|Н|H|НС|HC)-?\d{1,3}$", pcanon):
                sheet_kind = "PROFNASTIL"
            elif re.match(r"^(МП|MP)-?\d{1,3}$", pcanon):
                sheet_kind = "METAL_TILE"

        color_system = None
        color_code = None
        t = title or ""
        m = RE_COLOR_RAL.search(t)
        if m:
            color_system = "RAL"
            color_code = m.group(1)
        else:
            m = RE_COLOR_RR.search(t)
            if m:
                color_system = "RR"
                color_code = m.group(1)
            else:
                m = RE_DECOR.search(t)
                if m:
                    color_system = "DECOR"
                    color_code = re.sub(r"\s+", " ", m.group(1).upper()).strip()

        patch = {
            "id": pid,
            "title": title,
            "profile": pprof,
            "sheet_kind": sheet_kind,
            "color_system": color_system,
            "color_code": color_code,
        }
        patches.append(patch)

    patches_sample = (patches or [])[:50]
    # ===== /DRY_RUN_PATCHES_V1 =====

    

    resp = {
        "ok": True,
        "organization_id": org,
        "import_job_id": req.import_job_id,
        "run_id": run_id,
        "profile_hash": ph,
        "stats": {
            "rows_scanned": int(len(df)),
            "candidates": int(len(df)),
            "patches_ready": int(len(patches)),
            "questions": int(len(questions)),
            "ai_questions": int(sum(1 for q in questions if isinstance(q, dict) and q.get("type") == "COATING_COLOR_MAP")),
        },
        "patches_sample": patches_sample,
        "questions": questions,
    }

    try:
        sb_patch_import_job_summary(req.import_job_id, {
            "enrich": {
                "run_id": run_id,
                "profile_hash": ph,
                "stats": resp["stats"],
                "created_at": dt.datetime.now(dt.timezone.utc),
                "status": "DRY_RUN_READY",
            }
        })
    except Exception:
        pass

    return _json_safe(resp)

@app.post("/api/enrich/apply")
def apply(req: ApplyRequest, x_internal_secret: Optional[str] = Header(default=None, alias="X-Internal-Secret")):
    require_secret(x_internal_secret)

    org = req.organization_id

    # verify enrich state exists (dry_run must have written it)
    enrich = sb_get_enrich_state(req.import_job_id)
    if not enrich:
        raise HTTPException(status_code=409, detail="No enrich state in import_jobs.summary; run dry_run first")
    if enrich.get("run_id") != req.run_id:
        raise HTTPException(status_code=409, detail="run_id mismatch; run dry_run again")
    if enrich.get("profile_hash") != req.profile_hash:
        raise HTTPException(status_code=409, detail="profile_hash mismatch; run dry_run again")

    prof = load_pricing_profile(org)
    ph_now = profile_hash(prof)
    if ph_now != req.profile_hash:
        raise HTTPException(status_code=409, detail="Org pricing profile changed; run dry_run again")

    widths_selected = prof.get("widths_selected") or {}
    profile_aliases = prof.get("profile_aliases") or {}
    coatings = prof.get("coatings") or {}

    df = fetch_current(org, limit=0)

    # Build patches
    patches: List[Dict[str, Any]] = []
    for _, r in df.iterrows():
        pid = safe_text(r.get("id"))
        title = safe_text(r.get("title"))
        notes = safe_text(r.get("notes"))

        # thickness: reuse existing if present else try parse
        th = r.get("thickness_mm")
        if th is None or (isinstance(th, float) and pd.isna(th)):
            # simple parse 0.45 / 0,5 patterns
            mth = re.search(r'(?:(?:-|\\s|\\(|/))((?:0[\\.,]\\d{1,2}|1[\\.,]\\d{1,2}))(?=\\b|\\)|$)', title)
            if mth:
                try:
                    th = float(mth.group(1).replace(",", "."))
                except Exception:
                    th = None

        # ral tagging
        ral = None
        mral = re.search(r'(?:RAL\\s*)?(\\d{4})', title.upper())
        if mral:
            ral = mral.group(1)
        notes_append = None
        if ral and not re.search(r'\\bral=\\d{4}\\b', notes or ""):
            notes_append = f"ral={ral}"

        # detect profile -> widths_selected
        detected_profile = None
        for raw in extract_tokens(title):
            tok = _tok_norm(raw)
            canon = None
            for v in _tok_variants(tok):
                if v in profile_aliases:
                    canon = profile_aliases[v]
                    break
            canon = _tok_norm(canon or tok)
            if isinstance(widths_selected, dict) and canon in widths_selected:
                detected_profile = canon
                break

        ww = None
        wf = None
        if detected_profile and isinstance(widths_selected.get(detected_profile), dict):
            ww = widths_selected[detected_profile].get("work_mm")
            wf = widths_selected[detected_profile].get("full_mm")

        # coating by aliases (substring match)
        coating_val = safe_text(r.get("coating") or "")
        if not coating_val and isinstance(coatings, dict):
            tl = title.lower()
            for token, aliases in coatings.items():
                if not token:
                    continue
                if isinstance(aliases, list):
                    for a in aliases:
                        if a and a.lower() in tl:
                            coating_val = str(token)
                            break
                if coating_val:
                    break

        # _KIND_COLOR_V1
        # Compute sheet_kind + color_system/color_code from title/profile

        t = (title or "")
        tl = t.lower()

        # IS_ACCESSORY_V1
        # Accessory/marketing items are NOT sheets even if they mention profiles or "на профнастил"
        is_accessory = bool(re.search(r"\b(буклет|каталог|инструкц|сертификат|паспорт|оклад|выход|проходка|манжет|аэратор|воронк|планк|конек|ендов|карниз|торцев|примык|нащельник|саморез|шуруп|винт|кронштейн|держател|лоток|заглушк|уплотн|снегозадерж|ворота|калитк|ламель|штакет|жалюзи|планка\s+стыковочная)\b", tl))

        # SHEET_KIND_GUARD_V1
        # Accessory/marketing items are NOT sheets even if they say "на профнастил/на металлочерепицу"
        if re.search(r"\b(буклет|каталог|инструкц|сертификат|паспорт|оклад|выход|проходка|манжет|аэратор|воронк|планк|конек|ендов|карниз|торцев|примык|нащельник|саморез|шуруп|винт|кронштейн|держател|лоток|заглушк|уплотн|снегозадерж)\b", tl):
            sheet_kind = "OTHER"
        else:
            if re.search(r"\bна\s+(профнастил|профлист|металлочерепиц)\b", tl):
                sheet_kind = "OTHER"

        # 1) sheet_kind: prefer explicit words in title
        sheet_kind = "OTHER"
        if (not is_accessory) and RE_SMOOTH.search(t):
            sheet_kind = "SMOOTH_SHEET"
        else:
            if (not is_accessory) and re.search(r"(профнастил|профлист|профлиста|профлист\b|профилированн(ый|ого)\s+лист)", tl):
                sheet_kind = "PROFNASTIL"
            elif (not is_accessory) and re.search(r"(металлочерепиц|монтеррей|каскад|андалуз|ламонтерра|монтерроса)", tl):
                sheet_kind = "METAL_TILE"
            else:
                # fallback by extracted/normalized profile token
                pcanon = (p or "").upper().replace("–","-").replace("—","-")
                pcanon = re.sub(r"\s+", "", pcanon)
                if (not is_accessory) and re.match(r"^(С|C|Н|H|НС|HC)-?\d{1,3}$", pcanon):
                    sheet_kind = "PROFNASTIL"
                elif (not is_accessory) and re.match(r"^(МП|MP)-?\d{1,3}$", pcanon):
                    sheet_kind = "METAL_TILE"

        color_system = None


        # FINAL_FIX_V3_BEGIN
        # Hard last-layer normalization right before patch write (last-write-wins).
        # Guarantees:
        # - (3005) => RAL3005 (by whitelist if present)
        # - RR32 => RR32 (never '32')
        # - accessories => sheet_kind OTHER
        try:
            _t2 = t if isinstance(t, str) else ""
        except Exception:
            _t2 = ""

        try:
            _tl2 = tl if isinstance(tl, str) else _t2.lower()
        except Exception:
            _tl2 = _t2.lower()

        # accessory flag (local, guaranteed)
        try:
            _is_accessory2 = bool(re.search(r"\b(буклет|каталог|инструкц|сертификат|паспорт|оклад|выход|проходк|манжет|аэратор|воронк|планк|конек|ендов|карниз|торцев|примык|нащельник|саморез|шуруп|винт|кронштейн|держател|лоток|заглушк|уплотн|снегозадерж)\b", _tl2))
        except Exception:
            _is_accessory2 = False

        # RAL whitelist digits-only (local, guaranteed)
        _ral_wl2 = set()
        try:
            _wl_list = None
            if isinstance(prof, dict):
                _dflt = prof.get("defaults")
                if isinstance(_dflt, dict):
                    _wl_list = _dflt.get("ral_classic_codes")
            if isinstance(_wl_list, list):
                for _x in _wl_list:
                    if not _x:
                        continue
                    _sx = str(_x).strip().upper().replace(" ", "")
                    if _sx.startswith("RAL") and len(_sx) == 7:
                        _sx = _sx[3:]
                    if re.fullmatch(r"\d{4}", _sx):
                        _ral_wl2.add(_sx)
        except Exception:
            _ral_wl2 = set()

        # (####) => RAL#### if still empty
        if (not color_system) and (not color_code):
            _m4 = re.search(r"\((\d{4})\)", _t2)
            if _m4:
                _code = _m4.group(1)
                _ok = (_code in _ral_wl2) if _ral_wl2 else True
                if _ok:
                    color_system = "RAL"
                    color_code = "RAL" + _code

        # RR from title wins (RR-32 / RR32 / RR 32)
        _mrr = re.search(r"\bRR[-\s]?(\d{1,2})\b", _t2, flags=re.I)
        if _mrr:
            try:
                _n = int(_mrr.group(1))
                color_system = "RR"
                color_code = "RR%02d" % _n
            except Exception:
                pass
        else:
            # normalize existing RR
            try:
                if color_system == "RR" and color_code:
                    _cc = str(color_code).strip().upper().replace(" ", "")
                    if _cc.startswith("RR"):
                        _digits = re.sub(r"\D+", "", _cc[2:])
                    else:
                        _digits = re.sub(r"\D+", "", _cc)
                    if _digits:
                        _n = int(_digits)
                        color_code = "RR%02d" % _n
            except Exception:
                pass

        # normalize RAL form (3005 -> RAL3005)
        try:
            if color_system == "RAL" and color_code:
                _cc = str(color_code).strip().upper().replace(" ", "")
                if re.fullmatch(r"\d{4}", _cc):
                    color_code = "RAL" + _cc
                else:
                    color_code = _cc
        except Exception:
            pass

        # accessories override kind
        if _is_accessory2:
            sheet_kind = "OTHER"
        # FINAL_FIX_V3_END

        # DEDUPE_COLOR_TAIL_V4: no duplicate tail found


        # FINAL_KIND_COLOR_V4
        # Last-write-wins normalization right before patches.append({
        # accessory detection (local)
        try:
            _tl2 = (tl if isinstance(tl, str) else (t or '').lower())
        except Exception:
            _tl2 = (t or '').lower()
        try:
            _is_accessory = bool(re.search(r"\b(буклет|каталог|инструкц|сертификат|паспорт|оклад|выход|проходк|манжет|аэратор|воронк|планк|конек|ендов|карниз|торцев|примык|нащельник|саморез|шуруп|винт|кронштейн|держател|лоток|заглушк|уплотн|снегозадерж)\b", _tl2))
        except Exception:
            _is_accessory = False
        if _is_accessory:
            sheet_kind = 'OTHER'

        # digits-only RAL whitelist (pricing.defaults.ral_classic_codes)
        _ral_wl = set()
        try:
            _wl = None
            if isinstance(prof, dict):
                _d = prof.get('defaults')
                if isinstance(_d, dict):
                    _wl = _d.get('ral_classic_codes')
            if isinstance(_wl, list):
                for x in _wl:
                    if not x: continue
                    s = str(x).strip().upper().replace(' ','')
                    if s.startswith('RAL') and len(s)==7:
                        s = s[3:]
                    if re.fullmatch(r"\d{4}", s):
                        _ral_wl.add(s)
        except Exception:
            _ral_wl = set()

        # (3005) => RAL3005 if still empty
        if (not color_system) and (not color_code):
            m4 = re.search(r"\((\d{4})\)", t or '')
            if m4:
                code = m4.group(1)
                ok = ((code in _ral_wl) or (('RAL'+code) in _ral_wl)) if _ral_wl else True
                if ok:
                    color_system = 'RAL'
                    color_code = 'RAL' + code

        # normalize RR and RAL shapes
        try:
            if color_system == 'RR' and color_code:
                cc = str(color_code).strip().upper().replace(' ', '')
                if cc.startswith('RR'):
                    cc = cc[2:]
                digs = re.sub(r"\D+", "", cc)
                if digs:
                    n = int(digs)
                    color_code = 'RR%02d' % n
            if color_system == 'RAL' and color_code:
                cc = str(color_code).strip().upper().replace(' ', '')
                if cc.startswith('RAL'):
                    cc = cc[3:]
                if re.fullmatch(r"\d{4}", cc):
                    color_code = 'RAL' + cc
        except Exception:
            pass


        # FINAL_COLOR_NORMALIZE_V3
        # 1) RR always RR##
        try:
            if color_system == "RR" and color_code:
                cc = str(color_code).strip().upper().replace(" ", "")
                if cc.startswith("RR"):
                    cc = cc[2:]
                digits = re.sub(r"\D+", "", cc)
                if digits:
                    color_code = "RR%02d" % int(digits)
        except Exception:
            pass

        # 2) (####) => RAL#### if still empty (use whitelist if available)
        try:
            if (not color_system) and (not color_code):
                m4 = re.search(r"\((\d{4})\)", t)
                if m4:
                    code = m4.group(1)
                    wl = set()
                    try:
                        dflt = prof.get("defaults") if isinstance(prof, dict) else None
                        wl_list = dflt.get("ral_classic_codes") if isinstance(dflt, dict) else None
                        if isinstance(wl_list, list):
                            for x in wl_list:
                                sx = str(x).strip().upper().replace(" ", "")
                                if sx.startswith("RAL"):
                                    sx = sx[3:]
                                if re.fullmatch(r"\d{4}", sx):
                                    wl.add(sx)
                    except Exception:
                        wl = set()
                    if (not wl) or (code in wl):
                        color_system = "RAL"
                        color_code = "RAL" + code
        except Exception:
            pass

        # 3) normalize RAL form
        try:
            if color_system == "RAL" and color_code:
                cc = str(color_code).strip().upper().replace(" ", "")
                if re.fullmatch(r"\d{4}", cc):
                    color_code = "RAL" + cc
                else:
                    color_code = cc
        except Exception:
            pass

        patches.append({
            "organization_id": org,
            "sheet_kind": sheet_kind,
            "color_system": color_system,
            "color_code": color_code,
            "id": pid,
            "profile": detected_profile,
            "thickness_mm": th,
            "coating": coating_val or None,
            "width_work_mm": ww,
            "width_full_mm": wf,
            "weight_kg_m2": r.get("weight_kg_m2"),
            "notes_append": notes_append,
            "updated_at": dt.datetime.now(dt.timezone.utc),
        })

    # staging cleanup + write + merge
    delete_staging(org, req.run_id)
    written = write_patches_to_bq(req.run_id, patches)
    merge_patches_into_current(org, req.run_id)

    sb_patch_import_job_summary(req.import_job_id, {
        "enrich": {
            "status": "APPLIED",
            "applied_at": dt.datetime.now(dt.timezone.utc),
            "applied_stats": {"patched_rows": int(written)}
        }
    })

    return {"ok": True, "organization_id": org, "import_job_id": req.import_job_id, "run_id": req.run_id, "patched_rows": int(written)}




# ============================================================
# ASYNC APPLY via Cloud Tasks (Edge-safe: no 55s timeout)
# Adds:
#   POST /api/enrich/apply_start
#   POST /api/enrich/apply_worker   (called by Cloud Tasks)
#   GET  /api/enrich/apply_status
# Stores status in Supabase: import_jobs.summary.enrich_apply
# ============================================================

from fastapi import Request
from pydantic import BaseModel
import os, json, time, uuid
import requests
from google.cloud import tasks_v2

def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default) or default

def _public_base_url() -> str:
    # Prefer explicit env (stable for Cloud Tasks)
    u = _env("PUBLIC_BASE_URL","").strip()
    if u:
        return u.rstrip("/")
    # Fallback: try Cloud Run URL envs
    u = _env("K_SERVICE","")
    # last resort: empty
    return ""

def _internal_secret() -> str:
    return _env("ENRICH_SHARED_SECRET","")

def _require_internal_secret(x_internal_secret: str | None) -> None:
    secret = _internal_secret()
    if not secret:
        raise HTTPException(status_code=500, detail="ENRICH_SHARED_SECRET is not set")
    if not x_internal_secret or x_internal_secret != secret:
        raise HTTPException(status_code=403, detail="Forbidden: invalid X-Internal-Secret")

def _sb_headers() -> dict:
    key = _env("SUPABASE_SERVICE_KEY") or _env("SUPABASE_SERVICE_ROLE_KEY")
    if not key:
        raise RuntimeError("Supabase service key missing")
    return {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

def _sb_url(path: str) -> str:
    base = _env("SUPABASE_URL").rstrip("/")
    if not base:
        raise RuntimeError("SUPABASE_URL missing")
    return base + path

def _sb_get_import_job(import_job_id: str) -> dict | None:
    url = _sb_url(f"/rest/v1/import_jobs?select=id,summary&limit=1&id=eq.{import_job_id}")
    r = requests.get(url, headers=_sb_headers(), timeout=30)
    if r.status_code >= 300:
        return None
    rows = r.json() or []
    return rows[0] if rows else None

def _deep_merge(a, b):
    if isinstance(a, dict) and isinstance(b, dict):
        out = dict(a)
        for k,v in b.items():
            out[k] = _deep_merge(out.get(k), v)
        return out
    return b

def _sb_patch_import_job_summary(import_job_id: str, patch_obj: dict) -> None:
    job = _sb_get_import_job(import_job_id)
    if not job:
        raise HTTPException(status_code=404, detail="import_job_id not found")
    cur = job.get("summary") or {}
    if not isinstance(cur, dict): cur = {}
    merged = _deep_merge(cur, patch_obj)
    url = _sb_url(f"/rest/v1/import_jobs?id=eq.{import_job_id}")
    r = requests.patch(url, headers=_sb_headers(), data=json.dumps({"summary": merged}), timeout=30)
    if r.status_code >= 300:
        raise HTTPException(status_code=502, detail=f"Supabase patch summary failed: {r.status_code}")

def _sb_get_enrich_apply_state(import_job_id: str) -> dict:
    job = _sb_get_import_job(import_job_id)
    if not job:
        return {}
    summary = job.get("summary") or {}
    if not isinstance(summary, dict): return {}
    enrich = summary.get("enrich") or {}
    if not isinstance(enrich, dict): enrich = {}
    st = enrich.get("apply") or {}
    return st if isinstance(st, dict) else {}

class ApplyStartRequest(BaseModel):
    organization_id: str
    import_job_id: str
    run_id: str
    profile_hash: str

class ApplyWorkerRequest(BaseModel):
    organization_id: str
    import_job_id: str
    run_id: str
    profile_hash: str
    apply_id: str

def _tasks_client():
    return tasks_v2.CloudTasksClient()

def _create_apply_task(payload: dict, request_base_url: str) -> str:
    """
    Enqueue Cloud Task that calls /api/enrich/apply_worker with OIDC token.
    """
    project = _env("PROJECT_ID") or _env("GOOGLE_CLOUD_PROJECT")
    queue = _env("TASKS_QUEUE","catalog-enricher-apply")
    location = _env("TASKS_LOCATION","us-central1")
    sa_email = _env("TASKS_SA_EMAIL","")

    if not project:
        raise RuntimeError("PROJECT_ID/GOOGLE_CLOUD_PROJECT missing for tasks")
    if not sa_email:
        raise RuntimeError("TASKS_SA_EMAIL missing for OIDC")

    parent = _tasks_client().queue_path(project, location, queue)

    # call THIS service (base_url comes from incoming request)
    base = (_public_base_url() or request_base_url).rstrip("/")
    url = base + "/api/enrich/apply_worker"

    task = {
        "http_request": {
            "http_method": tasks_v2.HttpMethod.POST,
            "url": url,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps(payload).encode("utf-8"),
            "oidc_token": {
                "service_account_email": sa_email,
                # audience can be service URL (base)
                "audience": request_base_url.rstrip("/"),
            },
        }
    }

    resp = _tasks_client().create_task(parent=parent, task=task)
    return resp.name  # task name

@app.post("/api/enrich/apply_start")
def apply_start(req: ApplyStartRequest, request: Request, x_internal_secret: str | None = Header(default=None, alias="X-Internal-Secret")):
    _require_internal_secret(x_internal_secret)

    apply_id = str(uuid.uuid4())
    now = time.time()

    # write state QUEUED
    _sb_patch_import_job_summary(req.import_job_id, {
        "enrich": {
            "apply": {
                "apply_id": apply_id,
                "status": "QUEUED",
                "queued_at": now,
                "progress": 0,
                "patched_rows": None,
                "error": None
            }
        }
    })

    # enqueue cloud task
    base_url = (_public_base_url() or str(request.base_url).rstrip("/"))
    task_name = _create_apply_task({
        "organization_id": req.organization_id,
        "import_job_id": req.import_job_id,
        "run_id": req.run_id,
        "profile_hash": req.profile_hash,
        "apply_id": apply_id,
        "internal_secret": _internal_secret(),  # used only for internal call (below)
    }, base_url)

    return {"ok": True, "apply_id": apply_id, "status": "QUEUED", "task_name": task_name}

@app.get("/api/enrich/apply_status")
def apply_status(import_job_id: str, apply_id: str, x_internal_secret: str | None = Header(default=None, alias="X-Internal-Secret")):
    _require_internal_secret(x_internal_secret)
    st = _sb_get_enrich_apply_state(import_job_id)
    if not st:
        return {"ok": True, "status": "NOT_FOUND", "apply_id": apply_id}
    # if apply_id mismatched, still return state (UI can decide)
    return {"ok": True, **st}

@app.post("/api/enrich/apply_worker")
def apply_worker(req: ApplyWorkerRequest, request: Request):
    """
    Called by Cloud Tasks (OIDC). We do NOT require X-Internal-Secret header here;
    instead we are protected by Cloud Run IAM (invoker) + Cloud Tasks OIDC.
    Inside, we call existing synchronous /api/enrich/apply endpoint of this service.
    """
    # Mark RUNNING
    _sb_patch_import_job_summary(req.import_job_id, {
        "enrich": {"apply": {"apply_id": req.apply_id, "status": "RUNNING", "started_at": time.time(), "progress": 10}}
    })

    base_url = (_public_base_url() or str(request.base_url).rstrip("/"))
    # call existing apply endpoint (uses internal secret)
    try:
        r = requests.post(
            base_url + "/api/enrich/apply",
            headers={"Content-Type":"application/json","X-Internal-Secret": _internal_secret()},
            data=json.dumps({
                "organization_id": req.organization_id,
                "import_job_id": req.import_job_id,
                "run_id": req.run_id,
                "profile_hash": req.profile_hash
            }),
            timeout=3600
        )

        if r.status_code >= 300:
            _sb_patch_import_job_summary(req.import_job_id, {
                "enrich": {"apply": {"apply_id": req.apply_id, "status": "FAILED", "finished_at": time.time(), "error": f"apply http {r.status_code}: {r.text[:500]}"}}
            })
            return {"ok": False, "status": "FAILED"}

        data = {}
        try:
            data = r.json()
        except Exception:
            data = {"raw": r.text[:500]}

        patched_rows = data.get("patched_rows") if isinstance(data, dict) else None

        _sb_patch_import_job_summary(req.import_job_id, {
            "enrich": {"apply": {"apply_id": req.apply_id, "status": "DONE", "finished_at": time.time(), "progress": 100, "patched_rows": patched_rows}}
        })
        return {"ok": True, "status": "DONE", "patched_rows": patched_rows}

    except Exception as e:
        _sb_patch_import_job_summary(req.import_job_id, {
            "enrich": {"apply": {"apply_id": req.apply_id, "status": "FAILED", "finished_at": time.time(), "error": str(e)[:500]}}
        })
        return {"ok": False, "status": "FAILED"}
