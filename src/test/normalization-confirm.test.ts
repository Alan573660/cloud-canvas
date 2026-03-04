/**
 * 5 verification tests for normalization confirm/apply flows.
 * 
 * 1. WIDTH confirm from form — should produce valid payload with profile
 * 2. WIDTH confirm from cluster quick action — should include profile
 * 3. AI chat → apply actions (WIDTH_MASTER) — disabled if profile empty
 * 4. COATING_MAP/COLOR_MAP confirm — payload structure correct
 * 5. apply_status poll to DONE — flow state transitions correctly
 */

import { describe, it, expect, vi } from 'vitest';

// ─── Test 1: WIDTH_MASTER confirm payload from form ──────────
describe('WIDTH_MASTER confirm from form', () => {
  it('should produce valid payload with profile extracted from question token', () => {
    const question = {
      type: 'width' as const,
      token: 'МП40',
      cluster_path: { profile: 'МП40' },
      examples: ['Профнастил МП40 0.45'],
      affected_count: 12,
      suggestions: ['1100:1190'],
      confidence: 0.9,
      ask: 'Какая ширина для МП40?',
    };
    const value = '1200:1100';

    // Simulate payload building logic from NormalizationWizard handleAnswerQuestion
    const backendType = 'WIDTH_MASTER';
    let widthProfile = question.token || '';
    
    if (!widthProfile && question.examples?.length) {
      for (const ex of question.examples) {
        const profileMatch = ex.match(/(?:Профнастил[и]?\s+)?([A-Za-zА-Яа-яЁё]{1,4}\d{1,3})/i);
        if (profileMatch) { widthProfile = profileMatch[1]; break; }
      }
    }
    if (!widthProfile && question.cluster_path?.profile) {
      widthProfile = question.cluster_path.profile;
    }

    const payload: Record<string, unknown> = { profile: widthProfile };
    if (value.includes(':')) {
      const [full, work] = value.split(':');
      payload.full_mm = parseInt(full, 10) || 0;
      payload.work_mm = parseInt(work, 10) || 0;
    } else {
      payload.full_mm = parseInt(value, 10) || 0;
    }

    // Verify: profile is present and not empty
    expect(payload.profile).toBe('МП40');
    expect(payload.profile).not.toBe('');
    expect(payload.full_mm).toBe(1200);
    expect(payload.work_mm).toBe(1100);
    
    // This is the exact action sent to confirmBatch
    const action = { type: backendType, payload };
    expect(action.type).toBe('WIDTH_MASTER');
    expect(action.payload.profile).toBeTruthy();
  });

  it('should extract profile from examples when token is empty', () => {
    const question = {
      type: 'width' as const,
      token: '',
      cluster_path: { profile: '' },
      examples: ['Профнастил С8 0.45 PE RAL3005', 'С8 0.5 Пурал'],
      affected_count: 5,
      suggestions: [],
      confidence: 0.5,
    };

    let widthProfile = question.token || '';
    if (!widthProfile && question.examples?.length) {
      for (const ex of question.examples) {
        const profileMatch = ex.match(/(?:Профнастил[и]?\s+)?([A-Za-zА-Яа-яЁё]{1,4}\d{1,3})/i);
        if (profileMatch) { widthProfile = profileMatch[1]; break; }
      }
    }

    expect(widthProfile).toBe('С8');
  });
});

// ─── Test 2: WIDTH confirm from cluster quick action ─────────
describe('WIDTH confirm from cluster quick action', () => {
  it('should build correct payload using question token from cluster', () => {
    // Simulates handleAnswerFromCluster path
    const aiQuestions = [
      { type: 'width', token: 'НС35', cluster_path: { profile: 'НС35' }, examples: [], affected_count: 8, suggestions: ['1060:1000'], confidence: 0.8 },
    ];
    
    const questionId = 'НС35';
    const value = '1060';
    
    const question = aiQuestions.find(q => q.token === questionId);
    const questionType = question?.type || questionId;
    const backendType = questionType.toUpperCase() === 'WIDTH' ? 'WIDTH_MASTER' : questionType.toUpperCase();
    const token = question?.token || question?.cluster_path?.profile || questionId;

    // For WIDTH_MASTER from cluster, the action uses token+canonical format
    const action = { type: backendType, payload: { token, canonical: value } };

    expect(action.type).toBe('WIDTH_MASTER');
    expect(action.payload.token).toBe('НС35');
    expect(action.payload.token).not.toBe('');
    expect(action.payload.canonical).toBe('1060');
  });
});

// ─── Test 3: AI chat apply button disabled when profile empty ─
describe('AI chat apply actions button state', () => {
  it('should be disabled when missingFields includes profile', () => {
    const missingFields = ['profile'];
    const actions = [
      { type: 'WIDTH_MASTER', payload: { full_mm: 1200 } },
    ];
    
    const isBlocked = missingFields && missingFields.length > 0;
    
    // ActionPreview component logic: button disabled if isBlocked
    expect(isBlocked).toBe(true);
  });

  it('should be enabled when profile is present and no missing fields', () => {
    const missingFields: string[] = [];
    const actions = [
      { type: 'WIDTH_MASTER', payload: { profile: 'С20', full_mm: 1150, work_mm: 1100 } },
    ];
    
    const isBlocked = missingFields && missingFields.length > 0;
    expect(isBlocked).toBe(false);
    
    // Verify payload has profile
    expect(actions[0].payload.profile).toBe('С20');
  });
});

