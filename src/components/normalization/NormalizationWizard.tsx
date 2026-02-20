/**
 * NormalizationWizard v3 — full single-screen layout:
 * [Top KPI bar] [Left: category tree] [Center: clusters/table] [Right: AI questions + chat + rules]
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
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
import { useNormalization, type DryRunPatch, type BackendQuestion, type CatalogRow, type DashboardQuestionCard } from '@/hooks/use-normalization';

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

function categorizeItem(item: { profile?: string; title?: string; sheet_kind?: string }): ProductCategory {
  const sheetKind = item.sheet_kind?.toUpperCase();
  if (sheetKind === 'PROFNASTIL') return 'PROFNASTIL';
  if (sheetKind === 'METAL_TILE') return 'METALLOCHEREPICA';
  if (sheetKind === 'ACCESSORY') return 'DOBOR';
  if (sheetKind === 'OTHER') return 'OTHER';

  const profile = (item.profile || '').toUpperCase();
  const title = (item.title || '').toLowerCase();
  if (/^(С|C|Н|H|НС|HC|МП|MP)-?\d/i.test(profile) || title.includes('профнастил')) return 'PROFNASTIL';
  if (title.includes('металлочерепица') || title.includes('монтеррей')) return 'METALLOCHEREPICA';
  if (title.includes('сэндвич') || title.includes('панель')) return 'SANDWICH';
  if (title.includes('планка') || title.includes('конек') || title.includes('саморез')) return 'DOBOR';
  return 'OTHER';
}

function extractZincLabel(notes?: string): string | undefined {
  if (!notes) return undefined;
  const match = notes.match(/ZINC[:\s]*(ZN?\d+)/i);
  return match ? match[1].toUpperCase() : undefined;
}

function patchToCanonical(item: DryRunPatch): CanonicalProduct {
  const category = categorizeItem(item);
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
  return {
    type: mapQuestionType(q.type),
    cluster_path: { profile: q.profile || q.token || `q-${index}` },
    token: q.token || '',
    examples: q.examples || [],
    affected_count: q.affected_count || 0,
    suggestions: Array.isArray(q.suggested_variants)
      ? q.suggested_variants.map(String)
      : q.suggested ? [String(q.suggested)] : [],
    confidence: q.confidence || 0.5,
    ask: q.ask,
  };
}

// ─── Right Panel: Question Card ───────────────────────────────

function QuestionCard({
  card,
  onResolve,
}: {
  card: DashboardQuestionCard;
  onResolve: (type: string) => void;
}) {
  const cfg = Q_TYPE_CONFIG[card.type] || { icon: AlertTriangle, label: card.type, color: 'bg-muted border-border text-foreground' };
  const Icon = cfg.icon;
  return (
    <button
      onClick={() => onResolve(card.type)}
      className={`w-full text-left p-3 rounded-lg border transition-all hover:shadow-sm ${cfg.color}`}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5" />
          <span className="font-medium text-xs">{card.label || cfg.label}</span>
        </div>
        <Badge variant="secondary" className="text-xs font-bold">{card.count}</Badge>
      </div>
      {card.examples && card.examples.length > 0 && (
        <p className="text-xs opacity-70 truncate">{card.examples.slice(0, 2).join(', ')}</p>
      )}
      <p className="text-xs mt-1 opacity-50">Нажмите для исправления →</p>
    </button>
  );
}

// ─── Right Panel: Answer Form ─────────────────────────────────

function QuestionAnswerForm({
  question,
  onSubmit,
  onClose,
  loading,
}: {
  question: AIQuestion;
  onSubmit: (value: string) => void;
  onClose: () => void;
  loading: boolean;
}) {
  const [value, setValue] = useState('');
  const [selected, setSelected] = useState<string[]>([]);

  const handleSubmit = () => {
    const finalValue = question.type === 'width' ? selected.join(',') : (value || selected[0] || '');
    if (finalValue) onSubmit(finalValue);
  };

  return (
    <div className="border rounded-lg p-3 bg-muted/30 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">
          {Q_TYPE_CONFIG[question.type?.toUpperCase() || '']?.label || question.type}
          {question.token && <span className="ml-1 text-muted-foreground font-normal">«{question.token}»</span>}
        </span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {question.ask && (
        <p className="text-xs text-muted-foreground">{question.ask}</p>
      )}

      {/* Suggestions as chips */}
      {question.suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {question.suggestions.map(s => (
            <button
              key={s}
              onClick={() => {
                if (question.type === 'width') {
                  setSelected(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
                } else {
                  setValue(s);
                  setSelected([s]);
                }
              }}
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

      {/* Manual input */}
      <Input
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder={question.type === 'width' ? 'Например: 1150 или 1150:1100' : 'Введите значение…'}
        className="h-7 text-xs"
      />

      {question.affected_count > 0 && (
        <p className="text-xs text-muted-foreground">Затронуто товаров: {question.affected_count}</p>
      )}

      <div className="flex gap-2">
        <Button size="sm" onClick={handleSubmit} disabled={loading || (!value && selected.length === 0)} className="h-7 text-xs flex-1">
          {loading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
          Подтвердить
        </Button>
      </div>
    </div>
  );
}

// ─── Right Panel: AI Chat ─────────────────────────────────────

function AIChatPanel({
  organizationId,
  importJobId,
}: {
  organizationId: string;
  importJobId?: string;
}) {
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'ai'; text: string }>>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Import supabase inline to avoid circular deps
  const sendMessage = useCallback(async () => {
    if (!input.trim() || loading) return;
    const msg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: msg }]);
    setLoading(true);

    try {
      const { supabase } = await import('@/integrations/supabase/client');
      const payload = {
        op: 'chat',
        organization_id: organizationId,
        import_job_id: importJobId || 'current',
        message: msg,
        // context passed from parent if available (activeGroup)
      };
      console.log('[AIChatPanel] -> invoke import-normalize/chat', payload);

      const { data, error: invokeError } = await supabase.functions.invoke('import-normalize', {
        body: payload,
      });

      console.log('[AIChatPanel] <- response:', data, 'invokeError:', invokeError);

      if (invokeError) throw new Error(invokeError.message);

      const result = data as {
        ok?: boolean;
        reply?: string;
        answer?: string;
        message?: string;
        error?: string;
        code?: string;
        ai_skip_reason?: string;
        ai_disabled?: boolean;
      };

      // Handle { ok: false, error: ... } with HTTP 200
      if (result?.ok === false) {
        let errMsg = result.error || 'Ошибка ИИ';
        if (result.code === 'TIMEOUT') errMsg = 'ИИ не ответил вовремя. Попробуйте ещё раз.';
        if (result.ai_disabled) errMsg = `ИИ отключён. Причина: ${result.ai_skip_reason || 'не указана'}`;
        setMessages(prev => [...prev, { role: 'ai', text: `⚠️ ${errMsg}` }]);
        return;
      }

      // Show ai_skip_reason as info if present even on ok:true
      if (result?.ai_skip_reason) {
        console.info('[AIChatPanel] ai_skip_reason:', result.ai_skip_reason);
      }

      const reply = result?.reply || result?.answer || result?.message || 'Нет ответа от ИИ';
      setMessages(prev => [...prev, { role: 'ai', text: reply }]);
    } catch (err) {
      console.error('[AIChatPanel] sendMessage error:', err);
      const errMsg = err instanceof Error ? err.message : 'Ошибка подключения к ИИ';
      setMessages(prev => [...prev, { role: 'ai', text: `⚠️ ${errMsg}` }]);
    } finally {
      setLoading(false);
      setTimeout(() => scrollRef.current?.scrollTo({ top: 9999, behavior: 'smooth' }), 100);
    }
  }, [input, loading, organizationId, importJobId]);

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1 min-h-0 p-3" ref={scrollRef as React.Ref<HTMLDivElement>}>
        {messages.length === 0 && (
          <div className="text-center py-8 text-muted-foreground text-xs">
            <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p>Спросите ИИ о любом товаре или правиле</p>
            <p className="mt-1 opacity-70">«Почему этот товар попал в Профнастил?»</p>
          </div>
        )}
        <div className="space-y-2">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-lg px-3 py-2 text-xs ${
                m.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground'
              }`}>
                {m.text}
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
        </div>
      </ScrollArea>

      <div className="p-3 border-t flex gap-2">
        <Textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
          placeholder="Спросить ИИ…"
          className="text-xs resize-none h-8 min-h-0 py-1.5"
          rows={1}
        />
        <Button size="sm" onClick={sendMessage} disabled={!input.trim() || loading} className="h-8 w-8 p-0 shrink-0">
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

  const handleAnswerQuestion = useCallback(async (value: string) => {
    if (!activeQuestionForm) return;
    const ok = await norm.answerQuestion(activeQuestionForm.type, activeQuestionForm.token, value);
    if (ok) {
      setActiveQuestionForm(null);
      toast({ title: t('normalize.rerunning', 'Обновляем результаты…') });
      norm.executeDryRun({ aiSuggest: true, limit: 2000 });
    }
  }, [norm, activeQuestionForm, t]);

  const handleAnswerFromCluster = useCallback(async (questionId: string, value: string | number) => {
    const question = aiQuestions.find((q, i) => `q-${i}` === questionId || q.token === questionId);
    const questionType = question?.type || questionId;
    const token = question?.token || questionId;
    const ok = await norm.answerQuestion(questionType, token, value);
    if (ok) {
      toast({ title: t('normalize.rerunning', 'Обновляем результаты…') });
      norm.executeDryRun({ aiSuggest: true, limit: 2000 });
    }
  }, [norm, aiQuestions, t]);

  const getApplyStatusLabel = () => {
    switch (norm.applyState) {
      case 'STARTING': case 'PENDING': return 'Сканируем товары…';
      case 'RUNNING': return `Применяем исправления… ${norm.applyProgress > 0 ? norm.applyProgress + '%' : ''}`;
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
            {norm.applyState !== 'IDLE' && (
              <Badge
                variant={norm.applyState === 'DONE' ? 'default' : norm.applyState === 'ERROR' ? 'destructive' : 'secondary'}
                className="text-xs"
              >
                {isApplying && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                {getApplyStatusLabel()}
              </Badge>
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
                            .map(card => (
                              <QuestionCard
                                key={card.type}
                                card={card}
                                onResolve={handleResolveQuestionType}
                              />
                            ))}
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
                <AIChatPanel organizationId={organizationId} importJobId={effectiveJobId} />
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
