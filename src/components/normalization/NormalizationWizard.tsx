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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
import { hasInvalidConfirmActions, normalizeAndValidateConfirmActions } from '@/lib/confirm-action-guards';

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
  WIDTH_MASTER:  { icon: Ruler,      label: 'Ширины',     color: 'bg-gradient-to-r from-blue-500/20 to-indigo-500/10 border-blue-500/40 text-blue-800 dark:text-blue-300' },
  COATING_MAP:   { icon: Layers,     label: 'Покрытия',   color: 'bg-gradient-to-r from-amber-500/20 to-orange-500/10 border-orange-500/40 text-orange-800 dark:text-orange-300' },
  COLOR_MAP:     { icon: Palette,    label: 'Цвета',      color: 'bg-gradient-to-r from-violet-500/20 to-purple-500/10 border-purple-500/40 text-purple-800 dark:text-purple-300' },
  THICKNESS_SET: { icon: BarChart3,  label: 'Толщины',    color: 'bg-gradient-to-r from-emerald-500/20 to-green-500/10 border-green-500/40 text-emerald-800 dark:text-emerald-300' },
  PROFILE_MAP:   { icon: TrendingUp, label: 'Профили',    color: 'bg-gradient-to-r from-cyan-500/20 to-sky-500/10 border-cyan-500/40 text-cyan-800 dark:text-cyan-300' },
  CATEGORY_FIX:  { icon: Activity,   label: 'Категории',  color: 'bg-gradient-to-r from-rose-500/20 to-red-500/10 border-destructive/50 text-destructive' },
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

