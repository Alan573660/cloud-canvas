/**
 * NormalizationWizard v2 — production-ready, connected to backend via Edge Functions.
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/hooks/use-toast';
import {
  Sparkles, CheckCircle2, Loader2, RefreshCw, AlertCircle,
  Play, Save, Database, Hash, Cpu, BarChart3, Settings2
} from 'lucide-react';

import { ProductTypeFilter } from './ProductTypeFilter';
import { ClusterTree } from './ClusterTree';
import { ClusterDetailPanel } from './ClusterDetailPanel';
import { QualityGates } from './QualityGates';
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
import { useNormalization, type DryRunPatch, type BackendQuestion } from '@/hooks/use-normalization';

// ─── Props ────────────────────────────────────────────────────

interface NormalizationWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  importJobId?: string;
  onComplete?: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────

function categorizeItem(item: { profile?: string; title?: string; sheet_kind?: string }): ProductCategory {
  const sheetKind = item.sheet_kind?.toUpperCase();
  if (sheetKind === 'PROFNASTIL') return 'PROFNASTIL';
  if (sheetKind === 'METAL_TILE') return 'METALLOCHEREPICA';
  if (sheetKind === 'ACCESSORY') return 'DOBOR';
  // OTHER stays OTHER — don't merge into DOBOR
  if (sheetKind === 'OTHER') return 'OTHER';

  const profile = (item.profile || '').toUpperCase();
  const title = (item.title || '').toLowerCase();
  if (/^(С|C|Н|H|НС|HC|МП|MP)-?\d/i.test(profile) || title.includes('профнастил')) return 'PROFNASTIL';
  if (title.includes('металлочерепица') || title.includes('монтеррей')) return 'METALLOCHEREPICA';
  if (title.includes('сэндвич') || title.includes('панель')) return 'SANDWICH';
  if (title.includes('планка') || title.includes('конек') || title.includes('саморез')) return 'DOBOR';
  return 'OTHER';
}

/** Extract zinc label from notes field (e.g. "ZINC:ZN275" → "ZN275") */
function extractZincLabel(notes?: string): string | undefined {
  if (!notes) return undefined;
  const match = notes.match(/ZINC[:\s]*(ZN?\d+)/i);
  return match ? match[1].toUpperCase() : undefined;
}

/** Format color display: "RAL 8017 ZN275" or "RR 32" or "DECOR Античный" or "ZN275" or "—" */
function formatColorDisplay(item: { color_system?: string; color_code?: string; zinc_label?: string }): string {
  const parts: string[] = [];
  if (item.color_system && item.color_code) {
    parts.push(`${item.color_system} ${item.color_code}`);
  }
  if (item.zinc_label) {
    parts.push(item.zinc_label);
  }
  return parts.length > 0 ? parts.join(' ') : '—';
}

function patchToCanonical(item: DryRunPatch): CanonicalProduct {
  const category = categorizeItem(item);
  // Map all categories to product_type, not just profnastil/metallocherepica
  const productType: ProductType = 
    category === 'PROFNASTIL' ? 'PROFNASTIL' :
    category === 'METALLOCHEREPICA' ? 'METALLOCHEREPICA' :
    category === 'DOBOR' ? 'DOBOR' as ProductType :
    category === 'SANDWICH' ? 'SANDWICH' as ProductType :
    'OTHER' as ProductType;
  const zincLabel = extractZincLabel(item.notes);
  return {
    id: item.id,
    organization_id: '',
    product_type: productType as ProductType,
    profile: item.profile || '',
    thickness_mm: typeof item.thickness_mm === 'string' ? parseFloat(item.thickness_mm) : (item.thickness_mm || 0),
    coating: item.coating || '',
    color_or_ral: item.color_code || '',
    color_system: item.color_system || '',
    color_code: item.color_code || '',
    zinc_label: zincLabel,
    work_width_mm: item.width_work_mm || 0,
    full_width_mm: item.width_full_mm || 0,
    price: item.price_rub_m2 ?? 0,
    unit: item.unit === 'm2' ? 'm2' : 'sht',
    title: item.title,
    notes: item.notes,
  };
}

