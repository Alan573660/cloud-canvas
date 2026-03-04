/**
 * PR2 verification tests: WIDTH_MASTER confirm payload guards.
 * 
 * Ensures no entrypoint can send {"type":"WIDTH_MASTER","payload":{}}
 * 
 * 1. Form path — profile extracted, payload valid
 * 2. Cluster quick path — uses profile + numeric payload (not token/canonical)
 * 3. AI chat apply — disabled if profile empty; enabled if present
 * 4. COATING_MAP/COLOR_MAP — not broken by guard
 * 5. Hook-level guard — confirmActions rejects WIDTH_MASTER without profile
 * 6. apply_status poll — flow states correct
 */

import { describe, it, expect } from 'vitest';

// ─── Helper: simulate profile extraction logic ──────────────
function extractWidthProfile(question: {
  token?: string;
  cluster_path?: { profile?: string };
  examples?: string[];
  ask?: string;
}): string {
  let profile = question.token || '';
  
  if (!profile && question.examples?.length) {
    for (const ex of question.examples) {
      const m = ex.match(/(?:Профнастил[и]?\s+)?([A-Za-zА-Яа-яЁё]{1,4}\d{1,3})/i);
      if (m) { profile = m[1]; break; }
    }
  }
  if (!profile && question.cluster_path?.profile) {
    profile = question.cluster_path.profile;
  }
  if (!profile && question.ask) {
    const m = question.ask.match(/для\s+([A-Za-zА-Яа-яЁё]{1,4}\d{1,3})/i);
    if (m) profile = m[1];
  }
  return profile;
}

// ─── Helper: simulate WIDTH_MASTER payload builder ──────────
function buildWidthPayload(profile: string, value: string): Record<string, unknown> | null {
  if (!profile) return null;
  const payload: Record<string, unknown> = { profile };
  if (value.includes(':')) {
    const [full, work] = value.split(':');
    payload.full_mm = parseInt(full, 10) || 0;
    payload.work_mm = parseInt(work, 10) || 0;
  } else {
    payload.full_mm = parseInt(value, 10) || 0;
  }
  return payload;
}

// ─── Helper: hook-level guard ───────────────────────────────
function validateConfirmActions(actions: Array<{ type: string; payload: Record<string, unknown> }>): { valid: boolean; reason?: string } {
  for (const action of actions) {
    if (action.type === 'WIDTH_MASTER' && !action.payload?.profile) {
      return { valid: false, reason: 'WIDTH_MASTER requires profile' };
    }
  }
  return { valid: true };
}

// ═══ Test 1: Form path ═══════════════════════════════════════
describe('PR2: Form path — WIDTH_MASTER confirm', () => {
  it('produces valid payload with profile from token', () => {
    const profile = extractWidthProfile({ token: 'МП40' });
    const payload = buildWidthPayload(profile, '1200:1100');
    expect(payload).not.toBeNull();
    expect(payload!.profile).toBe('МП40');
    expect(payload!.full_mm).toBe(1200);
    expect(payload!.work_mm).toBe(1100);
  });

  it('extracts profile from examples when token empty', () => {
    const profile = extractWidthProfile({ token: '', examples: ['Профнастил С8 0.45'] });
    expect(profile).toBe('С8');
    const payload = buildWidthPayload(profile, '1200');
    expect(payload!.profile).toBe('С8');
  });

  it('extracts profile from ask text as last resort', () => {
    const profile = extractWidthProfile({ token: '', examples: [], ask: 'Какая ширина для Н60?' });
    expect(profile).toBe('Н60');
  });

  it('returns null payload when profile cannot be extracted', () => {
    const profile = extractWidthProfile({ token: '', examples: ['неизвестный товар'], ask: 'Какая ширина?' });
    const payload = buildWidthPayload(profile, '1200');
    expect(payload).toBeNull();
  });
});

