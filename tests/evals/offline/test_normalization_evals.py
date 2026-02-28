import json
from pathlib import Path

import pytest

from tests.evals.harness import EvalInput, evaluate_title


@pytest.mark.offline
@pytest.mark.parametrize("case", json.loads(Path("tests/evals/fixtures/offline_cases.json").read_text(encoding="utf-8")), ids=lambda c: c["id"])
def test_offline_eval_cases(case):
    input_payload = EvalInput(title=case["title"], **(case.get("input") or {}))
    result = evaluate_title(input_payload)
    fields = result["extracted_fields"]
    questions = {q.get("type") for q in result["questions"]}
    patch_types = {p.get("type") for p in result["suggested_patches"]}

    expected = case["expect"]
    for k in ["category", "coating", "color_system", "color_code", "color_name", "width_work_mm", "width_full_mm", "thickness_mm"]:
        if k in expected:
            assert fields.get(k) == expected[k]

    if "question" in expected:
        assert expected["question"] in questions

    if "patch" in expected:
        assert expected["patch"] in patch_types
