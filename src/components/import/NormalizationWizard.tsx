import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { 
  Loader2, Check, ChevronRight, ChevronDown, 
  Sparkles, Settings2, Palette, Save, CheckCircle2, Circle
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

// =========================================
// CONFIGURATION: UI Detail Level
// =========================================
type UIDetailLevel = 'minimal' | 'medium' | 'advanced';
const UI_DETAIL_LEVEL: UIDetailLevel = 'medium';

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
}

interface CoatingColorMapQuestion {
  type: 'COATING_COLOR_MAP';
  coatings: Array<{
    token: string;
    aliases: string[];
    examples?: string[];
  }>;
  colors: Array<{
    token: string;
    suggested_ral?: string;
    kind?: 'RAL' | 'DECOR';
    aliases?: string[];
    examples?: string[];
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
  };
  questions?: NormalizeQuestion[];
  error?: string;
}

interface ApplyResponse {
  ok: boolean;
  patched_rows?: number;
  error?: string;
}

interface StagingRow {
  row_number: number;
  data: Record<string, unknown>;
}

interface NormalizationWizardProps {
  organizationId: string;
  importJobId: string;
  stagingSample: StagingRow[];
  onComplete: () => void;
  onSkip: () => void;
}

// =========================================
// Wizard Steps Component
// =========================================
interface WizardStep {
  key: string;
  label: string;
  icon: React.ReactNode;
}

