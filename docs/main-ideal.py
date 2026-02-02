"""
catalog-enricher main.py v5.0 IDEAL
====================================
Cloud Run Worker для нормализации каталога кровельных материалов.

ИСПРАВЛЕНО:
1. ЕДИНЫЙ КЛАССИФИКАТОР - один проход, нет дублирования
2. ПРАВИЛЬНЫЙ COLOR - RR32→RR32, (3005)→RAL3005  
3. ACCESSORY GUARD - первая проверка, до любой классификации
4. ГИБРИДНЫЙ APPLY - sync ≤5000 строк, async >5000

АРХИТЕКТУРА:
- classify_item() - единая точка входа для sheet_kind/color_system/color_code
- enrich_row() - обогащение одной строки (profile, thickness, coating, widths)
- build_patch() - формирование патча для BQ
- apply() - sync для малых объемов
- apply_start/worker/status - async для больших объемов через Cloud Tasks
"""

import os
import io
import re
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

from google.cloud import bigquery, tasks_v2

import vertexai
from vertexai.generative_models import GenerativeModel, GenerationConfig


# ============================================================================
# CONFIGURATION
# ============================================================================

app = FastAPI(title="catalog-enricher", version="5.0-ideal")

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

# Hybrid apply threshold: sync if rows <= this, async otherwise
APPLY_SYNC_THRESHOLD = int(os.environ.get("APPLY_SYNC_THRESHOLD", "5000"))


# ============================================================================
# REGEX PATTERNS (COMPILED ONCE)
# ============================================================================

# Sheet profile patterns (С21, Н60, НС35, МП20)
RE_PROFILE = re.compile(
    r'(^|[^A-ZА-Я0-9])((?:НС|HC|С|C|Н|H|МП|MP)\s*[-–—]?\s*\d{1,3})([^A-ZА-Я0-9]|$)', 
    re.I
)

# Color patterns  
RE_RAL_EXPLICIT = re.compile(r'\bRAL\s*[-–]?\s*(\d{4})\b', re.I)  # "RAL 3005" or "RAL3005"
RE_RAL_PARENS = re.compile(r'\((\d{4})\)')  # "(3005)" - requires whitelist validation
RE_RR = re.compile(r'\bRR\s*[-–]?\s*(\d{1,2})\b', re.I)  # "RR32" or "RR 32"
RE_DECOR = re.compile(r'\b(ДУБ|ОРЕХ|КИРПИЧ|КАМЕНЬ|МОРЕНЫЙ\s*ДУБ|МРАМОР|ГРАНИТ)\b', re.I)

# Sheet type keywords
RE_SMOOTH_SHEET = re.compile(r'(гладк(ий|ого)\s*лист|плос(кий|кого)\s*лист)', re.I)
RE_PROFNASTIL = re.compile(r'(профнастил|профлист|профлиста|профилированн(ый|ого)\s+лист)', re.I)
RE_METAL_TILE = re.compile(r'(металлочерепиц|монтеррей|монтерроса|каскад|андалуз|ламонтерра)', re.I)

# Accessory patterns - THESE ITEMS ARE NEVER SHEETS
RE_ACCESSORY = re.compile(
    r'\b(буклет|каталог|инструкц|сертификат|паспорт|оклад|выход|проходк|манжет|'
    r'аэратор|воронк|планк|конек|ендов|карниз|торцев|примык|нащельник|'
    r'саморез|шуруп|винт|кронштейн|держател|лоток|заглушк|уплотн|снегозадерж|'
    r'ворота|калитк|ламель|штакет|жалюзи|планка\s+стыковочная)\b',
    re.I
)

# "для профнастила" / "на металлочерепицу" - these are accessories FOR sheets, not sheets themselves
RE_FOR_SHEET = re.compile(r'\b(для|на|под)\s+(профнастил|профлист|металлочерепиц)', re.I)

# Thickness extraction: 0.45, 0,5, etc.
RE_THICKNESS = re.compile(r'(?:^|[^\d])([0-2][.,]\d{1,2})(?:$|[^\d])')

# Profile token extractor for width questions
RE_TOKEN = re.compile(r'(?<!\w)([A-Za-zА-Яа-я]{1,4}\s*[-–]?\s*\d{1,3}(?:\s*[-–]\s*\d{2,4})?)(?!\w)', re.U)


# ============================================================================
# CLASSIFICATION (ЕДИНЫЙ КЛАССИФИКАТОР - ГЛАВНАЯ ЛОГИКА)
# ============================================================================

class ClassificationResult:
    """Result of item classification."""
    def __init__(self):
        self.sheet_kind: str = "OTHER"
        self.color_system: Optional[str] = None
        self.color_code: Optional[str] = None
        self.profile: Optional[str] = None
        self.is_accessory: bool = False


