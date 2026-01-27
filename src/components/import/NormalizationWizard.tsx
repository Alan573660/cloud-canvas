import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { 
  Loader2, Check, ChevronRight, ChevronDown, AlertTriangle,
  Sparkles, Settings2, Palette, Save
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { toast } from '@/hooks/use-toast';

// Question types from catalog-enricher
type QuestionType = 
  | 'WIDTH_CONFIRM' 
  | 'WIDTH_CHOOSE_VARIANT' 
  | 'WIDTH_MANUAL' 
  | 'COATING_COLOR_MAP';

interface WidthData {
  work_mm: number;
  full_mm: number;
}

interface WidthQuestion {
  type: 'WIDTH_CONFIRM' | 'WIDTH_CHOOSE_VARIANT' | 'WIDTH_MANUAL';
  profile: string;
  current?: WidthData;
  variants?: WidthData[];
  examples?: string[];
}

interface CoatingColorQuestion {
  type: 'COATING_COLOR_MAP';
  coating: string;
  detected_aliases: string[];
  suggested_ral?: string;
  examples?: string[];
}

type NormalizeQuestion = WidthQuestion | CoatingColorQuestion;

interface DryRunResponse {
  ok: boolean;
  run_id?: string;
  profile_hash?: string;
  stats?: {
    rows_scanned: number;
    candidates: number;
    patches_ready: number;
    questions: number;
    ai_questions?: number;
  };
  patches_sample?: Array<Record<string, unknown>>;
  questions?: NormalizeQuestion[];
  error?: string;
}

interface ApplyResponse {
  ok: boolean;
  patched_rows?: number;
  run_id?: string;
  profile_hash?: string;
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

export function NormalizationWizard({
  organizationId,
  importJobId,
  stagingSample,
  onComplete,
  onSkip,
}: NormalizationWizardProps) {
  const { t } = useTranslation();
  const { profile } = useAuth();

  // Wizard state
  const [wizardStep, setWizardStep] = useState<'init' | 'widths' | 'coatings' | 'applying' | 'done'>('init');
  
  // dry_run response
  const [runId, setRunId] = useState<string | null>(null);
  const [profileHash, setProfileHash] = useState<string | null>(null);
  const [questions, setQuestions] = useState<NormalizeQuestion[]>([]);
  const [stats, setStats] = useState<DryRunResponse['stats'] | null>(null);

  // User selections
  const [widthSelections, setWidthSelections] = useState<Record<string, WidthData>>({});
  const [coatingSelections, setCoatingSelections] = useState<Record<string, string[]>>({});
  const [ralAliases, setRalAliases] = useState<Record<string, string>>({});

  // Expanded sections
  const [expandedProfiles, setExpandedProfiles] = useState<Set<string>>(new Set());

  const widthQuestions = questions.filter(q => q.type.startsWith('WIDTH_')) as WidthQuestion[];
  const coatingQuestions = questions.filter(q => q.type === 'COATING_COLOR_MAP') as CoatingColorQuestion[];

  // Run dry_run
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

      // Pre-fill confirmed widths from WIDTH_CONFIRM questions
      const initialWidths: Record<string, WidthData> = {};
      (data.questions || []).forEach(q => {
        if (q.type === 'WIDTH_CONFIRM' && (q as WidthQuestion).current) {
          const wq = q as WidthQuestion;
          initialWidths[wq.profile] = wq.current!;
        }
      });
      setWidthSelections(initialWidths);

      // Move to widths step if there are width questions
      const hasWidths = (data.questions || []).some(q => q.type.startsWith('WIDTH_'));
      const hasCoatings = (data.questions || []).some(q => q.type === 'COATING_COLOR_MAP');

      if (hasWidths) {
        setWizardStep('widths');
      } else if (hasCoatings) {
        setWizardStep('coatings');
      } else {
        // No questions - skip to apply
        setWizardStep('applying');
      }

      toast({
        title: t('import.normalizationReady', 'Нормализация готова'),
        description: t('import.questionsCount', 'Найдено вопросов: {{count}}', { count: data.questions?.length || 0 }),
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
    onSuccess: () => {
      toast({
        title: t('common.saved', 'Сохранено'),
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
    await saveSettingsMutation.mutateAsync({
      pricing: {
        widths_selected: widthSelections,
      },
    });
    
    // Move to coatings if there are coating questions
    if (coatingQuestions.length > 0) {
      setWizardStep('coatings');
    } else {
      setWizardStep('applying');
    }
  };

  const handleSaveCoatings = async () => {
    await saveSettingsMutation.mutateAsync({
      pricing: {
        coatings: coatingSelections,
        colors: {
          ral_aliases: ralAliases,
        },
      },
    });
    setWizardStep('applying');
  };

  const handleApply = () => {
    applyMutation.mutate();
  };

  const toggleProfileExpanded = (profile: string) => {
    const newSet = new Set(expandedProfiles);
    if (newSet.has(profile)) {
      newSet.delete(profile);
    } else {
      newSet.add(profile);
    }
    setExpandedProfiles(newSet);
  };

  const handleWidthVariantSelect = (profile: string, variant: WidthData) => {
    setWidthSelections(prev => ({ ...prev, [profile]: variant }));
  };

  const handleWidthManualInput = (profile: string, field: 'work_mm' | 'full_mm', value: number) => {
    setWidthSelections(prev => ({
      ...prev,
      [profile]: {
        ...prev[profile],
        [field]: value,
      },
    }));
  };

  // Render based on wizard step
  if (wizardStep === 'init') {
    return (
      <div className="space-y-4">
        <div className="text-center py-6">
          <Sparkles className="h-12 w-12 mx-auto text-primary mb-4" />
          <h3 className="text-lg font-semibold mb-2">
            {t('import.normalizationStep', 'Нормализация данных')}
          </h3>
          <p className="text-muted-foreground text-sm max-w-md mx-auto">
            {t('import.normalizationDesc', 'Автоматическая проверка ширин профилей, покрытий и цветов. Это поможет унифицировать данные каталога.')}
          </p>
        </div>

        {/* Sample data preview */}
        {stagingSample.length > 0 && (
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm">{t('import.sampleData', 'Примеры данных')}</CardTitle>
            </CardHeader>
            <CardContent className="py-2">
              <ScrollArea className="h-32">
                <div className="space-y-2 text-xs font-mono">
                  {stagingSample.slice(0, 5).map((row, i) => (
                    <div key={i} className="p-2 bg-muted rounded">
                      <span className="text-muted-foreground">#{row.row_number}:</span>{' '}
                      {String(row.data.title || row.data.id || JSON.stringify(row.data)).slice(0, 100)}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        )}

        <div className="flex gap-2 justify-center">
          <Button variant="outline" onClick={onSkip}>
            {t('common.skip', 'Пропустить')}
          </Button>
          <Button onClick={() => dryRunMutation.mutate()} disabled={dryRunMutation.isPending}>
            {dryRunMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            <Sparkles className="h-4 w-4 mr-2" />
            {t('import.runNormalization', 'Запустить нормализацию')}
          </Button>
        </div>
      </div>
    );
  }

  if (wizardStep === 'widths') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-4">
          <Settings2 className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">{t('import.widthsStep', 'Ширины профилей')}</h3>
          <Badge variant="outline">{widthQuestions.length}</Badge>
        </div>

        {stats && (
          <div className="text-sm text-muted-foreground mb-4">
            {t('import.scannedRows', 'Проверено строк: {{count}}', { count: stats.rows_scanned })}
          </div>
        )}

        <ScrollArea className="h-[300px] pr-4">
          <div className="space-y-3">
            {widthQuestions.map((q, idx) => (
              <Collapsible 
                key={idx} 
                open={expandedProfiles.has(q.profile)}
                onOpenChange={() => toggleProfileExpanded(q.profile)}
              >
                <Card>
                  <CollapsibleTrigger asChild>
                    <CardHeader className="py-3 cursor-pointer hover:bg-muted/50">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {expandedProfiles.has(q.profile) ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                          <CardTitle className="text-sm">{q.profile}</CardTitle>
                          <Badge variant={q.type === 'WIDTH_CONFIRM' ? 'default' : 'secondary'} className="text-xs">
                            {q.type === 'WIDTH_CONFIRM' ? t('import.autoDetected', 'Авто') : 
                             q.type === 'WIDTH_CHOOSE_VARIANT' ? t('import.chooseVariant', 'Выбор') :
                             t('import.manual', 'Вручную')}
                          </Badge>
                        </div>
                        {widthSelections[q.profile] && (
                          <span className="text-xs text-muted-foreground">
                            {widthSelections[q.profile].work_mm} / {widthSelections[q.profile].full_mm} мм
                          </span>
                        )}
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent className="pt-0 pb-3">
                      {q.type === 'WIDTH_CONFIRM' && q.current && (
                        <div className="space-y-2">
                          <p className="text-sm text-muted-foreground">{t('import.confirmWidth', 'Подтвердите ширину:')}</p>
                          <div className="flex gap-4">
                            <div>
                              <Label className="text-xs">{t('import.workWidth', 'Рабочая')}</Label>
                              <p className="font-medium">{q.current.work_mm} мм</p>
                            </div>
                            <div>
                              <Label className="text-xs">{t('import.fullWidth', 'Полная')}</Label>
                              <p className="font-medium">{q.current.full_mm} мм</p>
                            </div>
                          </div>
                        </div>
                      )}

                      {q.type === 'WIDTH_CHOOSE_VARIANT' && q.variants && (
                        <div className="space-y-2">
                          <p className="text-sm text-muted-foreground">{t('import.chooseWidth', 'Выберите вариант:')}</p>
                          <RadioGroup
                            value={widthSelections[q.profile] ? JSON.stringify(widthSelections[q.profile]) : ''}
                            onValueChange={(val) => handleWidthVariantSelect(q.profile, JSON.parse(val))}
                          >
                            {q.variants.map((v, vi) => (
                              <div key={vi} className="flex items-center space-x-2">
                                <RadioGroupItem value={JSON.stringify(v)} id={`${q.profile}-${vi}`} />
                                <Label htmlFor={`${q.profile}-${vi}`} className="text-sm">
                                  {v.work_mm} / {v.full_mm} мм
                                </Label>
                              </div>
                            ))}
                          </RadioGroup>
                        </div>
                      )}

                      {q.type === 'WIDTH_MANUAL' && (
                        <div className="space-y-2">
                          <p className="text-sm text-muted-foreground">{t('import.enterWidth', 'Введите ширину:')}</p>
                          <div className="flex gap-4">
                            <div>
                              <Label className="text-xs">{t('import.workWidth', 'Рабочая (мм)')}</Label>
                              <Input
                                type="number"
                                value={widthSelections[q.profile]?.work_mm || ''}
                                onChange={(e) => handleWidthManualInput(q.profile, 'work_mm', Number(e.target.value))}
                                className="w-24"
                              />
                            </div>
                            <div>
                              <Label className="text-xs">{t('import.fullWidth', 'Полная (мм)')}</Label>
                              <Input
                                type="number"
                                value={widthSelections[q.profile]?.full_mm || ''}
                                onChange={(e) => handleWidthManualInput(q.profile, 'full_mm', Number(e.target.value))}
                                className="w-24"
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      {q.examples && q.examples.length > 0 && (
                        <div className="mt-3 pt-3 border-t">
                          <p className="text-xs text-muted-foreground mb-1">{t('import.examples', 'Примеры:')}</p>
                          <div className="text-xs font-mono bg-muted p-2 rounded max-h-16 overflow-auto">
                            {q.examples.slice(0, 3).map((ex, i) => (
                              <div key={i}>{ex}</div>
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

        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onSkip}>
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

  if (wizardStep === 'coatings') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-4">
          <Palette className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">{t('import.coatingsStep', 'Покрытия и цвета')}</h3>
          <Badge variant="outline">{coatingQuestions.length}</Badge>
        </div>

        <ScrollArea className="h-[300px] pr-4">
          <div className="space-y-3">
            {coatingQuestions.map((q, idx) => (
              <Card key={idx}>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm">{q.coating}</CardTitle>
                  <CardDescription className="text-xs">
                    {t('import.detectedAliases', 'Найденные варианты:')} {q.detected_aliases.join(', ')}
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0 pb-3">
                  {q.suggested_ral && (
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="secondary">{q.suggested_ral}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {t('import.suggestedRal', 'Предложенный RAL')}
                      </span>
                    </div>
                  )}

                  {q.examples && q.examples.length > 0 && (
                    <div className="mt-2">
                      <p className="text-xs text-muted-foreground mb-1">{t('import.examples', 'Примеры:')}</p>
                      <div className="text-xs font-mono bg-muted p-2 rounded max-h-16 overflow-auto">
                        {q.examples.slice(0, 3).map((ex, i) => (
                          <div key={i}>{ex}</div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>

        <Separator />

        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onSkip}>
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

  if (wizardStep === 'applying') {
    return (
      <div className="space-y-4">
        <div className="text-center py-6">
          <Check className="h-12 w-12 mx-auto text-green-600 mb-4" />
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
                  <p className="text-2xl font-bold">{stats.patches_ready}</p>
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
            {t('import.skipApply', 'Пропустить применение')}
          </Button>
          <Button onClick={handleApply} disabled={applyMutation.isPending}>
            {applyMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            <Check className="h-4 w-4 mr-2" />
            {t('import.applyNormalization', 'Применить в каталог')}
          </Button>
        </div>
      </div>
    );
  }

  if (wizardStep === 'done') {
    return (
      <div className="space-y-4">
        <div className="text-center py-6">
          <Check className="h-12 w-12 mx-auto text-green-600 mb-4" />
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