function resolveWidthProfile(question: AIQuestion): string {
  const profileToken = question.token || question.cluster_path?.profile || '';
  if (profileToken.trim()) return profileToken.trim();

  if (question.examples?.length) {
    for (const ex of question.examples) {
      const profileMatch = ex.match(/(?:Профнастил[и]?\s+)?([A-Za-zА-Яа-яЁё]{1,4}\d{1,3})/i);
      if (profileMatch?.[1]) return profileMatch[1].trim();
    }
  }

  if (question.ask) {
    const askMatch = question.ask.match(/для\s+([A-Za-zА-Яа-яЁё]{1,4}\d{1,3})/i);
    if (askMatch?.[1]) return askMatch[1].trim();
  }

  return '';
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
  card, onResolve, onSkip, relatedQuestions,
}: {
  card: DashboardQuestionCard;
  onResolve: (type: string) => void;
  onSkip: (type: string) => void;
  relatedQuestions?: AIQuestion[];
}) {
  const cfg = Q_TYPE_CONFIG[card.type] || { icon: AlertTriangle, label: card.type, color: 'bg-muted border-border text-foreground' };
  const Icon = cfg.icon;
  const questionText = relatedQuestions?.[0]?.ask;

  return (
    <div className={`w-full text-left p-4 rounded-xl border transition-all duration-200 hover:shadow-md ${cfg.color}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-md bg-background/70 border flex items-center justify-center">
            <Icon className="h-4 w-4" />
          </div>
          <span className="font-semibold text-sm tracking-tight">{card.label || cfg.label}</span>
        </div>
        <Badge variant="secondary" className="text-xs font-bold rounded-full px-2.5">{card.count} товаров</Badge>
      </div>
      {questionText && <p className="text-sm mb-2.5 opacity-85 leading-relaxed">{questionText}</p>}
      {card.examples && card.examples.length > 0 && (
        <div className="mb-3 bg-background/50 border rounded-lg p-2">
          <span className="text-xs text-muted-foreground">Примеры: </span>
          <span className="text-xs font-mono">{card.examples.slice(0, 4).join(', ')}</span>
        </div>
      )}
      <div className="flex gap-2">
        <Button size="sm" variant="default" className="h-8 text-xs px-4 flex-1 rounded-lg" onClick={() => onResolve(card.type)}>
          <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Открыть и подтвердить
        </Button>
        <Button size="sm" variant="ghost" className="h-8 text-xs px-3 rounded-lg text-muted-foreground hover:text-foreground" onClick={() => onSkip(card.type)}>
          Пропустить
        </Button>
      </div>
    </div>
  );
}

// ─── Question Answer Form ─────────────────────────────────────

function QuestionAnswerForm({
  question, onSubmit, onClose, onSkip, loading,
}: {
  question: AIQuestion;
  onSubmit: (value: string, scope?: 'all' | 'selected') => void;
  onClose: () => void;
  onSkip?: () => void;
  loading: boolean;
}) {
  const isWidth = question.type === 'width';
  const widthProfile = isWidth ? resolveWidthProfile(question) : '';
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

  const canSubmit = isWidth ? (!!fullMm && !!widthProfile) : (!!value || selected.length > 0);

  return (
    <div className="border rounded-xl p-3.5 bg-gradient-to-b from-background to-muted/40 space-y-3 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {(() => { const cfg = Q_TYPE_CONFIG[(question.type || '').toUpperCase() + '_MASTER'] || Q_TYPE_CONFIG[(question.type || '').toUpperCase() + '_MAP']; const QIcon = cfg?.icon || AlertTriangle; return <div className="h-6 w-6 rounded-md border bg-primary/10 flex items-center justify-center"><QIcon className="h-3.5 w-3.5 text-primary" /></div>; })()}
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

      {question.ask && <p className="text-xs text-muted-foreground leading-relaxed">{question.ask}</p>}

      {question.affected_count > 0 && (
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground bg-primary/5 rounded-lg px-2 py-1.5 border border-primary/10">
          <FileText className="h-3 w-3 shrink-0" />
          Затронуто: <strong className="text-foreground">{question.affected_count}</strong> товаров
        </div>
      )}

      {question.examples.length > 0 && (
        <div className="text-[10px] bg-background border rounded-lg p-2">
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
          {!widthProfile && (
            <div className="text-[10px] text-destructive bg-destructive/5 border border-destructive/20 rounded px-2 py-1">
              Нельзя подтвердить WIDTH_MASTER: не найден profile.
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

      <div className="flex gap-2">
        <Button size="sm" onClick={handleSubmit} disabled={loading || !canSubmit} className="h-8 text-xs flex-1">
          {loading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
          Подтвердить
        </Button>
        {onSkip && (
          <Button size="sm" variant="ghost" onClick={onSkip} className="h-8 text-xs text-muted-foreground">
            Пропустить
          </Button>
        )}
      </div>
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
    // PR2: Validate WIDTH_MASTER actions have profile before sending
    const invalidWidth = actions.find(a => a.type === 'WIDTH_MASTER' && !a.payload?.profile);
    if (invalidWidth) {
      setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Действие WIDTH_MASTER не содержит профиль. Уточните профиль в запросе.' }]);
      return;
    }

    setApplyingIdx(msgIdx);
    try {
      const confirmPayload: ConfirmAction[] = actions.map(a => ({ type: a.type, payload: a.payload }));
      const guarded = normalizeAndValidateConfirmActions(confirmPayload);
      if (guarded.issues.length > 0) {
        throw new Error(`${guarded.issues[0].type}: ${guarded.issues[0].reason}`);
      }

      if (confirmActionsFn) await confirmActionsFn(guarded.actions);
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
                {m.actions && m.actions.length > 0 && !m.actionsApplied && (() => {
                  const hasInvalidWidth = m.actions!.some(a => a.type === 'WIDTH_MASTER' && !a.payload?.profile);
                  return (
                  <div className="mt-2 p-2 bg-background/50 rounded border space-y-1">
                    <div className="flex items-center gap-1 mb-1">
                      <AlertTriangle className="h-3 w-3 text-primary" />
                      <span className="text-[10px] font-semibold">{m.actions!.length} действий</span>
                    </div>
                    {m.actions!.slice(0, 4).map((action, j) => (
                      <div key={j} className="text-[10px] font-mono bg-muted/50 rounded px-2 py-0.5 truncate">
                        <span className="text-primary font-semibold">{action.type}</span>: {JSON.stringify(action.payload).substring(0, 80)}
                      </div>
                    ))}
                    {m.actions!.length > 4 && <span className="text-[10px] text-muted-foreground">+{m.actions!.length - 4} ещё</span>}
                    {hasInvalidWidth && (
                      <div className="flex items-center gap-1 text-[10px] text-destructive bg-destructive/5 rounded px-2 py-0.5">
                        <AlertCircle className="h-3 w-3 shrink-0" /> WIDTH_MASTER: профиль не указан
                      </div>
                    )}
                    <div className="flex gap-2 mt-1">
                      <Button
                        size="sm"
                        className="h-6 text-[10px] flex-1"
                        onClick={() => handleApplyActions(m.actions!, i)}
                        disabled={applyingIdx === i || hasInvalidConfirmActions(m.actions!.map(a => ({ type: a.type, payload: a.payload })))}
                      >
                        {applyingIdx === i ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Play className="h-3 w-3 mr-1" />}
                        Применить
                      </Button>
                      <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => setMessages(prev => prev.map((msg, idx) => idx === i ? { ...msg, actions: undefined } : msg))}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  );
                })()}

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
      <div className="p-3 border-b bg-gradient-to-r from-primary/10 via-primary/5 to-transparent">
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
                  isActive ? 'bg-gradient-to-r from-primary to-primary/80 text-primary-foreground shadow-sm' : 'hover:bg-muted text-foreground'
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
      <div className="p-3 border-t space-y-2 bg-muted/20">
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

function KpiTile({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'success' | 'danger' | 'primary' }) {
  const toneClass = tone === 'success'
    ? 'text-emerald-600 dark:text-emerald-400'
    : tone === 'danger'
      ? 'text-destructive'
      : tone === 'primary'
        ? 'text-primary'
        : 'text-foreground';

  return (
    <div className="rounded-lg border bg-card px-3 py-2 min-w-[104px]">
      <div className={`text-base font-semibold tabular-nums leading-none ${toneClass}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground mt-1 uppercase tracking-wide">{label}</div>
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

  const [activeCategory, setActiveCategory] = useState<ProductCategory>('ALL');
  const [selectedCluster, setSelectedCluster] = useState<ClusterPath | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [onlyProblematic, setOnlyProblematic] = useState(false);
  const [rightTab, setRightTab] = useState<'questions' | 'chat'>('questions');
  const [activeQuestionForm, setActiveQuestionForm] = useState<AIQuestion | null>(null);
  const [confirmedTypes, setConfirmedTypes] = useState<Set<string>>(new Set());
  const [confirmedCount, setConfirmedCount] = useState(0); // Track total confirmed rules for feedback
  const [confirmApplyOpen, setConfirmApplyOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [scanLimit, setScanLimit] = useState<500 | 2000 | 5000 | 10000>(2000);
  const [quickFilter, setQuickFilter] = useState('');
  const [questionQuery, setQuestionQuery] = useState('');
  const [highImpactOnly, setHighImpactOnly] = useState(false);

  const flow = useNormalizationFlow({ organizationId, importJobId: effectiveJobId });
  const norm = flow.norm;

  const fetchDashboard = norm.fetchDashboard;
  const fetchCatalogItems = norm.fetchCatalogItems;
  const startScan = flow.startScan;
  const confirmBatch = flow.confirmBatch;
  const startApply = flow.startApply;
  const runScan = useCallback(() => {
    void startScan({ aiSuggest: true, limit: scanLimit });
  }, [startScan, scanLimit]);

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
    void fetchCatalogItems(10000);
    runScan();
  }, [open, organizationId, effectiveJobId, fetchDashboard, fetchCatalogItems, runScan]);

  useEffect(() => { if (!open) autoStartedRef.current = false; }, [open]);

  // Merge: catalog items as base, patches overlay on top by id
  const items = useMemo(() => {
    const patches = norm.dryRunResult?.patches_sample || [];
    const catalogRows = norm.catalogItems || [];
    
    if (patches.length === 0 && catalogRows.length === 0) return [];
    
    // Build patch map for fast lookup
    const patchMap = new Map<string, CanonicalProduct>();
    for (const p of patches) {
      const canonical = patchToCanonical(p);
      patchMap.set(canonical.id, canonical);
    }
    
    // If we have catalog items, merge with patches (patches take priority)
    if (catalogRows.length > 0) {
      const merged = new Map<string, CanonicalProduct>();
      for (const row of catalogRows) {
        const canonical = catalogRowToCanonical(row);
        merged.set(canonical.id, patchMap.get(canonical.id) || canonical);
      }
      // Also add patches that aren't in catalog (new items from enricher)
      for (const [id, p] of patchMap) {
        if (!merged.has(id)) merged.set(id, p);
      }
      return Array.from(merged.values());
    }
    
    // Fallback: only patches
    return patches.map(patchToCanonical);
  }, [norm.dryRunResult, norm.catalogItems]);

  // Filter out questions about DOBOR items (they don't need WIDTH/PROFILE normalization)
  const DOBOR_SKIP_TYPES = new Set(['WIDTH_MASTER', 'PROFILE_MAP']);
  
  const aiQuestions = useMemo(() => {
    const raw = (norm.dryRunResult?.questions || []).map(backendQuestionToAI);
    // Skip width/profile questions that are purely about dobor items
    return raw.filter(q => {
      const backendType = q.type.toUpperCase() === 'WIDTH' ? 'WIDTH_MASTER' : q.type.toUpperCase() === 'PROFILE' ? 'PROFILE_MAP' : '';
      if (!DOBOR_SKIP_TYPES.has(backendType)) return true;
      // If all examples look like dobor items, skip the question
      if (q.examples?.length > 0 && q.examples.every(ex => RE_DOBOR_TITLE.test(ex))) return false;
      return true;
    });
  }, [norm.dryRunResult]);

  const questionCards = useMemo((): DashboardQuestionCard[] => {
    const dbCards = norm.dashboardResult?.question_cards || [];
    let cards: DashboardQuestionCard[];
    if (dbCards.length > 0) {
      // Also filter dobor-only question cards from dashboard
      cards = dbCards.filter(c => !DOBOR_SKIP_TYPES.has(c.type) || !(c.examples || []).every(ex => RE_DOBOR_TITLE.test(ex)));
    } else {
      const grouped: Record<string, DashboardQuestionCard> = {};
      for (const q of aiQuestions) {
        const backendType = q.type.toUpperCase() === 'WIDTH' ? 'WIDTH_MASTER' : q.type.toUpperCase() === 'COATING' ? 'COATING_MAP' : q.type.toUpperCase() === 'COLOR' ? 'COLOR_MAP' : q.type.toUpperCase() + '_MAP';
        if (!grouped[backendType]) {
          grouped[backendType] = { type: backendType, label: Q_TYPE_CONFIG[backendType]?.label || backendType, count: 0, examples: [] };
        }
        grouped[backendType].count += q.affected_count;
        grouped[backendType].examples = [...(grouped[backendType].examples || []), ...(q.examples || [])].slice(0, 5);
      }
      cards = Object.values(grouped);
    }
    // Filter out types that the user already confirmed in this session
    return cards.filter(c => !confirmedTypes.has(c.type));
  }, [norm.dashboardResult, aiQuestions, confirmedTypes]);

  const filteredQuestionCards = useMemo(() => {
    let cards = [...questionCards].sort((a, b) => (b.count || 0) - (a.count || 0));
    const q = questionQuery.trim().toLowerCase();
    if (q) {
      cards = cards.filter((c) =>
        (c.label || '').toLowerCase().includes(q) ||
        (c.type || '').toLowerCase().includes(q) ||
        (c.examples || []).some((e) => e.toLowerCase().includes(q))
      );
    }
    if (highImpactOnly) {
      cards = cards.filter((c) => (c.count || 0) >= 10);
    }
    return cards;
  }, [questionCards, questionQuery, highImpactOnly]);

  const filteredQuestionDetails = useMemo(() => {
    let list = [...aiQuestions];
    const q = questionQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((item) =>
        (item.token || '').toLowerCase().includes(q) ||
        (item.ask || '').toLowerCase().includes(q) ||
        (item.examples || []).some((ex) => ex.toLowerCase().includes(q))
      );
    }
    if (highImpactOnly) {
      list = list.filter((item) => (item.affected_count || 0) >= 10);
    }
    return list;
  }, [aiQuestions, questionQuery, highImpactOnly]);


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
    if (quickFilter.trim()) {
      const q = quickFilter.trim().toLowerCase();
      result = result.filter((i) =>
        (i.title || '').toLowerCase().includes(q) ||
        (i.profile || '').toLowerCase().includes(q) ||
        (i.color_or_ral || '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [items, activeCategory, onlyProblematic, quickFilter]);

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
    runScan();
    void fetchDashboard(effectiveJobId);
  }, [runScan, fetchDashboard, effectiveJobId]);

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
        runScan();
      }
      return;
    }

    // WIDTH_MASTER always needs profile + numeric fields
    if (backendType === 'WIDTH_MASTER') {
      const widthProfile = resolveWidthProfile(activeQuestionForm);
      
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
        setConfirmedCount(prev => prev + 1);
        setConfirmedTypes(prev => new Set(prev).add(backendType));
        toast({ title: `✓ Применено правил: ${confirmedCount + 1}`, description: `Ширина для ${widthProfile} подтверждена` });
        setActiveQuestionForm(null);
        runScan();
      } else {
        const errMsg = (result && typeof result === 'object' && 'error' in result)
          ? String((result as { error?: string }).error || 'Ошибка подтверждения')
          : 'Ошибка подтверждения';
        toast({ title: 'Ошибка подтверждения', description: errMsg, variant: 'destructive' });
      }
      return;
    }

    // Default: token + canonical
    const payload: Record<string, unknown> = { token: profileToken, canonical: value };
    const action: ConfirmAction = { type: backendType, payload };
    const result = await confirmBatch([action]);
    if (result?.ok) {
      setConfirmedCount(prev => prev + 1);
      setConfirmedTypes(prev => new Set(prev).add(backendType));
      toast({ title: `✓ Применено правил: ${confirmedCount + 1}`, description: `${backendType}: ${value}` });
      setActiveQuestionForm(null);
      runScan();
    }
  }, [confirmBatch, runScan, activeQuestionForm, norm]);

  const handleAnswerFromCluster = useCallback(async (questionId: string, value: string | number) => {
    const question = aiQuestions.find((q, i) => `q-${i}` === questionId || q.token === questionId);
    const questionType = question?.type || questionId;
    const backendType = questionType.toUpperCase() === 'WIDTH' ? 'WIDTH_MASTER' : questionType.toUpperCase() === 'COATING' ? 'COATING_MAP'
      : questionType.toUpperCase() === 'COLOR' ? 'COLOR_MAP' : questionType.toUpperCase() === 'THICKNESS' ? 'THICKNESS_SET' : questionType.toUpperCase();
    const token = question?.token || question?.cluster_path?.profile || questionId;

    // THICKNESS_SET — use legacy path
    if (backendType === 'THICKNESS_SET') {
      const success = await norm.answerQuestion('THICKNESS_SET', token, value);
      if (success) runScan();
      return;
    }

    const payload = backendType === 'WIDTH_MASTER'
      ? { token, canonical: value, profile: token }
      : { token, canonical: value };
    const action: ConfirmAction = { type: backendType, payload };
    const result = await confirmBatch([action]);
    if (result?.ok) runScan();
  }, [confirmBatch, runScan, aiQuestions, norm]);


  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[98vw] w-[1720px] h-[95vh] flex flex-col p-0 gap-0 rounded-2xl border shadow-2xl overflow-hidden">

        {/* ═══ TOP STICKY BAR ═══ */}
        <div className="shrink-0 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85 sticky top-0 z-10">
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
          <div className="flex items-center gap-4 px-4 py-2">
            <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
              <KpiTile label="Всего" value={kpiTotal.toLocaleString('ru')} />
              <KpiTile label="Готово" value={kpiReady.toLocaleString('ru')} tone="success" />
              <KpiTile label="Проблем" value={kpiAttention.toLocaleString('ru')} tone="danger" />
              <KpiTile label="Готовность" value={`${kpiPct.toFixed(1)}%`} tone="primary" />
            </div>

            <div className="hidden lg:block h-8 border-l" />

            {/* Status indicators — explicit PENDING/RUNNING/DONE/FAILED */}
            <div className="flex items-center gap-3 flex-1 min-w-0">
              {flow.state === 'SCANNING' && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground rounded-full border px-2 py-1">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Сканирование…
                </div>
              )}
              {norm.catalogLoading && flow.state !== 'SCANNING' && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground rounded-full border px-2 py-1">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Загрузка…
                </div>
              )}

              {/* Apply state: PENDING / RUNNING with phase + progress */}
              {(flow.state === 'APPLY_STARTING' || flow.state === 'APPLY_RUNNING') && (
                <div className="flex items-center gap-3">
                  <Badge variant="secondary" className="text-xs">
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    {flow.state === 'APPLY_STARTING' ? 'PENDING' : 'RUNNING'}
                    {norm.applyPhase && norm.applyPhase !== 'unknown' && ` · ${norm.applyPhase === 'materialize' ? 'подготовка' : norm.applyPhase === 'merge' ? 'слияние' : norm.applyPhase}`}
                  </Badge>
                  <Progress value={norm.applyProgress} className="h-1.5 w-24" />
                  <span className="text-[10px] text-muted-foreground tabular-nums">{norm.applyProgress}%</span>
                </div>
              )}

              {/* DONE */}
              {flow.state === 'APPLY_DONE' && (
                <Badge className="text-xs bg-emerald-500/10 text-emerald-700 border-emerald-500/30" variant="outline">
                  <CheckCircle2 className="h-3 w-3 mr-1" /> Готово
                </Badge>
              )}

              {/* ERROR with single retry button */}
              {flow.state === 'ERROR' && (
                <div className="flex items-center gap-2">
                  <Badge variant="destructive" className="text-xs">
                    <AlertCircle className="h-3 w-3 mr-1" />
                    {(flow.context.lastError || 'Ошибка').substring(0, 80)}
                  </Badge>
                  <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => {
                    if (norm.applyId && norm.runId) {
                      norm.restartPolling();
                    } else {
                      handleRunScan();
                    }
                  }}>
                    <RefreshCw className="h-3 w-3 mr-1" /> Повторить
                  </Button>
                </div>
              )}

              {/* Confirmed rules count */}
              {confirmedCount > 0 && !isApplying && flow.state !== 'ERROR' && (
                <Badge variant="outline" className="text-xs text-emerald-700 border-emerald-500/30 bg-emerald-500/5">
                  <CheckCircle2 className="h-3 w-3 mr-1" /> Применено правил: {confirmedCount}
                </Badge>
              )}

              {!isApplying && flow.state !== 'SCANNING' && flow.state !== 'ERROR' && flow.state !== 'APPLY_DONE' && questionCards.length > 0 && (
                <div className="hidden md:flex items-center gap-2 text-[11px] text-muted-foreground rounded-full border px-2 py-1">
                  <span>В работе:</span>
                  <strong className="text-foreground">{questionCards.reduce((s, c) => s + c.count, 0).toLocaleString('ru')}</strong>
                </div>
              )}

              {/* Patches ready */}
              {norm.dryRunResult?.stats && flow.state !== 'SCANNING' && flow.state !== 'ERROR' && (
                <span className="text-xs text-muted-foreground ml-auto">
                  Исправлений: <strong className="text-foreground">{norm.dryRunResult.stats.patches_ready}</strong>
                </span>
              )}
            </div>
          </div>

          {/* AI unavailable banner */}
          {(norm.dryRunResult?.ai_disabled || norm.dryRunResult?.stats?.ai_status?.failed) && !norm.dryRunResult?.ai_skip_reason && (
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
            <ResizablePanel defaultSize={14} minSize={10} maxSize={22} className="bg-card/60">
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
            <ResizablePanel defaultSize={rightPanelOpen ? 51 : 86} minSize={30} className="bg-background">
              <div className="flex flex-col h-full">
                {/* Center toolbar */}
                <div className="px-3 py-2 border-b flex items-center gap-2 shrink-0 bg-gradient-to-r from-muted/50 to-background">
                  <span className="text-xs font-semibold text-muted-foreground">
                    {CAT_LABELS[activeCategory]}
                    {filteredItems.length > 0 && <span className="ml-2 font-normal">({filteredItems.length})</span>}
                  </span>
                  <Badge variant="outline" className="text-xs">
                    Показано {filteredItems.length.toLocaleString('ru')} из {Math.max(norm.catalogTotal, totalScanned, filteredItems.length).toLocaleString('ru')}
                  </Badge>
                  <div className="flex items-center gap-1 ml-auto">
                    <Input
                      value={quickFilter}
                      onChange={(e) => setQuickFilter(e.target.value)}
                      placeholder="Поиск по профилю/названию…"
                      className="h-7 w-48 text-xs"
                    />
                    <span className="text-[10px] text-muted-foreground">Лимит</span>
                    <Select value={String(scanLimit)} onValueChange={(v) => setScanLimit(Number(v) as 500 | 2000 | 5000 | 10000)}>
                      <SelectTrigger className="h-7 w-24 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="500">500</SelectItem>
                        <SelectItem value="2000">2 000</SelectItem>
                        <SelectItem value="5000">5 000</SelectItem>
                        <SelectItem value="10000">10 000</SelectItem>
                      </SelectContent>
                    </Select>
                    {(quickFilter || onlyProblematic) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => {
                          setQuickFilter('');
                          setOnlyProblematic(false);
                        }}
                      >
                        Сброс
                      </Button>
                    )}
                  </div>
                  {onlyProblematic && filteredItems.length < (categoryStats[activeCategory]?.total || 0) && (
                    <Badge variant="outline" className="text-xs text-destructive border-destructive/30">Только проблемные</Badge>
                  )}
                </div>

                {isNormalizable ? (
                  <div className="flex-1 flex min-h-0">
                    <div className="w-72 border-r shrink-0 min-h-0 overflow-hidden">
                      <ClusterTree
                        items={filteredItems}
                        selectedCluster={selectedCluster}
                        onSelectCluster={handleSelectCluster}
                        expandedNodes={expandedNodes}
                        onToggleNode={handleToggleNode}
                      />
                    </div>
                    <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
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
                  <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
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
              <ResizablePanel defaultSize={35} minSize={22} maxSize={50} className="border-l bg-card/40">
              <Tabs value={rightTab} onValueChange={v => setRightTab(v as typeof rightTab)} className="flex flex-col h-full">
                <div className="flex items-center border-b shrink-0 bg-gradient-to-r from-background to-muted/20">
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
                      <div className="rounded-lg border bg-muted/20 p-2 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="secondary" className="text-[10px]">Типов: {filteredQuestionCards.length}</Badge>
                          <Badge variant="outline" className="text-[10px]">Вопросов: {filteredQuestionDetails.length}</Badge>
                          <Badge variant="outline" className="text-[10px]">Затронуто: {filteredQuestionCards.reduce((sum, c) => sum + (c.count || 0), 0).toLocaleString('ru')}</Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          <Input
                            value={questionQuery}
                            onChange={(e) => setQuestionQuery(e.target.value)}
                            placeholder="Поиск по вопросам, типам, примерам…"
                            className="h-8 text-xs"
                          />
                          <Button
                            size="sm"
                            variant={highImpactOnly ? 'default' : 'outline'}
                            className="h-8 text-xs whitespace-nowrap"
                            onClick={() => setHighImpactOnly(v => !v)}
                          >
                            {highImpactOnly ? 'High impact ON' : 'High impact'}
                          </Button>
                          {(questionQuery || highImpactOnly) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 text-xs"
                              onClick={() => {
                                setQuestionQuery('');
                                setHighImpactOnly(false);
                              }}
                            >
                              Сброс
                            </Button>
                          )}
                        </div>
                      </div>

                      {activeQuestionForm && (
                        <QuestionAnswerForm question={activeQuestionForm} onSubmit={handleAnswerQuestion} onClose={() => setActiveQuestionForm(null)} onSkip={() => { setActiveQuestionForm(null); toast({ title: 'Пропущено' }); }} loading={norm.answeringQuestion} />
                      )}

                      {filteredQuestionCards.length > 0 ? (
                        <>
                          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Задачи нормализации</div>
                          <div className="space-y-2">
                            {filteredQuestionCards.map(card => {
                              const relatedQs = aiQuestions.filter(aq => {
                                const t = (aq.type || '').toUpperCase();
                                if (card.type === 'WIDTH_MASTER' && t === 'WIDTH') return true;
                                if (card.type === 'COATING_MAP' && t === 'COATING') return true;
                                if (card.type === 'COLOR_MAP' && t === 'COLOR') return true;
                                return t === card.type;
                              });
                              return <QuestionCard key={card.type} card={card} onResolve={handleResolveQuestionType} onSkip={(type) => { setConfirmedTypes(prev => new Set(prev).add(type)); toast({ title: 'Пропущено' }); }} relatedQuestions={relatedQs} />;
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

                      {filteredQuestionDetails.length > 0 && !activeQuestionForm && (
                        <>
                          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-4">Детали вопросов</div>
                          <div className="space-y-1">
                            {filteredQuestionDetails.slice(0, 30).map((q, i) => {
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
                            {filteredQuestionDetails.length > 30 && <p className="text-xs text-muted-foreground text-center py-2">+ ещё {filteredQuestionDetails.length - 30}</p>}
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
                      runScan();
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
