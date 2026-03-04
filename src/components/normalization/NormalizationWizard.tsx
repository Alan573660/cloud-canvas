/**
 * NormalizationWizard v4 — Redesigned workspace with resizable panels.
 * 
 * Layout: [Top sticky bar] + [Left: categories | Center: clusters/table | Right: AI/questions]
 * Uses ResizablePanelGroup for flexible panel sizing.
 * Integrates useNormalizationFlow state machine.
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { invokeEdge } from '@/lib/api-client';
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
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { toast } from '@/hooks/use-toast';
import {
  Sparkles, Loader2, RefreshCw, Play, CheckCircle2,
  AlertTriangle, Ruler, Layers, Palette, BarChart3, TrendingUp,
  Activity, MessageSquare, Settings2, Send, X, AlertCircle, FileText, Filter,
  PanelRightClose, PanelRightOpen
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
import { useNormalizationFlow } from '@/hooks/use-normalization-flow';
import type { DryRunPatch, BackendQuestion, CatalogRow, DashboardQuestionCard, AiChatV2Action, AiChatV2Result, ConfirmAction } from '@/lib/contract-types';

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
  WIDTH_MASTER:      { icon: Ruler,      label: 'Ширины',         color: 'bg-blue-500/10 border-blue-500/30 text-blue-700' },
  COATING_MAP:       { icon: Layers,     label: 'Покрытия',       color: 'bg-orange-500/10 border-orange-500/30 text-orange-700' },
  COLOR_MAP:         { icon: Palette,    label: 'Цвета',          color: 'bg-purple-500/10 border-purple-500/30 text-purple-700' },
  THICKNESS_SET:     { icon: BarChart3,  label: 'Толщины',        color: 'bg-green-500/10 border-green-500/30 text-green-700' },
  PROFILE_MAP:       { icon: TrendingUp, label: 'Профили',        color: 'bg-cyan-500/10 border-cyan-500/30 text-cyan-700' },
  CATEGORY_FIX:      { icon: Activity,   label: 'Категории',      color: 'bg-destructive/10 border-destructive/30 text-destructive' },
  PRODUCT_KIND_MAP:  { icon: Activity,   label: 'Тип продукции',  color: 'bg-amber-500/10 border-amber-500/30 text-amber-700' },
};

const CAT_LABELS: Record<string, string> = {
  ALL: 'Все товары',
  PROFNASTIL: 'Профнастил',
  METALLOCHEREPICA: 'Металлочерепица',
  DOBOR: 'Доборные элементы',
  SANDWICH: 'Сэндвич-панели',
  OTHER: 'Прочее',
};

// ─── Helpers ──────────────────────────────────────────────────

const RE_PROFNASTIL_PROFILE = /^(NS|НС|С|C|Н|H|НС|HC|МП|MP|Н)-?\d/i;
const RE_METALLOCHEREPICA_TITLE = /металлочерепица|monterrey|монтеррей|cascade|каскад|adamante|адаманте|quadro|квадро|genesis|dimos|luxury|supermonterey|супермонтеррей|modern|vintage|country|finnera|banga|decorrey|kredo|classic/i;
const RE_PROFNASTIL_TITLE = /профнастил|профлист/i;
const RE_DOBOR_TITLE = /планка|конёк|конек|ендова|карниз|ветровая|заглушка|шуруп|саморез|кронштейн|крепёж|крепеж|болт|гайка|шайба|доборн/i;
const RE_SANDWICH_TITLE = /сэндвич|sandwich|панель утеплен/i;

// Metal tile profile extraction from title: "Металлочерепица Adamante 0.4 ..." → "Adamante"
const METAL_TILE_PROFILES = [
  'Monterrey', 'Монтеррей', 'SuperMonterrey', 'Супермонтеррей',
  'Cascade', 'Каскад', 'Adamante', 'Адаманте',
  'Quadro', 'Квадро', 'Classic', 'Классик',
  'Genesis', 'Dimos', 'Modern', 'Модерн',
  'Vintage', 'Country', 'Finnera', 'Banga', 'Банга',
  'Decorrey', 'Декоррей', 'Kredo', 'Кредо',
  'Luxury', 'Макси', 'Maxi',
];
const RE_METAL_TILE_PROFILE = new RegExp(`(?:металлочерепица|metal\\s*tile)\\s+(${METAL_TILE_PROFILES.join('|')})`, 'i');

function extractMetalTileProfile(title?: string): string {
  if (!title) return '';
  const m = RE_METAL_TILE_PROFILE.exec(title);
  return m ? m[1] : '';
}

function categorizeItem(item: { profile?: string; title?: string; sheet_kind?: string; family_key?: string }): ProductCategory {
  const sheetKind = (item.sheet_kind || '').toUpperCase();
  if (sheetKind === 'PROFNASTIL') return 'PROFNASTIL';
  if (sheetKind === 'METAL_TILE') return 'METALLOCHEREPICA';
  if (sheetKind === 'ACCESSORY' || sheetKind === 'DOBOR') return 'DOBOR';
  if (sheetKind === 'SANDWICH') return 'SANDWICH';

  const profile = (item.profile || '').trim();
  const title = (item.title || '').trim();
  const familyKey = (item.family_key || '').toUpperCase();

  if (familyKey.includes('METAL_TILE') || familyKey.includes('METALLOCHEREPICA')) return 'METALLOCHEREPICA';
  if (familyKey.includes('PROFNASTIL') || familyKey.includes('CORRUGATED')) return 'PROFNASTIL';
  if (profile && RE_PROFNASTIL_PROFILE.test(profile)) return 'PROFNASTIL';
  if (RE_PROFNASTIL_TITLE.test(title)) return 'PROFNASTIL';
  if (RE_METALLOCHEREPICA_TITLE.test(title)) return 'METALLOCHEREPICA';
  if (RE_SANDWICH_TITLE.test(title)) return 'SANDWICH';
  if (RE_DOBOR_TITLE.test(title)) return 'DOBOR';
  if (RE_METALLOCHEREPICA_TITLE.test(profile)) return 'METALLOCHEREPICA';
  return 'OTHER';
}

function extractZincLabel(notes?: string): string | undefined {
  if (!notes) return undefined;
  const match = notes.match(/ZINC[:\s]*(ZN?\d+)/i);
  return match ? match[1].toUpperCase() : undefined;
}

function patchToCanonical(item: DryRunPatch): CanonicalProduct {
  const category = categorizeItem({ profile: item.profile, title: item.title, sheet_kind: item.sheet_kind, family_key: item.family_key });
  
  // Extract profile for metal tiles from title if backend didn't provide it
  let profile = item.profile || '';
  if (!profile && category === 'METALLOCHEREPICA') {
    profile = extractMetalTileProfile(item.title);
  }
  
  // Price: prefer price_rub_m2, fallback to cur (string from enricher)
  let price = item.price_rub_m2 ?? 0;
  if (!price && item.cur != null) {
    price = typeof item.cur === 'number' ? item.cur : parseFloat(String(item.cur)) || 0;
  }
  
  return {
    id: item.id,
    organization_id: '',
    product_type: category === 'ALL' ? 'OTHER' : category,
    profile,
    thickness_mm: typeof item.thickness_mm === 'string' ? parseFloat(item.thickness_mm) : (item.thickness_mm || 0),
    coating: item.coating || '',
    color_or_ral: item.color_code || '',
    color_system: item.color_system || '',
    color_code: item.color_code || '',
    zinc_label: extractZincLabel(item.notes),
    work_width_mm: item.width_work_mm || 0,
    full_width_mm: item.width_full_mm || 0,
    price,
    unit: item.unit === 'm2' ? 'm2' : 'sht',
    title: item.title,
    notes: item.notes,
  };
}

function catalogRowToCanonical(row: CatalogRow): CanonicalProduct {
  const extra = (row.extra_params || {}) as Record<string, unknown>;
  const sheetKind = (extra.sheet_kind as string) || '';
  const category = categorizeItem({ profile: row.profile || '', title: row.title || '', sheet_kind: sheetKind });
  return {
    id: row.id,
    organization_id: '',
    product_type: category === 'ALL' ? 'OTHER' : category,
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
  console.warn('[mapQuestionType] Unknown question type:', backendType);
  return 'color';
}

function suggestedActionToString(s: unknown): string {
  if (typeof s === 'string') return s;
  if (typeof s === 'number') return String(s);
  if (s && typeof s === 'object') {
    const obj = s as Record<string, unknown>;
    return (obj.label || obj.value || obj.canonical || obj.name || JSON.stringify(s)) as string;
  }
  return String(s);
}

function backendQuestionToAI(q: BackendQuestion, index: number): AIQuestion {
  const suggestedActions = q.suggested_actions || q.suggested_variants || [];
  return {
    type: mapQuestionType(q.type),
    cluster_path: { profile: q.profile || q.token || `q-${index}` },
    token: q.token || q.profile || '',
    examples: q.examples || [],
    affected_count: q.affected_rows_count ?? q.affected_count ?? 0,
    suggestions: Array.isArray(suggestedActions) ? suggestedActions.map(suggestedActionToString) : q.suggested ? [suggestedActionToString(q.suggested)] : [],
    confidence: q.confidence || 0.5,
    ask: q.question_text || q.ask,
  };
}

// ═══════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════

// ─── Question Card ────────────────────────────────────────────

function QuestionCard({
  card, onResolve, relatedQuestions,
}: {
  card: DashboardQuestionCard;
  onResolve: (type: string) => void;
  relatedQuestions?: AIQuestion[];
}) {
  const cfg = Q_TYPE_CONFIG[card.type] || { icon: AlertTriangle, label: card.type, color: 'bg-muted border-border text-foreground' };
  const Icon = cfg.icon;
  const questionText = relatedQuestions?.[0]?.ask;

  return (
    <div className={`w-full text-left p-3 rounded-lg border transition-all hover:shadow-sm ${cfg.color}`}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5" />
          <span className="font-medium text-xs">{card.label || cfg.label}</span>
        </div>
        <Badge variant="secondary" className="text-xs font-bold">{card.count} товаров</Badge>
      </div>
      {questionText && <p className="text-xs mb-1.5 opacity-80">{questionText}</p>}
      {card.examples && card.examples.length > 0 && (
        <div className="mb-2">
          <span className="text-[10px] text-muted-foreground">Примеры: </span>
          <span className="text-[10px] font-mono">{card.examples.slice(0, 3).join(', ')}</span>
        </div>
      )}
      <Button size="sm" variant="default" className="h-6 text-[10px] px-3 w-full" onClick={() => onResolve(card.type)}>
        <CheckCircle2 className="h-3 w-3 mr-1" /> Подтвердить
      </Button>
    </div>
  );
}

// ─── Question Answer Form ─────────────────────────────────────

function QuestionAnswerForm({
  question, onSubmit, onClose, loading,
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

  const handleSubmit = () => {
    let finalValue = '';
    if (isWidth) {
      if (!fullMm) return;
      finalValue = workMm ? `${fullMm}:${workMm}` : fullMm;
    } else {
      finalValue = value || selected[0] || '';
    }
    if (finalValue) onSubmit(finalValue, 'all');
  };

  const canSubmit = isWidth ? !!fullMm : (!!value || selected.length > 0);

  return (
    <div className="border rounded-lg p-3 bg-muted/30 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {(() => { const cfg = Q_TYPE_CONFIG[(question.type || '').toUpperCase() + '_MASTER'] || Q_TYPE_CONFIG[(question.type || '').toUpperCase() + '_MAP']; const QIcon = cfg?.icon || AlertTriangle; return <QIcon className="h-3.5 w-3.5 text-primary" />; })()}
          <span className="text-xs font-semibold">
            {Q_TYPE_CONFIG[(question.type || '').toUpperCase() + '_MASTER']?.label ||
             Q_TYPE_CONFIG[(question.type || '').toUpperCase() + '_MAP']?.label ||
             question.type}
          </span>
          {question.token && <Badge variant="secondary" className="text-[10px]">{question.token}</Badge>}
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted transition-colors">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {question.ask && <p className="text-xs text-muted-foreground">{question.ask}</p>}

      {question.affected_count > 0 && (
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground bg-primary/5 rounded px-2 py-1">
          <FileText className="h-3 w-3 shrink-0" />
          Затронуто: <strong className="text-foreground">{question.affected_count}</strong> товаров
        </div>
      )}

      {question.examples.length > 0 && (
        <div className="text-[10px]">
          <span className="text-muted-foreground">Примеры: </span>
          <span className="font-mono">{question.examples.slice(0, 3).join(' · ')}</span>
        </div>
      )}

      {isWidth ? (
      <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground block mb-1">Полная, мм *</label>
              <Input value={fullMm} onChange={e => setFullMm(e.target.value.replace(/\D/g, ''))} placeholder="1200" className="h-7 text-xs" inputMode="numeric" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground block mb-1">Рабочая, мм</label>
              <Input value={workMm} onChange={e => setWorkMm(e.target.value.replace(/\D/g, ''))} placeholder="необяз." className="h-7 text-xs" inputMode="numeric" />
            </div>
          </div>
          {question.suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {question.suggestions.map(s => (
                <button key={s} onClick={() => { const p = s.split(':'); setFullMm(p[0] || ''); setWorkMm(p[1] || ''); }}
                  className="text-[10px] px-2 py-0.5 rounded border border-border bg-background hover:border-primary transition-colors">{s}</button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          {question.suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {question.suggestions.map(s => (
                <button key={s} onClick={() => { setValue(s); setSelected([s]); }}
                  className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                    selected.includes(s) ? 'bg-primary text-primary-foreground border-primary' : 'border-border bg-background hover:border-primary'
                  }`}>{s}</button>
              ))}
            </div>
          )}
          <Input value={value} onChange={e => setValue(e.target.value)} placeholder="Введите значение…" className="h-7 text-xs" />
        </>
      )}

      <Button size="sm" onClick={handleSubmit} disabled={loading || !canSubmit} className="h-7 text-xs w-full">
        {loading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
        Подтвердить
      </Button>
    </div>
  );
}

// ─── AI Chat Panel (via import-normalize ai_chat_v2 → Cloud Run backend) ─────

const CHAT_EXAMPLES = [
  'Установи покрытие MattPE → Матовый полиэстер',
  'Какие профили металлочерепицы есть в каталоге?',
  'Установи ширину для С8: полная 1200, рабочая 1150',
  'Почему товары попадают в категорию "Прочее"?',
];

type ChatMsg = { role: 'user' | 'assistant'; content: string; actions?: AiChatV2Action[]; actionsApplied?: boolean };

function AIChatPanel({
  onApplyActions, confirmActions: confirmActionsFn, items, aiQuestions: pendingQuestions, categoryStats: catStats,
  sendChat,
}: {
  onApplyActions?: (actions: AiChatV2Action[]) => void;
  confirmActions?: (actions: ConfirmAction[]) => Promise<unknown>;
  sendChat: (message: string, context?: Record<string, unknown>) => Promise<AiChatV2Result | null>;
  items: CanonicalProduct[];
  aiQuestions?: AIQuestion[];
  categoryStats?: Record<string, { total: number; ready: number; needsAttention: number }>;
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [applyingIdx, setApplyingIdx] = useState<number | null>(null);
  const [showExamples, setShowExamples] = useState(true);
  const scrollEndRef = useRef<HTMLDivElement>(null);

  const buildContext = useCallback(() => ({
    total_items: items.length,
    category_stats: catStats,
    pending_questions: pendingQuestions?.slice(0, 10).map(q => ({
      type: q.type,
      token: q.token,
      affected_count: q.affected_count,
      examples: q.examples?.slice(0, 3),
    })),
    sample_items: items.slice(0, 10).map(i => ({
      title: i.title,
      profile: i.profile,
      thickness_mm: i.thickness_mm,
      coating: i.coating,
      color_or_ral: i.color_or_ral,
      product_type: i.product_type,
      price: i.price,
    })),
  }), [items, catStats, pendingQuestions]);

  const sendMessage = useCallback(async (overrideMsg?: string) => {
    const msg = (overrideMsg || input).trim();
    if (!msg || loading) return;
    setInput('');
    setShowExamples(false);

    const userMsg: ChatMsg = { role: 'user', content: msg };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const result = await sendChat(msg, buildContext());

      if (!result) {
        setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Нет ответа от сервера. Попробуйте ещё раз.' }]);
        return;
      }

      if (!result.ok) {
        const errMsg = result.error || 'Ошибка AI';
        setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ ${errMsg}` }]);
        return;
      }

      const assistantMsg: ChatMsg = {
        role: 'assistant',
        content: result.assistant_message || 'Готово.',
        actions: result.actions && result.actions.length > 0 ? result.actions : undefined,
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Ошибка подключения';
      setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ ${errMsg}` }]);
    } finally {
      setLoading(false);
      setTimeout(() => scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  }, [input, loading, sendChat, buildContext]);

  const handleApplyActions = useCallback(async (actions: AiChatV2Action[], msgIdx: number) => {
    setApplyingIdx(msgIdx);
    try {
      const confirmPayload: ConfirmAction[] = actions.map(a => ({ type: a.type, payload: a.payload }));
      if (confirmActionsFn) await confirmActionsFn(confirmPayload);
      if (onApplyActions) onApplyActions(actions);
      setMessages(prev => prev.map((m, i) => i === msgIdx ? { ...m, actionsApplied: true } : m));
    } catch (err) {
      console.error('[AIChatPanel] Apply error:', err);
      setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Ошибка при применении действий' }]);
    } finally {
      setApplyingIdx(null);
    }
  }, [confirmActionsFn, onApplyActions]);

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 space-y-2">
          {showExamples && messages.length === 0 && (
            <div className="space-y-2">
              <div className="text-center py-4 text-muted-foreground">
                <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-xs font-medium">ИИ-ассистент нормализации</p>
                <p className="text-[10px] mt-0.5 opacity-70">Cloud Run Gemini — задайте вопрос или команду</p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Примеры</p>
                {CHAT_EXAMPLES.map((ex, i) => (
                  <button key={i} onClick={() => sendMessage(ex)}
                    className="w-full text-left text-[11px] px-2 py-1.5 rounded border border-border hover:border-primary hover:bg-primary/5 transition-colors">
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[90%] rounded-lg px-3 py-2 text-xs whitespace-pre-line ${
                m.role === 'user' ? 'bg-primary text-primary-foreground'
                  : m.content.startsWith('⚠️') ? 'bg-destructive/10 text-destructive border border-destructive/20'
                  : 'bg-muted text-foreground'
              }`}>
                {m.content}

                {/* Pending actions */}
                {m.actions && m.actions.length > 0 && !m.actionsApplied && (
                  <div className="mt-2 p-2 bg-background/50 rounded border space-y-1">
                    <div className="flex items-center gap-1 mb-1">
                      <AlertTriangle className="h-3 w-3 text-primary" />
                      <span className="text-[10px] font-semibold">{m.actions.length} действий</span>
                    </div>
                    {m.actions.slice(0, 4).map((action, j) => (
                      <div key={j} className="text-[10px] font-mono bg-muted/50 rounded px-2 py-0.5 truncate">
                        <span className="text-primary font-semibold">{action.type}</span>: {JSON.stringify(action.payload).substring(0, 80)}
                      </div>
                    ))}
                    {m.actions.length > 4 && <span className="text-[10px] text-muted-foreground">+{m.actions.length - 4} ещё</span>}
                    <div className="flex gap-2 mt-1">
                      <Button size="sm" className="h-6 text-[10px] flex-1" onClick={() => handleApplyActions(m.actions!, i)} disabled={applyingIdx === i}>
                        {applyingIdx === i ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Play className="h-3 w-3 mr-1" />}
                        Применить
                      </Button>
                      <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => setMessages(prev => prev.map((msg, idx) => idx === i ? { ...msg, actions: undefined } : msg))}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
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
              <div className="bg-muted rounded-lg px-3 py-2"><Loader2 className="h-3 w-3 animate-spin text-muted-foreground" /></div>
            </div>
          )}
          <div ref={scrollEndRef} />
        </div>
      </ScrollArea>

      <div className="p-2 border-t flex gap-2">
        <Textarea value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
          placeholder="Спросить ИИ… (Enter)" className="text-xs resize-none min-h-0 py-1.5" rows={2} />
        <Button size="sm" onClick={() => sendMessage()} disabled={!input.trim() || loading} className="h-auto w-8 p-0 shrink-0 self-end mb-0.5">
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ─── Category Sidebar ─────────────────────────────────────────