function mapQuestionType(backendType?: string): AIQuestionType {
  const t = (backendType || '').toUpperCase();
  if (t.includes('WIDTH')) return 'width';
  if (t.includes('PROFILE')) return 'profile';
  if (t.includes('CATEGORY') || t.includes('CAT')) return 'category';
  if (t.includes('COLOR')) return 'color';
  if (t.includes('COATING')) return 'coating';
  if (t.includes('THICK')) return 'thickness';
  return 'color'; // fallback
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

// ─── Main Component ──────────────────────────────────────────

export function NormalizationWizard({
  open,
  onOpenChange,
  organizationId,
  importJobId: propJobId,
  onComplete,
}: NormalizationWizardProps) {
  const { t } = useTranslation();
  const DEV_MODE = import.meta.env.DEV;
  
  // Job selector (if not provided via props)
  const [inputJobId, setInputJobId] = useState(propJobId || '');
  const effectiveJobId = propJobId || inputJobId || undefined;

  // UI state
  const [activeCategory, setActiveCategory] = useState<ProductCategory>('PROFNASTIL');
  const [selectedCluster, setSelectedCluster] = useState<ClusterPath | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [showSettings, setShowSettings] = useState(false);
  const [showDevInfo, setShowDevInfo] = useState(false);
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);

  // Backend hook — AI always enabled
  const norm = useNormalization({
    organizationId,
    importJobId: effectiveJobId,
  });

  // Transform patches to canonical items
  const items = useMemo(() => {
    return (norm.dryRunResult?.patches_sample || []).map(patchToCanonical);
  }, [norm.dryRunResult]);

  // Transform questions
  const aiQuestions = useMemo(() => {
    return (norm.dryRunResult?.questions || []).map(backendQuestionToAI);
  }, [norm.dryRunResult]);

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
      const cat = item.product_type || 'OTHER';
      const v = validateProduct(item);
      stats.ALL.total++;
      stats[cat].total++;
      if (v.status === 'ready') { stats.ALL.ready++; stats[cat].ready++; }
      else { stats.ALL.needsAttention++; stats[cat].needsAttention++; }
    });
    return stats;
  }, [items]);

  // Auto-select best category after dry_run
  useEffect(() => {
    if (items.length === 0) return;
    // If current category has items, keep it
    const currentCount = categoryStats[activeCategory]?.total || 0;
    if (currentCount > 0) return;
    // Find category with most items (excluding ALL)
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
    if (activeCategory === 'ALL') return items;
    return items.filter(i => (i.product_type || 'OTHER') === activeCategory);
  }, [items, activeCategory]);

  const isNormalizable = activeCategory === 'PROFNASTIL' || activeCategory === 'METALLOCHEREPICA';

  // Handlers — AI always on
  const handleRunNormalization = useCallback(() => {
    norm.executeDryRun({ aiSuggest: true, limit: 2000, onlyWhereNull: onlyIncomplete });
  }, [norm, onlyIncomplete]);

  const handleApply = useCallback(() => {
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

  const handleAnswerQuestion = useCallback(async (questionId: string, value: string | number) => {
    // Find the original question to get type and token
    const question = aiQuestions.find((q, i) => `q-${i}` === questionId || q.token === questionId);
    const questionType = question?.type || questionId;
    const token = question?.token || questionId;

    const ok = await norm.answerQuestion(questionType, token, value);
    if (ok) {
      // Re-run dry_run to refresh clusters with the new answer applied
      toast({ title: t('normalize.rerunning', 'Обновляем результаты…') });
      norm.executeDryRun({ aiSuggest: true, limit: 2000 });
    }
  }, [norm, aiQuestions, t]);

  // Progress
  const totalItems = categoryStats.PROFNASTIL.total + categoryStats.METALLOCHEREPICA.total;
  const readyItems = categoryStats.PROFNASTIL.ready + categoryStats.METALLOCHEREPICA.ready;
  const progressPercent = totalItems > 0 ? (readyItems / totalItems) * 100 : 0;

  // Apply status helpers
  const isApplying = norm.applyState === 'STARTING' || norm.applyState === 'PENDING' || norm.applyState === 'RUNNING';

  // Human-friendly apply status
  const getApplyStatusLabel = () => {
    switch (norm.applyState) {
      case 'STARTING': case 'PENDING': return t('normalize.statusScanning', 'Сканируем товары…');
      case 'RUNNING': return t('normalize.statusApplying', 'Применяем исправления…');
      case 'DONE': return t('normalize.statusDone', 'Готово');
      case 'ERROR': return t('normalize.statusError', 'Ошибка');
      default: return '';
    }
  };

  // Quality metrics
  const activeMetrics = norm.applyReport || norm.serverStats;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[1600px] h-[90vh] flex flex-col p-0">
        {/* ─── Header ─── */}
        <DialogHeader className="px-6 py-3 border-b shrink-0">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Sparkles className="h-5 w-5 text-primary" />
              <div>
                <DialogTitle className="text-base">
                  {t('normalize.wizardTitle', 'Нормализация каталога')}
                </DialogTitle>
                <DialogDescription className="text-xs">
                  {t('normalize.wizardDesc', 'Проверка и стандартизация данных товаров')}
                </DialogDescription>
              </div>
            </div>

            {/* Controls row — clean, no dev terms */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Job ID input — dev only */}
              {DEV_MODE && !propJobId && (
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs shrink-0">Job ID:</Label>
                  <Input
                    value={inputJobId}
                    onChange={e => setInputJobId(e.target.value)}
                    placeholder="import_job_id"
                    className="h-7 w-48 text-xs"
                  />
                </div>
              )}

              {/* Filter toggle */}
              <div className="flex items-center gap-1.5">
                <Switch
                  id="only-incomplete"
                  checked={onlyIncomplete}
                  onCheckedChange={setOnlyIncomplete}
                  className="scale-75"
                />
                <Label htmlFor="only-incomplete" className="text-xs cursor-pointer">
                  {t('normalize.onlyIncomplete', 'Только незаполненные')}
                </Label>
              </div>

              {/* Main action: Run normalization */}
              <Button size="sm" variant="outline" onClick={handleRunNormalization} disabled={norm.dryRunLoading || isApplying}>
                {norm.dryRunLoading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                {t('normalize.scanCatalog', 'Сканировать')}
              </Button>

              {/* Settings */}
              <Button size="sm" variant={showSettings ? 'default' : 'outline'} onClick={() => setShowSettings(v => !v)}>
                <Settings2 className="h-3.5 w-3.5 mr-1.5" />
                {t('normalize.confirmed', 'Настройки')}
              </Button>

              {/* Apply — human-friendly label */}
              <Button size="sm" onClick={handleApply} disabled={!norm.runId || isApplying}>
                {isApplying ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1.5" />}
                {t('normalize.applyNormalization', 'Применить')}
              </Button>

              {/* Dev debug toggle */}
              {DEV_MODE && (
                <Button size="sm" variant="ghost" onClick={() => setShowDevInfo(v => !v)} title="Dev Info">
                  <BarChart3 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>

          {/* ─── Status Bar — human-friendly ─── */}
          <div className="flex items-center gap-4 mt-2 text-xs">
            {/* Dev info — hidden from users */}
            {DEV_MODE && showDevInfo && norm.runId && (
              <div className="flex items-center gap-3 text-muted-foreground">
                <span className="flex items-center gap-1"><Hash className="h-3 w-3" /> run: <code className="font-mono">{norm.runId.slice(0, 12)}…</code></span>
                <span className="flex items-center gap-1"><Database className="h-3 w-3" /> hash: <code className="font-mono">{norm.profileHash?.slice(0, 8)}…</code></span>
              </div>
            )}

            {/* Stats from dry_run — human labels */}
            {norm.dryRunResult?.stats && (
              <div className="flex items-center gap-3 text-muted-foreground">
                <span>{t('normalize.scannedCount', 'Проверено: {{count}}', { count: norm.dryRunResult.stats.rows_scanned })}</span>
                <span>{t('normalize.fixesFound', 'Найдено исправлений: {{count}}', { count: norm.dryRunResult.stats.patches_ready })}</span>
              </div>
            )}

            {/* Local progress */}
            {items.length > 0 && (
              <div className="flex items-center gap-2 ml-auto">
                <CheckCircle2 className="h-3 w-3 text-green-600" />
                <span>{readyItems}/{totalItems}</span>
                <Progress value={progressPercent} className="w-24 h-1.5" />
              </div>
            )}

            {/* Apply state — human-friendly */}
            {norm.applyState !== 'IDLE' && (
              <Badge 
                variant={norm.applyState === 'DONE' ? 'default' : norm.applyState === 'ERROR' ? 'destructive' : 'secondary'}
                className="text-xs"
              >
                {isApplying && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                {getApplyStatusLabel()}
                {norm.applyProgress > 0 && norm.applyState === 'RUNNING' && ` ${norm.applyProgress}%`}
              </Badge>
            )}
          </div>

          {/* Apply error */}
          {norm.applyError && (
            <div className="mt-1 text-xs text-destructive flex items-center gap-1">
              <AlertCircle className="h-3 w-3" /> {norm.applyError}
            </div>
          )}
        </DialogHeader>

        {/* ─── Quality Gates (dev only) ─── */}
        {DEV_MODE && showDevInfo && activeMetrics && (
          <div className="px-6 py-3 border-b shrink-0">
            <QualityGates metrics={activeMetrics} />
          </div>
        )}

        {/* ─── Confirmed Settings Editor (collapsible) ─── */}
        {showSettings && (
          <div className="px-6 py-3 border-b shrink-0 max-h-72 overflow-y-auto">
            <ConfirmedSettingsEditor
              onSave={norm.saveConfirmedSettings}
              saving={norm.savingSettings}
            />
          </div>
        )}

        {/* ─── Questions Banner ─── */}
        {aiQuestions.length > 0 && (
          <div className="px-6 py-2 border-b bg-purple-50/50 dark:bg-purple-900/10 shrink-0">
            <div className="flex items-center gap-2 text-xs">
              <Cpu className="h-3.5 w-3.5 text-purple-600" />
              <span className="font-medium">{t('normalize.improvementsFound', 'Найдены улучшения нормализации')}</span>
              <Badge variant="secondary" className="text-xs">{aiQuestions.length}</Badge>
            </div>
          </div>
        )}

        {/* ─── Main Content — 3 Column Layout ─── */}
        <div className="flex-1 flex min-h-0">
          {/* Left: Category Filter */}
          <div className="w-64 border-r shrink-0">
            <ProductTypeFilter
              activeCategory={activeCategory}
              onCategoryChange={setActiveCategory}
              stats={categoryStats}
              loading={norm.dryRunLoading}
            />
          </div>

          {/* Center + Right */}
          {isNormalizable ? (
            <>
              <div className="w-80 border-r shrink-0">
                <ClusterTree
                  items={filteredItems}
                  selectedCluster={selectedCluster}
                  onSelectCluster={handleSelectCluster}
                  expandedNodes={expandedNodes}
                  onToggleNode={handleToggleNode}
                />
              </div>
              <div className="flex-1 min-w-0">
                <ClusterDetailPanel
                  items={filteredItems}
                  clusterPath={selectedCluster}
                  loading={norm.dryRunLoading}
                  aiQuestions={aiQuestions}
                  onAnswerQuestion={handleAnswerQuestion}
                  answeringQuestion={norm.answeringQuestion}
                />
              </div>
            </>
          ) : (
            <div className="flex-1 min-w-0">
              <ClusterDetailPanel
                items={filteredItems}
                clusterPath={null}
                loading={norm.dryRunLoading}
                aiQuestions={aiQuestions}
                onAnswerQuestion={handleAnswerQuestion}
                answeringQuestion={norm.answeringQuestion}
                simpleMode
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default NormalizationWizard;