def classify_item(
    title: str,
    existing_profile: Optional[str] = None,
    ral_whitelist: Optional[set] = None
) -> ClassificationResult:
    """
    ЕДИНАЯ ТОЧКА ВХОДА для классификации товара.
    
    Порядок проверок (важен!):
    1. Accessory guard - если аксессуар, сразу sheet_kind=OTHER
    2. Извлечение профиля
    3. Определение sheet_kind по ключевым словам и профилю
    4. Извлечение цвета (RAL/RR/DECOR)
    
    Returns:
        ClassificationResult with sheet_kind, color_system, color_code, profile
    """
    result = ClassificationResult()
    
    if not title:
        return result
    
    t = title.strip()
    tl = t.lower()
    
    # ========================================
    # STEP 1: ACCESSORY GUARD (FIRST!)
    # ========================================
    if RE_ACCESSORY.search(tl) or RE_FOR_SHEET.search(tl):
        result.is_accessory = True
        result.sheet_kind = "OTHER"
        # Continue to extract profile/color for metadata, but sheet_kind stays OTHER
    
    # ========================================
    # STEP 2: EXTRACT PROFILE
    # ========================================
    profile = existing_profile
    if not profile:
        m = RE_PROFILE.search(t.upper())
        if m:
            raw = m.group(2) or ""
            raw = raw.replace("–", "-").replace("—", "-")
            raw = re.sub(r"\s+", "", raw)
            # Normalize Cyrillic/Latin
            raw = raw.replace("HC", "НС").replace("H", "Н").replace("C", "С").replace("MP", "МП")
            raw = raw.replace("-", "")  # С-21 -> С21
            profile = raw
    
    result.profile = profile
    
    # ========================================
    # STEP 3: SHEET_KIND (only if not accessory)
    # ========================================
    if not result.is_accessory:
        # Priority 1: Smooth sheet
        if RE_SMOOTH_SHEET.search(t):
            result.sheet_kind = "SMOOTH_SHEET"
        
        # Priority 2: Explicit keywords
        elif RE_PROFNASTIL.search(tl):
            result.sheet_kind = "PROFNASTIL"
        
        elif RE_METAL_TILE.search(tl):
            result.sheet_kind = "METAL_TILE"
        
        # Priority 3: Fallback by profile pattern
        elif profile:
            pcanon = profile.upper()
            if re.match(r'^(С|C|Н|H|НС|HC)\d{1,3}$', pcanon):
                result.sheet_kind = "PROFNASTIL"
            elif re.match(r'^(МП|MP)\d{1,3}$', pcanon):
                result.sheet_kind = "METAL_TILE"
    
    # ========================================
    # STEP 4: COLOR EXTRACTION
    # ========================================
    
    # Priority 1: Explicit RAL (RAL 3005)
    m = RE_RAL_EXPLICIT.search(t)
    if m:
        code = m.group(1)
        result.color_system = "RAL"
        result.color_code = f"RAL{code}"
    
    # Priority 2: RR colors (RR32, RR 32)
    elif (m := RE_RR.search(t)):
        num = int(m.group(1))
        result.color_system = "RR"
        result.color_code = f"RR{num:02d}"  # Always RR32, not just 32
    
    # Priority 3: Parenthesized 4-digit (3005) - validate against whitelist if provided
    elif (m := RE_RAL_PARENS.search(t)):
        code = m.group(1)
        # If whitelist provided, validate; otherwise accept
        if ral_whitelist is None or code in ral_whitelist:
            result.color_system = "RAL"
            result.color_code = f"RAL{code}"
    
    # Priority 4: Decor names (ДУБ, ОРЕХ, etc.)
    elif (m := RE_DECOR.search(t)):
        result.color_system = "DECOR"
        result.color_code = re.sub(r'\s+', ' ', m.group(1).upper()).strip()
    
    return result


def build_ral_whitelist(prof: Dict[str, Any]) -> set:
    """
    Build RAL whitelist from pricing profile defaults.
    
    Source: prof['defaults']['ral_classic_codes'] = ["RAL3005", "3009", ...]
    Returns: set of 4-digit strings {"3005", "3009", ...}
    """
    whitelist = set()
    
    try:
        defaults = prof.get("defaults") if isinstance(prof, dict) else None
        if not isinstance(defaults, dict):
            return whitelist
        
        codes = defaults.get("ral_classic_codes")
        if not isinstance(codes, list):
            return whitelist
        
        for x in codes:
            if not x:
                continue
            s = str(x).strip().upper().replace(" ", "")
            # "RAL3005" -> "3005", "3005" -> "3005"
            if s.startswith("RAL") and len(s) == 7:
                s = s[3:]
            if re.fullmatch(r'\d{4}', s):
                whitelist.add(s)
    
    except Exception:
        pass
    
    return whitelist


# ============================================================================
# ENRICHMENT (Обогащение строки)
# ============================================================================

def safe_text(v: Any) -> str:
    """Safe string conversion handling pandas NA values."""
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


def extract_thickness(title: str) -> Optional[float]:
    """Extract thickness (0.45, 0.5, etc.) from title."""
    m = RE_THICKNESS.search(title or "")
    if m:
        try:
            return float(m.group(1).replace(",", "."))
        except Exception:
            pass
    return None


def extract_tokens(title: str) -> List[str]:
    """Extract profile-like tokens from title for width questions."""
    t = safe_text(title)
    return [m.group(1) for m in RE_TOKEN.finditer(t)] if t else []


def _tok_norm(tok: str) -> str:
    """Normalize token: uppercase, no spaces, standardize dashes."""
    t = safe_text(tok).strip()
    t = t.replace("–", "-").replace("—", "-")
    t = re.sub(r"\s+", "", t)
    return t.upper()


def _tok_variants(tok: str) -> List[str]:
    """Generate Cyrillic/Latin variants of token."""
    t = _tok_norm(tok)
    if not t:
        return []
    
    vs = {t}
    pairs = [("С", "C"), ("Н", "H"), ("М", "M"), ("Р", "P"), ("Х", "X"), ("В", "B"), ("Т", "T"), ("К", "K")]
    for a, b in pairs:
        vs.add(t.replace(a, b))
        vs.add(t.replace(b, a))
    
    return sorted({re.sub(r"-{2,}", "-", x) for x in vs})


