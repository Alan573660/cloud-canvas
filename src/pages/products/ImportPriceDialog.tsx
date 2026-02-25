import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { 
  Upload, FileSpreadsheet, AlertTriangle, Loader2, 
  Check, ChevronRight, PlayCircle, CheckCircle2, XCircle, HelpCircle, Sparkles
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { toast } from '@/hooks/use-toast';
import { 
  getFileFormat, 
  isFormatSupported, 
  generateStoragePath,
  ImportGatewayApi,
  STORAGE_BUCKET,
  type FileFormat 
} from '@/lib/backend';
import { ColumnMappingStep, REQUIRED_FIELDS, type ColumnMapping } from './ColumnMappingStep';
import { useActiveImportJob } from '@/hooks/use-active-import';
import { NormalizationWizard } from '@/components/import/NormalizationWizard';

interface ImportPriceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

type ImportStep = 
  | 'upload' 
  | 'uploading' 
  | 'validating' 
  | 'mapping'
  | 'validated' 
  | 'normalizing'
  | 'pre-publish'
  | 'publishing' 
  | 'done' 
  | 'error';

interface CreatedJob {
  id: string;
  storagePath: string;
  fileFormat: FileFormat;
}

interface ValidateResponse {
  ok: boolean;
  import_job_id: string;
  error_code?: string;
  error?: string;
  detected_columns?: string[];
  missing_required?: string[];
  suggestions?: Record<string, string[]>;
  total_rows?: number;
  valid_rows?: number;
  invalid_rows?: number;
}

interface ValidationStats {
  totalRows: number;
  validRows: number;
  invalidRows: number;
}

interface NormalizationResult {
  patched_rows?: number;
  skipped?: boolean;
}

/** Map raw backend errors to user-friendly messages */
function mapPublishError(raw: string, t: (key: string, fallback: string) => string): string {
  if (raw.includes('Forbidden') || raw.includes('403')) {
    return t('import.errorForbidden', 'Сервер импорта временно недоступен (ошибка доступа). Обратитесь к администратору.');
  }
  if (raw.includes('Supabase is not configured') || raw.includes('CONFIG_ERROR') || raw.includes('not set')) {
    return t('import.errorConfig', 'Сервер импорта не настроен. Обратитесь к администратору для проверки конфигурации.');
  }
  if (raw.includes('WORKER_UNREACHABLE') || raw.includes('Worker unreachable')) {
    return t('import.errorUnreachable', 'Сервер импорта недоступен. Попробуйте позже или обратитесь к администратору.');
  }
  if (raw.includes('File not found')) {
    return t('import.errorFileNotFound', 'Файл не найден в хранилище. Попробуйте загрузить заново.');
  }
  // Python worker uses error_types not matching DB constraint (e.g. INVALID_PRICE)
  if (raw.includes('WORKER_ERROR_TYPE_MISMATCH') || raw.includes('import_errors_error_type_check') || raw.includes('23514')) {
    return t('import.errorWorkerMismatch',
      'Файл содержит строки с недопустимыми значениями (например, нулевая цена или некорректный SKU). ' +
      'Проверьте исходный файл и попробуйте ещё раз. Если проблема повторяется — обратитесь к администратору для обновления воркера.'
    );
  }
  if (raw.includes('Decimal is not JSON serializable')) {
    return t('import.errorDecimal',
      'Ошибка сериализации данных на сервере импорта. Обратитесь к администратору для обновления воркера.'
    );
  }
  return raw;
}

export function ImportPriceDialog({ open, onOpenChange, onSuccess }: ImportPriceDialogProps) {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const { setActiveJobId, clearActiveJob } = useActiveImportJob();

  const [file, setFile] = useState<File | null>(null);
  
  // Multi-step state
  const [step, setStep] = useState<ImportStep>('upload');
  const [createdJob, setCreatedJob] = useState<CreatedJob | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Column mapping state
  const [detectedColumns, setDetectedColumns] = useState<string[]>([]);
  const [missingRequired, setMissingRequired] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<Record<string, string[]>>({});
  const [validationStats, setValidationStats] = useState<ValidationStats | null>(null);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({});
  
  // Normalization result
  const [normalizationResult, setNormalizationResult] = useState<NormalizationResult | null>(null);

  // Query for staging sample (for normalization wizard)
  const { data: stagingSample } = useQuery({
    queryKey: ['staging-sample', createdJob?.id],
    queryFn: async () => {
      if (!createdJob?.id || !profile?.organization_id) return [];
      
      const { data, error } = await supabase
        .from('import_staging_rows')
        .select('row_number, data')
        .eq('import_job_id', createdJob.id)
        .eq('organization_id', profile.organization_id)
        .eq('validation_status', 'VALID')
        .order('row_number', { ascending: true })
        .limit(50);

      if (error) {
        console.error('[ImportPriceDialog] Staging sample error:', error);
        return [];
      }
      return data as Array<{ row_number: number; data: Record<string, unknown> }>;
    },
    enabled: !!createdJob?.id && !!profile?.organization_id && (step === 'validated' || step === 'normalizing'),
  });

  // Save job ID to localStorage when created
  useEffect(() => {
    if (createdJob?.id) {
      setActiveJobId(createdJob.id);
    }
  }, [createdJob?.id, setActiveJobId]);

  // Create import job, upload file, and AUTO-TRIGGER validation
  const createJobMutation = useMutation({
    mutationFn: async () => {
      if (!profile?.organization_id || !file) throw new Error('Invalid state');

      const fileFormat = getFileFormat(file.name);
      if (!fileFormat) throw new Error('Unsupported file format');
      
      if (!isFormatSupported(fileFormat)) {
        throw new Error(`Format ${fileFormat.toUpperCase()} is not yet supported`);
      }

      // Step 1: Create import job record
      const { data: job, error: insertError } = await supabase
        .from('import_jobs')
        .insert({
          organization_id: profile.organization_id,
          entity_type: 'PRODUCT_CATALOG',
          status: 'QUEUED',
          dry_run: false,
          mode: 'REPLACE',
          source: 'ui',
          file_name: file.name,
          file_mime: file.type,
          file_size_bytes: file.size,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      console.info('[ImportPriceDialog] Job created:', job.id);

      // Step 2: Upload file
      const storagePath = generateStoragePath(profile.organization_id, job.id, file.name);
      
      await supabase
        .from('import_jobs')
        .update({ file_url: `storage://${STORAGE_BUCKET}/${storagePath}` })
        .eq('id', job.id)
        .eq('organization_id', profile.organization_id);

      setStep('uploading');
      setUploadProgress(10);

      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, file, {
          cacheControl: '3600',
          upsert: false,
        });

      if (uploadError) {
        console.error('[ImportPriceDialog] Upload error:', uploadError);
        
        const is409 = uploadError.message?.includes('already exists') || 
                      uploadError.message?.includes('Duplicate') ||
                      (uploadError as { statusCode?: number }).statusCode === 409;
        
        const userMessage = is409 
          ? t('import.fileAlreadyExists', 'Файл с таким именем уже загружен. Создайте новый импорт.')
          : `Upload failed: ${uploadError.message}`;
        
        await supabase
          .from('import_jobs')
          .update({ status: 'FAILED', error_message: userMessage })
          .eq('id', job.id)
          .eq('organization_id', profile.organization_id);

        throw new Error(userMessage);
      }

      setUploadProgress(100);
      console.info('[ImportPriceDialog] File uploaded to:', storagePath);

      return { id: job.id, storagePath, fileFormat };
    },
    onSuccess: (data) => {
      setCreatedJob(data);
      // Auto-trigger validation immediately
      setStep('validating');
      queryClient.invalidateQueries({ queryKey: ['import-jobs'] });
      validateMutation.mutate({ job: data, mapping: undefined });
    },
    onError: (error) => {
      console.error('[ImportPriceDialog] Error:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create import job');
      setStep('error');
    },
  });

  // Validate mutation
  const validateMutation = useMutation({
    mutationFn: async ({ job, mapping }: { job: CreatedJob; mapping?: ColumnMapping }) => {
      if (!profile?.organization_id) throw new Error('Invalid state');

      setStep('validating');

      const { data, error } = await supabase.functions.invoke<ValidateResponse>(ImportGatewayApi.validate, {
        body: {
          organization_id: profile.organization_id,
          import_job_id: job.id,
          file_path: job.storagePath,
          file_format: job.fileFormat,
          mapping: mapping || null,
          options: {
            transform: { sanitize_id: true, normalize_price: true, trim_text: true },
          },
        },
      });

      if (error) {
        console.error('[ImportPriceDialog] Validate error:', error);
        throw new Error(error.message || 'Validation failed');
      }

      console.info('[ImportPriceDialog] Validate result:', data);
      return data;
    },
    onSuccess: (data) => {
      if (!data) return;

      // Mapping required
      if (!data.ok && data.error_code === 'MISSING_REQUIRED_COLUMNS') {
        setDetectedColumns(data.detected_columns || []);
        setMissingRequired(data.missing_required || []);
        setSuggestions(data.suggestions || {});
        
        const initialMapping: ColumnMapping = {};
        Object.entries(data.suggestions || {}).forEach(([field, cols]) => {
          if (cols && cols.length > 0) {
            initialMapping[field] = cols[0];
          }
        });
        setColumnMapping(initialMapping);
        setStep('mapping');
        return;
      }

      setValidationStats({
        totalRows: data.total_rows || 0,
        validRows: data.valid_rows || 0,
        invalidRows: data.invalid_rows || 0,
      });

      setStep('validated');
      queryClient.invalidateQueries({ queryKey: ['import-jobs'] });
    },
    onError: async (error) => {
      console.error('[ImportPriceDialog] Validate failed:', error);
      const raw = error instanceof Error ? error.message : 'Validation failed';
      setErrorMessage(mapPublishError(raw, t));
      setStep('error');
      queryClient.invalidateQueries({ queryKey: ['import-jobs'] });
    },
  });

  // Poll for job completion
  const pollJobStatus = async (jobId: string, maxAttempts = 300): Promise<'COMPLETED' | 'FAILED'> => {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const { data: job } = await supabase
        .from('import_jobs')
        .select('status, error_message, error_code, summary')
        .eq('id', jobId)
        .eq('organization_id', profile!.organization_id)
        .single();
      
      if (job?.status === 'COMPLETED') return 'COMPLETED';
      if (job?.status === 'FAILED') throw new Error(job.error_message || 'Import failed');
      
      if (i > 0 && i % 10 === 0) {
        const summary = job?.summary as Record<string, unknown> | null;
        console.info(`[ImportPriceDialog] Polling ${i}/${maxAttempts}: status=${job?.status}, stage=${summary?.stage || 'processing'}`);
      }
    }
    throw new Error('Import timeout - job did not complete in 15 minutes.');
  };

  // Publish mutation
  const publishMutation = useMutation({
    mutationFn: async () => {
      if (!profile?.organization_id || !createdJob) throw new Error('Invalid state');

      setStep('publishing');

      const { data, error } = await supabase.functions.invoke(ImportGatewayApi.publish, {
        body: {
          organization_id: profile.organization_id,
          import_job_id: createdJob.id,
          file_path: createdJob.storagePath,
          file_format: createdJob.fileFormat,
          archive_before_replace: true,
          mapping: Object.keys(columnMapping).length > 0 ? columnMapping : null,
          options: {
            transform: { sanitize_id: true, normalize_price: true, trim_text: true },
          },
          allow_partial: true,
        },
      });

      if (error) throw new Error(error.message || 'Publish failed');
      if (data?.ok === false && data?.error) throw new Error(data.error);

      console.info('[ImportPriceDialog] Publish dispatched (async):', data);
      await pollJobStatus(createdJob.id);
      return data;
    },
    onSuccess: () => {
      setStep('done');
      queryClient.invalidateQueries({ queryKey: ['import-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast({
        title: t('import.publishSuccess', 'Импорт завершён'),
        description: t('import.publishSuccessDesc', 'Каталог успешно обновлён'),
      });
      onSuccess?.();
    },
    onError: async (error) => {
      const errorMsg = error instanceof Error ? error.message : 'Publish failed';
      console.error('[ImportPriceDialog] Publish failed:', error);
      
      if (errorMsg.includes('timeout') || errorMsg.includes('15 minutes')) {
        toast({
          title: t('import.publishInProgress', 'Импорт выполняется'),
          description: t('import.publishInProgressDesc', 'Обработка большого файла занимает время. Прогресс отображается в баннере.'),
        });
        onOpenChange(false);
        queryClient.invalidateQueries({ queryKey: ['import-jobs'] });
        return;
      }
      
      // Map infrastructure errors to user-friendly messages
      const userMessage = mapPublishError(errorMsg, t);
      setErrorMessage(userMessage);
      setStep('error');
      queryClient.invalidateQueries({ queryKey: ['import-jobs'] });
    },
  });

  const resetForm = () => {
    setFile(null);
    setStep('upload');
    setCreatedJob(null);
    setUploadProgress(0);
    setErrorMessage(null);
    setDetectedColumns([]);
    setMissingRequired([]);
    setSuggestions({});
    setColumnMapping({});
    setValidationStats(null);
    setNormalizationResult(null);
  };

  const handleClose = () => {
    onOpenChange(false);
    setTimeout(resetForm, 300);
  };

  const handleContinueInBackground = () => {
    toast({
      title: t('import.continueInBackground', 'Импорт продолжается в фоне'),
      description: t('import.continueInBackgroundDesc', 'Прогресс виден в баннере сверху.'),
    });
    handleClose();
  };

  const handleStopTracking = () => {
    clearActiveJob();
    toast({
      title: t('import.trackingReset', 'Отслеживание сброшено'),
      description: t('import.trackingResetDesc', 'Задача может продолжаться на сервере.'),
    });
    handleClose();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) setFile(selectedFile);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) setFile(droppedFile);
  };

  const handleValidateWithMapping = () => {
    if (!createdJob) return;
    validateMutation.mutate({ job: createdJob, mapping: columnMapping });
  };

  const fileFormat = file ? getFileFormat(file.name) : null;
  const isFormatAvailable = fileFormat ? isFormatSupported(fileFormat) : true;
  const allRequiredMapped = REQUIRED_FIELDS.every((f) => !!columnMapping[f]);

  // Step label for header
  const getStepLabel = (): string => {
    switch (step) {
      case 'upload': return t('import.stepUpload', 'Шаг 1 — Загрузка файла');
      case 'uploading': return t('import.stepUploading', 'Загрузка файла...');
      case 'validating': return t('import.stepValidating', 'Шаг 2 — Проверка данных...');
      case 'mapping': return t('import.stepMapping', 'Сопоставление колонок');
      case 'validated': return t('import.stepValidated', 'Шаг 2 — Проверка завершена');
      case 'normalizing': return t('import.stepNormalizing', 'Нормализация данных');
      case 'pre-publish': return t('import.stepPrePublish', 'Шаг 3 — Подтверждение');
      case 'publishing': return t('import.stepPublishing', 'Импорт в каталог...');
      case 'done': return t('import.stepDone', 'Готово');
      case 'error': return t('import.stepError', 'Ошибка');
      default: return '';
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className={(step === 'mapping' || step === 'normalizing') ? 'max-w-2xl max-h-[85vh] overflow-y-auto' : 'max-w-lg'}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            {t('catalog.uploadPrice', 'Загрузить прайс')}
          </DialogTitle>
          <DialogDescription>{getStepLabel()}</DialogDescription>
        </DialogHeader>

        {/* Step 1: Upload */}
        {step === 'upload' && (
          <div className="space-y-4">
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              className="border-2 border-dashed rounded-lg p-6 text-center hover:border-primary/50 transition-colors cursor-pointer"
              onClick={() => document.getElementById('file-input')?.click()}
            >
              <input
                id="file-input"
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFileChange}
                className="hidden"
              />
              {file ? (
                <div className="flex items-center justify-center gap-3">
                  <FileSpreadsheet className="h-8 w-8 text-primary" />
                  <div className="text-left">
                    <p className="font-medium">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {(file.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                  <p className="text-sm text-muted-foreground">{t('import.dragAndDrop', 'Перетащите файл или нажмите для выбора')}</p>
                  <div className="flex flex-wrap justify-center gap-1 mt-3">
                    <Badge variant="secondary" className="text-xs">CSV</Badge>
                    <Badge variant="secondary" className="text-xs">XLSX</Badge>
                    <Badge variant="secondary" className="text-xs">XLS</Badge>
                  </div>
                </>
              )}
            </div>

            {file && !isFormatAvailable && (
              <Card className="bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800">
                <CardContent className="p-3 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-amber-800 dark:text-amber-300">
                    {t('import.formatNotSupported', 'Формат {{format}} пока не поддерживается. Используйте CSV или XLSX.', { format: fileFormat?.toUpperCase() })}
                  </p>
                </CardContent>
              </Card>
            )}

            <Card className="bg-muted/30 border-muted">
              <CardContent className="p-3 flex items-start gap-2">
                <HelpCircle className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                <div className="text-xs text-muted-foreground">
                  <p>{t('import.autoMappingDesc', 'Колонки распознаются автоматически. Если не распознано — вы выберете соответствие один раз.')}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Uploading */}
        {step === 'uploading' && (
          <div className="py-6 space-y-4">
            <div className="text-center">
              <Loader2 className="h-10 w-10 mx-auto animate-spin text-primary mb-3" />
              <p className="text-sm text-muted-foreground">
                {t('import.uploadingToStorage', 'Загрузка файла...')}
              </p>
            </div>
            <Progress value={uploadProgress} className="h-2" />
          </div>
        )}

        {/* Validating */}
        {step === 'validating' && (
          <div className="py-8 text-center space-y-3">
            <Loader2 className="h-10 w-10 mx-auto animate-spin text-primary" />
            <p className="text-sm font-medium">{t('import.checkingData', 'Проверка данных…')}</p>
            <p className="text-xs text-muted-foreground">
              {t('import.validatingDesc', 'Проверяем структуру и данные файла...')}
            </p>
          </div>
        )}

        {/* Column Mapping */}
        {step === 'mapping' && (
          <ColumnMappingStep
            detectedColumns={detectedColumns}
            missingRequired={missingRequired}
            suggestions={suggestions}
            mapping={columnMapping}
            onMappingChange={setColumnMapping}
          />
        )}

        {/* Validated */}
        {step === 'validated' && (
          <div className="space-y-4">
            <Card className="bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800">
              <CardContent className="p-4 flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" />
                <div>
                  <p className="font-medium text-green-800 dark:text-green-300">
                    {t('import.validationPassed', 'Проверка пройдена')}
                  </p>
                  {validationStats && (
                    <p className="text-xs text-green-700 dark:text-green-400 mt-1">
                      {t('import.validationSummary', '{{valid}} из {{total}} строк готовы к импорту', {
                        valid: validationStats.validRows,
                        total: validationStats.totalRows,
                      })}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {validationStats && validationStats.invalidRows > 0 && (
              <Card className="bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800">
                <CardContent className="p-3 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-amber-800 dark:text-amber-300">
                    {t('import.hasErrors', 'Есть ошибки в {{count}} строках', { count: validationStats.invalidRows })}
                  </p>
                </CardContent>
              </Card>
            )}

            <div className="flex justify-center pt-2">
              <Button 
                size="lg" 
                onClick={() => setStep('normalizing')}
                className="gap-2"
              >
                <Sparkles className="h-4 w-4" />
                {t('import.continueToNormalization', 'Далее')}
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Normalizing */}
        {step === 'normalizing' && createdJob && profile?.organization_id && (
          <NormalizationWizard
            organizationId={profile.organization_id}
            importJobId={createdJob.id}
            stagingSample={stagingSample || []}
            onComplete={(result) => {
              setNormalizationResult(result);
              setStep('pre-publish');
            }}
            onSkip={() => {
              setNormalizationResult({ skipped: true });
              setStep('pre-publish');
            }}
          />
        )}

        {/* Pre-Publish */}
        {step === 'pre-publish' && (
          <div className="py-6 space-y-6">
            <div className="text-center space-y-4">
              <CheckCircle2 className="h-12 w-12 mx-auto text-green-600" />
              <div>
                <p className="font-medium text-lg text-green-800 dark:text-green-300">
                  {normalizationResult?.skipped 
                    ? t('normalize.skipped', 'Нормализация пропущена')
                    : t('normalize.applied', 'Нормализация применена')}
                </p>
                {normalizationResult?.patched_rows && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {t('normalize.patchedRows', 'Обновлено строк: {{count}}', { count: normalizationResult.patched_rows })}
                  </p>
                )}
              </div>
            </div>

            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="p-4 text-center">
                <p className="text-sm text-muted-foreground">
                  {t('import.readyToPublish', 'Данные готовы к импорту в каталог.')}
                </p>
              </CardContent>
            </Card>

            <div className="flex justify-center gap-3">
              <Button variant="outline" onClick={handleClose}>
                {t('common.cancel')}
              </Button>
              <Button 
                size="lg" 
                onClick={() => publishMutation.mutate()}
                disabled={publishMutation.isPending}
                className="gap-2"
              >
                {publishMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PlayCircle className="h-4 w-4" />
                )}
                {t('import.importToCatalog', 'Импортировать в каталог')}
              </Button>
            </div>
          </div>
        )}

        {/* Publishing */}
        {step === 'publishing' && (
          <div className="py-8 text-center space-y-4">
            <Loader2 className="h-10 w-10 mx-auto animate-spin text-primary" />
            <div>
              <p className="font-medium">{t('import.publishingInProgress', 'Импорт в каталог...')}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {t('import.publishingDesc', 'Обновляем каталог...')}
              </p>
            </div>
            <Progress value={undefined} className="w-48 mx-auto h-2" />
            <p className="text-xs text-muted-foreground">
              {t('import.publishingHint', 'Можно закрыть окно — задача продолжится в фоне.')}
            </p>
          </div>
        )}

        {/* Done */}
        {step === 'done' && (
          <div className="py-6 space-y-6">
            <div className="text-center space-y-4">
              <CheckCircle2 className="h-12 w-12 mx-auto text-green-600" />
              <div>
                <p className="font-medium text-lg text-green-800 dark:text-green-300">
                  {t('import.importComplete', 'Импорт завершён!')}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {t('import.importCompleteDesc', 'Каталог успешно обновлён.')}
                </p>
              </div>
            </div>

            {normalizationResult && !normalizationResult.skipped && (
              <Card className="bg-primary/5 border-primary/20">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <Sparkles className="h-5 w-5 text-primary flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{t('normalize.applied', 'Нормализация применена')}</p>
                      <p className="text-xs text-muted-foreground">
                        {normalizationResult.patched_rows 
                          ? t('normalize.patchedRowsSummary', 'Обновлено {{count}} строк в каталоге', { count: normalizationResult.patched_rows })
                          : t('normalize.noChangesNeeded', 'Все данные уже были нормализованы')}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Error */}
        {step === 'error' && (
          <div className="space-y-4">
            <Card className="bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800">
              <CardContent className="p-4 flex items-start gap-3">
                <XCircle className="h-5 w-5 text-red-600 mt-0.5" />
                <div>
                  <p className="font-medium text-red-800 dark:text-red-300">
                    {t('import.errorTitle', 'Ошибка импорта')}
                  </p>
                  <p className="text-xs text-red-700 dark:text-red-400 mt-1">
                    {errorMessage || t('import.unknownError', 'Неизвестная ошибка')}
                  </p>
                </div>
              </CardContent>
            </Card>
            <Button variant="outline" onClick={resetForm} className="w-full">
              {t('common.tryAgain', 'Попробовать снова')}
            </Button>
          </div>
        )}

        <DialogFooter>
          {step === 'upload' && (
            <>
              <Button variant="outline" onClick={handleClose}>
                {t('common.cancel')}
              </Button>
              <Button
                onClick={() => createJobMutation.mutate()}
                disabled={!file || !isFormatAvailable || createJobMutation.isPending}
              >
                {createJobMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" />
                )}
                {t('import.uploadAndCheck', 'Загрузить и проверить')}
              </Button>
            </>
          )}

          {step === 'publishing' && (
            <>
              <Button variant="outline" onClick={handleContinueInBackground}>
                {t('import.closeAndContinue', 'Закрыть и продолжить в фоне')}
              </Button>
              <Button variant="destructive" onClick={handleStopTracking}>
                {t('import.stopTracking', 'Сбросить отслеживание')}
              </Button>
            </>
          )}

          {step === 'mapping' && (
            <>
              <Button variant="outline" onClick={handleClose}>
                {t('common.close', 'Закрыть')}
              </Button>
              <Button
                onClick={handleValidateWithMapping}
                disabled={!allRequiredMapped || validateMutation.isPending || detectedColumns.length === 0}
              >
                {validateMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 mr-2" />
                )}
                {t('import.validateAndContinue', 'Проверить')}
              </Button>
            </>
          )}

          {(step === 'validated') && (
            <Button variant="outline" onClick={handleClose}>
              {t('common.close', 'Закрыть')}
            </Button>
          )}

          {(step === 'done') && (
            <Button onClick={handleClose}>
              {t('common.close', 'Закрыть')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