function CategorySidebar({
  activeCategory, onSelect, stats, loading, onlyProblematic, onToggleProblematic,
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
              <button key={cat} onClick={() => onSelect(cat)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs transition-colors ${
                  isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-foreground'
                }`}>
                <span className="font-medium truncate">{CAT_LABELS[cat]}</span>
                <div className="flex items-center gap-1 shrink-0 ml-2">
                  {s.needsAttention > 0 && (
                    <Badge className={`text-[10px] h-4 px-1 ${isActive ? 'bg-white/20 text-white' : 'bg-destructive/10 text-destructive border-destructive/20'}`} variant="outline">
                      !{s.needsAttention}
                    </Badge>
                  )}
                  <span className={`text-[10px] ${isActive ? 'opacity-70' : 'text-muted-foreground'}`}>{s.total}</span>
                </div>
              </button>
            );
          })}
        </div>
      </ScrollArea>
      <div className="p-3 border-t space-y-2">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
          <Filter className="h-3 w-3" /> Фильтры
        </span>
        <div className="flex items-center gap-2">
          <Switch id="only-prob" checked={onlyProblematic} onCheckedChange={onToggleProblematic} className="scale-75" />
          <Label htmlFor="only-prob" className="text-xs cursor-pointer">Только проблемные</Label>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

export function NormalizationWizard({
  open, onOpenChange, organizationId, importJobId: propJobId, onComplete,
}: NormalizationWizardProps) {
  const { t } = useTranslation();
  const DEV_MODE = import.meta.env.DEV;

  const [inputJobId, setInputJobId] = useState(propJobId || '');
  const effectiveJobId = propJobId || inputJobId || undefined;

  const [activeCategory, setActiveCategory] = useState<ProductCategory>('PROFNASTIL');
  const [selectedCluster, setSelectedCluster] = useState<ClusterPath | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [onlyProblematic, setOnlyProblematic] = useState(false);
  const [rightTab, setRightTab] = useState<'questions' | 'chat'>('questions');
  const [activeQuestionForm, setActiveQuestionForm] = useState<AIQuestion | null>(null);
  const [confirmApplyOpen, setConfirmApplyOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);

  const flow = useNormalizationFlow({ organizationId, importJobId: effectiveJobId });
  const norm = flow.norm;

  const fetchDashboard = norm.fetchDashboard;
  const fetchCatalogItems = norm.fetchCatalogItems;
  const startScan = flow.startScan;
  const confirmBatch = flow.confirmBatch;
  const startApply = flow.startApply;

  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!open || !organizationId) return;
    if (autoStartedRef.current) return;
    autoStartedRef.current = true;

    invokeEdge('settings-merge', {
      organization_id: organizationId,
      patch: { ai_policy: { ai_enabled: true, shadow_mode: true, autopatch_after_confirm: true, max_questions_per_run: 40 } },
    }).catch(err => console.warn('[NormWizard] ai_policy seed failed:', err));

    void fetchDashboard(effectiveJobId);
    void fetchCatalogItems(500);
    void startScan({ aiSuggest: true, limit: 2000 });
  }, [open, organizationId, effectiveJobId, fetchDashboard, fetchCatalogItems, startScan]);

  useEffect(() => { if (!open) autoStartedRef.current = false; }, [open]);

  const items = useMemo(() => {
    const patches = norm.dryRunResult?.patches_sample || [];
    if (patches.length > 0) return patches.map(patchToCanonical);
    if (norm.catalogItems.length > 0) return norm.catalogItems.map(catalogRowToCanonical);
    return [];
  }, [norm.dryRunResult, norm.catalogItems]);

  const aiQuestions = useMemo(() => (norm.dryRunResult?.questions || []).map(backendQuestionToAI), [norm.dryRunResult]);

  const questionCards = useMemo((): DashboardQuestionCard[] => {
    const dbCards = norm.dashboardResult?.question_cards || [];
    if (dbCards.length > 0) return dbCards;
    const grouped: Record<string, DashboardQuestionCard> = {};
    for (const q of aiQuestions) {
      const backendType = q.type.toUpperCase() === 'WIDTH' ? 'WIDTH_MASTER' : q.type.toUpperCase() === 'COATING' ? 'COATING_MAP' : q.type.toUpperCase() === 'COLOR' ? 'COLOR_MAP' : q.type.toUpperCase() + '_MAP';
      if (!grouped[backendType]) {
        grouped[backendType] = { type: backendType, label: Q_TYPE_CONFIG[backendType]?.label || backendType, count: 0, examples: [] };
      }
      grouped[backendType].count += q.affected_count;
      grouped[backendType].examples = [...(grouped[backendType].examples || []), ...(q.examples || [])].slice(0, 5);
    }
    return Object.values(grouped);
  }, [norm.dashboardResult, aiQuestions]);

  const categoryStats = useMemo(() => {
    const stats: Record<string, { total: number; ready: number; needsAttention: number }> = {};
    const cats: ProductCategory[] = ['ALL', 'PROFNASTIL', 'METALLOCHEREPICA', 'DOBOR', 'SANDWICH', 'OTHER'];
    for (const c of cats) stats[c] = { total: 0, ready: 0, needsAttention: 0 };
    for (const item of items) {
      const cat = item.product_type || 'OTHER';
      const v = validateProduct(item);
      stats.ALL.total++;
      if (v.status === 'ready') stats.ALL.ready++;
      else stats.ALL.needsAttention++;
      if (stats[cat]) {
        stats[cat].total++;
        if (v.status === 'ready') stats[cat].ready++;
        else stats[cat].needsAttention++;
      }
    }
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
      if ((categoryStats[c]?.total || 0) > bestCount) { bestCount = categoryStats[c].total; best = c; }
    }
    setActiveCategory(bestCount > 0 ? best : 'ALL');
  }, [items, categoryStats, activeCategory]);

  const filteredItems = useMemo(() => {
    let result = activeCategory === 'ALL' ? items : items.filter(i => (i.product_type || 'OTHER') === activeCategory);
    if (onlyProblematic) result = result.filter(i => validateProduct(i).status !== 'ready');
    return result;
  }, [items, activeCategory, onlyProblematic]);

  const isNormalizable = activeCategory === 'PROFNASTIL' || activeCategory === 'METALLOCHEREPICA';
  const isApplying = flow.state === 'APPLY_STARTING' || flow.state === 'APPLY_RUNNING';
  const patchesReady = flow.context.patchesReady;
  const totalScanned = flow.context.totalScanned;

  const dashProgress = norm.dashboardResult?.progress;
  const kpiTotal = dashProgress?.total || categoryStats.ALL.total || totalScanned;
  const kpiReady = dashProgress?.ready || categoryStats.ALL.ready;
  const kpiAttention = dashProgress?.needs_attention || categoryStats.ALL.needsAttention;
  const kpiPct = dashProgress?.ready_pct || (kpiTotal > 0 ? (kpiReady / kpiTotal) * 100 : 0);

  // Handlers
  const handleRunScan = useCallback(() => {
    void startScan({ aiSuggest: true, limit: 2000 });
    void fetchDashboard(effectiveJobId);
  }, [startScan, fetchDashboard, effectiveJobId]);

  const handleApply = useCallback(() => { setConfirmApplyOpen(false); void startApply(); }, [startApply]);

  const handleSelectCluster = useCallback((path: ClusterPath) => { setSelectedCluster(path); }, []);
  const handleToggleNode = useCallback((nodeId: string) => {
    setExpandedNodes(prev => { const next = new Set(prev); if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId); return next; });
  }, []);

  const handleResolveQuestionType = useCallback((type: string) => {
    // For WIDTH_MASTER: find first question with a non-empty token/profile
    const matchingQs = aiQuestions.filter(aq => {
      const t = (aq.type || '').toUpperCase();
      if (type === 'WIDTH_MASTER' && t === 'WIDTH') return true;
      if (type === 'COATING_MAP' && t === 'COATING') return true;
      if (type === 'COLOR_MAP' && t === 'COLOR') return true;
      return t === type;
    });
    // Prefer question with non-empty token (= profile name)
    const q = matchingQs.find(aq => aq.token && aq.token.trim()) || matchingQs[0];
    if (q) {
      setActiveQuestionForm(q);
      setRightTab('questions');
      setRightPanelOpen(true);
    } else {
      toast({ title: 'Нет вопросов этого типа' });
    }
  }, [aiQuestions]);

  const handleAnswerQuestion = useCallback(async (value: string, scope?: 'all' | 'selected') => {
    if (!activeQuestionForm) return;
    const questionType = activeQuestionForm.type.toUpperCase();
    const backendType = questionType === 'WIDTH' ? 'WIDTH_MASTER' : questionType === 'COATING' ? 'COATING_MAP' : questionType === 'COLOR' ? 'COLOR_MAP'
      : questionType === 'THICKNESS' ? 'THICKNESS_SET' : questionType === 'PROFILE' ? 'PROFILE_MAP' : questionType === 'CATEGORY' ? 'CATEGORY_FIX' : questionType;
    
    const profileToken = activeQuestionForm.token || activeQuestionForm.cluster_path?.profile || '';

    // THICKNESS_SET is not supported by batch confirm — use legacy answerQuestion
    if (backendType === 'THICKNESS_SET') {
      const success = await norm.answerQuestion('THICKNESS_SET', profileToken, value);
      if (success) {
        setActiveQuestionForm(null);
        void startScan({ aiSuggest: true, limit: 2000 });
      }
      return;
    }

    // WIDTH_MASTER always needs profile + numeric fields
    if (backendType === 'WIDTH_MASTER') {
      // Extract profile from multiple sources with aggressive fallbacks
      let widthProfile = profileToken;
      
      // Fallback 1: extract from examples
      if (!widthProfile && activeQuestionForm.examples?.length) {
        for (const ex of activeQuestionForm.examples) {
          // Match patterns like "МП40", "С8", "Н60", "HC35", "Профнастил МП40 ..."
          const profileMatch = ex.match(/(?:Профнастил[и]?\s+)?([A-Za-zА-Яа-яЁё]{1,4}\d{1,3})/i);
          if (profileMatch) { widthProfile = profileMatch[1]; break; }
        }
      }
      
      // Fallback 2: extract from cluster_path
      if (!widthProfile && activeQuestionForm.cluster_path?.profile) {
        widthProfile = activeQuestionForm.cluster_path.profile;
      }
      
      // Fallback 3: from ask text (e.g., "Ширина для МП40")
      if (!widthProfile && activeQuestionForm.ask) {
        const askMatch = activeQuestionForm.ask.match(/для\s+([A-Za-zА-Яа-яЁё]{1,4}\d{1,3})/i);
        if (askMatch) widthProfile = askMatch[1];
      }
      
      if (!widthProfile) {
        toast({ title: 'Не удалось определить профиль', description: 'Выберите конкретный профиль из списка «Детали вопросов»', variant: 'destructive' });
        return;
      }
      const payload: Record<string, unknown> = { profile: widthProfile };
      if (value.includes(':')) {
        const [full, work] = value.split(':');
        payload.full_mm = parseInt(full, 10) || 0;
        payload.work_mm = parseInt(work, 10) || 0;
      } else {
        payload.full_mm = parseInt(value, 10) || 0;
      }
      
      console.log('[NormWizard] WIDTH_MASTER confirm payload:', payload);
      const action: ConfirmAction = { type: backendType, payload };
      const result = await confirmBatch([action]);
      if (result?.ok) {
        toast({ title: 'Ширина подтверждена', description: `Профиль: ${widthProfile}` });
        setActiveQuestionForm(null);
        void startScan({ aiSuggest: true, limit: 2000 });
      } else {
        const errMsg = (result as any)?.error?.message || 'Ошибка подтверждения';
        toast({ title: 'Ошибка подтверждения', description: errMsg, variant: 'destructive' });
      }
      return;
    }

    // Default: token + canonical
    const payload: Record<string, unknown> = { token: profileToken, canonical: value };
    const action: ConfirmAction = { type: backendType, payload };
    const result = await confirmBatch([action]);
    if (result?.ok) {
      setActiveQuestionForm(null);
      void startScan({ aiSuggest: true, limit: 2000 });
    }
  }, [confirmBatch, startScan, activeQuestionForm, norm]);

  const handleAnswerFromCluster = useCallback(async (questionId: string, value: string | number) => {
    const question = aiQuestions.find((q, i) => `q-${i}` === questionId || q.token === questionId);
    const questionType = question?.type || questionId;
    const backendType = questionType.toUpperCase() === 'WIDTH' ? 'WIDTH_MASTER' : questionType.toUpperCase() === 'COATING' ? 'COATING_MAP'
      : questionType.toUpperCase() === 'COLOR' ? 'COLOR_MAP' : questionType.toUpperCase() === 'THICKNESS' ? 'THICKNESS_SET' : questionType.toUpperCase();
    const token = question?.token || question?.cluster_path?.profile || questionId;

    // THICKNESS_SET — use legacy path
    if (backendType === 'THICKNESS_SET') {
      const success = await norm.answerQuestion('THICKNESS_SET', token, value);
      if (success) void startScan({ aiSuggest: true, limit: 2000 });
      return;
    }

    const action: ConfirmAction = { type: backendType, payload: { token, canonical: value } };
    const result = await confirmBatch([action]);
    if (result?.ok) void startScan({ aiSuggest: true, limit: 2000 });
  }, [confirmBatch, startScan, aiQuestions, norm]);

  const getApplyStatusLabel = () => {
    const phaseLabel = norm.applyPhase && norm.applyPhase !== 'unknown'
      ? ` (${norm.applyPhase === 'materialize' ? 'подготовка' : norm.applyPhase === 'merge' ? 'слияние' : norm.applyPhase})`
      : '';
    switch (flow.state) {
      case 'APPLY_STARTING': return `Запуск${phaseLabel}…`;
      case 'APPLY_RUNNING': return `Применяем${phaseLabel}… ${norm.applyProgress > 0 ? norm.applyProgress + '%' : ''}`;
      case 'APPLY_DONE': return '✓ Готово';
      case 'ERROR': return flow.context.lastError || 'Ошибка';
      default: return '';
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[98vw] w-[1700px] h-[92vh] max-h-[92vh] flex flex-col p-0 gap-0 overflow-hidden">

        {/* ═══ TOP STICKY BAR ═══ */}
        <div className="shrink-0 border-b bg-background">
          {/* Title row */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Sparkles className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <h2 className="font-semibold text-sm leading-none">Нормализация каталога</h2>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Обогащение и стандартизация товаров</p>
                </div>
              </div>
              {totalScanned > 0 && <Badge variant="outline" className="text-xs">{totalScanned.toLocaleString('ru')} товаров</Badge>}
              {aiQuestions.length > 0 && (
                <Badge variant="destructive" className="text-xs">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  {questionCards.reduce((s, c) => s + c.count, 0)} требуют внимания
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-2">
              {DEV_MODE && !propJobId && (
                <Input value={inputJobId} onChange={e => setInputJobId(e.target.value)} placeholder="ID задачи импорта" className="h-7 w-40 text-xs" />
              )}
              <Button size="sm" variant="ghost" onClick={() => setShowSettings(v => !v)} className="h-7 text-xs gap-1">
                <Settings2 className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant={rightPanelOpen ? 'secondary' : 'outline'} onClick={() => setRightPanelOpen(v => !v)} className="h-7 text-xs gap-1" title={rightPanelOpen ? 'Скрыть панель' : 'Показать вопросы/чат'}>
                {rightPanelOpen ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
                {!rightPanelOpen && aiQuestions.length > 0 && <Badge variant="destructive" className="text-[10px] h-4 px-1">{aiQuestions.length}</Badge>}
              </Button>
              <Button size="sm" variant="outline" onClick={handleRunScan} disabled={flow.state === 'SCANNING' || isApplying} className="h-7 text-xs">
                {flow.state === 'SCANNING' ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                Сканировать
              </Button>
              {!confirmApplyOpen ? (
                <Button size="sm" onClick={() => setConfirmApplyOpen(true)} disabled={patchesReady === 0 || isApplying} className="h-7 text-xs">
                  {isApplying ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1.5" />}
                  Применить
                  {patchesReady > 0 && <Badge variant="secondary" className="ml-1 text-xs">{patchesReady}</Badge>}
                </Button>
              ) : (
                <div className="flex items-center gap-1 bg-destructive/10 border border-destructive/30 rounded-md px-2 py-1">
                  <span className="text-xs text-destructive">Применить {patchesReady} исправлений?</span>
                  <Button size="sm" variant="destructive" onClick={handleApply} className="h-6 text-xs px-2">Да</Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmApplyOpen(false)} className="h-6 w-6 p-0"><X className="h-3 w-3" /></Button>
                </div>
              )}
            </div>
          </div>

          {/* KPI + Status */}
          <div className="flex items-center gap-6 px-4 py-2">
            <div className="flex items-center gap-5">
              <div className="text-center">
                <div className="text-lg font-bold leading-none tabular-nums">{kpiTotal.toLocaleString('ru')}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">Всего</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold leading-none text-primary tabular-nums">{kpiReady.toLocaleString('ru')}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">Готово</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold leading-none text-destructive tabular-nums">{kpiAttention.toLocaleString('ru')}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">Проблем</div>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-center">
                  <div className="text-lg font-bold leading-none text-primary tabular-nums">{kpiPct.toFixed(1)}%</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">Готовность</div>
                </div>
                <Progress value={kpiPct} className="h-1.5 w-24" />
              </div>
            </div>

            <div className="h-8 border-l" />

            {/* Status indicators */}
            <div className="flex items-center gap-3 flex-1 min-w-0">
              {flow.state === 'SCANNING' && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Сканирование…
                </div>
              )}
              {norm.catalogLoading && flow.state !== 'SCANNING' && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Загрузка…
                </div>
              )}
              {(flow.state === 'APPLY_STARTING' || flow.state === 'APPLY_RUNNING' || flow.state === 'APPLY_DONE' || flow.state === 'ERROR') && (
                <div className="flex items-center gap-3">
                  <Badge variant={flow.state === 'APPLY_DONE' ? 'default' : flow.state === 'ERROR' ? 'destructive' : 'secondary'} className="text-xs">
                    {isApplying && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                    {getApplyStatusLabel()}
                  </Badge>
                  {isApplying && (
                    <div className="flex items-center gap-2">
                      <Progress value={norm.applyProgress} className="h-1.5 w-24" />
                      <span className="text-[10px] text-muted-foreground tabular-nums">{norm.applyProgress}%</span>
                    </div>
                  )}
                </div>
              )}
              {flow.context.lastError && (
                <div className="flex items-center gap-1 text-xs text-destructive">
                  <AlertCircle className="h-3 w-3" /> {flow.context.lastError}
                </div>
              )}
              {norm.dryRunResult?.stats && flow.state !== 'SCANNING' && (
                <span className="text-xs text-muted-foreground ml-auto">
                  Исправлений: <strong className="text-foreground">{norm.dryRunResult.stats.patches_ready}</strong>
                </span>
              )}
            </div>
          </div>

          {/* AI unavailable banner */}
          {(norm.dryRunResult?.ai_disabled || norm.dryRunResult?.stats?.ai_status?.failed) && (
            <div className="mx-4 mb-2 flex items-center gap-2 text-xs border border-destructive/30 bg-destructive/5 rounded-md px-3 py-2">
              <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
              <div>
                <span className="font-medium text-destructive">ИИ-ассистент недоступен</span>
                <span className="text-muted-foreground ml-1">
                  — {norm.dryRunResult?.stats?.ai_status?.fail_reason || norm.dryRunResult?.ai_skip_reason || 'сервис временно недоступен'}
                </span>
              </div>
            </div>
          )}

          {/* Settings panel */}
          {showSettings && (
            <div className="px-4 pb-3 border-t max-h-56 overflow-y-auto">
              <ConfirmedSettingsEditor onSave={norm.saveConfirmedSettings} saving={norm.savingSettings} />
            </div>
          )}
        </div>

        {/* ═══ BODY: Resizable 3-Panel Layout ═══ */}
        <div className="flex-1 min-h-0 overflow-hidden relative">
          <ResizablePanelGroup direction="horizontal" className="absolute inset-0">
            {/* LEFT: Categories */}
            <ResizablePanel defaultSize={14} minSize={10} maxSize={22}>
              <CategorySidebar
                activeCategory={activeCategory}
                onSelect={setActiveCategory}
                stats={categoryStats}
                loading={norm.dryRunLoading}
                onlyProblematic={onlyProblematic}
                onToggleProblematic={setOnlyProblematic}
              />
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* CENTER: Clusters / Table */}
            <ResizablePanel defaultSize={rightPanelOpen ? 56 : 86} minSize={30}>
              <div className="flex flex-col h-full overflow-hidden">
                {/* Center toolbar */}
                <div className="px-3 py-2 border-b flex items-center gap-2 shrink-0 bg-muted/30">
                  <span className="text-xs font-semibold text-muted-foreground">
                    {CAT_LABELS[activeCategory]}
                    {filteredItems.length > 0 && <span className="ml-2 font-normal">({filteredItems.length})</span>}
                  </span>
                  {onlyProblematic && filteredItems.length < (categoryStats[activeCategory]?.total || 0) && (
                    <Badge variant="outline" className="text-xs text-destructive border-destructive/30">Только проблемные</Badge>
                  )}
                </div>

                {isNormalizable ? (
                  <div className="flex-1 flex min-h-0 overflow-hidden">
                    <div className="w-64 border-r shrink-0 overflow-hidden">
                      <ClusterTree
                        items={filteredItems}
                        selectedCluster={selectedCluster}
                        onSelectCluster={handleSelectCluster}
                        expandedNodes={expandedNodes}
                        onToggleNode={handleToggleNode}
                      />
                    </div>
                    <div className="flex-1 min-w-0 overflow-hidden">
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
                  <div className="flex-1 min-w-0 overflow-hidden">
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
            </ResizablePanel>

            {rightPanelOpen && (
              <>
              <ResizableHandle withHandle />

              {/* RIGHT: Questions / Chat */}
              <ResizablePanel defaultSize={30} minSize={20} maxSize={45}>
              <Tabs value={rightTab} onValueChange={v => setRightTab(v as typeof rightTab)} className="flex flex-col h-full">
                <div className="flex items-center border-b shrink-0">
                  <TabsList className="rounded-none h-9 px-0 bg-transparent justify-start gap-0 flex-1">
                    <TabsTrigger value="questions" className="rounded-none text-xs px-4 h-9 border-b-2 data-[state=active]:border-primary data-[state=inactive]:border-transparent">
                      Вопросы {aiQuestions.length > 0 && <Badge variant="destructive" className="ml-1 text-[10px] h-4 px-1">{aiQuestions.length}</Badge>}
                    </TabsTrigger>
                    <TabsTrigger value="chat" className="rounded-none text-xs px-4 h-9 border-b-2 data-[state=active]:border-primary data-[state=inactive]:border-transparent">
                      ИИ-чат <Sparkles className="h-3 w-3 ml-1 text-primary" />
                    </TabsTrigger>
                  </TabsList>
                  <button onClick={() => setRightPanelOpen(false)} className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors mr-1" title="Закрыть панель">
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* QUESTIONS */}
                <TabsContent value="questions" className="flex-1 min-h-0 m-0 flex flex-col">
                  <ScrollArea className="flex-1 min-h-0">
                    <div className="p-3 space-y-3">
                      {activeQuestionForm && (
                        <QuestionAnswerForm question={activeQuestionForm} onSubmit={handleAnswerQuestion} onClose={() => setActiveQuestionForm(null)} loading={norm.answeringQuestion} />
                      )}

                      {questionCards.length > 0 ? (
                        <>
                          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Задачи нормализации</div>
                          <div className="space-y-2">
                            {questionCards.sort((a, b) => (b.count || 0) - (a.count || 0)).map(card => {
                              const relatedQs = aiQuestions.filter(aq => {
                                const t = (aq.type || '').toUpperCase();
                                if (card.type === 'WIDTH_MASTER' && t === 'WIDTH') return true;
                                if (card.type === 'COATING_MAP' && t === 'COATING') return true;
                                if (card.type === 'COLOR_MAP' && t === 'COLOR') return true;
                                return t === card.type;
                              });
                              return <QuestionCard key={card.type} card={card} onResolve={handleResolveQuestionType} relatedQuestions={relatedQs} />;
                            })}
                          </div>
                        </>
                      ) : !norm.dryRunResult ? (
                        <div className="text-center py-8 text-muted-foreground">
                          <Sparkles className="h-8 w-8 mx-auto mb-3 opacity-30" />
                          <p className="text-xs">Нажмите «Сканировать» для анализа</p>
                          <Button size="sm" variant="outline" onClick={handleRunScan} className="mt-3 h-7 text-xs" disabled={norm.dryRunLoading}>
                            {norm.dryRunLoading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
                            Сканировать
                          </Button>
                        </div>
                      ) : (
                        <div className="text-center py-8">
                          <CheckCircle2 className="h-8 w-8 mx-auto mb-3 text-primary" />
                          <p className="text-xs font-semibold">Все вопросы решены!</p>
                          <p className="text-xs text-muted-foreground mt-1">Нажмите «Применить»</p>
                        </div>
                      )}

                      {norm.dryRunResult?.ai_skip_reason && (
                        <div className="flex items-start gap-2 text-xs text-muted-foreground border border-border rounded-md p-2 bg-muted/30">
                          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          <div>
                            <span className="font-medium text-foreground">ИИ-анализ пропущен</span><br />
                            Причина: <code className="text-[10px]">{norm.dryRunResult.ai_skip_reason}</code>
                          </div>
                        </div>
                      )}

                      {aiQuestions.length > 0 && !activeQuestionForm && (
                        <>
                          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-4">Детали вопросов</div>
                          <div className="space-y-1">
                            {aiQuestions.slice(0, 20).map((q, i) => {
                              const cfg = Q_TYPE_CONFIG[q.type?.toUpperCase() + '_MAP'] || Q_TYPE_CONFIG[q.type?.toUpperCase() + '_MASTER'] || { icon: AlertTriangle, label: q.type, color: '' };
                              const QIcon = cfg.icon;
                              return (
                                <button key={i} onClick={() => setActiveQuestionForm(q)}
                                  className="w-full text-left px-2 py-1.5 rounded border hover:bg-muted transition-colors">
                                  <div className="flex items-center gap-2">
                                    <QIcon className="h-3 w-3 text-muted-foreground shrink-0" />
                                    <span className="text-xs font-medium truncate">{q.token || `вопрос ${i + 1}`}</span>
                                    {q.affected_count > 0 && <Badge variant="outline" className="text-[10px] h-4 px-1 ml-auto shrink-0">{q.affected_count}</Badge>}
                                  </div>
                                  {q.examples.length > 0 && <p className="text-[10px] text-muted-foreground truncate mt-0.5 pl-5">{q.examples[0]}</p>}
                                </button>
                              );
                            })}
                            {aiQuestions.length > 20 && <p className="text-xs text-muted-foreground text-center py-2">+ ещё {aiQuestions.length - 20}</p>}
                          </div>
                        </>
                      )}
                    </div>
                  </ScrollArea>
                </TabsContent>

                {/* CHAT */}
                <TabsContent value="chat" className="flex-1 min-h-0 m-0 flex flex-col">
                  <AIChatPanel
                    sendChat={flow.sendChat}
                    confirmActions={flow.confirmBatch}
                    items={items}
                    aiQuestions={aiQuestions}
                    categoryStats={categoryStats}
                    onApplyActions={(actions) => {
                      toast({ title: 'Применено из чата', description: `${actions.length} правил` });
                      flow.startScan({ aiSuggest: true, limit: 2000 });
                    }}
                  />
                </TabsContent>
              </Tabs>
            </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default NormalizationWizard;