def enrich_row(
    row: Dict[str, Any],
    prof: Dict[str, Any],
    ral_whitelist: set
) -> Dict[str, Any]:
    """
    Enrich a single row with normalized fields.
    
    Args:
        row: Dict with id, title, notes, profile, thickness_mm, coating, etc.
        prof: Pricing profile from bot_settings.settings_json
        ral_whitelist: Set of valid RAL codes (4 digits)
    
    Returns:
        Dict with enriched fields ready for patch
    """
    pid = safe_text(row.get("id"))
    title = safe_text(row.get("title"))
    notes = safe_text(row.get("notes"))
    existing_profile = safe_text(row.get("profile"))
    
    # ---- CLASSIFICATION (единый вызов) ----
    cls = classify_item(title, existing_profile, ral_whitelist)
    
    # ---- THICKNESS ----
    thickness = row.get("thickness_mm")
    if thickness is None or (isinstance(thickness, float) and pd.isna(thickness)):
        thickness = extract_thickness(title)
    
    # ---- COATING ----
    coatings_map = prof.get("coatings") or {}
    coating_val = safe_text(row.get("coating") or "")
    
    if not coating_val and isinstance(coatings_map, dict):
        tl = title.lower()
        for token, aliases in coatings_map.items():
            if not token:
                continue
            if isinstance(aliases, list):
                for a in aliases:
                    if a and a.lower() in tl:
                        coating_val = str(token)
                        break
            if coating_val:
                break
    
    # ---- WIDTHS (from profile aliases -> widths_selected) ----
    widths_selected = prof.get("widths_selected") or {}
    profile_aliases = prof.get("profile_aliases") or {}
    
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
    
    width_work = None
    width_full = None
    if detected_profile and isinstance(widths_selected.get(detected_profile), dict):
        width_work = widths_selected[detected_profile].get("work_mm")
        width_full = widths_selected[detected_profile].get("full_mm")
    
    # Use classification profile if no detected profile from widths
    final_profile = detected_profile or cls.profile
    
    # ---- NOTES APPEND (RAL tag) ----
    notes_append = None
    if cls.color_system == "RAL" and cls.color_code:
        ral_digits = cls.color_code.replace("RAL", "")
        if not re.search(r'\bral=\d{4}\b', notes or ""):
            notes_append = f"ral={ral_digits}"
    
    return {
        "organization_id": safe_text(row.get("organization_id")),
        "id": pid,
        "profile": final_profile,
        "thickness_mm": thickness,
        "coating": coating_val or None,
        "width_work_mm": width_work,
        "width_full_mm": width_full,
        "weight_kg_m2": row.get("weight_kg_m2"),
        "sheet_kind": cls.sheet_kind,
        "color_system": cls.color_system,
        "color_code": cls.color_code,
        "notes_append": notes_append,
        "updated_at": dt.datetime.now(dt.timezone.utc),
    }


# ============================================================================
# SECURITY & UTILITIES
# ============================================================================

_rl_state: Dict[str, Tuple[float, float]] = {}


def _rate_limit_allow(ip: str) -> bool:
    """Token bucket rate limiter."""
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


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default) or default


def require_secret(x_internal_secret: Optional[str]) -> None:
    secret = _env("ENRICH_SHARED_SECRET")
    if not secret:
        raise HTTPException(status_code=500, detail="ENRICH_SHARED_SECRET is not set")
    if not x_internal_secret or x_internal_secret != secret:
        raise HTTPException(status_code=403, detail="Forbidden: invalid X-Internal-Secret")


def _json_safe(obj: Any) -> Any:
    """Recursively sanitize for JSON serialization."""
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


# ============================================================================
# SUPABASE CLIENT
# ============================================================================

def _supabase_env() -> Tuple[str, str]:
    supabase_url = _env("SUPABASE_URL").rstrip("/")
    service_key = _env("SUPABASE_SERVICE_KEY") or _env("SUPABASE_SERVICE_ROLE_KEY")
    return supabase_url, service_key


def sb_headers() -> Dict[str, str]:
    url, key = _supabase_env()
    if not url or not key:
        raise RuntimeError("Supabase env missing")
    return {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}


def sb_url(path: str) -> str:
    url, _ = _supabase_env()
    return url + path


def load_pricing_profile(organization_id: str) -> Dict[str, Any]:
    """Load and merge pricing profile from bot_settings."""
    url, key = _supabase_env()
    if not url or not key:
        return {}

    r = requests.get(
        f"{url}/rest/v1/bot_settings?select=settings_json&organization_id=eq.{organization_id}&limit=1",
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        timeout=30
    )
    if r.status_code >= 300:
        return {}
    
    rows = r.json() or []
    if not rows:
        return {}
    
    settings = rows[0].get("settings_json") or {}
    if not isinstance(settings, dict):
        return {}
    
    # Merge root + pricing for convenience
    pr = settings.get("pricing")
    if isinstance(pr, dict):
        merged = dict(settings)
        merged.update(pr)
        return merged
    
    return settings


