/**
 * NormalizationWizard v3 — full single-screen layout:
 * [Top KPI bar] [Left: category tree] [Center: clusters/table] [Right: AI questions + chat + rules]
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import {
  Sparkles, Loader2, RefreshCw, Play, CheckCircle2,
  AlertTriangle, Ruler, Layers, Palette, BarChart3, TrendingUp,
  Activity, MessageSquare, Settings2, ChevronRight, ChevronDown,
  Send, X, AlertCircle, FileText, Filter
} from 'lucide-react';

import { ClusterTree } from './ClusterTree';
import { ClusterDetailPanel } from './ClusterDetailPanel';
import { ConfirmedSettingsEditor } from './ConfirmedSettingsEditor';
import type {
  ProductCategory,
  ProductType,
  CanonicalProduct,
  ClusterPath,
  AIQuestion,
  AIQuestionType,
} from './types';
import { validateProduct } from './types';
import { useNormalization } from '@/hooks/use-normalization';
import type { DryRunPatch, BackendQuestion, CatalogRow, DashboardQuestionCard, AiChatV2Action, ConfirmAction } from '@/lib/contract-types';

// ─── Props ────────────────────────────────────────────────────

interface NormalizationWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  importJobId?: string;
  onComplete?: () => void;
}

// ─── Question type config ─────────────────────────────────────

const Q_TYPE_CONFIG: Record<string, { icon: React.ElementType; label: string; color: string }> = {
  WIDTH_MASTER:  { icon: Ruler,      label: 'Ширины',     color: 'bg-blue-500/10 border-blue-500/30 text-blue-700' },
  COATING_MAP:   { icon: Layers,     label: 'Покрытия',   color: 'bg-orange-500/10 border-orange-500/30 text-orange-700' },
  COLOR_MAP:     { icon: Palette,    label: 'Цвета',      color: 'bg-purple-500/10 border-purple-500/30 text-purple-700' },
  THICKNESS_SET: { icon: BarChart3,  label: 'Толщины',    color: 'bg-green-500/10 border-green-500/30 text-green-700' },
  PROFILE_MAP:   { icon: TrendingUp, label: 'Профили',    color: 'bg-cyan-500/10 border-cyan-500/30 text-cyan-700' },
  CATEGORY_FIX:  { icon: Activity,   label: 'Категории',  color: 'bg-destructive/10 border-destructive/30 text-destructive' },
};

// ─── Category tree items ──────────────────────────────────────

const CAT_LABELS: Record<string, string> = {
  ALL: 'Все товары',
  PROFNASTIL: 'Профнастил',
  METALLOCHEREPICA: 'Металлочерепица',
  DOBOR: 'Доборные элементы',
  SANDWICH: 'Сэндвич-панели',
  OTHER: 'Прочее',
};

// ─── Helpers ──────────────────────────────────────────────────

// Профнастил профили: C8, C10, C20, C21, HC35, NS35, NS57, МП20, НС57, Н60, etc.
const RE_PROFNASTIL_PROFILE = /^(NS|НС|С|C|Н|H|НС|HC|МП|MP|Н)-?\d/i;
// Металлочерепица профили: Монтеррей, Каскад, Супермонтеррей, Modern, Adamante, Cascade, etc.
const RE_METALLOCHEREPICA_TITLE = /металлочерепица|monterrey|монтеррей|cascade|каскад|adamante|адаманте|quadro|квадро|genesis|dimos|luxury|supermonterey|супермонтеррей|modern|vintage|country/i;
const RE_PROFNASTIL_TITLE = /профнастил|профлист/i;
const RE_DOBOR_TITLE = /планка|конёк|конек|ендова|карниз|ветровая|заглушка|шуруп|саморез|кронштейн|крепёж|крепеж|болт|гайка|шайба|доборн/i;
const RE_SANDWICH_TITLE = /сэндвич|sandwich|панель утеплен/i;

function categorizeItem(item: { profile?: string; title?: string; sheet_kind?: string; family_key?: string }): ProductCategory {
  const sheetKind = (item.sheet_kind || '').toUpperCase();
  
  // Priority 1: explicit sheet_kind from backend
  if (sheetKind === 'PROFNASTIL') return 'PROFNASTIL';
  if (sheetKind === 'METAL_TILE') return 'METALLOCHEREPICA';
  if (sheetKind === 'ACCESSORY' || sheetKind === 'DOBOR') return 'DOBOR';
  if (sheetKind === 'SANDWICH') return 'SANDWICH';

  const profile = (item.profile || '').trim();
  const title = (item.title || '').trim();
  const familyKey = (item.family_key || '').toUpperCase();

  // Priority 2: family_key hint from enricher (e.g. "METAL_TILE|Cascade")
  if (familyKey.includes('METAL_TILE') || familyKey.includes('METALLOCHEREPICA')) return 'METALLOCHEREPICA';
  if (familyKey.includes('PROFNASTIL') || familyKey.includes('CORRUGATED')) return 'PROFNASTIL';

  // Priority 3: profile regex — profnastil profiles like C8, NS57, НС35, МП20
  if (profile && RE_PROFNASTIL_PROFILE.test(profile)) return 'PROFNASTIL';

  // Priority 4: title-based detection
  if (RE_PROFNASTIL_TITLE.test(title)) return 'PROFNASTIL';
  if (RE_METALLOCHEREPICA_TITLE.test(title)) return 'METALLOCHEREPICA';
  if (RE_SANDWICH_TITLE.test(title)) return 'SANDWICH';
  if (RE_DOBOR_TITLE.test(title)) return 'DOBOR';

  // Priority 5: if profile looks like metallocherepica pattern (e.g. "Cascade", "Monterrey")
  if (RE_METALLOCHEREPICA_TITLE.test(profile)) return 'METALLOCHEREPICA';

  return 'OTHER';
}

function extractZincLabel(notes?: string): string | undefined {
  if (!notes) return undefined;
  const match = notes.match(/ZINC[:\s]*(ZN?\d+)/i);
  return match ? match[1].toUpperCase() : undefined;
}

function patchToCanonical(item: DryRunPatch): CanonicalProduct {
  const category = categorizeItem({
    profile: item.profile,
    title: item.title,
    sheet_kind: item.sheet_kind,
    family_key: item.family_key,
  });
  const productType: ProductType =
    category === 'PROFNASTIL' ? 'PROFNASTIL' :
    category === 'METALLOCHEREPICA' ? 'METALLOCHEREPICA' :
    category === 'DOBOR' ? 'DOBOR' as ProductType :
    category === 'SANDWICH' ? 'SANDWICH' as ProductType :
    'OTHER' as ProductType;
  return {
    id: item.id,
    organization_id: '',
    product_type: productType,
    profile: item.profile || '',
    thickness_mm: typeof item.thickness_mm === 'string' ? parseFloat(item.thickness_mm) : (item.thickness_mm || 0),
    coating: item.coating || '',
    color_or_ral: item.color_code || '',
    color_system: item.color_system || '',
    color_code: item.color_code || '',
    zinc_label: extractZincLabel(item.notes),
    work_width_mm: item.width_work_mm || 0,
    full_width_mm: item.width_full_mm || 0,
    price: item.price_rub_m2 ?? 0,
    unit: item.unit === 'm2' ? 'm2' : 'sht',
    title: item.title,
    notes: item.notes,
  };
}

function catalogRowToCanonical(row: CatalogRow): CanonicalProduct {
  const extra = (row.extra_params || {}) as Record<string, unknown>;
  const sheetKind = (extra.sheet_kind as string) || '';
  const category = categorizeItem({ profile: row.profile || '', title: row.title || '', sheet_kind: sheetKind });
  const productType: ProductType =
    category === 'PROFNASTIL' ? 'PROFNASTIL' :
    category === 'METALLOCHEREPICA' ? 'METALLOCHEREPICA' :
    category === 'DOBOR' ? 'DOBOR' as ProductType :
    category === 'SANDWICH' ? 'SANDWICH' as ProductType :
    'OTHER' as ProductType;
  return {
    id: row.id,
    organization_id: '',
    product_type: productType,
    profile: row.profile || '',
    thickness_mm: row.thickness_mm || 0,
    coating: row.coating || '',
    color_or_ral: (extra.color_code as string) || '',
    color_system: (extra.color_system as string) || '',
    color_code: (extra.color_code as string) || '',
    zinc_label: extractZincLabel(row.notes || undefined),
    work_width_mm: row.width_work_mm || 0,
    full_width_mm: row.width_full_mm || 0,
    price: row.base_price_rub_m2 ?? 0,
    unit: 'm2',
    title: row.title || undefined,
    notes: row.notes || undefined,
  };
}

function mapQuestionType(backendType?: string): AIQuestionType {
  const t = (backendType || '').toUpperCase();
  if (t.includes('WIDTH')) return 'width';
  if (t.includes('THICK')) return 'thickness';
  if (t.includes('PROFILE')) return 'profile';
  if (t.includes('CATEGORY') || t.includes('CAT') || t.includes('KIND')) return 'category';
  if (t.includes('COATING') || t.includes('COAT')) return 'coating';
  if (t.includes('COLOR') || t.includes('COLOUR') || t.includes('RAL') || t.includes('RR')) return 'color';
  // Log unknown types for debugging instead of silently falling back
  console.warn('[mapQuestionType] Unknown question type from backend:', backendType, '— treating as "color"');
  return 'color';
}

function backendQuestionToAI(q: BackendQuestion, index: number): AIQuestion {
  // Contract v1: read new fields first, fallback to legacy
  const suggestedActions = q.suggested_actions || q.suggested_variants || [];
  return {
    type: mapQuestionType(q.type),
    cluster_path: { profile: q.profile || q.token || `q-${index}` },
    token: q.token || '',
    examples: q.examples || [],
    affected_count: q.affected_rows_count ?? q.affected_count ?? 0,
    suggestions: Array.isArray(suggestedActions)
      ? suggestedActions.map(String)
      : q.suggested ? [String(q.suggested)] : [],
    confidence: q.confidence || 0.5,
    ask: q.question_text || q.ask,
  };
}

// ─── Right Panel: Question Card (Enhanced) ────────────────────

function QuestionCard({
  card,
  onResolve,
  relatedQuestions,
}: {
  card: DashboardQuestionCard;
  onResolve: (type: string) => void;
  relatedQuestions?: AIQuestion[];
}) {
  const cfg = Q_TYPE_CONFIG[card.type] || { icon: AlertTriangle, label: card.type, color: 'bg-muted border-border text-foreground' };
  const Icon = cfg.icon;
  
  // Collect suggested actions from related questions
  const suggestedActions = relatedQuestions
    ?.flatMap(q => q.suggestions)
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 4) || [];

  // Human-readable question text from first related question
  const questionText = relatedQuestions?.[0]?.ask;

  return (
    <div className={`w-full text-left p-3 rounded-lg border transition-all hover:shadow-sm ${cfg.color}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5" />
          <span className="font-medium text-xs">{card.label || cfg.label}</span>
        </div>
        <Badge variant="secondary" className="text-xs font-bold">
          {card.count} товаров
        </Badge>
      </div>

      {/* Question text (human-readable from backend) */}
      {questionText && (
        <p className="text-xs mb-1.5">{questionText}</p>
      )}

      {/* Examples (3-5 items) */}
      {card.examples && card.examples.length > 0 && (
        <div className="mb-2">
          <span className="text-[10px] text-muted-foreground">Примеры: </span>
          <span className="text-[10px] font-mono">{card.examples.slice(0, 5).join(', ')}</span>
        </div>
      )}

      {/* Suggested actions as chips */}
      {suggestedActions.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {suggestedActions.map(action => (
            <span key={action} className="text-[10px] px-1.5 py-0.5 rounded bg-background/50 border border-border/50">
              {action}
            </span>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-1.5 mt-1">
        <Button
          size="sm"
          variant="default"
          className="h-6 text-[10px] px-2 flex-1"
          onClick={() => onResolve(card.type)}
        >
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Подтвердить
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-[10px] px-2"
          onClick={() => onResolve(card.type)}
        >
          Редактировать
        </Button>
      </div>
    </div>
  );
}

// ─── Right Panel: Answer Form (Enhanced) ──────────────────────

function QuestionAnswerForm({
  question,
  onSubmit,
  onClose,
  loading,
}: {
  question: AIQuestion;
  onSubmit: (value: string, scope?: 'all' | 'selected') => void;
  onClose: () => void;
  loading: boolean;
}) {
  const isWidth = question.type === 'width';
  const [fullMm, setFullMm] = useState('');
  const [workMm, setWorkMm] = useState('');
  const [value, setValue] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [scope, setScope] = useState<'all' | 'selected'>('all');

  const handleSubmit = () => {
    let finalValue = '';
    if (isWidth) {
      if (!fullMm) return;
      finalValue = workMm ? `${fullMm}:${workMm}` : fullMm;
    } else {
      finalValue = value || selected[0] || '';
    }
    if (finalValue) onSubmit(finalValue, scope);
  };

  const canSubmit = isWidth ? !!fullMm : (!!value || selected.length > 0);

  return (
    <div className="border rounded-lg p-3 bg-muted/30 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-xs font-semibold">
            {Q_TYPE_CONFIG[(question.type || '').toUpperCase() + '_MASTER'] || Q_TYPE_CONFIG[(question.type || '').toUpperCase() + '_MAP'] ? 
              (Q_TYPE_CONFIG[(question.type || '').toUpperCase() + '_MASTER'] || Q_TYPE_CONFIG[(question.type || '').toUpperCase() + '_MAP'])?.label
              : question.type}
          </span>
          {question.token && <span className="ml-1 text-[10px] text-muted-foreground">«{question.token}»</span>}
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-0.5">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {question.ask && (
        <p className="text-xs text-muted-foreground">{question.ask}</p>
      )}

      {question.affected_count > 0 && (
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground bg-primary/5 rounded px-2 py-1">
          <FileText className="h-3 w-3 shrink-0" />
          Затронуто товаров: <strong className="text-foreground">{question.affected_count}</strong>
        </div>
      )}

      {/* Examples */}
      {question.examples.length > 0 && (
        <div className="text-[10px]">
          <span className="text-muted-foreground">Примеры: </span>
          <span className="font-mono">{question.examples.slice(0, 5).join(' · ')}</span>
        </div>
      )}

      {/* WIDTH: two separate fields */}
      {isWidth ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground block mb-1">Полная, мм *</label>
              <Input
                value={fullMm}
                onChange={e => setFullMm(e.target.value.replace(/\D/g, ''))}
                placeholder="1200"
                className="h-7 text-xs"
                inputMode="numeric"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground block mb-1">Рабочая, мм</label>
              <Input
                value={workMm}
                onChange={e => setWorkMm(e.target.value.replace(/\D/g, ''))}
                placeholder="необяз."
                className="h-7 text-xs"
                inputMode="numeric"
              />
            </div>
          </div>
          {question.suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {question.suggestions.map(s => (
                <button
                  key={s}
                  onClick={() => {
                    const parts = s.split(':');
                    setFullMm(parts[0] || '');
                    setWorkMm(parts[1] || '');
                  }}
                  className="text-[10px] px-2 py-0.5 rounded border border-border bg-background hover:border-primary transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Suggestions as chips */}
          {question.suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {question.suggestions.map(s => (
                <button
                  key={s}
                  onClick={() => { setValue(s); setSelected([s]); }}
                  className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                    selected.includes(s)
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border bg-background hover:border-primary'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          <Input
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder="Введите значение (canonical_value)…"
            className="h-7 text-xs"
          />
        </>
      )}

      {/* Scope selector */}
      <div className="flex items-center gap-3 text-[10px]">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} className="w-3 h-3" />
          Все совпадения ({question.affected_count})
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="radio" checked={scope === 'selected'} onChange={() => setScope('selected')} className="w-3 h-3" />
          Только выбранные
        </label>
      </div>

      {/* Preview of what will change */}
      {canSubmit && (
        <div className="text-[10px] bg-primary/5 rounded px-2 py-1.5 border border-primary/10">
          <span className="font-medium">Предпросмотр:</span> Будет изменено <strong>{scope === 'all' ? question.affected_count : '—'}</strong> строк. Значение: <code className="bg-background px-1 rounded">{isWidth ? (workMm ? `${fullMm}:${workMm}` : fullMm) : (value || selected[0])}</code>
        </div>
      )}

      <Button size="sm" onClick={handleSubmit} disabled={loading || !canSubmit} className="h-7 text-xs w-full">
        {loading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
        Подтвердить и применить
      </Button>
    </div>
  );
}

// ─── Right Panel: AI Chat ─────────────────────────────────────

// Примеры команд для AI-чата
const CHAT_EXAMPLES = [
  'Установи покрытие MattPE → Матовый полиэстер',
  'Установи покрытие Plastisol → Пластизол',
  'Установи покрытие Valori → Пуральметалл',
  'Установи цвет RAL9003 → белый',
  'Установи цвет RR32 → тёмно-коричневый',
  'Какие товары с неизвестным профилем?',
];

function AIChatPanel({
  organizationId,
  importJobId,
  onApplyActions,
  runId,
  confirmActions: confirmActionsFn,
}: {
  organizationId: string;
  importJobId?: string;
  onApplyActions?: (actions: AiChatV2Action[]) => void;
  runId?: string | null;
  confirmActions?: (actions: ConfirmAction[]) => Promise<unknown>;
}) {
  const norm = useNormalization({ organizationId, importJobId });
  const [messages, setMessages] = useState<Array<{
    role: 'user' | 'ai';
    text: string;
    isError?: boolean;
    actions?: AiChatV2Action[];
    actionsApplied?: boolean;
  }>>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [applyingIdx, setApplyingIdx] = useState<number | null>(null);
  const [showExamples, setShowExamples] = useState(true);
  const scrollEndRef = useRef<HTMLDivElement>(null);

  const sendMessage = useCallback(async (overrideMsg?: string) => {
    const msg = (overrideMsg || input).trim();
    if (!msg || loading) return;
    setInput('');
    setShowExamples(false);
    setMessages(prev => [...prev, { role: 'user', text: msg }]);
    setLoading(true);

    try {
      const result = await norm.sendAiChatV2(msg, {});

      if (!result || result.ok === false) {
        let errMsg = result?.error || 'Ошибка ИИ';
        if (result?.code === 'TIMEOUT') errMsg = '⏱ ИИ не ответил вовремя. Попробуйте ещё раз.';
        if (result?.ai_disabled) errMsg = `ИИ отключён: ${result.ai_skip_reason || 'неизвестная причина'}`;
        console.error('[AIChatPanel] AI error response:', result);
        setMessages(prev => [...prev, { role: 'ai', text: `⚠️ ${errMsg}`, isError: true }]);
        return;
      }

      const reply = result.assistant_message || '';
      const actions = result.actions || [];

      if (!reply && actions.length === 0) {
        setMessages(prev => [...prev, {
          role: 'ai',
          text: '💡 Примеры команд:\n\n• «Установи покрытие MattPE → Матовый полиэстер»\n• «Установи цвет RAL9003 → белый»\n• «Какие товары с неизвестным профилем?»',
        }]);
        return;
      }

      setMessages(prev => [...prev, {
        role: 'ai',
        text: reply,
        actions: actions.length > 0 ? actions : undefined,
      }]);
    } catch (err) {
      console.error('[AIChatPanel] sendMessage error:', err);
      const errMsg = err instanceof Error ? err.message : 'Ошибка подключения к ИИ';
      const friendlyErr = errMsg.includes('401') ? 'Требуется авторизация. Перезайдите в систему.'
        : errMsg.includes('403') ? 'Нет доступа к ИИ-чату.'
        : errMsg.substring(0, 200);
      setMessages(prev => [...prev, { role: 'ai', text: `⚠️ ${friendlyErr}`, isError: true }]);
    } finally {
      setLoading(false);
      setTimeout(() => scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  }, [input, loading, norm]);

  const handleApplyActions = useCallback(async (actions: AiChatV2Action[], msgIndex: number) => {
    setApplyingIdx(msgIndex);
    try {
      // Use confirmActions batch endpoint
      const confirmPayload: ConfirmAction[] = actions.map(a => ({
        type: a.type,
        payload: a.payload,
      }));

      if (confirmActionsFn) {
        await confirmActionsFn(confirmPayload);
      } else {
        await norm.confirmActions(confirmPayload);
      }

      // Mark as applied
      setMessages(prev => prev.map((m, i) =>
        i === msgIndex ? { ...m, actionsApplied: true } : m
      ));

      if (onApplyActions) {
        onApplyActions(actions);
      }
    } catch (err) {
      console.error('[AIChatPanel] Apply actions error:', err);
    } finally {
      setApplyingIdx(null);
    }
  }, [confirmActionsFn, norm, onApplyActions]);

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 space-y-2">
          {/* Welcome / examples */}
          {showExamples && messages.length === 0 && (
            <div className="space-y-2">
              <div className="text-center py-3 text-muted-foreground">
                <MessageSquare className="h-7 w-7 mx-auto mb-2 opacity-30" />
                <p className="text-xs font-medium">ИИ-чат для нормализации</p>
                <p className="text-[10px] mt-0.5 opacity-70">Задайте вопрос или отдайте команду</p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Примеры команд</p>
                {CHAT_EXAMPLES.map((ex, i) => (
                  <button
                    key={i}
                    onClick={() => sendMessage(ex)}
                    className="w-full text-left text-[11px] px-2 py-1.5 rounded border border-border hover:border-primary hover:bg-primary/5 transition-colors text-foreground"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[90%] rounded-lg px-3 py-2 text-xs whitespace-pre-line ${
                m.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : m.isError
                    ? 'bg-destructive/10 text-destructive border border-destructive/20'
                    : 'bg-muted text-foreground'
              }`}>
                {m.text}
                
                {/* Contract v1: Pending Actions as list */}
                {m.actions && m.actions.length > 0 && !m.actionsApplied && (
                  <div className="mt-2 p-2 bg-background rounded border border-primary/20 space-y-1.5">
                    <div className="flex items-center gap-1 mb-1">
                      <AlertTriangle className="h-3 w-3 text-primary" />
                      <span className="text-[10px] font-semibold">
                        {m.actions.length} {m.actions.length === 1 ? 'действие' : 'действий'} ожидает подтверждения
                      </span>
                    </div>
                    {m.actions.map((action, j) => (
                      <div key={j} className="text-[10px] font-mono bg-muted/50 rounded px-2 py-1 truncate">
                        <span className="text-primary font-semibold">{action.type}</span>
                        {': '}
                        {JSON.stringify(action.payload).substring(0, 80)}
                      </div>
                    ))}
                    <Button
                      size="sm"
                      className="h-6 text-[10px] w-full"
                      onClick={() => handleApplyActions(m.actions!, i)}
                      disabled={applyingIdx === i}
                    >
                      {applyingIdx === i
                        ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        : <Play className="h-3 w-3 mr-1" />}
                      Применить ко всему прайсу
                    </Button>
                  </div>
                )}
                {m.actionsApplied && (
                  <div className="mt-1 text-[10px] text-primary flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Применено!
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-lg px-3 py-2">
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
          <div ref={scrollEndRef} />
        </div>
      </ScrollArea>

      <div className="p-2 border-t flex gap-2">
        <Textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
          placeholder="Спросить ИИ… (Enter — отправить)"
          className="text-xs resize-none min-h-0 py-1.5"
          rows={2}
        />
        <Button size="sm" onClick={() => sendMessage()} disabled={!input.trim() || loading} className="h-auto w-8 p-0 shrink-0 self-end mb-0.5">
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ─── Left Panel: Category Tree ────────────────────────────────

function CategorySidebar({
  activeCategory,
  onSelect,
  stats,
  loading,
  onlyProblematic,
  onToggleProblematic,
}: {
  activeCategory: ProductCategory;
  onSelect: (cat: ProductCategory) => void;
  stats: Record<string, { total: number; ready: number; needsAttention: number }>;
  loading: boolean;
  onlyProblematic: boolean;
  onToggleProblematic: (v: boolean) => void;
}) {
  const cats: ProductCategory[] = ['ALL', 'PROFNASTIL', 'METALLOCHEREPICA', 'DOBOR', 'SANDWICH', 'OTHER'];

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Категории</span>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-0.5">
          {cats.map(cat => {
            const s = stats[cat] || { total: 0, ready: 0, needsAttention: 0 };
            const isActive = activeCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => onSelect(cat)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs transition-colors ${
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted text-foreground'
                }`}
              >
                <span className="font-medium truncate">{CAT_LABELS[cat]}</span>
                <div className="flex items-center gap-1 shrink-0 ml-2">
                  {s.needsAttention > 0 && (
                    <Badge
                      className={`text-[10px] h-4 px-1 ${isActive ? 'bg-white/20 text-white' : 'bg-destructive/10 text-destructive border-destructive/20'}`}
                      variant="outline"
                    >
                      !{s.needsAttention}
                    </Badge>
                  )}
                  <span className={`text-[10px] ${isActive ? 'opacity-70' : 'text-muted-foreground'}`}>
                    {s.total}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </ScrollArea>

      {/* Filters */}
      <div className="p-3 border-t space-y-2">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
          <Filter className="h-3 w-3" /> Фильтры
        </span>
        <div className="flex items-center gap-2">
          <Switch
            id="only-prob"
            checked={onlyProblematic}
            onCheckedChange={onToggleProblematic}
            className="scale-75"
          />
          <Label htmlFor="only-prob" className="text-xs cursor-pointer">Только проблемные</Label>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────

export function NormalizationWizard({
  open,
  onOpenChange,
  organizationId,
  importJobId: propJobId,
  onComplete,
}: NormalizationWizardProps) {
  const { t } = useTranslation();
  const DEV_MODE = import.meta.env.DEV;

  const [inputJobId, setInputJobId] = useState(propJobId || '');
  const effectiveJobId = propJobId || inputJobId || undefined;

  // UI state
  const [activeCategory, setActiveCategory] = useState<ProductCategory>('PROFNASTIL');
  const [selectedCluster, setSelectedCluster] = useState<ClusterPath | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [onlyProblematic, setOnlyProblematic] = useState(false);
  const [rightTab, setRightTab] = useState<'questions' | 'rules' | 'chat'>('questions');
  const [activeQuestionForm, setActiveQuestionForm] = useState<AIQuestion | null>(null);
  const [confirmApplyOpen, setConfirmApplyOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const norm = useNormalization({ organizationId, importJobId: effectiveJobId });

  // Auto-load: on open, run dashboard + preview_rows, then auto-scan
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!open || !organizationId) return;
    if (autoStartedRef.current) return;
    autoStartedRef.current = true;

    console.log('[NormalizationWizard] Opening, auto-loading dashboard + preview_rows...');

    // 0. Ensure ai_policy exists in bot_settings (idempotent deep merge)
    supabase.functions.invoke('settings-merge', {
      body: {
        organization_id: organizationId,
        patch: {
          ai_policy: {
            ai_enabled: true,
            shadow_mode: true,
            autopatch_after_confirm: true,
            max_questions_per_run: 40,
          },
        },
      },
    }).catch(err => console.warn('[NormalizationWizard] ai_policy seed failed (non-critical):', err));

    // 1. Load dashboard KPIs
    norm.fetchDashboard(effectiveJobId);

    // 2. Load preview rows (BigQuery data) for immediate display
    norm.fetchCatalogItems(500);

    // 3. If we have an import job, also auto-run dry_run to get questions
    if (effectiveJobId) {
      console.log('[NormalizationWizard] Auto-triggering dry_run for job:', effectiveJobId);
      norm.executeDryRun({ aiSuggest: true, limit: 2000, onlyWhereNull: false });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, organizationId]);

  // Reset auto-start flag when dialog closes
  useEffect(() => {
    if (!open) {
      autoStartedRef.current = false;
    }
  }, [open]);

  // Build items from dry_run patches or preview_rows
  const items = useMemo(() => {
    const patches = norm.dryRunResult?.patches_sample || [];
    if (patches.length > 0) return patches.map(patchToCanonical);
    if (norm.catalogItems.length > 0) return norm.catalogItems.map(catalogRowToCanonical);
    return [];
  }, [norm.dryRunResult, norm.catalogItems]);

  // AI questions from dry_run
  const aiQuestions = useMemo(() => {
    return (norm.dryRunResult?.questions || []).map(backendQuestionToAI);
  }, [norm.dryRunResult]);

  // Dashboard question cards
  const questionCards = useMemo((): DashboardQuestionCard[] => {
    // Prefer dashboard cards; fall back to aggregating from aiQuestions
    if (norm.dashboardResult?.question_cards?.length) return norm.dashboardResult.question_cards;
    // Build from dry_run questions
    const byType: Record<string, { count: number; examples: string[] }> = {};
    aiQuestions.forEach(q => {
      const key = (q.type || 'OTHER').toUpperCase();
      const typeKey = key === 'WIDTH' ? 'WIDTH_MASTER' : key === 'COATING' ? 'COATING_MAP' : key === 'COLOR' ? 'COLOR_MAP' : key;
      if (!byType[typeKey]) byType[typeKey] = { count: 0, examples: [] };
      byType[typeKey].count += q.affected_count || 1;
      if (q.token && byType[typeKey].examples.length < 2) byType[typeKey].examples.push(q.token);
    });
    return Object.entries(byType).map(([type, d]) => ({
      type,
      label: Q_TYPE_CONFIG[type]?.label || type,
      count: d.count,
      examples: d.examples,
    }));
  }, [norm.dashboardResult, aiQuestions]);

  // Category stats
  const categoryStats = useMemo(() => {
    const stats: Record<ProductCategory, { total: number; ready: number; needsAttention: number }> = {
      ALL: { total: 0, ready: 0, needsAttention: 0 },
      PROFNASTIL: { total: 0, ready: 0, needsAttention: 0 },
      METALLOCHEREPICA: { total: 0, ready: 0, needsAttention: 0 },
      DOBOR: { total: 0, ready: 0, needsAttention: 0 },
      SANDWICH: { total: 0, ready: 0, needsAttention: 0 },
      OTHER: { total: 0, ready: 0, needsAttention: 0 },
    };
    items.forEach(item => {
      const cat = (item.product_type || 'OTHER') as ProductCategory;
      const v = validateProduct(item);
      stats.ALL.total++;
      if (stats[cat]) stats[cat].total++;
      if (v.status === 'ready') {
        stats.ALL.ready++;
        if (stats[cat]) stats[cat].ready++;
      } else {
        stats.ALL.needsAttention++;
        if (stats[cat]) stats[cat].needsAttention++;
      }
    });
    return stats;
  }, [items]);

  // Auto-select best category
  useEffect(() => {
    if (items.length === 0) return;
    const currentCount = categoryStats[activeCategory]?.total || 0;
    if (currentCount > 0) return;
    const cats: ProductCategory[] = ['PROFNASTIL', 'METALLOCHEREPICA', 'DOBOR', 'SANDWICH', 'OTHER'];
    let best: ProductCategory = 'ALL';
    let bestCount = 0;
    for (const c of cats) {
      if ((categoryStats[c]?.total || 0) > bestCount) {
        bestCount = categoryStats[c].total;
        best = c;
      }
    }
    setActiveCategory(bestCount > 0 ? best : 'ALL');
  }, [items, categoryStats]);

  // Filtered items
  const filteredItems = useMemo(() => {
    let result = activeCategory === 'ALL' ? items : items.filter(i => (i.product_type || 'OTHER') === activeCategory);
    if (onlyProblematic) {
      result = result.filter(i => validateProduct(i).status !== 'ready');
    }
    return result;
  }, [items, activeCategory, onlyProblematic]);

  const isNormalizable = activeCategory === 'PROFNASTIL' || activeCategory === 'METALLOCHEREPICA';
  const isApplying = norm.applyState === 'STARTING' || norm.applyState === 'PENDING' || norm.applyState === 'RUNNING';
  const patchesReady = norm.dryRunResult?.stats?.patches_ready || 0;
  const totalScanned = norm.dryRunResult?.stats?.rows_scanned || norm.catalogTotal || 0;

  // Dashboard KPIs
  const dashProgress = norm.dashboardResult?.progress;
  const kpiTotal = dashProgress?.total || categoryStats.ALL.total || totalScanned;
  const kpiReady = dashProgress?.ready || categoryStats.ALL.ready;
  const kpiAttention = dashProgress?.needs_attention || categoryStats.ALL.needsAttention;
  const kpiPct = dashProgress?.ready_pct || (kpiTotal > 0 ? (kpiReady / kpiTotal) * 100 : 0);

  // Handlers
  const handleRunScan = useCallback(() => {
    norm.executeDryRun({ aiSuggest: true, limit: 2000, onlyWhereNull: false });
    norm.fetchDashboard(effectiveJobId);
  }, [norm, effectiveJobId]);

  const handleApply = useCallback(() => {
    setConfirmApplyOpen(false);
    norm.executeApply();
  }, [norm]);

  const handleSelectCluster = useCallback((path: ClusterPath) => {
    setSelectedCluster(path);
  }, []);

  const handleToggleNode = useCallback((nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId);
      return next;
    });
  }, []);

  const handleResolveQuestionType = useCallback((type: string) => {
    // Find first matching question and open its form
    const q = aiQuestions.find(aq => {
      const t = (aq.type || '').toUpperCase();
      if (type === 'WIDTH_MASTER' && t === 'WIDTH') return true;
      if (type === 'COATING_MAP' && t === 'COATING') return true;
      if (type === 'COLOR_MAP' && t === 'COLOR') return true;
      return t === type;
    });
    if (q) {
      setActiveQuestionForm(q);
      setRightTab('questions');
    } else {
      toast({ title: 'Нет вопросов этого типа', description: 'Выполните сканирование сначала' });
    }
  }, [aiQuestions]);

  const handleAnswerQuestion = useCallback(async (value: string, scope?: 'all' | 'selected') => {
    if (!activeQuestionForm) return;
    // Contract v1: convert answer to confirmActions payload
    const questionType = activeQuestionForm.type.toUpperCase();
    const backendType = questionType === 'WIDTH' ? 'WIDTH_MASTER'
      : questionType === 'COATING' ? 'COATING_MAP'
      : questionType === 'COLOR' ? 'COLOR_MAP'
      : questionType === 'THICKNESS' ? 'THICKNESS_SET'
      : questionType === 'PROFILE' ? 'PROFILE_MAP'
      : questionType === 'CATEGORY' ? 'CATEGORY_FIX'
      : questionType;
    
    const payload: Record<string, unknown> = {
      token: activeQuestionForm.token,
      canonical: value,
    };
    
    // For widths, parse "full:work" format
    if (backendType === 'WIDTH_MASTER' && value.includes(':')) {
      const [full, work] = value.split(':');
      payload.profile = activeQuestionForm.token;
      payload.full_mm = parseInt(full, 10) || 0;
      payload.work_mm = parseInt(work, 10) || 0;
      delete payload.canonical;
    }

    const action: ConfirmAction = { type: backendType, payload };
    const result = await norm.confirmActions([action]);
    if (result?.ok) {
      setActiveQuestionForm(null);
      toast({ title: t('normalize.rerunning', 'Обновляем результаты…') });
      norm.executeDryRun({ aiSuggest: true, limit: 2000 });
    }
  }, [norm, activeQuestionForm, t]);

  const handleAnswerFromCluster = useCallback(async (questionId: string, value: string | number) => {
    const question = aiQuestions.find((q, i) => `q-${i}` === questionId || q.token === questionId);
    const questionType = question?.type || questionId;
    const backendType = questionType.toUpperCase() === 'WIDTH' ? 'WIDTH_MASTER'
      : questionType.toUpperCase() === 'COATING' ? 'COATING_MAP'
      : questionType.toUpperCase() === 'COLOR' ? 'COLOR_MAP'
      : questionType.toUpperCase();
    const token = question?.token || questionId;
    
    const action: ConfirmAction = {
      type: backendType,
      payload: { token, canonical: value },
    };
    const result = await norm.confirmActions([action]);
    if (result?.ok) {
      toast({ title: t('normalize.rerunning', 'Обновляем результаты…') });
      norm.executeDryRun({ aiSuggest: true, limit: 2000 });
    }
  }, [norm, aiQuestions, t]);

  const getApplyStatusLabel = () => {
    const phaseLabel = norm.applyPhase && norm.applyPhase !== 'unknown'
      ? ` (${norm.applyPhase === 'materialize' ? 'подготовка' : norm.applyPhase === 'merge' ? 'слияние' : norm.applyPhase})`
      : '';
    switch (norm.applyState) {
      case 'STARTING': case 'PENDING': return `Запуск${phaseLabel}…`;
      case 'RUNNING': return `Применяем${phaseLabel}… ${norm.applyProgress > 0 ? norm.applyProgress + '%' : ''}`;
      case 'DONE': return '✓ Готово';
      case 'ERROR': return 'Ошибка';
      case 'POLL_EXCEEDED': return 'Превышен лимит ожидания';
      default: return '';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[98vw] w-[1700px] h-[95vh] flex flex-col p-0 gap-0">

        {/* ═══════════════════════════════════════════════════════
            TOP BAR: KPI + Actions
        ═══════════════════════════════════════════════════════ */}
        <div className="shrink-0 border-b bg-background">
          {/* Title row */}
          <div className="flex items-center justify-between px-4 py-2 border-b">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">Нормализация каталога</span>
              {totalScanned > 0 && (
                <Badge variant="outline" className="text-xs">{totalScanned.toLocaleString('ru')} товаров</Badge>
              )}
              {aiQuestions.length > 0 && (
                <Badge variant="destructive" className="text-xs">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  {questionCards.reduce((s, c) => s + c.count, 0)} проблем
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* DEV: job id input */}
              {DEV_MODE && !propJobId && (
                <Input
                  value={inputJobId}
                  onChange={e => setInputJobId(e.target.value)}
                  placeholder="Job ID"
                  className="h-7 w-40 text-xs"
                />
              )}

              {/* Settings toggle */}
              <Button size="sm" variant="ghost" onClick={() => setShowSettings(v => !v)} className="h-7 text-xs gap-1">
                <Settings2 className="h-3.5 w-3.5" />
              </Button>

              {/* Scan */}
              <Button size="sm" variant="outline" onClick={handleRunScan} disabled={norm.dryRunLoading || isApplying} className="h-7 text-xs">
                {norm.dryRunLoading
                  ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                Сканировать
              </Button>

              {/* Apply with confirmation */}
              {!confirmApplyOpen ? (
                <Button
                  size="sm"
                  onClick={() => setConfirmApplyOpen(true)}
                  disabled={patchesReady === 0 || isApplying}
                  className="h-7 text-xs"
                >
                  {isApplying
                    ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    : <Play className="h-3.5 w-3.5 mr-1.5" />}
                  Применить исправления
                  {patchesReady > 0 && <Badge variant="secondary" className="ml-1 text-xs">{patchesReady}</Badge>}
                </Button>
              ) : (
                <div className="flex items-center gap-1 bg-destructive/10 border border-destructive/30 rounded-md px-2 py-1">
                  <span className="text-xs text-destructive">Применить {patchesReady} исправлений?</span>
                  <Button size="sm" variant="destructive" onClick={handleApply} className="h-6 text-xs px-2">Да</Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmApplyOpen(false)} className="h-6 w-6 p-0">
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* KPI + Status row */}
          <div className="flex items-center gap-6 px-4 py-2">
            {/* KPI cards */}
            <div className="flex items-center gap-4">
              <div className="text-center">
                <div className="text-lg font-bold leading-none">{kpiTotal.toLocaleString('ru')}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">Всего</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold leading-none text-primary">{kpiReady.toLocaleString('ru')}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">Готово</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold leading-none text-destructive">{kpiAttention.toLocaleString('ru')}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">Проблем</div>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-center">
                  <div className="text-lg font-bold leading-none text-primary">{kpiPct.toFixed(1)}%</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">Готовность</div>
                </div>
                <Progress value={kpiPct} className="h-1.5 w-20" />
              </div>
            </div>

            <div className="h-8 border-l" />

            {/* Status */}
            {norm.dryRunLoading && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Сканирование каталога…
              </div>
            )}
            {norm.catalogLoading && !norm.dryRunLoading && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Загрузка данных…
              </div>
            )}
            {/* Apply Progress Bar */}
            {norm.applyState !== 'IDLE' && (
              <div className="flex items-center gap-3">
                <Badge
                  variant={norm.applyState === 'DONE' ? 'default' : norm.applyState === 'ERROR' ? 'destructive' : 'secondary'}
                  className="text-xs"
                >
                  {isApplying && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                  {getApplyStatusLabel()}
                </Badge>
                {isApplying && (
                  <div className="flex items-center gap-2">
                    <Progress value={norm.applyProgress} className="h-1.5 w-24" />
                    <span className="text-[10px] text-muted-foreground">{norm.applyProgress}%</span>
                  </div>
                )}
              </div>
            )}
            {norm.applyError && (
              <div className="flex items-center gap-1 text-xs text-destructive">
                <AlertCircle className="h-3 w-3" /> {norm.applyError}
              </div>
            )}
            {norm.dryRunResult?.stats && !norm.dryRunLoading && (
              <span className="text-xs text-muted-foreground">
                Найдено исправлений: <strong>{norm.dryRunResult.stats.patches_ready}</strong>
              </span>
            )}
          </div>

          {/* AI unavailable fallback banner — reads Contract v1 ai_status or legacy ai_disabled */}
          {(norm.dryRunResult?.ai_disabled || norm.dryRunResult?.stats?.ai_status?.failed) && (
            <div className="mx-4 mb-2 flex items-center gap-2 text-xs border border-destructive/30 bg-destructive/5 rounded-md px-3 py-2">
              <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
              <div>
                <span className="font-medium text-destructive">ИИ-ассистент недоступен</span>
                <span className="text-muted-foreground ml-1">
                  — {norm.dryRunResult?.stats?.ai_status?.fail_reason || norm.dryRunResult?.ai_skip_reason || 'сервис временно недоступен'}. Используются только детерминированные правила.
                </span>
              </div>
            </div>
          )}

          {/* Settings panel */}
          {showSettings && (
            <div className="px-4 pb-3 border-t max-h-56 overflow-y-auto">
              <ConfirmedSettingsEditor
                onSave={norm.saveConfirmedSettings}
                saving={norm.savingSettings}
              />
            </div>
          )}
        </div>

        {/* ═══════════════════════════════════════════════════════
            BODY: Left | Center | Right
        ═══════════════════════════════════════════════════════ */}
        <div className="flex-1 flex min-h-0 overflow-hidden">

          {/* ─── LEFT: Category sidebar ─── */}
          <div className="w-52 border-r shrink-0 flex flex-col">
            <CategorySidebar
              activeCategory={activeCategory}
              onSelect={setActiveCategory}
              stats={categoryStats}
              loading={norm.dryRunLoading}
              onlyProblematic={onlyProblematic}
              onToggleProblematic={setOnlyProblematic}
            />
          </div>

          {/* ─── CENTER: Clusters / Table ─── */}
          <div className="flex-1 min-w-0 flex flex-col">
            {/* Center toolbar */}
            <div className="px-3 py-2 border-b flex items-center gap-2 shrink-0">
              <span className="text-xs font-semibold text-muted-foreground">
                {CAT_LABELS[activeCategory]}
                {filteredItems.length > 0 && (
                  <span className="ml-2 font-normal">({filteredItems.length} товаров)</span>
                )}
              </span>
              {onlyProblematic && filteredItems.length < (categoryStats[activeCategory]?.total || 0) && (
                <Badge variant="outline" className="text-xs text-destructive border-destructive/30">
                  Только проблемные
                </Badge>
              )}
            </div>

            {isNormalizable ? (
              <div className="flex-1 flex min-h-0">
                {/* Cluster Tree */}
                <div className="w-72 border-r shrink-0">
                  <ClusterTree
                    items={filteredItems}
                    selectedCluster={selectedCluster}
                    onSelectCluster={handleSelectCluster}
                    expandedNodes={expandedNodes}
                    onToggleNode={handleToggleNode}
                  />
                </div>
                {/* Cluster detail */}
                <div className="flex-1 min-w-0">
                  <ClusterDetailPanel
                    items={filteredItems}
                    clusterPath={selectedCluster}
                    loading={norm.dryRunLoading}
                    aiQuestions={aiQuestions}
                    onAnswerQuestion={handleAnswerFromCluster}
                    answeringQuestion={norm.answeringQuestion}
                  />
                </div>
              </div>
            ) : (
              <div className="flex-1 min-w-0">
                <ClusterDetailPanel
                  items={filteredItems}
                  clusterPath={null}
                  loading={norm.dryRunLoading}
                  aiQuestions={aiQuestions}
                  onAnswerQuestion={handleAnswerFromCluster}
                  answeringQuestion={norm.answeringQuestion}
                  simpleMode
                />
              </div>
            )}
          </div>

          {/* ─── RIGHT: Questions + Chat + Rules ─── */}
          <div className="w-80 border-l shrink-0 flex flex-col">
            <Tabs value={rightTab} onValueChange={v => setRightTab(v as typeof rightTab)} className="flex flex-col h-full">
              <TabsList className="rounded-none border-b shrink-0 h-9 px-0 bg-transparent justify-start gap-0">
                <TabsTrigger value="questions" className="rounded-none text-xs px-4 h-9 border-b-2 data-[state=active]:border-primary data-[state=inactive]:border-transparent">
                  Вопросы {aiQuestions.length > 0 && <Badge variant="destructive" className="ml-1 text-[10px] h-4 px-1">{aiQuestions.length}</Badge>}
                </TabsTrigger>
                <TabsTrigger value="chat" className="rounded-none text-xs px-4 h-9 border-b-2 data-[state=active]:border-primary data-[state=inactive]:border-transparent">
                  ИИ-чат
                </TabsTrigger>
                <TabsTrigger value="rules" className="rounded-none text-xs px-4 h-9 border-b-2 data-[state=active]:border-primary data-[state=inactive]:border-transparent">
                  Правила
                </TabsTrigger>
              </TabsList>

              {/* QUESTIONS TAB */}
              <TabsContent value="questions" className="flex-1 min-h-0 m-0 flex flex-col">
                <ScrollArea className="flex-1 min-h-0">
                  <div className="p-3 space-y-3">
                    {/* Active question form */}
                    {activeQuestionForm && (
                      <QuestionAnswerForm
                        question={activeQuestionForm}
                        onSubmit={handleAnswerQuestion}
                        onClose={() => setActiveQuestionForm(null)}
                        loading={norm.answeringQuestion}
                      />
                    )}

                    {/* Question cards by type */}
                    {questionCards.length > 0 ? (
                      <>
                        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          Задачи нормализации
                        </div>
                        <div className="space-y-2">
                          {questionCards
                            .sort((a, b) => (b.count || 0) - (a.count || 0))
                            .map(card => {
                              // Find related AI questions for this card type
                              const relatedQs = aiQuestions.filter(aq => {
                                const t = (aq.type || '').toUpperCase();
                                if (card.type === 'WIDTH_MASTER' && t === 'WIDTH') return true;
                                if (card.type === 'COATING_MAP' && t === 'COATING') return true;
                                if (card.type === 'COLOR_MAP' && t === 'COLOR') return true;
                                return t === card.type;
                              });
                              return (
                                <QuestionCard
                                  key={card.type}
                                  card={card}
                                  onResolve={handleResolveQuestionType}
                                  relatedQuestions={relatedQs}
                                />
                              );
                            })}
                        </div>
                      </>
                    ) : !norm.dryRunResult ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <Sparkles className="h-8 w-8 mx-auto mb-3 opacity-30" />
                        <p className="text-xs">Нажмите «Сканировать» для анализа каталога</p>
                        <Button size="sm" variant="outline" onClick={handleRunScan} className="mt-3 h-7 text-xs" disabled={norm.dryRunLoading}>
                          {norm.dryRunLoading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
                          Сканировать
                        </Button>
                      </div>
                    ) : (
                      <div className="text-center py-8">
                        <CheckCircle2 className="h-8 w-8 mx-auto mb-3 text-primary" />
                        <p className="text-xs font-semibold">Все вопросы решены!</p>
                        <p className="text-xs text-muted-foreground mt-1">Нажмите «Применить исправления»</p>
                      </div>
                    )}

                    {/* ai_skip_reason banner — show if backend reported AI was skipped */}
                    {norm.dryRunResult && (norm.dryRunResult as unknown as { ai_skip_reason?: string; ai_disabled?: boolean }).ai_skip_reason && (
                      <div className="flex items-start gap-2 text-xs text-muted-foreground border border-border rounded-md p-2 bg-muted/30">
                        <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-warning" />
                        <div>
                          <span className="font-medium text-foreground">ИИ-анализ пропущен</span>
                          <br />
                          Причина: <code className="text-[10px]">{(norm.dryRunResult as unknown as { ai_skip_reason?: string }).ai_skip_reason}</code>
                          <br />
                          <span className="opacity-70">Используются только детерминированные правила.</span>
                        </div>
                      </div>
                    )}

                    {/* Individual questions list */}
                    {aiQuestions.length > 0 && !activeQuestionForm && (
                      <>
                        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-4">
                          Детали вопросов
                        </div>
                        <div className="space-y-1">
                          {aiQuestions.slice(0, 20).map((q, i) => {
                            const cfg = Q_TYPE_CONFIG[q.type?.toUpperCase() + '_MAP'] || Q_TYPE_CONFIG[q.type?.toUpperCase() + '_MASTER'] || { icon: AlertTriangle, label: q.type, color: '' };
                            const Icon = cfg.icon;
                            return (
                              <button
                                key={i}
                                onClick={() => setActiveQuestionForm(q)}
                                className="w-full text-left px-2 py-1.5 rounded border hover:bg-muted transition-colors"
                              >
                                <div className="flex items-center gap-2">
                                  <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
                                  <span className="text-xs font-medium truncate">{q.token || `вопрос ${i + 1}`}</span>
                                  {q.affected_count > 0 && (
                                    <Badge variant="outline" className="text-[10px] h-4 px-1 ml-auto shrink-0">{q.affected_count}</Badge>
                                  )}
                                </div>
                                {q.examples.length > 0 && (
                                  <p className="text-[10px] text-muted-foreground truncate mt-0.5 pl-5">{q.examples[0]}</p>
                                )}
                              </button>
                            );
                          })}
                          {aiQuestions.length > 20 && (
                            <p className="text-xs text-muted-foreground text-center py-2">
                              + ещё {aiQuestions.length - 20} вопросов
                            </p>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              {/* CHAT TAB */}
              <TabsContent value="chat" className="flex-1 min-h-0 m-0 flex flex-col">
                <AIChatPanel
                  organizationId={organizationId}
                  importJobId={effectiveJobId}
                  runId={norm.runId}
                  confirmActions={norm.confirmActions}
                  onApplyActions={(actions) => {
                    // After chat batch confirm, re-scan
                    toast({ title: 'Применено из чата', description: `${actions.length} правил применено` });
                    norm.executeDryRun({ aiSuggest: true, limit: 2000 });
                  }}
                />
              </TabsContent>

              {/* RULES TAB */}
              <TabsContent value="rules" className="flex-1 min-h-0 m-0">
                <ScrollArea className="h-full">
                  <div className="p-3">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                      Подтверждённые правила
                    </div>
                    <ConfirmedSettingsEditor
                      onSave={norm.saveConfirmedSettings}
                      saving={norm.savingSettings}
                    />
                  </div>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default NormalizationWizard;