function StepIndicator({ steps, currentStep }: { steps: WizardStep[]; currentStep: string }) {
  const currentIndex = steps.findIndex(s => s.key === currentStep);
  const progress = currentIndex >= 0 ? ((currentIndex) / (steps.length - 1)) * 100 : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-2">
        {steps.map((step, idx) => {
          const isComplete = idx < currentIndex;
          const isCurrent = step.key === currentStep;
          const isPending = idx > currentIndex;

          return (
            <div key={step.key} className="flex items-center gap-2">
              <div className={cn(
                "flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium transition-colors",
                isComplete && "bg-primary text-primary-foreground",
                isCurrent && "bg-primary/20 text-primary border-2 border-primary",
                isPending && "bg-muted text-muted-foreground"
              )}>
                {isComplete ? <Check className="h-4 w-4" /> : idx + 1}
              </div>
              <span className={cn(
                "text-sm hidden sm:inline",
                isCurrent && "font-medium text-foreground",
                !isCurrent && "text-muted-foreground"
              )}>
                {step.label}
              </span>
              {idx < steps.length - 1 && (
                <div className="hidden sm:block w-8 h-px bg-border mx-2" />
              )}
            </div>
          );
        })}
      </div>
      <Progress value={progress} className="h-1" />
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
}: NormalizationWizardProps) {
  const { t } = useTranslation();

  // Wizard state
  const [wizardStep, setWizardStep] = useState<'loading' | 'widths' | 'coatings' | 'applying' | 'done' | 'empty'>('loading');
  
  // dry_run response
  const [runId, setRunId] = useState<string | null>(null);
  const [profileHash, setProfileHash] = useState<string | null>(null);
  const [questions, setQuestions] = useState<NormalizeQuestion[]>([]);
  const [stats, setStats] = useState<DryRunResponse['stats'] | null>(null);

  // User selections
  const [widthSelections, setWidthSelections] = useState<Record<string, WidthData>>({});
  const [coatingConfirmations, setCoatingConfirmations] = useState<Set<string>>(new Set());
  const [ralMappings, setRalMappings] = useState<Record<string, string>>({});

  // Expanded sections
  const [expandedProfiles, setExpandedProfiles] = useState<Set<string>>(new Set());

  // Filter questions
  const widthQuestions = questions.filter(q => q.type.startsWith('WIDTH_')) as WidthQuestion[];
  const coatingColorMap = questions.find(q => q.type === 'COATING_COLOR_MAP') as CoatingColorMapQuestion | undefined;

  // Define wizard steps based on questions
  const getWizardSteps = (): WizardStep[] => {
    const steps: WizardStep[] = [];
    if (widthQuestions.length > 0) {
      steps.push({ key: 'widths', label: t('import.widthsStep', 'Ширины'), icon: <Settings2 className="h-4 w-4" /> });
    }
    if (coatingColorMap) {
      steps.push({ key: 'coatings', label: t('import.coatingsStep', 'Покрытия'), icon: <Palette className="h-4 w-4" /> });
    }
    steps.push({ key: 'applying', label: t('import.applyStep', 'Применение'), icon: <Check className="h-4 w-4" /> });
    return steps;
  };

  // Auto-run dry_run on mount
  const dryRunMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<DryRunResponse>('import-normalize', {
        body: {
          op: 'dry_run',
          organization_id: organizationId,
          import_job_id: importJobId,
          scope: { only_where_null: true, limit: 5000 },
          ai_suggest: true,
        },
      });

      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || 'Dry run failed');
      return data;
    },
    onSuccess: (data) => {
      setRunId(data.run_id || null);
      setProfileHash(data.profile_hash || null);
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
        // No questions - show empty state with option to proceed
        setWizardStep('empty');
      } else if (hasWidths) {
        setWizardStep('widths');
      } else {
        setWizardStep('coatings');
      }
    },
    onError: (error) => {
      toast({
        title: t('common.error'),
        description: error.message,
        variant: 'destructive',
      });
      // On error, allow skipping
      onSkip();
    },
  });

  // Run dry_run automatically on mount
  useEffect(() => {
    dryRunMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Apply normalization
  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!runId || !profileHash) {
        throw new Error('Missing run_id or profile_hash');
      }

      const { data, error } = await supabase.functions.invoke<ApplyResponse>('import-normalize', {
        body: {
          op: 'apply',
          organization_id: organizationId,
          import_job_id: importJobId,
          run_id: runId,
          profile_hash: profileHash,
        },
      });

      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || 'Apply failed');
      return data;
    },
    onSuccess: (data) => {
      setWizardStep('done');
      toast({
        title: t('import.normalizationApplied', 'Нормализация применена'),
        description: t('import.patchedRows', 'Обновлено строк: {{count}}', { count: data.patched_rows || 0 }),
      });
    },
    onError: (error) => {
      toast({
        title: t('common.error'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleSaveWidths = async () => {
    try {
      await saveSettingsMutation.mutateAsync({
        pricing: {
          widths_selected: widthSelections,
        },
      });
      
      // Move to coatings if available, else to applying
      if (coatingColorMap) {
        setWizardStep('coatings');
      } else {
        setWizardStep('applying');
      }
    } catch (error) {
      // Error handled in mutation
    }
  };

  const handleSaveCoatings = async () => {
    try {
      // Build coatings patch
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
    } catch (error) {
      // Error handled in mutation
    }
  };

  const handleApply = () => {
    applyMutation.mutate();
  };

  const toggleProfileExpanded = (profile: string) => {
    setExpandedProfiles(prev => {
      const newSet = new Set(prev);
      if (newSet.has(profile)) {
        newSet.delete(profile);
      } else {
        newSet.add(profile);
      }
      return newSet;
    });
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

  const toggleCoatingConfirmation = (token: string) => {
    setCoatingConfirmations(prev => {
      const newSet = new Set(prev);
      if (newSet.has(token)) {
        newSet.delete(token);
      } else {
        newSet.add(token);
      }
      return newSet;
    });
  };

  // =========================================
  // Render: Loading
  // =========================================
  if (wizardStep === 'loading') {
    return (
      <div className="space-y-4 py-8">
        <div className="text-center">
          <Loader2 className="h-10 w-10 mx-auto animate-spin text-primary mb-4" />
          <h3 className="text-lg font-semibold mb-2">
            {t('import.analyzingData', 'Анализ данных...')}
          </h3>
          <p className="text-muted-foreground text-sm">
            {t('import.analyzingDataDesc', 'Проверяем ширины профилей и покрытия')}
          </p>
        </div>
      </div>
    );
  }

  // =========================================
  // Render: Empty (no questions)
  // =========================================
  if (wizardStep === 'empty') {
    return (
      <div className="space-y-4 py-6">
        <div className="text-center">
          <CheckCircle2 className="h-12 w-12 mx-auto text-green-600 mb-4" />
          <h3 className="text-lg font-semibold mb-2">
            {t('import.noNormalizationNeeded', 'Нормализация не требуется')}
          </h3>
          <p className="text-muted-foreground text-sm max-w-md mx-auto">
            {t('import.dataAlreadyNormalized', 'Все данные уже в порядке. Можно продолжить к публикации.')}
          </p>
        </div>

        {stats && (
          <Card className="mx-auto max-w-sm">
            <CardContent className="py-4 text-center">
              <p className="text-2xl font-bold">{stats.rows_scanned}</p>
              <p className="text-xs text-muted-foreground">{t('import.rowsScanned', 'строк проверено')}</p>
            </CardContent>
          </Card>
        )}

        <div className="flex gap-2 justify-center">
          <Button onClick={onComplete}>
            <ChevronRight className="h-4 w-4 mr-2" />
            {t('import.continueToPublish', 'Продолжить к публикации')}
          </Button>
        </div>
      </div>
    );
  }

  const wizardSteps = getWizardSteps();

  // =========================================
  // Render: Widths Step
  // =========================================
  if (wizardStep === 'widths') {
    return (
      <div className="space-y-4">
        {UI_DETAIL_LEVEL !== 'minimal' && (
          <StepIndicator steps={wizardSteps} currentStep="widths" />
        )}

        <div className="flex items-center gap-2">
          <Settings2 className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">{t('import.widthsStep', 'Ширины профилей')}</h3>
          <Badge variant="outline">{widthQuestions.length}</Badge>
        </div>

        {stats && UI_DETAIL_LEVEL !== 'minimal' && (
          <p className="text-sm text-muted-foreground">
            {t('import.scannedRows', 'Проверено строк: {{count}}', { count: stats.rows_scanned })}
          </p>
        )}

        <ScrollArea className="h-[280px] pr-4">
          <div className="space-y-3">
            {widthQuestions.map((q, idx) => (
              <Collapsible 
                key={idx} 
                open={expandedProfiles.has(q.profile)}
                onOpenChange={() => toggleProfileExpanded(q.profile)}
              >
                <Card className={cn(
                  widthSelections[q.profile] && "border-primary/50"
                )}>
                  <CollapsibleTrigger asChild>
                    <CardHeader className="py-3 cursor-pointer hover:bg-muted/50 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {expandedProfiles.has(q.profile) ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                          <CardTitle className="text-sm font-medium">{q.profile}</CardTitle>
                          <Badge 
                            variant={q.type === 'WIDTH_CONFIRM' ? 'default' : 'secondary'} 
                            className="text-xs"
                          >
                            {q.type === 'WIDTH_CONFIRM' ? t('import.autoDetected', 'Авто') : 
                             q.type === 'WIDTH_CHOOSE_VARIANT' ? t('import.chooseVariant', 'Выбор') :
                             t('import.manual', 'Вручную')}
                          </Badge>
                        </div>
                        {widthSelections[q.profile] && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              {widthSelections[q.profile].work_mm}/{widthSelections[q.profile].full_mm} мм
                            </span>
                            <CheckCircle2 className="h-4 w-4 text-primary" />
                          </div>
                        )}
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent className="pt-0 pb-3 space-y-3">
                      {/* WIDTH_CONFIRM */}
                      {q.type === 'WIDTH_CONFIRM' && q.suggested && (
                        <div className="space-y-2">
                          <p className="text-sm text-muted-foreground">{t('import.confirmWidth', 'Подтвердите ширину:')}</p>
                          <div className="flex gap-6 bg-muted/50 rounded-lg p-3">
                            <div>
                              <Label className="text-xs text-muted-foreground">{t('import.workWidth', 'Рабочая')}</Label>
                              <p className="font-semibold text-lg">{q.suggested.work_mm} мм</p>
                            </div>
                            <div>
                              <Label className="text-xs text-muted-foreground">{t('import.fullWidth', 'Полная')}</Label>
                              <p className="font-semibold text-lg">{q.suggested.full_mm} мм</p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* WIDTH_CHOOSE_VARIANT */}
                      {q.type === 'WIDTH_CHOOSE_VARIANT' && q.suggested_variants && (
                        <div className="space-y-2">
                          <p className="text-sm text-muted-foreground">{t('import.chooseWidth', 'Выберите вариант:')}</p>
                          <RadioGroup
                            value={widthSelections[q.profile] ? JSON.stringify(widthSelections[q.profile]) : ''}
                            onValueChange={(val) => handleWidthVariantSelect(q.profile, JSON.parse(val))}
                          >
                            {q.suggested_variants.map((v, vi) => (
                              <div key={vi} className="flex items-center space-x-3 p-2 rounded hover:bg-muted/50">
                                <RadioGroupItem value={JSON.stringify(v)} id={`${q.profile}-${vi}`} />
                                <Label htmlFor={`${q.profile}-${vi}`} className="text-sm flex-1 cursor-pointer">
                                  <span className="font-medium">{v.work_mm}</span>
                                  <span className="text-muted-foreground"> / </span>
                                  <span className="font-medium">{v.full_mm}</span>
                                  <span className="text-muted-foreground"> мм</span>
                                </Label>
                              </div>
                            ))}
                          </RadioGroup>
                        </div>
                      )}

                      {/* WIDTH_MANUAL */}
                      {q.type === 'WIDTH_MANUAL' && (
                        <div className="space-y-2">
                          <p className="text-sm text-muted-foreground">{t('import.enterWidth', 'Введите ширину:')}</p>
                          <div className="flex gap-4">
                            <div className="flex-1">
                              <Label className="text-xs">{t('import.workWidth', 'Рабочая (мм)')}</Label>
                              <Input
                                type="number"
                                placeholder="1000"
                                value={widthSelections[q.profile]?.work_mm || ''}
                                onChange={(e) => handleWidthManualInput(q.profile, 'work_mm', Number(e.target.value))}
                              />
                            </div>
                            <div className="flex-1">
                              <Label className="text-xs">{t('import.fullWidth', 'Полная (мм)')}</Label>
                              <Input
                                type="number"
                                placeholder="1051"
                                value={widthSelections[q.profile]?.full_mm || ''}
                                onChange={(e) => handleWidthManualInput(q.profile, 'full_mm', Number(e.target.value))}
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Examples (medium/advanced only) */}
                      {UI_DETAIL_LEVEL !== 'minimal' && q.examples && q.examples.length > 0 && (
                        <div className="pt-2 border-t">
                          <p className="text-xs text-muted-foreground mb-1">{t('import.examples', 'Примеры из файла:')}</p>
                          <div className="text-xs font-mono bg-muted p-2 rounded max-h-16 overflow-auto space-y-1">
                            {q.examples.slice(0, 3).map((ex, i) => (
                              <div key={i} className="truncate">{ex}</div>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            ))}
          </div>
        </ScrollArea>

        <Separator />

        <div className="flex gap-2 justify-between">
          <Button variant="ghost" onClick={onSkip}>
            {t('common.skip', 'Пропустить')}
          </Button>
          <Button onClick={handleSaveWidths} disabled={saveSettingsMutation.isPending}>
            {saveSettingsMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            <Save className="h-4 w-4 mr-2" />
            {t('import.saveAndContinue', 'Сохранить и продолжить')}
          </Button>
        </div>
      </div>
    );
  }

  // =========================================
  // Render: Coatings Step
  // =========================================
  if (wizardStep === 'coatings') {
    const totalItems = (coatingColorMap?.coatings?.length || 0) + (coatingColorMap?.colors?.length || 0);
    
    return (
      <div className="space-y-4">
        {UI_DETAIL_LEVEL !== 'minimal' && (
          <StepIndicator steps={wizardSteps} currentStep="coatings" />
        )}

        <div className="flex items-center gap-2">
          <Palette className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">{t('import.coatingsStep', 'Покрытия и цвета')}</h3>
          <Badge variant="outline">{totalItems}</Badge>
        </div>

        <ScrollArea className="h-[280px] pr-4">
          <div className="space-y-4">
            {/* Coatings section */}
            {coatingColorMap?.coatings && coatingColorMap.coatings.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  {t('import.coatingsSection', 'Покрытия')}
                  <Badge variant="secondary" className="text-xs">{coatingColorMap.coatings.length}</Badge>
                </h4>
                {coatingColorMap.coatings.map((coating, idx) => (
                  <Card 
                    key={idx} 
                    className={cn(
                      "cursor-pointer transition-colors",
                      coatingConfirmations.has(coating.token) && "border-primary/50 bg-primary/5"
                    )}
                    onClick={() => toggleCoatingConfirmation(coating.token)}
                  >
                    <CardHeader className="py-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="text-sm">{coating.token}</CardTitle>
                          <CardDescription className="text-xs mt-1">
                            {coating.aliases.slice(0, 5).join(', ')}
                            {coating.aliases.length > 5 && ` +${coating.aliases.length - 5}`}
                          </CardDescription>
                        </div>
                        {coatingConfirmations.has(coating.token) ? (
                          <CheckCircle2 className="h-5 w-5 text-primary" />
                        ) : (
                          <Circle className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                    </CardHeader>
                    {UI_DETAIL_LEVEL !== 'minimal' && coating.examples && coating.examples.length > 0 && (
                      <CardContent className="pt-0 pb-3">
                        <div className="text-xs font-mono bg-muted p-2 rounded max-h-12 overflow-auto">
                          {coating.examples.slice(0, 2).map((ex, i) => (
                            <div key={i} className="truncate">{ex}</div>
                          ))}
                        </div>
                      </CardContent>
                    )}
                  </Card>
                ))}
              </div>
            )}

            {/* Colors/RAL section */}
            {coatingColorMap?.colors && coatingColorMap.colors.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  {t('import.colorsSection', 'Цвета / RAL')}
                  <Badge variant="secondary" className="text-xs">{coatingColorMap.colors.length}</Badge>
                </h4>
                {coatingColorMap.colors.map((color, idx) => (
                  <Card key={idx}>
                    <CardHeader className="py-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="text-sm flex items-center gap-2">
                            {color.token}
                            {color.kind === 'DECOR' && (
                              <Badge variant="outline" className="text-xs">Декор</Badge>
                            )}
                          </CardTitle>
                          {color.aliases && color.aliases.length > 0 && (
                            <CardDescription className="text-xs mt-1">
                              {color.aliases.slice(0, 3).join(', ')}
                            </CardDescription>
                          )}
                        </div>
                        {color.suggested_ral && (
                          <div className="flex items-center gap-2">
                            <Input
                              value={ralMappings[color.token] || ''}
                              onChange={(e) => setRalMappings(prev => ({ ...prev, [color.token]: e.target.value }))}
                              placeholder={color.suggested_ral}
                              className="w-28 h-8 text-sm"
                            />
                          </div>
                        )}
                      </div>
                    </CardHeader>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>

        <Separator />

        <div className="flex gap-2 justify-between">
          <Button variant="ghost" onClick={onSkip}>
            {t('common.skip', 'Пропустить')}
          </Button>
          <Button onClick={handleSaveCoatings} disabled={saveSettingsMutation.isPending}>
            {saveSettingsMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            <Save className="h-4 w-4 mr-2" />
            {t('import.saveAndContinue', 'Сохранить и продолжить')}
          </Button>
        </div>
      </div>
    );
  }

  // =========================================
  // Render: Applying Step
  // =========================================
  if (wizardStep === 'applying') {
    return (
      <div className="space-y-4">
        {UI_DETAIL_LEVEL !== 'minimal' && (
          <StepIndicator steps={wizardSteps} currentStep="applying" />
        )}

        <div className="text-center py-4">
          <Sparkles className="h-10 w-10 mx-auto text-primary mb-3" />
          <h3 className="text-lg font-semibold mb-2">
            {t('import.readyToApply', 'Готово к применению')}
          </h3>
          <p className="text-muted-foreground text-sm max-w-md mx-auto">
            {t('import.applyDesc', 'Настройки сохранены. Нажмите "Применить" чтобы обновить каталог.')}
          </p>
        </div>

        {stats && (
          <Card>
            <CardContent className="py-4">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-2xl font-bold">{stats.rows_scanned}</p>
                  <p className="text-xs text-muted-foreground">{t('import.scanned', 'Проверено')}</p>
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.patches_ready || 0}</p>
                  <p className="text-xs text-muted-foreground">{t('import.patchesReady', 'К обновлению')}</p>
                </div>
                <div>
                  <p className="text-2xl font-bold">{Object.keys(widthSelections).length}</p>
                  <p className="text-xs text-muted-foreground">{t('import.profilesConfirmed', 'Профилей')}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex gap-2 justify-center">
          <Button variant="outline" onClick={onSkip}>
            {t('import.skipApply', 'Пропустить')}
          </Button>
          <Button onClick={handleApply} disabled={applyMutation.isPending}>
            {applyMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            <Check className="h-4 w-4 mr-2" />
            {t('import.applyNormalization', 'Применить')}
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
      <div className="space-y-4 py-6">
        <div className="text-center">
          <CheckCircle2 className="h-12 w-12 mx-auto text-green-600 mb-4" />
          <h3 className="text-lg font-semibold mb-2">
            {t('import.normalizationComplete', 'Нормализация завершена')}
          </h3>
          <p className="text-muted-foreground text-sm">
            {t('import.continueToPublish', 'Теперь можно опубликовать каталог.')}
          </p>
        </div>

        <div className="flex justify-center">
          <Button onClick={onComplete}>
            <ChevronRight className="h-4 w-4 mr-2" />
            {t('import.continueToPublish', 'Продолжить к публикации')}
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