def profile_hash(profile: Dict[str, Any]) -> str:
    raw = json.dumps(profile or {}, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


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
    r = requests.get(
        sb_url(f"/rest/v1/import_jobs?select=*&id=eq.{import_job_id}&limit=1"),
        headers=sb_headers(),
        timeout=30
    )
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
    
    r = requests.patch(
        sb_url(f"/rest/v1/import_jobs?id=eq.{import_job_id}"),
        headers=sb_headers(),
        json={"summary": merged},
        timeout=30
    )
    if r.status_code >= 300:
        raise HTTPException(status_code=502, detail=f"Supabase patch summary failed: {r.status_code}")


def sb_get_enrich_state(import_job_id: str) -> Optional[Dict[str, Any]]:
    job = sb_get_import_job(import_job_id)
    if not job:
        return None
    s = job.get("summary") or {}
    if not isinstance(s, dict):
        return None
    e = s.get("enrich")
    return e if isinstance(e, dict) else None


# ============================================================================
# BIGQUERY CLIENT
# ============================================================================

def bq_client() -> bigquery.Client:
    return bigquery.Client(project=PROJECT_ID) if PROJECT_ID else bigquery.Client()


def fq_table(table: str) -> str:
    c = bq_client()
    return f"{c.project}.{BQ_DATASET}.{table}"


def fetch_current(org: str, limit: int = 0) -> pd.DataFrame:
    """Fetch current catalog rows from BigQuery, sorted with sheets first."""
    lim = f"LIMIT {int(limit)}" if limit and limit > 0 else ""
    sql = f"""
    SELECT 
        organization_id, id, title, notes, profile, 
        thickness_mm, coating, width_work_mm, width_full_mm, weight_kg_m2,
        sheet_kind, color_system, color_code
    FROM `{fq_table(BQ_TABLE_CURRENT)}`
    WHERE organization_id=@org
    ORDER BY
        CASE
            WHEN REGEXP_CONTAINS(UPPER(title), r'(^|[^A-ZА-Я0-9])((С|C|Н|H|НС|HC|МП|MP)\\s*-?\\s*\\d{{1,3}})([^A-ZА-Я0-9]|$)') THEN 0
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


def count_current(org: str) -> int:
    """Count total rows for org in current table."""
    sql = f"SELECT COUNT(1) AS cnt FROM `{fq_table(BQ_TABLE_CURRENT)}` WHERE organization_id=@org"
    job = bq_client().query(sql, job_config=bigquery.QueryJobConfig(
        query_parameters=[bigquery.ScalarQueryParameter("org", "STRING", org)]
    ))
    for row in job.result():
        return int(row["cnt"])
    return 0


def delete_staging(org: str, run_id: str) -> None:
    """Delete staging patches for given org and run_id."""
    sql = f"DELETE FROM `{fq_table(BQ_TABLE_PATCHES)}` WHERE organization_id=@org AND run_id=@run_id"
    bq_client().query(sql, job_config=bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("org", "STRING", org),
            bigquery.ScalarQueryParameter("run_id", "STRING", run_id),
        ]
    )).result()


def write_patches_to_bq(run_id: str, patches: List[Dict[str, Any]]) -> int:
    """Write patches to staging table using NDJSON."""
    if not patches:
        return 0
    
    dfp = pd.DataFrame(patches)
    dfp["run_id"] = run_id
    dfp["updated_at"] = dfp["updated_at"].apply(
        lambda x: x.isoformat() if hasattr(x, "isoformat") else str(x)
    )
    
    # Numeric cleanup
    for c in ["thickness_mm", "width_work_mm", "width_full_mm", "weight_kg_m2", "price_rub_m2"]:
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
    
    chunk = max(1, BQ_JSON_CHUNK_SIZE)
    for i in range(0, len(dfp), chunk):
        part = dfp.iloc[i:i+chunk]
        ndjson = part.to_json(orient="records", lines=True, date_format="iso", force_ascii=False)
        job = client.load_table_from_file(
            io.BytesIO(ndjson.encode("utf-8")), 
            fq, 
            job_config=job_config
        )
        job.result()
    
    return int(len(dfp))


def merge_patches_into_current(org: str, run_id: str) -> None:
    """Merge staging patches into current table."""
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
        profile = COALESCE(S.profile, T.profile),
        thickness_mm = COALESCE(S.thickness_mm, T.thickness_mm),
        coating = COALESCE(S.coating, T.coating),
        width_work_mm = COALESCE(S.width_work_mm, T.width_work_mm),
        width_full_mm = COALESCE(S.width_full_mm, T.width_full_mm),
        weight_kg_m2 = COALESCE(S.weight_kg_m2, T.weight_kg_m2),
        notes = CASE
            WHEN S.notes_append IS NULL THEN T.notes
            WHEN T.notes IS NULL OR T.notes = '' THEN S.notes_append
            ELSE CONCAT(T.notes, ' | ', S.notes_append)
        END,
        sheet_kind = COALESCE(S.sheet_kind, T.sheet_kind),
        color_system = COALESCE(S.color_system, T.color_system),
        color_code = COALESCE(S.color_code, T.color_code),
        updated_at = CURRENT_TIMESTAMP()
    """
    bq_client().query(sql, job_config=bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("org", "STRING", org),
            bigquery.ScalarQueryParameter("run_id", "STRING", run_id),
        ]
    )).result()


# ============================================================================
# GEMINI AI
# ============================================================================

_vertex_inited = False


