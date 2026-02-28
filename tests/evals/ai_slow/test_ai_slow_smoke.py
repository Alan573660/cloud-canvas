import os

import pytest

from tests.evals.harness import EvalInput, evaluate_title


pytestmark = pytest.mark.ai_slow


def test_ai_slow_stubbed_patch_available_when_enabled():
    if os.getenv("ENABLE_AI_EVALS") != "1":
        pytest.skip("AI evals disabled. Set ENABLE_AI_EVALS=1 to run.")

    result = evaluate_title(EvalInput(title="Профнастил С8 RR29"))
    patch_types = {p.get("type") for p in result["suggested_patches"]}
    assert "AI_SUGGESTION" in patch_types