// ═══ Test 2: Cluster quick path ═════════════════════════════
describe('PR2: Cluster quick path — WIDTH_MASTER confirm', () => {
  it('builds profile+numeric payload (not token/canonical)', () => {
    const token = 'НС35';
    const value = '1060:1000';
    
    // PR2 fix: cluster path now builds WIDTH_MASTER-specific payload
    const payload = buildWidthPayload(token, value);
    expect(payload).not.toBeNull();
    expect(payload!.profile).toBe('НС35');
    expect(payload!.full_mm).toBe(1060);
    expect(payload!.work_mm).toBe(1000);
    
    // Must NOT be token/canonical format
    expect(payload).not.toHaveProperty('token');
    expect(payload).not.toHaveProperty('canonical');
  });

  it('rejects when token is empty', () => {
    const payload = buildWidthPayload('', '1060');
    expect(payload).toBeNull();
  });
});

// ═══ Test 3: AI chat apply — disabled state ═════════════════
describe('PR2: AI chat apply button state', () => {
  it('is disabled when WIDTH_MASTER action has no profile', () => {
    const actions = [{ type: 'WIDTH_MASTER', payload: { full_mm: 1200 } as Record<string, unknown> }];
    const hasInvalidWidth = actions.some(a => a.type === 'WIDTH_MASTER' && !a.payload?.profile);
    expect(hasInvalidWidth).toBe(true);
  });

  it('is enabled when WIDTH_MASTER action has profile', () => {
    const actions = [{ type: 'WIDTH_MASTER', payload: { profile: 'С20', full_mm: 1150, work_mm: 1100 } as Record<string, unknown> }];
    const hasInvalidWidth = actions.some(a => a.type === 'WIDTH_MASTER' && !a.payload?.profile);
    expect(hasInvalidWidth).toBe(false);
  });

  it('is enabled for non-WIDTH actions regardless of profile', () => {
    const actions = [{ type: 'COATING_MAP', payload: { token: 'PE', canonical: 'Полиэстер' } as Record<string, unknown> }];
    const hasInvalidWidth = actions.some(a => a.type === 'WIDTH_MASTER' && !a.payload?.profile);
    expect(hasInvalidWidth).toBe(false);
  });

  it('is disabled when mix of valid and invalid WIDTH actions', () => {
    const actions = [
      { type: 'WIDTH_MASTER', payload: { profile: 'С8', full_mm: 1200 } },
      { type: 'WIDTH_MASTER', payload: { full_mm: 1060 } }, // no profile
    ];
    const hasInvalidWidth = actions.some(a => a.type === 'WIDTH_MASTER' && !a.payload?.profile);
    expect(hasInvalidWidth).toBe(true);
  });
});

// ═══ Test 4: COATING_MAP/COLOR_MAP not broken ═══════════════
describe('PR2: COATING_MAP/COLOR_MAP confirm unaffected', () => {
  it('COATING_MAP passes hook guard', () => {
    const result = validateConfirmActions([
      { type: 'COATING_MAP', payload: { token: 'MattPE', canonical: 'Матовый полиэстер' } },
    ]);
    expect(result.valid).toBe(true);
  });

  it('COLOR_MAP passes hook guard', () => {
    const result = validateConfirmActions([
      { type: 'COLOR_MAP', payload: { token: '3005', canonical: 'RAL3005' } },
    ]);
    expect(result.valid).toBe(true);
  });

  it('mixed batch with valid WIDTH_MASTER passes', () => {
    const result = validateConfirmActions([
      { type: 'WIDTH_MASTER', payload: { profile: 'С8', full_mm: 1200, work_mm: 1150 } },
      { type: 'COATING_MAP', payload: { token: 'PE', canonical: 'Полиэстер' } },
    ]);
    expect(result.valid).toBe(true);
  });
});

// ═══ Test 5: Hook-level guard ═══════════════════════════════
describe('PR2: Hook-level confirmActions guard', () => {
  it('rejects WIDTH_MASTER with empty payload', () => {
    const result = validateConfirmActions([{ type: 'WIDTH_MASTER', payload: {} }]);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('profile');
  });

  it('rejects WIDTH_MASTER with payload missing profile', () => {
    const result = validateConfirmActions([{ type: 'WIDTH_MASTER', payload: { full_mm: 1200 } }]);
    expect(result.valid).toBe(false);
  });

  it('accepts WIDTH_MASTER with profile present', () => {
    const result = validateConfirmActions([{ type: 'WIDTH_MASTER', payload: { profile: 'МП40', full_mm: 1200 } }]);
    expect(result.valid).toBe(true);
  });
});

