import os
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional


RE_PROFILE = re.compile(r"(^|[^A-ZА-Я0-9])((?:НС|HC|С|C|Н|H|МП|MP)\s*[-–]?\s*(\d{1,3}))([^A-ZА-Я0-9]|$)", re.I)
RE_THICKNESS = re.compile(r"\b(\d(?:[\.,]\d{1,2}))\s*(?:мм|mm)?\b", re.I)
RE_RR = re.compile(r"\bRR\s*-?\s*(\d{2})\b", re.I)
RE_DECOR = re.compile(r"\b(принтеч|printech|дуб)\b", re.I)
RE_SMOOTH = re.compile(r"(гладк(ий|ого)\s*лист|лист\s*гладк(ий|ого)|плос(кий|кого)\s*лист|лист\s*плос(кий|кого))", re.I)

KNOWN_TILE_PROFILES = {"ADAMANTE", "CASCADE", "KVINTA"}
KNOWN_COATINGS = {
    "MATTPE": "MATT_PE",
    "PE": "PE",
    "PURAL": "PURAL",
    "PURMAN": "PURMAN",
}
WIDTH_MASTERS_MM = {
    "С8": {"width_work_mm": 1150, "width_full_mm": 1200},
}


@dataclass
class EvalInput:
    title: str
    widths_selected: bool = False
    defaults: Optional[Dict[str, Any]] = None


def _canon_profile(title: str) -> Optional[str]:
    m = RE_PROFILE.search((title or "").upper())
    if not m:
        return None
    raw = m.group(2).replace("–", "-").replace("—", "-")
    raw = re.sub(r"\s+", "", raw)
    raw = raw.replace("HC", "НС").replace("H", "Н").replace("C", "С").replace("MP", "МП")
    return raw.replace("-", "")


def _extract_thickness_mm(title: str) -> Optional[float]:
    m = RE_THICKNESS.search(title or "")
    if not m:
        return None
    return float(m.group(1).replace(",", "."))


def evaluate_title(payload: EvalInput) -> Dict[str, Any]:
    title = payload.title or ""
    up = title.upper()

    fields: Dict[str, Any] = {
        "title": title,
        "profile": _canon_profile(title),
        "category": "OTHER",
        "sheet_kind": None,
        "thickness_mm": _extract_thickness_mm(title),
        "coating": None,
        "color_system": None,
        "color_code": None,
        "color_name": None,
        "width_work_mm": None,
        "width_full_mm": None,
    }
    questions: List[Dict[str, Any]] = []
    patches: List[Dict[str, Any]] = []

    if "САМОРЕЗ" in up:
        fields["category"] = "ACCESSORY"
        fields["sheet_kind"] = "ACCESSORY"
    elif RE_SMOOTH.search(title):
        fields["category"] = "SMOOTH_SHEET"
        fields["sheet_kind"] = "SMOOTH_SHEET"
    elif "МЕТАЛЛОЧЕРЕП" in up:
        fields["category"] = "METAL_TILE"
        fields["sheet_kind"] = "METAL_TILE"
    elif fields["profile"]:
        fields["category"] = "PROFNASTIL"
        fields["sheet_kind"] = "PROFNASTIL"

    if "МЕТАЛЛОЧЕРЕП" in up and not any(p in up for p in KNOWN_TILE_PROFILES):
        questions.append({"type": "PROFILE_RESOLUTION", "reason": "missing_tile_profile"})

    for source, canonical in KNOWN_COATINGS.items():
        if source in up:
            fields["coating"] = canonical
            break
    if any(token in up for token in ["MATTPE", "PE", "PURAL", "PURMAN"]) and fields["coating"] is None:
        questions.append({"type": "COATING_MAP", "reason": "unknown_coating_token"})

    rr = RE_RR.search(up)
    if rr:
        fields["color_system"] = "RR"
        fields["color_code"] = f"RR{rr.group(1)}"

    if RE_DECOR.search(title):
        fields["color_system"] = fields["color_system"] or "DECOR"
        if "ДУБ" in up:
            fields["color_name"] = "Дуб"
        if fields["color_name"] is None:
            questions.append({"type": "COLOR_MAP", "reason": "decor_without_name"})

    profile = fields["profile"]
    if profile in WIDTH_MASTERS_MM:
        if payload.widths_selected:
            fields.update(WIDTH_MASTERS_MM[profile])
            patches.append({"type": "SET_WIDTHS", "profile": profile, **WIDTH_MASTERS_MM[profile]})
        else:
            questions.append({"type": "WIDTH_CONFIRM", "profile": profile})
            patches.append({"type": "SUGGEST_WIDTHS", "profile": profile, **WIDTH_MASTERS_MM[profile]})
    elif profile and profile.startswith("МП"):
        questions.append({"type": "WIDTH_MANUAL", "profile": profile})
        patches.append({"type": "REQUEST_WIDTH_PATCH", "profile": profile})

    if payload.defaults and not payload.widths_selected:
        patches.append({"type": "DEFAULTS_REVIEW", "defaults": payload.defaults})

    if os.getenv("ENABLE_AI_EVALS") == "1":
        patches.append({"type": "AI_SUGGESTION", "status": "stubbed"})

    return {
        "extracted_fields": fields,
        "questions": questions,
        "suggested_patches": patches,
    }
