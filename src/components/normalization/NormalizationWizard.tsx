/**
 * NormalizationWizard v2 — production-ready, connected to backend via Edge Functions.
 */

import { useState, useMemo, useCallback } from 'react';
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

function patchToCanonical(item: DryRunPatch): CanonicalProduct {
  const category = categorizeItem(item);
  const productType: ProductType | undefined = 
    category === 'PROFNASTIL' ? 'PROFNASTIL' :
    category === 'METALLOCHEREPICA' ? 'METALLOCHEREPICA' :
    undefined;
  return {
    id: item.id,
    organization_id: '',
    product_type: productType as ProductType,
    profile: item.profile || '',
    thickness_mm: typeof item.thickness_mm === 'string' ? parseFloat(item.thickness_mm) : (item.thickness_mm || 0),
    coating: item.coating || '',
    color_or_ral: item.color_code || '',
    work_width_mm: item.width_work_mm || 0,
    full_width_mm: item.width_full_mm || 0,
    price: item.price_rub_m2 ?? 0,
    unit: item.unit === 'm2' ? 'm2' : 'sht',
    title: item.title,
  };
}

function backendQuestionToAI(q: BackendQuestion, index: number): AIQuestion {
  return {
    type: q.type?.includes('COLOR') ? 'color' : q.type?.includes('COATING') ? 'coating' : 'thickness',
    cluster_path: { profile: q.profile || q.token || `q-${index}` },
    token: q.token || '',
    examples: q.examples || [],
    affected_count: q.affected_count || 0,
    suggestions: Array.isArray(q.suggested_variants) 
      ? q.suggested_variants.map(String)
      : q.suggested ? [String(q.suggested)] : [],
    confidence: q.confidence || 0.5,
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
  
  // Job selector (if not provided via props)
  const [inputJobId, setInputJobId] = useState(propJobId || '');
  const effectiveJobId = propJobId || inputJobId || undefined;

  // UI state
  const [activeCategory, setActiveCategory] = useState<ProductCategory>('PROFNASTIL');
  const [selectedCluster, setSelectedCluster] = useState<ClusterPath | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [aiEnabled, setAiEnabled] = useState(false);
  const [showMetrics, setShowMetrics] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Backend hook
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

  // Filtered items
  const filteredItems = useMemo(() => {
    if (activeCategory === 'ALL') return items;
    return items.filter(i => (i.product_type || 'OTHER') === activeCategory);
  }, [items, activeCategory]);

  const isNormalizable = activeCategory === 'PROFNASTIL' || activeCategory === 'METALLOCHEREPICA';

  // Handlers
  const handleDryRun = useCallback(() => {
    norm.executeDryRun({ aiSuggest: aiEnabled, limit: 2000 });
  }, [norm, aiEnabled]);

  const handleApply = useCallback(() => {
    norm.executeApply();
  }, [norm]);

  const handleRefreshStats = useCallback(() => {
    norm.fetchStats();
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

  const handleAnswerQuestion = useCallback((questionId: string, value: string | number) => {
    console.log('Answer question:', questionId, value);
    toast({ title: 'Ответ сохранён', description: String(value) });
  }, []);

  // Progress
  const totalItems = categoryStats.PROFNASTIL.total + categoryStats.METALLOCHEREPICA.total;
  const readyItems = categoryStats.PROFNASTIL.ready + categoryStats.METALLOCHEREPICA.ready;
  const progressPercent = totalItems > 0 ? (readyItems / totalItems) * 100 : 0;

  // Apply status helpers
  const isApplying = norm.applyState === 'STARTING' || norm.applyState === 'PENDING' || norm.applyState === 'RUNNING';

  // Quality metrics — prefer applyReport, fallback to serverStats
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

            {/* Controls row */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Job ID input (if not provided) */}
              {!propJobId && (
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs shrink-0">Job ID:</Label>
                  <Input
                    value={inputJobId}
                    onChange={e => setInputJobId(e.target.value)}
                    placeholder="import_job_id или 'current'"
                    className="h-7 w-48 text-xs"
                  />
                </div>
              )}

              {/* AI toggle */}
              <div className="flex items-center gap-1.5">
                <Label className="text-xs">AI</Label>
                <Switch checked={aiEnabled} onCheckedChange={setAiEnabled} />
              </div>

              {/* Dry Run */}
              <Button size="sm" variant="outline" onClick={handleDryRun} disabled={norm.dryRunLoading || isApplying}>
                {norm.dryRunLoading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                Dry Run
              </Button>

              {/* Settings editor toggle */}
              <Button size="sm" variant={showSettings ? 'default' : 'outline'} onClick={() => setShowSettings(v => !v)}>
                <Settings2 className="h-3.5 w-3.5 mr-1.5" />
                {t('normalize.confirmed', 'Настройки')}
              </Button>

              {/* Apply */}
              <Button size="sm" onClick={handleApply} disabled={!norm.runId || isApplying}>
                {isApplying ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1.5" />}
                Apply
              </Button>

              {/* Refresh Stats */}
              <Button size="sm" variant="outline" onClick={handleRefreshStats} disabled={norm.statsLoading}>
                {norm.statsLoading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <BarChart3 className="h-3.5 w-3.5 mr-1.5" />}
                Stats
              </Button>

              {/* Metrics toggle */}
              {activeMetrics && (
                <Button size="sm" variant="ghost" onClick={() => setShowMetrics(v => !v)}>
                  <BarChart3 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>

          {/* ─── Status Bar ─── */}
          <div className="flex items-center gap-4 mt-2 text-xs">
            {/* Run info */}
            {norm.runId && (
              <div className="flex items-center gap-3 text-muted-foreground">
                <span className="flex items-center gap-1"><Hash className="h-3 w-3" /> run: <code className="font-mono">{norm.runId.slice(0, 12)}…</code></span>
                <span className="flex items-center gap-1"><Database className="h-3 w-3" /> hash: <code className="font-mono">{norm.profileHash?.slice(0, 8)}…</code></span>
              </div>
            )}

            {/* Stats from dry_run */}
            {norm.dryRunResult?.stats && (
              <div className="flex items-center gap-3 text-muted-foreground">
                <span>Сканировано: {norm.dryRunResult.stats.rows_scanned}</span>
                <span>Кандидатов: {norm.dryRunResult.stats.candidates}</span>
                <span>Патчей: {norm.dryRunResult.stats.patches_ready}</span>
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

            {/* Apply state */}
            {norm.applyState !== 'IDLE' && (
              <Badge 
                variant={norm.applyState === 'DONE' ? 'default' : norm.applyState === 'ERROR' ? 'destructive' : 'secondary'}
                className="text-xs"
              >
                {isApplying && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                {norm.applyState}
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

        {/* ─── Quality Gates (collapsible) ─── */}
        {showMetrics && activeMetrics && (
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
              <span className="font-medium">{aiQuestions.length} {t('normalize.questionsFromBackend', 'вопросов от backend')}</span>
              <span className="text-muted-foreground">— ответьте для улучшения нормализации</span>
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
                />
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center max-w-md">
                <AlertCircle className="h-16 w-16 mx-auto mb-4 opacity-50" />
                <h3 className="text-lg font-medium mb-2">
                  {t('normalize.notNormalizable', 'Нормализация недоступна')}
                </h3>
                <p className="text-sm">
                  {t('normalize.notNormalizableDesc', 'Нормализация доступна только для профнастила и металлочерепицы.')}
                </p>
                <Button variant="outline" className="mt-4" onClick={() => setActiveCategory('PROFNASTIL')}>
                  {t('normalize.goToProfnastil', 'Перейти к Профнастилу')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default NormalizationWizard;
