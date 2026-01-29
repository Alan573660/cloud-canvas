import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { 
  Loader2, Check, ChevronRight, ChevronDown, 
  Sparkles, Settings2, Palette, Save, CheckCircle2, Circle,
  ArrowRight, Eye, Zap, AlertTriangle, RefreshCw, Info
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';

// =========================================
// Types matching Cloud Run contract
// =========================================
interface WidthData {
  work_mm: number;
  full_mm: number;
}

interface WidthQuestion {
  type: 'WIDTH_CONFIRM' | 'WIDTH_CHOOSE_VARIANT' | 'WIDTH_MANUAL';
  profile: string;
  suggested?: WidthData;
  suggested_variants?: WidthData[];
  examples?: string[];
  affected_count?: number;
}

interface CoatingColorMapQuestion {
  type: 'COATING_COLOR_MAP';
  coatings: Array<{
    token: string;
    aliases: string[];
    examples?: string[];
    affected_count?: number;
  }>;
  colors: Array<{
    token: string;
    suggested_ral?: string;
    kind?: 'RAL' | 'DECOR';
    aliases?: string[];
    examples?: string[];
    affected_count?: number;
  }>;
}

type NormalizeQuestion = WidthQuestion | CoatingColorMapQuestion;

interface DryRunResponse {
  ok: boolean;
  run_id?: string;
  profile_hash?: string;
  stats?: {
    rows_scanned: number;
    candidates: number;
    patches_ready: number;
    questions: number;
    auto_recognized_colors?: number;
    auto_confirmed_widths?: number;
    sample_mode?: boolean; // True if dry_run was run on sample
    sample_limit?: number; // Number of rows in sample
    total_rows?: number; // Total rows in import (may come from enricher or import_jobs)
  };
  questions?: NormalizeQuestion[];
  error?: string;
  code?: 'TIMEOUT';
  recommended_limit?: number; // Suggested limit for retry
  // totalRows is fetched separately from import_jobs if not in stats
  totalRowsFromJob?: number;
}

interface ApplyStartResponse {
  ok: boolean;
  apply_id?: string;
  error?: string;
  code?: string;
}

interface ApplyStatusResponse {
  ok: boolean;
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
  patched_rows?: number;
  error?: string;
}

interface ApplyResponse {
  ok: boolean;
  patched_rows?: number;
  error?: string;
  code?: string;
  // For async apply
  apply_id?: string;
  status?: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
}

interface StagingRow {
  row_number: number;
  data: Record<string, unknown>;
}

interface NormalizationWizardProps {
  organizationId: string;
  importJobId: string;
  stagingSample: StagingRow[];
  onComplete: (result: { patched_rows?: number }) => void;
  onSkip: () => void;
  autoStart?: boolean;
}

// =========================================
// Sample Mode Banner
// =========================================
function SampleModeBanner({ 
  sampleLimit, 
  totalRows, 
  aiDisabled,
  onEnableAI,
}: { 
  sampleLimit: number;
  totalRows?: number; 
  aiDisabled: boolean;
  onEnableAI?: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Alert variant="default" className="bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800">
      <Info className="h-4 w-4 text-blue-600" />
      <AlertTitle className="text-blue-800 dark:text-blue-300">
        {t('normalize.sampleMode', 'Режим выборки')}
      </AlertTitle>
      <AlertDescription className="text-blue-700 dark:text-blue-400">
        <p>
          {totalRows 
            ? t('normalize.sampleModeDesc', 'Анализ выполнен на {{sample}} из {{total}} строк. Правила применятся ко всем строкам при публикации.', {
                sample: sampleLimit,
                total: totalRows.toLocaleString(),
              })
            : t('normalize.sampleModeDescNoTotal', 'Анализ выполнен на {{sample}} строках. Правила применятся ко всем строкам при публикации.', {
                sample: sampleLimit,
              })
          }
        </p>
        {aiDisabled && (
          <div className="flex items-center gap-2 mt-2">
            <Badge variant="outline" className="text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300">
              {t('normalize.aiDisabledTimeout', 'AI отключен из-за таймаута')}
            </Badge>
            {onEnableAI && (
              <Button variant="link" size="sm" className="text-xs p-0 h-auto" onClick={onEnableAI}>
                {t('normalize.retryWithAI', 'Повторить с AI')}
              </Button>
            )}
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}

// =========================================
// Wizard Steps Indicator
// =========================================
interface WizardStep {
  key: string;
  label: string;
  icon: React.ReactNode;
}

function StepIndicator({ steps, currentStep }: { steps: WizardStep[]; currentStep: string }) {
  const currentIndex = steps.findIndex(s => s.key === currentStep);

  return (
    <div className="flex items-center gap-1">
      {steps.map((step, idx) => {
        const isComplete = idx < currentIndex;
        const isCurrent = step.key === currentStep;

        return (
          <div key={step.key} className="flex items-center">
            <div className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all",
              isComplete && "bg-primary/10 text-primary",
              isCurrent && "bg-primary text-primary-foreground",
              !isComplete && !isCurrent && "bg-muted text-muted-foreground"
            )}>
              {isComplete ? <Check className="h-3 w-3" /> : step.icon}
              <span className="hidden sm:inline">{step.label}</span>
            </div>
            {idx < steps.length - 1 && (
              <ChevronRight className="h-4 w-4 text-muted-foreground mx-1" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// =========================================
// Preview Table Component
// =========================================
interface PreviewChange {
  original: string;
  modified: string;
  field: string;
}

interface PreviewTableProps {
  changes: PreviewChange[];
  title: string;
  affectedCount?: number;
}

function PreviewTable({ changes, title, affectedCount }: PreviewTableProps) {
  const { t } = useTranslation();
  
  if (changes.length === 0) return null;

  return (
    <Card className="border-dashed">
      <CardHeader className="py-3 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">{title}</CardTitle>
          </div>
          {affectedCount && (
            <Badge variant="secondary" className="text-xs">
              {t('normalize.affectsItems', '{{count}} товаров', { count: affectedCount })}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead className="h-8 text-xs">{t('normalize.original', 'Было')}</TableHead>
              <TableHead className="h-8 text-xs w-8"></TableHead>
              <TableHead className="h-8 text-xs">{t('normalize.modified', 'Станет')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {changes.slice(0, 5).map((change, idx) => (
              <TableRow key={idx} className="text-xs">
                <TableCell className="py-2 font-mono text-muted-foreground truncate max-w-[150px]">
                  {change.original}
                </TableCell>
                <TableCell className="py-2 text-center">
                  <ArrowRight className="h-3 w-3 text-primary" />
                </TableCell>
                <TableCell className="py-2">
                  <span className="font-mono bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 px-1 rounded">
                    {change.modified}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// =========================================
// Quick Actions Bar
// =========================================
interface QuickActionsProps {
  onConfirmAll: () => void;
  onSkipAll: () => void;
  confirmedCount: number;
  totalCount: number;
}

function QuickActionsBar({ onConfirmAll, onSkipAll, confirmedCount, totalCount }: QuickActionsProps) {
  const { t } = useTranslation();
  const progress = totalCount > 0 ? (confirmedCount / totalCount) * 100 : 0;

  return (
    <div className="flex items-center justify-between bg-muted/50 rounded-lg px-4 py-2">
      <div className="flex items-center gap-3">
        <div className="text-sm">
          <span className="font-medium">{confirmedCount}</span>
          <span className="text-muted-foreground">/{totalCount}</span>
        </div>
        <Progress value={progress} className="w-20 h-2" />
      </div>
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={onSkipAll} className="text-xs">
          {t('normalize.skipAll', 'Пропустить все')}
        </Button>
        <Button variant="secondary" size="sm" onClick={onConfirmAll} className="text-xs">
          <Zap className="h-3 w-3 mr-1" />
          {t('normalize.confirmAllSuggested', 'Принять все предложения')}
        </Button>
      </div>
    </div>
  );
}

// =========================================
// Main Component
// =========================================
export function NormalizationWizard({
  organizationId,
  importJobId,
  stagingSample,
  onComplete,
  onSkip,
  autoStart = true,
}: NormalizationWizardProps) {
  const { t } = useTranslation();

  // Prevent double dry_run invocation
  const dryRunTriggeredRef = useRef(false);

  // Wizard state
  const [wizardStep, setWizardStep] = useState<'loading' | 'timeout' | 'widths' | 'coatings' | 'applying' | 'done' | 'empty'>('loading');
  
  // dry_run response
  const [runId, setRunId] = useState<string | null>(null);
  const [profileHash, setProfileHash] = useState<string | null>(null);
  const [questions, setQuestions] = useState<NormalizeQuestion[]>([]);
  const [stats, setStats] = useState<DryRunResponse['stats'] | null>(null);
  
  // Total rows from import_jobs (as backup if not returned by enricher)
  const [totalRowsFromJob, setTotalRowsFromJob] = useState<number | null>(null);
  
  // Sample mode and AI flags
  const [sampleLimit, setSampleLimit] = useState<number>(500);
  const [aiEnabled, setAiEnabled] = useState<boolean>(true); // AI ENABLED by default - main value
  const [aiDisabledByTimeout, setAiDisabledByTimeout] = useState<boolean>(false); // True if AI was disabled due to timeout
  const [lastTimeoutLimit, setLastTimeoutLimit] = useState<number | null>(null);
  
  // Fetch total_rows from import_jobs once on mount
  useEffect(() => {
    const fetchTotalRows = async () => {
      const { data } = await supabase
        .from('import_jobs')
        .select('total_rows')
        .eq('id', importJobId)
        .single();
      if (data?.total_rows) {
        setTotalRowsFromJob(data.total_rows);
      }
    };
    fetchTotalRows();
  }, [importJobId]);
  
  // Computed: actual total rows (prefer enricher response, fallback to import_jobs)
  const actualTotalRows = stats?.total_rows || totalRowsFromJob || undefined;

  // User selections
  const [widthSelections, setWidthSelections] = useState<Record<string, WidthData>>({});
  const [coatingConfirmations, setCoatingConfirmations] = useState<Set<string>>(new Set());
  const [ralMappings, setRalMappings] = useState<Record<string, string>>({});

  // Active question for split-screen
  const [activeWidthProfile, setActiveWidthProfile] = useState<string | null>(null);
  const [activeColorToken, setActiveColorToken] = useState<string | null>(null);

  // Filter questions
  const widthQuestions = questions.filter(q => q.type.startsWith('WIDTH_')) as WidthQuestion[];
  const coatingColorMap = questions.find(q => q.type === 'COATING_COLOR_MAP') as CoatingColorMapQuestion | undefined;

  // Set initial active question
  useEffect(() => {
    if (widthQuestions.length > 0 && !activeWidthProfile) {
      setActiveWidthProfile(widthQuestions[0].profile);
    }
  }, [widthQuestions, activeWidthProfile]);

  useEffect(() => {
    if (coatingColorMap?.colors?.length && !activeColorToken) {
      setActiveColorToken(coatingColorMap.colors[0].token);
    }
  }, [coatingColorMap, activeColorToken]);

  // Define wizard steps based on questions
  const getWizardSteps = (): WizardStep[] => {
    const steps: WizardStep[] = [];
    if (widthQuestions.length > 0) {
      steps.push({ key: 'widths', label: t('normalize.widths', 'Ширины'), icon: <Settings2 className="h-3 w-3" /> });
    }
    if (coatingColorMap) {
      steps.push({ key: 'coatings', label: t('normalize.coatings', 'Цвета'), icon: <Palette className="h-3 w-3" /> });
    }
    steps.push({ key: 'applying', label: t('normalize.apply', 'Применение'), icon: <Check className="h-3 w-3" /> });
    return steps;
  };

  // Generate preview changes for current selection
  const generatePreviewChanges = useMemo((): PreviewChange[] => {
    if (wizardStep === 'widths' && activeWidthProfile) {
      const q = widthQuestions.find(w => w.profile === activeWidthProfile);
      const selection = widthSelections[activeWidthProfile];
      if (!q?.examples || !selection) return [];
      
      return q.examples.slice(0, 5).map(ex => ({
        original: ex,
        modified: `${ex} → ${selection.work_mm}/${selection.full_mm}мм`,
        field: 'width',
      }));
    }
    
    if (wizardStep === 'coatings' && activeColorToken && coatingColorMap) {
      const color = coatingColorMap.colors.find(c => c.token === activeColorToken);
      const ral = ralMappings[activeColorToken];
      if (!color?.examples) return [];
      
      return color.examples.slice(0, 5).map(ex => ({
        original: ex,
        modified: ral ? `${ex} → ${ral}` : ex,
        field: 'color',
      }));
    }
    
    return [];
  }, [wizardStep, activeWidthProfile, activeColorToken, widthSelections, ralMappings, widthQuestions, coatingColorMap]);

  // dry_run mutation
  const dryRunMutation = useMutation({
    mutationFn: async (params: { limit: number; ai_suggest: boolean }) => {
      console.log('[NormalizationWizard] Starting dry_run with params:', params);
      
      const { data, error } = await supabase.functions.invoke<DryRunResponse>('import-normalize', {
        body: {
          op: 'dry_run',
          organization_id: organizationId,
          import_job_id: importJobId,
          scope: { only_where_null: true, limit: params.limit },
          ai_suggest: params.ai_suggest,
        },
      });

      if (error) throw new Error(error.message);
      
      // Handle TIMEOUT gracefully
      if (data?.code === 'TIMEOUT') {
        console.warn('[NormalizationWizard] dry_run TIMEOUT, recommended_limit:', data.recommended_limit);
        return { ...data, ok: false };
      }
      
      if (!data?.ok) throw new Error(data?.error || 'Dry run failed');
      
      // LOG FULL RESPONSE FOR DEBUG
      console.log('[NormalizationWizard] dry_run FULL RESPONSE:', JSON.stringify(data, null, 2));
      
      return data;
    },
    onSuccess: (data) => {
      // Handle timeout - show retry UI and DISABLE AI as fallback
      if (data.code === 'TIMEOUT') {
        setLastTimeoutLimit(sampleLimit);
        setAiDisabledByTimeout(true); // Mark AI disabled due to timeout
        setAiEnabled(false); // Disable AI for next retry
        setWizardStep('timeout');
        return;
      }
      
      // Clear timeout-disabled flag on success
      setAiDisabledByTimeout(false);

      // CRITICAL: Store run_id and profile_hash from THIS dry_run
      const newRunId = data.run_id || null;
      const newProfileHash = data.profile_hash || null;
      
      console.log('[NormalizationWizard] Storing run_id:', newRunId, 'profile_hash:', newProfileHash);
      
      setRunId(newRunId);
      setProfileHash(newProfileHash);
      setQuestions(data.questions || []);
      setStats(data.stats || null);

      // Pre-fill WIDTH_CONFIRM with suggested values
      const initialWidths: Record<string, WidthData> = {};
      (data.questions || []).forEach(q => {
        if (q.type === 'WIDTH_CONFIRM' && (q as WidthQuestion).suggested) {
          initialWidths[(q as WidthQuestion).profile] = (q as WidthQuestion).suggested!;
        }
      });
      setWidthSelections(initialWidths);

      // Pre-fill RAL mappings from suggestions
      const ccMap = (data.questions || []).find(q => q.type === 'COATING_COLOR_MAP') as CoatingColorMapQuestion | undefined;
      if (ccMap) {
        const initialRal: Record<string, string> = {};
        ccMap.colors?.forEach(c => {
          if (c.suggested_ral) {
            initialRal[c.token] = c.suggested_ral;
          }
        });
        setRalMappings(initialRal);
      }

      // Determine first step
      const hasWidths = (data.questions || []).some(q => q.type.startsWith('WIDTH_'));
      const hasCoatings = (data.questions || []).some(q => q.type === 'COATING_COLOR_MAP');

      if (!hasWidths && !hasCoatings) {
        setWizardStep('empty');
      } else if (hasWidths) {
        setWizardStep('widths');
      } else {
        setWizardStep('coatings');
      }
    },
    onError: (error) => {
      console.error('[NormalizationWizard] dry_run error:', error);
      toast({
        title: t('common.error'),
        description: error.message,
        variant: 'destructive',
      });
      onSkip();
    },
  });

  // Run dry_run ONCE on mount (with ref guard)
  useEffect(() => {
    if (dryRunTriggeredRef.current) {
      console.log('[NormalizationWizard] dry_run already triggered, skipping');
      return;
    }
    dryRunTriggeredRef.current = true;
    console.log('[NormalizationWizard] Triggering initial dry_run');
    dryRunMutation.mutate({ limit: sampleLimit, ai_suggest: aiEnabled });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Retry dry_run with different params
  const handleRetryDryRun = useCallback((newLimit: number, enableAI: boolean) => {
    console.log('[NormalizationWizard] Retrying dry_run with limit:', newLimit, 'ai:', enableAI);
    setSampleLimit(newLimit);
    setAiEnabled(enableAI);
    setWizardStep('loading');
    dryRunMutation.mutate({ limit: newLimit, ai_suggest: enableAI });
  }, [dryRunMutation]);

  // Save settings via settings-merge
  const saveSettingsMutation = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const { data, error } = await supabase.functions.invoke('settings-merge', {
        body: {
          organization_id: organizationId,
          patch,
        },
      });

      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || 'Failed to save settings');
      return data;
    },
  });

  // Poll apply status helper
  const pollApplyStatus = async (applyId: string, maxAttempts = 60): Promise<ApplyStatusResponse> => {
    for (let i = 0; i < maxAttempts; i++) {
      const { data, error } = await supabase.functions.invoke<ApplyStatusResponse>('import-normalize', {
        body: {
          op: 'apply_status',
          organization_id: organizationId,
          import_job_id: importJobId,
          apply_id: applyId,
        },
      });
      
      if (error) {
        console.error('[NormalizationWizard] apply_status error:', error);
        throw new Error(error.message);
      }
      
      console.log('[NormalizationWizard] apply_status:', data?.status, 'attempt:', i + 1);
      
      if (data?.status === 'DONE') {
        return data;
      }
      
      if (data?.status === 'FAILED') {
        throw new Error(data.error || 'Apply failed');
      }
      
      // Wait 2 seconds before next poll
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    throw new Error('Apply timeout - took too long');
  };

  // Apply normalization with async polling
  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!runId || !profileHash) {
        throw new Error('Missing run_id or profile_hash');
      }

      // DIAGNOSTIC LOG - verify we're using the correct run_id
      console.log('[NormalizationWizard] APPLY - Using state values:');
      console.log('  runId:', runId);
      console.log('  profileHash:', profileHash);
      console.log('  importJobId:', importJobId);

      // Start async apply
      const { data: startData, error: startError } = await supabase.functions.invoke<ApplyResponse>('import-normalize', {
        body: {
          op: 'apply',
          organization_id: organizationId,
          import_job_id: importJobId,
          run_id: runId,
          profile_hash: profileHash,
        },
      });

      if (startError) throw new Error(startError.message);
      
      // Handle 409 mismatch - need to re-run dry_run
      if (!startData?.ok && startData?.error?.includes('mismatch')) {
        console.warn('[NormalizationWizard] 409 run_id mismatch detected');
        return { ok: false, code: 'MISMATCH', error: startData.error };
      }
      
      // If apply returns immediately (sync mode or small dataset), use the result directly
      if (startData?.ok && startData?.patched_rows !== undefined) {
        console.log('[NormalizationWizard] Apply completed synchronously, patched_rows:', startData.patched_rows);
        return startData;
      }
      
      // If we got an apply_id, poll for completion (async mode)
      if (startData?.apply_id) {
        console.log('[NormalizationWizard] Apply started async, apply_id:', startData.apply_id);
        const statusResult = await pollApplyStatus(startData.apply_id);
        return { ok: true, patched_rows: statusResult.patched_rows };
      }
      
      if (!startData?.ok) throw new Error(startData?.error || 'Apply failed');
      return startData;
    },
    onSuccess: (data) => {
      // Handle mismatch - need fresh dry_run
      if (data.code === 'MISMATCH') {
        toast({
          title: t('normalize.mismatchTitle', 'Данные устарели'),
          description: t('normalize.mismatchDesc', 'Нужно перезапустить анализ. Нажмите "Повторить анализ".'),
          variant: 'destructive',
        });
        return;
      }
      
      setWizardStep('done');
      toast({
        title: t('normalize.applied', 'Нормализация применена'),
        description: t('normalize.patchedRows', 'Обновлено строк: {{count}}', { count: data.patched_rows || 0 }),
      });
    },
    onError: (error) => {
      console.error('[NormalizationWizard] apply error:', error);
      toast({
        title: t('common.error'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Handle mismatch - re-run dry_run and reset applyMutation state
  const handleMismatchRetry = useCallback(async () => {
    console.log('[NormalizationWizard] Handling mismatch - re-running dry_run');
    
    // Reset apply mutation state to clear the "data outdated" error state
    applyMutation.reset();
    
    setWizardStep('loading');
    
    // Re-run dry_run
    dryRunMutation.mutate({ limit: sampleLimit, ai_suggest: aiEnabled });
  }, [dryRunMutation, sampleLimit, aiEnabled, applyMutation]);

  const handleSaveWidths = async () => {
    try {
      await saveSettingsMutation.mutateAsync({
        pricing: {
          widths_selected: widthSelections,
        },
      });
      
      if (coatingColorMap) {
        setWizardStep('coatings');
      } else {
        setWizardStep('applying');
      }
    } catch {
      // Error handled in mutation
    }
  };

  const handleSaveCoatings = async () => {
    try {
      const coatingsPatch: Record<string, string[]> = {};
      coatingColorMap?.coatings?.forEach(c => {
        if (coatingConfirmations.has(c.token)) {
          coatingsPatch[c.token] = c.aliases || [];
        }
      });

      await saveSettingsMutation.mutateAsync({
        pricing: {
          coatings: coatingsPatch,
          colors: {
            ral_aliases: ralMappings,
          },
        },
      });
      setWizardStep('applying');
    } catch {
      // Error handled in mutation
    }
  };

  const handleApply = () => {
    applyMutation.mutate();
  };

  const handleWidthVariantSelect = (profile: string, variant: WidthData) => {
    setWidthSelections(prev => ({ ...prev, [profile]: variant }));
  };

  const handleWidthManualInput = (profile: string, field: 'work_mm' | 'full_mm', value: number) => {
    setWidthSelections(prev => ({
      ...prev,
      [profile]: {
        work_mm: prev[profile]?.work_mm || 0,
        full_mm: prev[profile]?.full_mm || 0,
        [field]: value,
      },
    }));
  };

  const confirmAllWidths = () => {
    const newSelections: Record<string, WidthData> = { ...widthSelections };
    widthQuestions.forEach(q => {
      if (q.type === 'WIDTH_CONFIRM' && q.suggested) {
        newSelections[q.profile] = q.suggested;
      } else if (q.type === 'WIDTH_CHOOSE_VARIANT' && q.suggested_variants?.[0]) {
        newSelections[q.profile] = q.suggested_variants[0];
      }
    });
    setWidthSelections(newSelections);
  };

  const confirmAllColors = () => {
    const newMappings: Record<string, string> = { ...ralMappings };
    coatingColorMap?.colors?.forEach(c => {
      if (c.suggested_ral) {
        newMappings[c.token] = c.suggested_ral;
      }
    });
    setRalMappings(newMappings);
    
    const newConfirmations = new Set(coatingConfirmations);
    coatingColorMap?.coatings?.forEach(c => newConfirmations.add(c.token));
    setCoatingConfirmations(newConfirmations);
  };

  const wizardSteps = getWizardSteps();

  // =========================================
  // Render: Loading
  // =========================================
  if (wizardStep === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
        <h3 className="text-lg font-semibold mb-2">
          {t('normalize.analyzing', 'Анализ данных...')}
        </h3>
        <p className="text-muted-foreground text-sm">
          {aiEnabled 
            ? t('normalize.analyzingDescAI', 'AI проверяет ширины профилей и покрытия')
            : t('normalize.analyzingDescFast', 'Быстрый анализ ({{limit}} строк)', { limit: sampleLimit })
          }
        </p>
      </div>
    );
  }

  // =========================================
  // Render: Timeout - Retry UI
  // =========================================
  if (wizardStep === 'timeout') {
    return (
      <div className="space-y-6 py-6">
        <div className="text-center">
          <AlertTriangle className="h-12 w-12 mx-auto text-yellow-500 mb-4" />
          <h3 className="text-xl font-semibold mb-2">
            {t('normalize.timeoutTitle', 'Превышено время ожидания')}
          </h3>
          <p className="text-muted-foreground max-w-md mx-auto">
            {t('normalize.timeoutDesc', 'Анализ занял слишком много времени. Попробуйте уменьшить размер выборки.')}
          </p>
        </div>

        <Card className="max-w-md mx-auto">
          <CardContent className="py-6 space-y-4">
            <div className="text-center text-sm text-muted-foreground">
              {t('normalize.lastAttempt', 'Последняя попытка')}: {lastTimeoutLimit} {t('normalize.rows', 'строк')}
            </div>
            
            {/* AI disabled notice */}
            <Alert variant="default" className="bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200">
              <AlertTriangle className="h-4 w-4 text-yellow-600" />
              <AlertDescription className="text-sm text-yellow-800 dark:text-yellow-300">
                {t('normalize.aiDisabledTimeout', 'AI отключен из-за таймаута')}
              </AlertDescription>
            </Alert>
            
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                onClick={() => handleRetryDryRun(250, false)}
                className="flex flex-col items-center py-4 h-auto"
              >
                <RefreshCw className="h-5 w-5 mb-1" />
                <span className="font-medium">250 {t('normalize.rows', 'строк')}</span>
                <span className="text-xs text-muted-foreground">{t('normalize.fastest', 'Быстрее всего')}</span>
              </Button>
              
              <Button
                variant="outline"
                onClick={() => handleRetryDryRun(500, false)}
                className="flex flex-col items-center py-4 h-auto"
              >
                <RefreshCw className="h-5 w-5 mb-1" />
                <span className="font-medium">500 {t('normalize.rows', 'строк')}</span>
                <span className="text-xs text-muted-foreground">{t('normalize.recommended', 'Рекомендуется')}</span>
              </Button>
            </div>

            {/* Option to retry with AI enabled */}
            <Button
              variant="secondary"
              onClick={() => handleRetryDryRun(250, true)}
              className="w-full"
            >
              <Sparkles className="h-4 w-4 mr-2" />
              {t('normalize.retryWithAI', 'Повторить с AI')} (250 {t('normalize.rows', 'строк')})
            </Button>

            <Separator />

            <div className="flex justify-center">
              <Button variant="ghost" onClick={onSkip}>
                {t('normalize.skipNormalization', 'Пропустить нормализацию')}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // =========================================
  // Render: Empty (no questions)
  // =========================================
  if (wizardStep === 'empty') {
    return (
      <div className="space-y-6 py-6">
        <div className="text-center">
          <CheckCircle2 className="h-14 w-14 mx-auto text-green-600 mb-4" />
          <h3 className="text-xl font-semibold mb-2">
            {t('normalize.noQuestionsTitle', 'Нормализация не требуется')}
          </h3>
          <p className="text-muted-foreground max-w-md mx-auto">
            {t('normalize.noQuestionsDesc', 'AI автоматически распознал все данные. Можно продолжить к публикации.')}
          </p>
        </div>

        {stats && (
          <Card className="max-w-md mx-auto">
            <CardContent className="py-4">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-2xl font-bold text-primary">{stats.rows_scanned}</p>
                  <p className="text-xs text-muted-foreground">{t('normalize.scanned', 'Проверено')}</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-green-600">{stats.auto_recognized_colors || 0}</p>
                  <p className="text-xs text-muted-foreground">{t('normalize.autoColors', 'Цветов')}</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-green-600">{stats.auto_confirmed_widths || 0}</p>
                  <p className="text-xs text-muted-foreground">{t('normalize.autoWidths', 'Ширин')}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex justify-center">
          <Button size="lg" onClick={() => onComplete({})}>
            <ChevronRight className="h-4 w-4 mr-2" />
            {t('normalize.continuePublish', 'Продолжить к публикации')}
          </Button>
        </div>
      </div>
    );
  }

  // =========================================
  // Render: Widths Step (Split Screen)
  // =========================================
  if (wizardStep === 'widths') {
    const activeQuestion = widthQuestions.find(q => q.profile === activeWidthProfile);
    const confirmedCount = Object.keys(widthSelections).length;

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <StepIndicator steps={wizardSteps} currentStep="widths" />
          <Badge variant="outline">
            {widthQuestions.length} {t('normalize.profiles', 'профилей')}
          </Badge>
        </div>

        {/* Sample mode banner */}
        <SampleModeBanner
          sampleLimit={sampleLimit}
          totalRows={actualTotalRows}
          aiDisabled={aiDisabledByTimeout}
          onEnableAI={() => handleRetryDryRun(sampleLimit, true)}
        />

        <QuickActionsBar
          onConfirmAll={confirmAllWidths}
          onSkipAll={onSkip}
          confirmedCount={confirmedCount}
          totalCount={widthQuestions.length}
        />

        {/* Split Screen Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left: Question List */}
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Settings2 className="h-4 w-4" />
                {t('normalize.widthProfiles', 'Профили и ширины')}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[300px]">
                <div className="divide-y">
                  {widthQuestions.map((q) => {
                    const isActive = activeWidthProfile === q.profile;
                    const isConfirmed = !!widthSelections[q.profile];
                    
                    return (
                      <div
                        key={q.profile}
                        className={cn(
                          "flex items-center justify-between px-4 py-3 cursor-pointer transition-colors",
                          isActive && "bg-primary/5 border-l-2 border-primary",
                          !isActive && "hover:bg-muted/50"
                        )}
                        onClick={() => setActiveWidthProfile(q.profile)}
                      >
                        <div className="flex items-center gap-3">
                          {isConfirmed ? (
                            <CheckCircle2 className="h-5 w-5 text-primary" />
                          ) : (
                            <Circle className="h-5 w-5 text-muted-foreground" />
                          )}
                          <div>
                            <p className="font-medium">{q.profile}</p>
                            <p className="text-xs text-muted-foreground">
                              {q.type === 'WIDTH_CONFIRM' ? t('normalize.autoDetected', 'Авто') : 
                               q.type === 'WIDTH_CHOOSE_VARIANT' ? t('normalize.chooseVariant', 'Выбор') :
                               t('normalize.manual', 'Вручную')}
                              {q.affected_count && ` • ${q.affected_count} товаров`}
                            </p>
                          </div>
                        </div>
                        {isConfirmed && widthSelections[q.profile] && (
                          <Badge variant="secondary" className="text-xs">
                            {widthSelections[q.profile].work_mm}/{widthSelections[q.profile].full_mm}
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Right: Active Question Details + Preview */}
          <div className="space-y-4">
            {activeQuestion && (
              <Card>
                <CardHeader className="py-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{activeQuestion.profile}</CardTitle>
                    <Badge>
                      {activeQuestion.type === 'WIDTH_CONFIRM' ? t('normalize.autoDetected', 'AI предложение') : 
                       activeQuestion.type === 'WIDTH_CHOOSE_VARIANT' ? t('normalize.multipleOptions', 'Несколько вариантов') :
                       t('normalize.manualEntry', 'Ввод вручную')}
                    </Badge>
                  </div>
                  <CardDescription>
                    {t('normalize.foundPattern')} {activeQuestion.affected_count || '—'} {t('normalize.items')}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* WIDTH_CONFIRM */}
                  {activeQuestion.type === 'WIDTH_CONFIRM' && activeQuestion.suggested && (
                    <div className="flex gap-4 bg-primary/5 rounded-lg p-4">
                      <div className="flex-1">
                        <Label className="text-xs text-muted-foreground">{t('normalize.workWidth', 'Рабочая')}</Label>
                        <p className="text-2xl font-bold">{activeQuestion.suggested.work_mm}</p>
                        <p className="text-xs text-muted-foreground">мм</p>
                      </div>
                      <div className="flex-1">
                        <Label className="text-xs text-muted-foreground">{t('normalize.fullWidth', 'Полная')}</Label>
                        <p className="text-2xl font-bold">{activeQuestion.suggested.full_mm}</p>
                        <p className="text-xs text-muted-foreground">мм</p>
                      </div>
                      <Button 
                        variant={widthSelections[activeQuestion.profile] ? "secondary" : "default"}
                        className="self-center"
                        onClick={() => handleWidthVariantSelect(activeQuestion.profile, activeQuestion.suggested!)}
                      >
                        {widthSelections[activeQuestion.profile] ? <Check className="h-4 w-4" /> : t('common.confirm', 'Подтвердить')}
                      </Button>
                    </div>
                  )}

                  {/* WIDTH_CHOOSE_VARIANT */}
                  {activeQuestion.type === 'WIDTH_CHOOSE_VARIANT' && activeQuestion.suggested_variants && (
                    <RadioGroup
                      value={widthSelections[activeQuestion.profile] ? JSON.stringify(widthSelections[activeQuestion.profile]) : ''}
                      onValueChange={(val) => handleWidthVariantSelect(activeQuestion.profile, JSON.parse(val))}
                      className="space-y-2"
                    >
                      {activeQuestion.suggested_variants.map((v, vi) => (
                        <div key={vi} className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-muted/50">
                          <RadioGroupItem value={JSON.stringify(v)} id={`${activeQuestion.profile}-${vi}`} />
                          <Label htmlFor={`${activeQuestion.profile}-${vi}`} className="flex-1 cursor-pointer">
                            <span className="font-semibold text-lg">{v.work_mm}</span>
                            <span className="text-muted-foreground mx-2">/</span>
                            <span className="font-semibold text-lg">{v.full_mm}</span>
                            <span className="text-muted-foreground ml-1">мм</span>
                          </Label>
                        </div>
                      ))}
                    </RadioGroup>
                  )}

                  {/* WIDTH_MANUAL */}
                  {activeQuestion.type === 'WIDTH_MANUAL' && (
                    <div className="flex gap-4">
                      <div className="flex-1">
                        <Label>{t('normalize.workWidth', 'Рабочая (мм)')}</Label>
                        <Input
                          type="number"
                          placeholder="1000"
                          value={widthSelections[activeQuestion.profile]?.work_mm || ''}
                          onChange={(e) => handleWidthManualInput(activeQuestion.profile, 'work_mm', Number(e.target.value))}
                        />
                      </div>
                      <div className="flex-1">
                        <Label>{t('normalize.fullWidth', 'Полная (мм)')}</Label>
                        <Input
                          type="number"
                          placeholder="1051"
                          value={widthSelections[activeQuestion.profile]?.full_mm || ''}
                          onChange={(e) => handleWidthManualInput(activeQuestion.profile, 'full_mm', Number(e.target.value))}
                        />
                      </div>
                    </div>
                  )}

                  {/* Examples */}
                  {activeQuestion.examples && activeQuestion.examples.length > 0 && (
                    <div className="pt-2">
                      <p className="text-xs font-medium text-muted-foreground mb-2">
                        {t('normalize.examplesFromFile', 'Примеры из файла:')}
                      </p>
                      <div className="font-mono text-xs bg-muted p-2 rounded space-y-1 max-h-20 overflow-auto">
                        {activeQuestion.examples.slice(0, 5).map((ex, i) => (
                          <div key={i} className="truncate">{ex}</div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Preview Table */}
            <PreviewTable 
              changes={generatePreviewChanges}
              title={t('normalize.previewChanges', 'Предпросмотр изменений')}
              affectedCount={activeQuestion?.affected_count}
            />
          </div>
        </div>

        <Separator />

        <div className="flex justify-between">
          <Button variant="ghost" onClick={onSkip}>
            {t('common.skip', 'Пропустить')}
          </Button>
          <Button onClick={handleSaveWidths} disabled={saveSettingsMutation.isPending}>
            {saveSettingsMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            <Save className="h-4 w-4 mr-2" />
            {t('normalize.saveAndContinue', 'Сохранить и продолжить')}
          </Button>
        </div>
      </div>
    );
  }

  // =========================================
  // Render: Coatings Step (Split Screen)
  // =========================================
  if (wizardStep === 'coatings') {
    const activeColor = coatingColorMap?.colors?.find(c => c.token === activeColorToken);
    const totalItems = (coatingColorMap?.coatings?.length || 0) + (coatingColorMap?.colors?.length || 0);
    const confirmedCount = coatingConfirmations.size + Object.keys(ralMappings).length;

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <StepIndicator steps={wizardSteps} currentStep="coatings" />
          <Badge variant="outline">
            {totalItems} {t('normalize.items', 'элементов')}
          </Badge>
        </div>

        {/* Sample mode banner */}
        <SampleModeBanner
          sampleLimit={sampleLimit}
          totalRows={actualTotalRows}
          aiDisabled={aiDisabledByTimeout}
          onEnableAI={() => handleRetryDryRun(sampleLimit, true)}
        />

        <QuickActionsBar
          onConfirmAll={confirmAllColors}
          onSkipAll={onSkip}
          confirmedCount={confirmedCount}
          totalCount={totalItems}
        />

        {/* Split Screen Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left: Colors List */}
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Palette className="h-4 w-4" />
                {t('normalize.colorsAndCoatings', 'Цвета и покрытия')}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[300px]">
                <div className="divide-y">
                  {/* Colors */}
                  {coatingColorMap?.colors?.map((color) => {
                    const isActive = activeColorToken === color.token;
                    const isConfirmed = !!ralMappings[color.token];
                    
                    return (
                      <div
                        key={color.token}
                        className={cn(
                          "flex items-center justify-between px-4 py-3 cursor-pointer transition-colors",
                          isActive && "bg-primary/5 border-l-2 border-primary",
                          !isActive && "hover:bg-muted/50"
                        )}
                        onClick={() => setActiveColorToken(color.token)}
                      >
                        <div className="flex items-center gap-3">
                          {isConfirmed ? (
                            <CheckCircle2 className="h-5 w-5 text-primary" />
                          ) : (
                            <Circle className="h-5 w-5 text-muted-foreground" />
                          )}
                          <div>
                            <p className="font-medium">{color.token}</p>
                            <p className="text-xs text-muted-foreground">
                              {color.kind === 'DECOR' ? 'Декор' : 'RAL'}
                              {color.affected_count && ` • ${color.affected_count} товаров`}
                            </p>
                          </div>
                        </div>
                        {isConfirmed && (
                          <Badge variant="secondary" className="text-xs">
                            {ralMappings[color.token]}
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Right: Active Color Details + Preview */}
          <div className="space-y-4">
            {activeColor && (
              <Card>
                <CardHeader className="py-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg flex items-center gap-2">
                      {activeColor.token}
                      {activeColor.kind === 'DECOR' && (
                        <Badge variant="outline">Декор</Badge>
                      )}
                    </CardTitle>
                  </div>
                  <CardDescription>
                    {t('normalize.foundColorPattern')} {activeColor.affected_count || '—'} {t('normalize.items')}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {activeColor.suggested_ral && (
                    <div className="flex items-center gap-4">
                      <div className="flex-1">
                        <Label className="text-xs text-muted-foreground">
                          {t('normalize.suggestedRal', 'AI предлагает')}
                        </Label>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="default" className="text-lg px-3 py-1">
                            {activeColor.suggested_ral}
                          </Badge>
                          <Button
                            size="sm"
                            variant={ralMappings[activeColor.token] === activeColor.suggested_ral ? "secondary" : "outline"}
                            onClick={() => setRalMappings(prev => ({ ...prev, [activeColor.token]: activeColor.suggested_ral! }))}
                          >
                            {ralMappings[activeColor.token] === activeColor.suggested_ral ? (
                              <Check className="h-4 w-4" />
                            ) : (
                              t('common.confirm', 'Подтвердить')
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  <div>
                    <Label>{t('normalize.orEnterRal', 'Или введите RAL вручную')}</Label>
                    <Input
                      placeholder="RAL 6005"
                      value={ralMappings[activeColor.token] || ''}
                      onChange={(e) => setRalMappings(prev => ({ ...prev, [activeColor.token]: e.target.value }))}
                      className="mt-1"
                    />
                  </div>

                  {activeColor.aliases && activeColor.aliases.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-2">
                        {t('normalize.detectedAliases', 'Найденные варианты написания:')}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {activeColor.aliases.map((alias, i) => (
                          <Badge key={i} variant="outline" className="text-xs">
                            {alias}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {activeColor.examples && activeColor.examples.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-2">
                        {t('normalize.examplesFromFile', 'Примеры из файла:')}
                      </p>
                      <div className="font-mono text-xs bg-muted p-2 rounded space-y-1 max-h-20 overflow-auto">
                        {activeColor.examples.slice(0, 5).map((ex, i) => (
                          <div key={i} className="truncate">{ex}</div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Preview Table */}
            <PreviewTable 
              changes={generatePreviewChanges}
              title={t('normalize.previewChanges', 'Предпросмотр изменений')}
              affectedCount={activeColor?.affected_count}
            />
          </div>
        </div>

        <Separator />

        <div className="flex justify-between">
          <Button variant="ghost" onClick={onSkip}>
            {t('common.skip', 'Пропустить')}
          </Button>
          <Button onClick={handleSaveCoatings} disabled={saveSettingsMutation.isPending}>
            {saveSettingsMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            <Save className="h-4 w-4 mr-2" />
            {t('normalize.saveAndContinue', 'Сохранить и продолжить')}
          </Button>
        </div>
      </div>
    );
  }

  // =========================================
  // Render: Applying Step
  // =========================================
  if (wizardStep === 'applying') {
    const hasMismatch = applyMutation.data?.code === 'MISMATCH';

    return (
      <div className="space-y-6">
        <StepIndicator steps={wizardSteps} currentStep="applying" />

        {hasMismatch && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{t('normalize.mismatchTitle', 'Данные устарели')}</AlertTitle>
            <AlertDescription>
              {t('normalize.mismatchDesc', 'Между анализом и применением были изменения. Нужно перезапустить анализ.')}
              <Button 
                variant="outline" 
                size="sm" 
                className="mt-2"
                onClick={handleMismatchRetry}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('normalize.rerunAnalysis', 'Перезапустить анализ')}
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <div className="text-center py-6">
          <Sparkles className="h-12 w-12 mx-auto text-primary mb-4" />
          <h3 className="text-xl font-semibold mb-2">
            {t('normalize.readyToApply', 'Готово к применению')}
          </h3>
          <p className="text-muted-foreground max-w-md mx-auto">
            {t('normalize.applyDesc', 'Настройки сохранены. Нажмите "Применить" чтобы обновить каталог.')}
          </p>
        </div>

        {stats && (
          <Card className="max-w-lg mx-auto">
            <CardContent className="py-6">
              <div className="grid grid-cols-3 gap-6 text-center">
                <div>
                  <p className="text-3xl font-bold text-primary">{stats.rows_scanned}</p>
                  <p className="text-xs text-muted-foreground mt-1">{t('normalize.scanned', 'Проверено')}</p>
                </div>
                <div>
                  <p className="text-3xl font-bold text-green-600">{stats.patches_ready || 0}</p>
                  <p className="text-xs text-muted-foreground mt-1">{t('normalize.toUpdate', 'К обновлению')}</p>
                </div>
                <div>
                  <p className="text-3xl font-bold">{Object.keys(widthSelections).length + Object.keys(ralMappings).length}</p>
                  <p className="text-xs text-muted-foreground mt-1">{t('normalize.confirmed', 'Подтверждено')}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex gap-3 justify-center">
          <Button variant="outline" onClick={onSkip}>
            {t('normalize.skipApply', 'Пропустить')}
          </Button>
          <Button 
            size="lg" 
            onClick={handleApply} 
            disabled={applyMutation.isPending || hasMismatch}
          >
            {applyMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Check className="h-4 w-4 mr-2" />
            )}
            {t('normalize.applyToCatalog', 'Применить в каталог')}
          </Button>
        </div>
      </div>
    );
  }

  // =========================================
  // Render: Done
  // =========================================
  if (wizardStep === 'done') {
    return (
      <div className="space-y-6 py-6">
        <div className="text-center">
          <CheckCircle2 className="h-16 w-16 mx-auto text-green-600 mb-4" />
          <h3 className="text-xl font-semibold mb-2">
            {t('normalize.complete', 'Нормализация завершена')}
          </h3>
          <p className="text-muted-foreground">
            {t('normalize.continueToPublish', 'Теперь можно опубликовать каталог.')}
          </p>
        </div>

        <div className="flex justify-center">
          <Button size="lg" onClick={() => onComplete({ patched_rows: applyMutation.data?.patched_rows })}>
            <ChevronRight className="h-4 w-4 mr-2" />
            {t('normalize.publishCatalog', 'Перейти к публикации')}
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