def _vertex_init_once():
    global _vertex_inited
    if _vertex_inited:
        return
    vertexai.init(project=PROJECT_ID or _env("PROJECT_ID"), location=AI_LOCATION)
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
        try:
            v = json.loads(text[i:j+1])
            return v if isinstance(v, list) else None
        except Exception:
            return None
    return None


def gemini_suggest(profile: Dict[str, Any], titles: List[str], payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Call Gemini for AI suggestions."""
    _vertex_init_once()
    model = GenerativeModel(AI_MODEL_NAME)
    cfg = GenerationConfig(temperature=0.2)
    system = "Return ONLY JSON array. No markdown. No comments. If cannot comply return []."
    user = {"profile": profile or {}, "payload": payload or {}, "examples": (titles or [])[:AI_MAX_TITLES]}
    resp = model.generate_content([system, json.dumps(user, ensure_ascii=False)], generation_config=cfg)
    txt = getattr(resp, "text", "") or ""
    arr = _extract_json_array(txt) or []
    return [x for x in arr if isinstance(x, dict)]


# ============================================================================
# QUESTION BUILDERS
# ============================================================================

def build_width_questions(
    profile_cfg: Dict[str, Any], 
    titles: List[str], 
    max_profiles: int = 60
) -> List[Dict[str, Any]]:
    """Build width questions for profiles found in titles."""
    cfg = profile_cfg or {}
    defaults = cfg.get("defaults") or {}
    widths_suggested = defaults.get("widths_suggested") or {}
    widths_selected = cfg.get("widths_selected") or {}
    alias_map = cfg.get("profile_aliases") or {}
    
    from collections import Counter
    raw_counter = Counter()
    raw_example = {}
    
    for t in (titles or [])[:5000]:
        for raw in extract_tokens(t):
            tok = _tok_norm(raw)
            if not tok:
                continue
            
            # Skip non-profile tokens
            if re.match(r"^RR\d{2}$", tok):  # RR colors
                continue
            if re.match(r"^(?:RAL)?\d{4}$", tok):  # RAL codes
                continue
            if re.match(r"^E-\d{2}(?:-\d{4})?$", tok):  # E-codes
                continue
            
            # Accept only valid profile patterns
            if not re.match(r"^(?:С|C|Н|H|НС|HC|МП|MP)-?\d{1,3}$", tok):
                continue
            
            raw_counter[tok] += 1
            raw_example.setdefault(tok, safe_text(t)[:200])
    
    # Resolve to canonical profiles
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
                work = v.get("work_mm")
                full = v.get("full_mm")
                if work is None and full is None:
                    continue
                norm_vars.append({
                    "work_mm": int(work) if work is not None else None,
                    "full_mm": int(full) if full is not None else None
                })
            
            ex = [canon_examples.get(canon, "")] if canon_examples.get(canon) else []
            if len(norm_vars) == 1:
                questions.append({"type": "WIDTH_CONFIRM", "profile": canon, "suggested": norm_vars[0], "examples": ex})
            elif len(norm_vars) > 1:
                questions.append({"type": "WIDTH_CHOOSE_VARIANT", "profile": canon, "suggested_variants": norm_vars, "examples": ex})
            else:
                questions.append({"type": "WIDTH_MANUAL", "profile": canon, "examples": ex})
        else:
            ex = [canon_examples.get(canon, "")] if canon_examples.get(canon) else []
            questions.append({"type": "WIDTH_MANUAL", "profile": canon, "examples": ex})
    
    return questions


def build_coating_color_map(profile_cfg: Dict[str, Any], titles: List[str]) -> Dict[str, Any]:
    """Build coating and color mapping question."""
    cfg = profile_cfg or {}
    existing_coatings = cfg.get("coatings") or {}
    existing_ral_aliases = (cfg.get("colors") or {}).get("ral_aliases") or {}
    
    coatings_out = []
    if isinstance(existing_coatings, dict):
        for token, aliases in existing_coatings.items():
            tok = _tok_norm(token)
            als = aliases if isinstance(aliases, list) else []
            coatings_out.append({"token": tok, "aliases": [safe_text(a) for a in als if safe_text(a)]})
    
    colors_out = []
    if isinstance(existing_ral_aliases, dict):
        for token, ral in existing_ral_aliases.items():
            tok = _tok_norm(token)
            ral_s = safe_text(ral).strip().upper()
            if ral_s and not ral_s.startswith("RAL"):
                ral_s = f"RAL{ral_s}"
            colors_out.append({"token": tok, "suggested_ral": ral_s, "aliases": [tok, ral_s] if ral_s else [tok]})
    
    out: Dict[str, Any] = {"type": "COATING_COLOR_MAP", "coatings": coatings_out, "colors": colors_out}
    
    # Try AI enhancement (optional)
    try:
        payload = {
            "task": "Extract coatings and colors/RAL from titles.",
            "contract": {
                "type": "COATING_COLOR_MAP",
                "coatings": [{"token": "PE", "aliases": ["пэ", "polyester"]}],
                "colors": [{"token": "RR32", "suggested_ral": "RAL8017", "aliases": ["шоколад", "8017"]}]
            },
            "existing_coatings": existing_coatings,
            "existing_ral_aliases": existing_ral_aliases
        }
        ai = gemini_suggest(cfg, (titles or [])[:AI_MAX_TITLES], payload)
        if ai and isinstance(ai[0], dict) and ai[0].get("type") == "COATING_COLOR_MAP":
            obj = ai[0]
            if isinstance(obj.get("coatings"), list):
                out["coatings"] = obj["coatings"]
            if isinstance(obj.get("colors"), list):
                out["colors"] = obj["colors"]
    except Exception:
        pass
    
    return out


# ============================================================================
# API MODELS
# ============================================================================

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


class PreviewRowsRequest(BaseModel):
    organization_id: str
    import_job_id: Optional[str] = None
    group_type: Optional[str] = None
    filter_key: Optional[str] = None
    q: Optional[str] = None
    limit: int = 50
    offset: int = 0


class ChatRequest(BaseModel):
    organization_id: str
    import_job_id: Optional[str] = None
    message: str
    context: Optional[Dict[str, Any]] = None


# ============================================================================
# ENDPOINTS
# ============================================================================

@app.get("/health")
def health():
    return {
        "ok": True,
        "version": "5.0-ideal",
        "project_id": PROJECT_ID or None,
        "dataset": BQ_DATASET,
        "table_current": BQ_TABLE_CURRENT,
        "table_patches": BQ_TABLE_PATCHES,
        "supabase_url_set": bool(_env("SUPABASE_URL")),
        "secret_set": bool(_env("ENRICH_SHARED_SECRET")),
        "ai_model": AI_MODEL_NAME,
        "ai_location": AI_LOCATION,
        "apply_sync_threshold": APPLY_SYNC_THRESHOLD,
    }


@app.post("/api/enrich/dry_run")
def dry_run(
    req: DryRunRequest, 
    x_internal_secret: Optional[str] = Header(default=None, alias="X-Internal-Secret")
):
    """
    Perform dry run: scan catalog, classify items, build questions.
    Returns patches_sample for UI preview and questions for user input.
    """
    require_secret(x_internal_secret)
    
    org = req.organization_id
    run_id = str(uuid.uuid4())
    
    prof = load_pricing_profile(org)
    ph = profile_hash(prof)
    ral_whitelist = build_ral_whitelist(prof)
    
    df = fetch_current(org, limit=req.scope.limit if req.scope.limit else 0)
    titles_all = [safe_text(x) for x in df["title"].tolist() if not df.empty and "title" in df.columns]
    
    # Sort titles: sheets first
    def _is_sheet_title(t: str) -> bool:
        tl = (t or "").lower()
        if RE_PROFNASTIL.search(tl) or RE_METAL_TILE.search(tl) or RE_SMOOTH_SHEET.search(t):
            return True
        if RE_PROFILE.search(t.upper()):
            return True
        return False
    
    titles_sheet = [t for t in titles_all if _is_sheet_title(t)]
    titles_other = [t for t in titles_all if not _is_sheet_title(t)]
    titles = titles_sheet + titles_other
    
    # Build questions
    questions = build_width_questions(prof, titles, max_profiles=60)
    if req.ai_suggest:
        questions.append(build_coating_color_map(prof, titles[:AI_MAX_TITLES]))
    
    # Build patches for preview (using ЕДИНЫЙ классификатор)
    patches = []
    for _, r in df.iterrows():
        row_dict = r.to_dict()
        row_dict["organization_id"] = org
        
        cls = classify_item(
            safe_text(r.get("title")),
            safe_text(r.get("profile")),
            ral_whitelist
        )
        
        patches.append({
            "id": safe_text(r.get("id")),
            "title": safe_text(r.get("title")),
            "profile": cls.profile,
            "sheet_kind": cls.sheet_kind,
            "color_system": cls.color_system,
            "color_code": cls.color_code,
        })
    
    patches_sample = patches[:50]
    
    # Stats
    kind_counts = {}
    for p in patches:
        k = p.get("sheet_kind", "OTHER")
        kind_counts[k] = kind_counts.get(k, 0) + 1
    
    resp = {
        "ok": True,
        "organization_id": org,
        "import_job_id": req.import_job_id,
        "run_id": run_id,
        "profile_hash": ph,
        "stats": {
            "rows_scanned": len(df),
            "candidates": len(df),
            "patches_ready": len(patches),
            "questions": len(questions),
            "ai_questions": sum(1 for q in questions if isinstance(q, dict) and q.get("type") == "COATING_COLOR_MAP"),
            "kind_breakdown": kind_counts,
        },
        "patches_sample": patches_sample,
        "questions": questions,
    }
    
    # Save state to Supabase
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
def apply(
    req: ApplyRequest, 
    x_internal_secret: Optional[str] = Header(default=None, alias="X-Internal-Secret")
):
    """
    Apply enrichment: read all rows, enrich, write to staging, merge to current.
    For large catalogs, use apply_start for async processing.
    """
    require_secret(x_internal_secret)
    
    org = req.organization_id
    
    # Verify enrich state
    enrich = sb_get_enrich_state(req.import_job_id)
    if not enrich:
        raise HTTPException(status_code=409, detail="No enrich state; run dry_run first")
    if enrich.get("run_id") != req.run_id:
        raise HTTPException(status_code=409, detail="run_id mismatch; run dry_run again")
    if enrich.get("profile_hash") != req.profile_hash:
        raise HTTPException(status_code=409, detail="profile_hash mismatch; run dry_run again")
    
    # Load current profile and verify
    prof = load_pricing_profile(org)
    if profile_hash(prof) != req.profile_hash:
        raise HTTPException(status_code=409, detail="Pricing profile changed; run dry_run again")
    
    ral_whitelist = build_ral_whitelist(prof)
    
    # Fetch all rows
    df = fetch_current(org, limit=0)
    
    # Build patches using ЕДИНЫЙ enrich_row
    patches: List[Dict[str, Any]] = []
    for _, r in df.iterrows():
        row_dict = r.to_dict()
        row_dict["organization_id"] = org
        patch = enrich_row(row_dict, prof, ral_whitelist)
        patches.append(patch)
    
    # Cleanup old staging, write new, merge
    delete_staging(org, req.run_id)
    written = write_patches_to_bq(req.run_id, patches)
    merge_patches_into_current(org, req.run_id)
    
    # Update status
    sb_patch_import_job_summary(req.import_job_id, {
        "enrich": {
            "status": "APPLIED",
            "applied_at": dt.datetime.now(dt.timezone.utc),
            "applied_stats": {"patched_rows": written}
        }
    })
    
    return {
        "ok": True, 
        "organization_id": org, 
        "import_job_id": req.import_job_id, 
        "run_id": req.run_id, 
        "patched_rows": written
    }


# ============================================================================
# ASYNC APPLY (Cloud Tasks for >5000 rows)
# ============================================================================

def _public_base_url() -> str:
    u = _env("PUBLIC_BASE_URL").strip()
    if u:
        return u.rstrip("/")
    return ""


def _tasks_client():
    return tasks_v2.CloudTasksClient()


def _create_apply_task(payload: dict, request_base_url: str) -> str:
    """Enqueue Cloud Task for async apply."""
    project = _env("PROJECT_ID") or _env("GOOGLE_CLOUD_PROJECT")
    queue = _env("TASKS_QUEUE", "catalog-enricher-apply")
    location = _env("TASKS_LOCATION", "us-central1")
    sa_email = _env("TASKS_SA_EMAIL")
    
    if not project:
        raise RuntimeError("PROJECT_ID missing for tasks")
    if not sa_email:
        raise RuntimeError("TASKS_SA_EMAIL missing for OIDC")
    
    parent = _tasks_client().queue_path(project, location, queue)
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
                "audience": request_base_url.rstrip("/"),
            },
        }
    }
    
    resp = _tasks_client().create_task(parent=parent, task=task)
    return resp.name


@app.post("/api/enrich/apply_start")
def apply_start(
    req: ApplyStartRequest, 
    request: Request, 
    x_internal_secret: Optional[str] = Header(default=None, alias="X-Internal-Secret")
):
    """
    Start async apply via Cloud Tasks.
    
    HYBRID LOGIC:
    - If row count <= APPLY_SYNC_THRESHOLD (5000), run synchronously
    - Otherwise, enqueue Cloud Task for async processing
    """
    require_secret(x_internal_secret)
    
    org = req.organization_id
    apply_id = str(uuid.uuid4())
    now = time.time()
    
    # Check row count for hybrid decision
    row_count = count_current(org)
    
    if row_count <= APPLY_SYNC_THRESHOLD:
        # SYNC PATH: small catalog, run directly
        sb_patch_import_job_summary(req.import_job_id, {
            "enrich": {"apply": {
                "apply_id": apply_id,
                "status": "RUNNING",
                "queued_at": now,
                "started_at": now,
                "progress": 10,
                "mode": "sync",
            }}
        })
        
        try:
            # Call apply directly
            result = apply(ApplyRequest(
                organization_id=org,
                import_job_id=req.import_job_id,
                run_id=req.run_id,
                profile_hash=req.profile_hash,
            ), x_internal_secret)
            
            sb_patch_import_job_summary(req.import_job_id, {
                "enrich": {"apply": {
                    "apply_id": apply_id,
                    "status": "DONE",
                    "finished_at": time.time(),
                    "progress": 100,
                    "patched_rows": result.get("patched_rows"),
                }}
            })
            
            return {"ok": True, "apply_id": apply_id, "status": "DONE", "mode": "sync", "patched_rows": result.get("patched_rows")}
        
        except Exception as e:
            sb_patch_import_job_summary(req.import_job_id, {
                "enrich": {"apply": {
                    "apply_id": apply_id,
                    "status": "FAILED",
                    "finished_at": time.time(),
                    "error": str(e)[:500],
                }}
            })
            raise
    
    else:
        # ASYNC PATH: large catalog, use Cloud Tasks
        sb_patch_import_job_summary(req.import_job_id, {
            "enrich": {"apply": {
                "apply_id": apply_id,
                "status": "QUEUED",
                "queued_at": now,
                "progress": 0,
                "patched_rows": None,
                "error": None,
                "mode": "async",
                "row_count": row_count,
            }}
        })
        
        base_url = _public_base_url() or str(request.base_url).rstrip("/")
        task_name = _create_apply_task({
            "organization_id": org,
            "import_job_id": req.import_job_id,
            "run_id": req.run_id,
            "profile_hash": req.profile_hash,
            "apply_id": apply_id,
            "internal_secret": _env("ENRICH_SHARED_SECRET"),
        }, base_url)
        
        return {"ok": True, "apply_id": apply_id, "status": "QUEUED", "mode": "async", "task_name": task_name}


@app.get("/api/enrich/apply_status")
def apply_status(
    import_job_id: str, 
    apply_id: str, 
    x_internal_secret: Optional[str] = Header(default=None, alias="X-Internal-Secret")
):
    """Get status of async apply operation."""
    require_secret(x_internal_secret)
    
    job = sb_get_import_job(import_job_id)
    if not job:
        return {"ok": True, "status": "NOT_FOUND", "apply_id": apply_id}
    
    summary = job.get("summary") or {}
    enrich = summary.get("enrich") or {}
    st = enrich.get("apply") or {}
    
    return {"ok": True, **st}


@app.post("/api/enrich/apply_worker")
def apply_worker(req: ApplyWorkerRequest, request: Request):
    """
    Called by Cloud Tasks for async apply.
    Protected by Cloud Run IAM + OIDC (not X-Internal-Secret).
    """
    # Mark RUNNING
    sb_patch_import_job_summary(req.import_job_id, {
        "enrich": {"apply": {
            "apply_id": req.apply_id, 
            "status": "RUNNING", 
            "started_at": time.time(), 
            "progress": 10
        }}
    })
    
    base_url = _public_base_url() or str(request.base_url).rstrip("/")
    
    try:
        r = requests.post(
            base_url + "/api/enrich/apply",
            headers={"Content-Type": "application/json", "X-Internal-Secret": _env("ENRICH_SHARED_SECRET")},
            json={
                "organization_id": req.organization_id,
                "import_job_id": req.import_job_id,
                "run_id": req.run_id,
                "profile_hash": req.profile_hash
            },
            timeout=3600
        )
        
        if r.status_code >= 300:
            sb_patch_import_job_summary(req.import_job_id, {
                "enrich": {"apply": {
                    "apply_id": req.apply_id, 
                    "status": "FAILED", 
                    "finished_at": time.time(), 
                    "error": f"apply http {r.status_code}: {r.text[:500]}"
                }}
            })
            return {"ok": False, "status": "FAILED"}
        
        data = r.json() if r.text else {}
        patched_rows = data.get("patched_rows") if isinstance(data, dict) else None
        
        sb_patch_import_job_summary(req.import_job_id, {
            "enrich": {"apply": {
                "apply_id": req.apply_id, 
                "status": "DONE", 
                "finished_at": time.time(), 
                "progress": 100, 
                "patched_rows": patched_rows
            }}
        })
        
        return {"ok": True, "status": "DONE", "patched_rows": patched_rows}
    
    except Exception as e:
        sb_patch_import_job_summary(req.import_job_id, {
            "enrich": {"apply": {
                "apply_id": req.apply_id, 
                "status": "FAILED", 
                "finished_at": time.time(), 
                "error": str(e)[:500]
            }}
        })
        return {"ok": False, "status": "FAILED"}


# ============================================================================
# PREVIEW & CHAT ENDPOINTS
# ============================================================================

@app.post("/api/enrich/preview_rows")
def preview_rows(
    req: PreviewRowsRequest, 
    x_internal_secret: Optional[str] = Header(default=None, alias="X-Internal-Secret")
):
    """Get paginated rows from current catalog with optional filtering."""
    require_secret(x_internal_secret)
    
    org = req.organization_id
    limit = max(1, min(req.limit or 50, 500))
    offset = max(0, req.offset or 0)
    
    q = (req.q or "").strip().lower()
    key = (req.filter_key or "").strip()
    key_l = key.lower()
    
    where = "WHERE organization_id=@org"
    params = [bigquery.ScalarQueryParameter("org", "STRING", org)]
    
    if key:
        where += " AND (LOWER(title) LIKE @key_like OR profile=@key_exact OR LOWER(id) LIKE @key_like)"
        params.append(bigquery.ScalarQueryParameter("key_like", "STRING", f"%{key_l}%"))
        params.append(bigquery.ScalarQueryParameter("key_exact", "STRING", key))
    
    if q:
        where += " AND (LOWER(title) LIKE @q_like OR LOWER(id) LIKE @q_like)"
        params.append(bigquery.ScalarQueryParameter("q_like", "STRING", f"%{q}%"))
    
    fq = fq_table(BQ_TABLE_CURRENT)
    
    # Total count
    sql_count = f"SELECT COUNT(1) AS cnt FROM `{fq}` {where}"
    cnt_row = bq_client().query(sql_count, job_config=bigquery.QueryJobConfig(query_parameters=params)).result()
    total_count = 0
    for r in cnt_row:
        total_count = int(r["cnt"])
        break
    
    # Rows
    sql_rows = f"""
    SELECT
        id, title, unit,
        profile, thickness_mm, width_work_mm, width_full_mm,
        coating, notes,
        sheet_kind, color_system, color_code
    FROM `{fq}`
    {where}
    ORDER BY title
    LIMIT @limit OFFSET @offset
    """
    params2 = params + [
        bigquery.ScalarQueryParameter("limit", "INT64", limit),
        bigquery.ScalarQueryParameter("offset", "INT64", offset),
    ]
    
    rows = []
    for r in bq_client().query(sql_rows, job_config=bigquery.QueryJobConfig(query_parameters=params2)).result():
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


@app.post("/api/enrich/chat")
def chat(
    req: ChatRequest, 
    x_internal_secret: Optional[str] = Header(default=None, alias="X-Internal-Secret")
):
    """AI chat endpoint - placeholder for future Gemini integration."""
    require_secret(x_internal_secret)
    
    # V1: Stub - returns not implemented
    return _json_safe({
        "ok": False,
        "error": "CHAT_NOT_IMPLEMENTED_YET",
        "message": "AI chat endpoint is not implemented yet. Deploy V2 to enable Gemini patches."
    })