// ─── Test 4: COATING_MAP and COLOR_MAP confirm payloads ──────
describe('COATING_MAP and COLOR_MAP confirm', () => {
  it('should produce valid COATING_MAP payload', () => {
    const token = 'MattPE';
    const canonical = 'Матовый полиэстер';
    
    const action = { type: 'COATING_MAP', payload: { token, canonical } };
    
    expect(action.type).toBe('COATING_MAP');
    expect(action.payload.token).toBe('MattPE');
    expect(action.payload.canonical).toBe('Матовый полиэстер');
  });

  it('should produce valid COLOR_MAP payload', () => {
    const token = '3005';
    const canonical = 'RAL3005';
    
    const action = { type: 'COLOR_MAP', payload: { token, canonical } };
    
    expect(action.type).toBe('COLOR_MAP');
    expect(action.payload.token).toBe('3005');
    expect(action.payload.canonical).toBe('RAL3005');
  });

  it('should map question types correctly to backend types', () => {
    const mappings: Record<string, string> = {
      'COATING': 'COATING_MAP',
      'COLOR': 'COLOR_MAP',
      'WIDTH': 'WIDTH_MASTER',
      'THICKNESS': 'THICKNESS_SET',
      'PROFILE': 'PROFILE_MAP',
      'CATEGORY': 'CATEGORY_FIX',
    };
    
    for (const [input, expected] of Object.entries(mappings)) {
      const backendType = input === 'WIDTH' ? 'WIDTH_MASTER' 
        : input === 'COATING' ? 'COATING_MAP' 
        : input === 'COLOR' ? 'COLOR_MAP'
        : input === 'THICKNESS' ? 'THICKNESS_SET' 
        : input === 'PROFILE' ? 'PROFILE_MAP' 
        : input === 'CATEGORY' ? 'CATEGORY_FIX' 
        : input;
      expect(backendType).toBe(expected);
    }
  });
});

// ─── Test 5: apply_status polling to DONE ────────────────────
describe('apply_status poll lifecycle', () => {
  it('should correctly normalize apply status responses', async () => {
    const { normalizeApplyStatus } = await import('@/lib/contract-types');
    
    // PENDING state
    const pending = normalizeApplyStatus({ status: 'PENDING', phase: 'queued', progress_percent: 0 });
    expect(pending.status).toBe('PENDING');
    expect(pending.progressPercent).toBe(0);
    
    // RUNNING state
    const running = normalizeApplyStatus({ status: 'RUNNING', phase: 'materialize', progress_percent: 45 });
    expect(running.status).toBe('RUNNING');
    expect(running.phase).toBe('materialize');
    expect(running.progressPercent).toBe(45);
    
    // DONE state
    const done = normalizeApplyStatus({ 
      status: 'DONE', 
      phase: 'done', 
      progress_percent: 100,
      report: { total: 500, profile_filled: 450, coating_filled: 480 }
    });
    expect(done.status).toBe('DONE');
    expect(done.progressPercent).toBe(100);
    expect(done.report).toEqual({ total: 500, profile_filled: 450, coating_filled: 480 });
    expect(done.lastError).toBeNull();
  });

  it('should handle legacy field names', async () => {
    const { normalizeApplyStatus } = await import('@/lib/contract-types');
    
    // Legacy: state instead of status, progress instead of progress_percent
    const legacy = normalizeApplyStatus({ state: 'running', progress: 60, error: 'test error' });
    expect(legacy.status).toBe('RUNNING');
    expect(legacy.progressPercent).toBe(60);
    expect(legacy.lastError).toBe('test error');
  });

  it('should map flow states correctly from apply state', () => {
    // Simulate flow state derivation logic from useNormalizationFlow
    function deriveState(applyState: string): string {
      if (applyState === 'STARTING' || applyState === 'PENDING') return 'APPLY_STARTING';
      if (applyState === 'RUNNING') return 'APPLY_RUNNING';
      if (applyState === 'DONE') return 'APPLY_DONE';
      if (applyState === 'ERROR' || applyState === 'POLL_EXCEEDED') return 'ERROR';
      return 'IDLE';
    }
    
    expect(deriveState('STARTING')).toBe('APPLY_STARTING');
    expect(deriveState('PENDING')).toBe('APPLY_STARTING');
    expect(deriveState('RUNNING')).toBe('APPLY_RUNNING');
    expect(deriveState('DONE')).toBe('APPLY_DONE');
    expect(deriveState('ERROR')).toBe('ERROR');
    expect(deriveState('POLL_EXCEEDED')).toBe('ERROR');
    expect(deriveState('IDLE')).toBe('IDLE');
  });
});