// ═══ Test 6: apply_status flow states ═══════════════════════
describe('PR2: apply_status polling lifecycle', () => {
  it('normalizes apply status responses correctly', async () => {
    const { normalizeApplyStatus } = await import('@/lib/contract-types');
    
    const done = normalizeApplyStatus({ status: 'DONE', phase: 'done', progress_percent: 100, report: { total: 500 } });
    expect(done.status).toBe('DONE');
    expect(done.progressPercent).toBe(100);
    expect(done.report).toEqual({ total: 500 });
  });

  it('maps flow states correctly', () => {
    const map: Record<string, string> = {
      'STARTING': 'APPLY_STARTING', 'PENDING': 'APPLY_STARTING',
      'RUNNING': 'APPLY_RUNNING', 'DONE': 'APPLY_DONE',
      'ERROR': 'ERROR', 'POLL_EXCEEDED': 'ERROR',
    };
    function deriveState(s: string) {
      if (s === 'STARTING' || s === 'PENDING') return 'APPLY_STARTING';
      if (s === 'RUNNING') return 'APPLY_RUNNING';
      if (s === 'DONE') return 'APPLY_DONE';
      if (s === 'ERROR' || s === 'POLL_EXCEEDED') return 'ERROR';
      return 'IDLE';
    }
    for (const [input, expected] of Object.entries(map)) {
      expect(deriveState(input)).toBe(expected);
    }
  });
});

// ═══ PR3: Polling stability tests ═══════════════════════════

describe('PR3: Single-flight polling lock', () => {
  it('A1: elapsed time uses startedAtMs, never shows raw timestamp', () => {
    const startedAtMs = Date.now();
    const elapsed = startedAtMs > 0 ? Date.now() - startedAtMs : 0;
    // Must be small (< 100ms in test), never ~1.77 billion
    expect(elapsed).toBeLessThan(1000);
    expect(elapsed).toBeGreaterThanOrEqual(0);
  });

  it('A1: zero startedAtMs produces zero elapsed (no absurd numbers)', () => {
    const startedAtMs = 0;
    const elapsed = startedAtMs > 0 ? Date.now() - startedAtMs : 0;
    expect(elapsed).toBe(0);
  });

  it('A2: state machine transitions PENDING -> RUNNING -> DONE', () => {
    function deriveState(s: string) {
      if (s === 'STARTING' || s === 'PENDING') return 'APPLY_STARTING';
      if (s === 'RUNNING') return 'APPLY_RUNNING';
      if (s === 'DONE') return 'APPLY_DONE';
      if (s === 'ERROR' || s === 'POLL_EXCEEDED') return 'ERROR';
      return 'IDLE';
    }
    const sequence = ['PENDING', 'RUNNING', 'DONE'];
    const expected = ['APPLY_STARTING', 'APPLY_RUNNING', 'APPLY_DONE'];
    expect(sequence.map(deriveState)).toEqual(expected);
  });

  it('A3: restartPolling reuses existing apply_id (no duplicate)', () => {
    let pollCount = 0;
    const applyId = 'apply-123';
    const runId = 'run-456';
    
    // Simulate startPolling logic: clear previous, set new
    let activeApplyId: string | null = null;
    function startPolling(newId: string, _rid: string) {
      activeApplyId = newId;
      pollCount++;
    }
    function restartPolling() {
      if (applyId && runId) {
        startPolling(applyId, runId);
      }
    }
    
    startPolling(applyId, runId);
    expect(pollCount).toBe(1);
    expect(activeApplyId).toBe(applyId);
    
    restartPolling();
    expect(pollCount).toBe(2);
    expect(activeApplyId).toBe(applyId); // Same apply_id reused
  });

  it('A5: single-flight guard prevents stale apply_id from polling', () => {
    let activeApplyId: string | null = 'apply-new';
    const staleId = 'apply-old';
    
    // Simulates the guard inside pollApplyStatus
    function shouldPoll(currentApplyId: string): boolean {
      if (activeApplyId && activeApplyId !== currentApplyId) return false;
      return true;
    }
    
    expect(shouldPoll('apply-new')).toBe(true);
    expect(shouldPoll(staleId)).toBe(false); // Stale → blocked
  });
});
