import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { 
  Upload, FileSpreadsheet, AlertTriangle, Loader2, Info, 
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
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
  | 'pending' 
  | 'validating' 
  | 'mapping'  // Step for column mapping
  | 'validated' 
  | 'normalizing'  // NEW: Normalization wizard step
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

export function ImportPriceDialog({ open, onOpenChange, onSuccess }: ImportPriceDialogProps) {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const { setActiveJobId, clearActiveJob } = useActiveImportJob();

  const [file, setFile] = useState<File | null>(null);
  const [dryRun, setDryRun] = useState(false);
  const [archiveBeforeReplace, setArchiveBeforeReplace] = useState(true);
  
  // Import options
  const [strictRoofingOnlyM2, setStrictRoofingOnlyM2] = useState(true); // Only import м² items by default
  const [excludedRowNumbers, setExcludedRowNumbers] = useState<number[]>([]);
  
  // Auto-correction options
  const [transformOptions, setTransformOptions] = useState({
    sanitize_id: true,
    normalize_price: true,
    trim_text: true,
  });
  
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
  
  // Check if Measure column is present and has non-м² values
  const [hasMeasureColumn, setHasMeasureColumn] = useState(false);

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

  // Create import job and upload file mutation
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
          dry_run: dryRun,
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

      // Step 2: Generate storage path
      const storagePath = generateStoragePath(profile.organization_id, job.id, file.name);
      
      // Save storage path in file_url
      await supabase
        .from('import_jobs')
        .update({ file_url: `storage://${STORAGE_BUCKET}/${storagePath}` })
        .eq('id', job.id);

      // Step 3: Upload file to Supabase Storage
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
        
        // Handle 409 Conflict (file already exists)
        const is409 = uploadError.message?.includes('already exists') || 
                      uploadError.message?.includes('Duplicate') ||
                      (uploadError as any).statusCode === 409;
        
        const userMessage = is409 
          ? t('import.fileAlreadyExists', 'Файл с таким именем уже загружен для этого импорта. Создайте новый импорт.')
          : `Upload failed: ${uploadError.message}`;
        
        // Update job status to FAILED
        await supabase
          .from('import_jobs')
          .update({ 
            status: 'FAILED',
            error_message: userMessage
          })
          .eq('id', job.id);

        throw new Error(userMessage);
      }

      setUploadProgress(100);
      console.info('[ImportPriceDialog] File uploaded to:', storagePath);

      return { id: job.id, storagePath, fileFormat };
    },
    onSuccess: (data) => {
      setCreatedJob(data);
      setStep('pending');
      queryClient.invalidateQueries({ queryKey: ['import-jobs'] });
      toast({
        title: t('import.uploadComplete', 'Файл загружен'),
        description: t('import.readyToValidate', 'Теперь можно запустить проверку.'),
      });
    },
    onError: (error) => {
      console.error('[ImportPriceDialog] Error:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create import job');
      setStep('error');
    },
  });

  // Validate mutation - calls Edge Function gateway
  const validateMutation = useMutation({
    mutationFn: async (mappingToUse?: ColumnMapping) => {
      if (!profile?.organization_id || !createdJob) throw new Error('Invalid state');

      setStep('validating');

      // Call Edge Function gateway with mapping and options
      const { data, error } = await supabase.functions.invoke<ValidateResponse>(ImportGatewayApi.validate, {
        body: {
          organization_id: profile.organization_id,
          import_job_id: createdJob.id,
          file_path: createdJob.storagePath,
          file_format: createdJob.fileFormat,
          mapping: mappingToUse || null,
          options: {
            transform: transformOptions,
            strict_roofing_only_m2: strictRoofingOnlyM2,
            excluded_row_numbers: excludedRowNumbers,
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

      // Check if mapping is required (only when ok=false AND specific error code)
      if (!data.ok && data.error_code === 'MISSING_REQUIRED_COLUMNS') {
        console.info('[ImportPriceDialog] Mapping required, showing mapping UI');
        setDetectedColumns(data.detected_columns || []);
        setMissingRequired(data.missing_required || []);
        setSuggestions(data.suggestions || {});
        
        // Pre-populate mapping from suggestions
        const initialMapping: ColumnMapping = {};
        Object.entries(data.suggestions || {}).forEach(([field, cols]) => {
          if (cols && cols.length > 0) {
            initialMapping[field] = cols[0];
          }
        });
        setColumnMapping(initialMapping);
        
        // Check if Measure column is detected
        const measureCol = (data.detected_columns || []).find(c => 
          c.toLowerCase() === 'measure' || c.toLowerCase() === 'единица'
        );
        setHasMeasureColumn(!!measureCol);
        
        setStep('mapping');
        return;
      }

      // Save validation stats (for showing warning about errors)
      setValidationStats({
        totalRows: data.total_rows || 0,
        validRows: data.valid_rows || 0,
        invalidRows: data.invalid_rows || 0,
      });

      // Validation passed (ok=true) - auto-transition to normalizing step (no extra button)
      setStep('validated');
      queryClient.invalidateQueries({ queryKey: ['import-jobs'] });
      toast({
        title: t('import.validateSuccess', 'Проверка завершена'),
        description: t('import.validateSuccessDesc', 'Файл успешно проверен. Переходим к нормализации.'),
      });
      
      // Auto-transition to normalizing after a brief pause to show validated state
      if (!dryRun) {
        setTimeout(() => {
          setStep('normalizing');
        }, 1500);
      }
    },
    onError: async (error) => {
      console.error('[ImportPriceDialog] Validate failed:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Validation failed');
      setStep('error');
      queryClient.invalidateQueries({ queryKey: ['import-jobs'] });
    },
  });

  // Poll for job completion (async publish)
  // For large files (70k+ rows), BigQuery load can take 10-15 minutes
  const pollJobStatus = async (jobId: string, maxAttempts = 300): Promise<'COMPLETED' | 'FAILED'> => {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, 3000)); // Poll every 3 seconds
      
      const { data: job } = await supabase
        .from('import_jobs')
        .select('status, error_message, error_code, summary')
        .eq('id', jobId)
        .single();
      
      if (job?.status === 'COMPLETED') {
        return 'COMPLETED';
      }
      if (job?.status === 'FAILED') {
        throw new Error(job.error_message || 'Import failed');
      }
      
      // Log progress for debugging (every 10 polls = 30 sec)
      if (i > 0 && i % 10 === 0) {
        const summary = job?.summary as Record<string, unknown> | null;
        const stage = summary?.stage || 'processing';
        const progress = summary?.progress || 0;
        console.info(`[ImportPriceDialog] Polling ${i}/${maxAttempts}: status=${job?.status}, stage=${stage}, progress=${progress}%`);
      }
      
      // Continue polling for APPLYING status
    }
    // 300 attempts × 3s = 15 minutes max
    throw new Error('Import timeout - job did not complete in 15 minutes. Check Import tab for status.');
  };

  // Publish mutation - calls Edge Function gateway (async)
  const publishMutation = useMutation({
    mutationFn: async () => {
      if (!profile?.organization_id || !createdJob) throw new Error('Invalid state');

      setStep('publishing');

      // Call Edge Function gateway with mapping, options, and allow_partial
      // Note: Edge function returns 202 immediately, worker processes async
      const { data, error } = await supabase.functions.invoke(ImportGatewayApi.publish, {
        body: {
          organization_id: profile.organization_id,
          import_job_id: createdJob.id,
          file_path: createdJob.storagePath,
          file_format: createdJob.fileFormat,
          archive_before_replace: archiveBeforeReplace,
          mapping: Object.keys(columnMapping).length > 0 ? columnMapping : null,
          options: {
            transform: transformOptions,
            strict_roofing_only_m2: strictRoofingOnlyM2,
            excluded_row_numbers: excludedRowNumbers,
          },
          allow_partial: true, // Import valid rows even if some have errors
        },
      });

      if (error) {
        console.error('[ImportPriceDialog] Publish error:', error);
        throw new Error(error.message || 'Publish failed');
      }

      // Check for immediate error in response body
      if (data?.ok === false && data?.error) {
        throw new Error(data.error);
      }

      console.info('[ImportPriceDialog] Publish dispatched (async):', data);
      
      // Poll for completion since worker runs async
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
      
      // If it's a timeout, don't show error - the job may still be running in background
      // User can track progress via ActiveImportBanner
      if (errorMsg.includes('timeout') || errorMsg.includes('15 minutes')) {
        toast({
          title: t('import.publishInProgress', 'Импорт выполняется'),
          description: t('import.publishInProgressDesc', 'Обработка большого файла занимает время. Прогресс отображается в баннере вверху страницы.'),
        });
        onOpenChange(false); // Close dialog gracefully
        queryClient.invalidateQueries({ queryKey: ['import-jobs'] });
        return;
      }
      
      setErrorMessage(errorMsg);
      setStep('error');
      queryClient.invalidateQueries({ queryKey: ['import-jobs'] });
    },
  });

  const resetForm = () => {
    setFile(null);
    setDryRun(false);
    setArchiveBeforeReplace(true);
    setStrictRoofingOnlyM2(true);
    setExcludedRowNumbers([]);
    setTransformOptions({
      sanitize_id: true,
      normalize_price: true,
      trim_text: true,
    });
    setStep('upload');
    setCreatedJob(null);
    setUploadProgress(0);
    setErrorMessage(null);
    setDetectedColumns([]);
    setMissingRequired([]);
    setSuggestions({});
    setColumnMapping({});
    setValidationStats(null);
    setHasMeasureColumn(false);
    setNormalizationResult(null);
  };

  const handleClose = () => {
    onOpenChange(false);
    // Reset after animation
    setTimeout(resetForm, 300);
  };

  // UX helpers: user can't really cancel backend job from UI (no RPC),
  // but can stop *tracking* and continue working.
  const handleContinueInBackground = () => {
    toast({
      title: t('import.continueInBackground', 'Импорт продолжается в фоне'),
      description: t(
        'import.continueInBackgroundDesc',
        'Закройте окно — прогресс будет виден в баннере сверху и во вкладке «Импорт».',
      ),
    });
    handleClose();
  };

  const handleStopTracking = () => {
    clearActiveJob();
    toast({
      title: t('import.trackingReset', 'Отслеживание сброшено'),
      description: t(
        'import.trackingResetDesc',
        'Фоновая задача может продолжаться на сервере, но UI перестанет ждать её завершения.',
      ),
    });
    handleClose();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      setFile(droppedFile);
    }
  };

  const handleValidateWithMapping = () => {
    validateMutation.mutate(columnMapping);
  };

  const fileFormat = file ? getFileFormat(file.name) : null;
  const isFormatAvailable = fileFormat ? isFormatSupported(fileFormat) : true;

  const isLoading = createJobMutation.isPending || validateMutation.isPending || publishMutation.isPending;

  // Check if all required fields are mapped
  const allRequiredMapped = REQUIRED_FIELDS.every((f) => !!columnMapping[f]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className={(step === 'mapping' || step === 'normalizing') ? 'max-w-2xl max-h-[85vh] overflow-y-auto' : 'max-w-lg'}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            {t('catalog.uploadPrice', 'Загрузить прайс')}
          </DialogTitle>
          <DialogDescription>
            {step === 'upload' && t('catalog.uploadPriceDesc', 'Загрузите файл прайс-листа для обновления каталога')}
            {step === 'uploading' && t('import.uploadingFile', 'Загрузка файла...')}
            {step === 'pending' && t('import.readyToValidate', 'Файл загружен. Запустите проверку.')}
            {step === 'validating' && t('import.validating', 'Проверка файла...')}
            {step === 'mapping' && t('import.mappingStep', 'Сопоставьте колонки файла с полями каталога')}
            {step === 'validated' && t('import.validated', 'Файл проверен. Можете опубликовать.')}
            {step === 'normalizing' && t('import.normalizingStep', 'Нормализация данных каталога')}
            {step === 'publishing' && t('import.publishing', 'Публикация данных...')}
            {step === 'done' && t('import.done', 'Импорт успешно завершён')}
            {step === 'error' && t('import.errorOccurred', 'Произошла ошибка')}
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Upload */}
        {step === 'upload' && (
          <div className="space-y-4">
            {/* File Drop Zone */}
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              className="border-2 border-dashed rounded-lg p-6 text-center hover:border-primary/50 transition-colors cursor-pointer"
              onClick={() => document.getElementById('file-input')?.click()}
            >
              <input
                id="file-input"
                type="file"
                accept=".csv,.xlsx,.xls,.jsonl,.parquet"
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
                  <p className="text-sm text-muted-foreground">{t('import.dragAndDrop')}</p>
                  <div className="flex flex-wrap justify-center gap-1 mt-3">
                    <Badge variant="secondary" className="text-xs">CSV</Badge>
                    <Badge variant="secondary" className="text-xs">XLSX</Badge>
                    <Badge variant="outline" className="text-xs text-muted-foreground">JSONL</Badge>
                    <Badge variant="outline" className="text-xs text-muted-foreground">Parquet</Badge>
                  </div>
                </>
              )}
            </div>

            {/* Format warning */}
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

            {/* Auto-mapping info */}
            <Card className="bg-muted/30 border-muted">
              <CardContent className="p-3 flex items-start gap-2">
                <HelpCircle className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                <div className="text-xs text-muted-foreground">
                  <p className="font-medium mb-1">{t('import.autoMappingTitle', 'Автоматическое распознавание')}</p>
                  <p>{t('import.autoMappingDesc', 'Можно загрузить CSV/XLSX в любом порядке колонок; система распознаёт автоматически. Если не распознано — вы выбираете соответствие колонок один раз.')}</p>
                </div>
              </CardContent>
            </Card>

            {/* Options */}
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center gap-2">
                  <Label htmlFor="dry-run" className="cursor-pointer">
                    {t('import.dryRun')} ({t('catalog.testMode', 'Тестовый режим')})
                  </Label>
                </div>
                <Switch
                  id="dry-run"
                  checked={dryRun}
                  onCheckedChange={setDryRun}
                />
              </div>

              <div className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center gap-2">
                  <Label htmlFor="archive" className="cursor-pointer">
                    {t('catalog.archiveBeforeReplace', 'Архивировать перед заменой')}
                  </Label>
                </div>
                <Switch
                  id="archive"
                  checked={archiveBeforeReplace}
                  onCheckedChange={setArchiveBeforeReplace}
                />
              </div>
            </div>

            {/* Only м² option */}
            <div className="flex items-center justify-between p-3 border rounded-lg bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
              <div className="flex-1">
                <Label htmlFor="strict-m2" className="cursor-pointer text-sm">
                  {t('import.strictM2Only', 'Импортировать только товары с м²')}
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t('import.strictM2OnlyDesc', 'Исключить товары с единицами шт, пог.м и др.')}
                </p>
              </div>
              <Switch
                id="strict-m2"
                checked={strictRoofingOnlyM2}
                onCheckedChange={setStrictRoofingOnlyM2}
              />
            </div>

            {/* Auto-corrections block */}
            <Card className="border-dashed">
              <CardContent className="p-3 space-y-2">
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  {t('import.autoCorrections', 'Авто-исправления')}
                </p>
                
                <div className="flex items-center justify-between">
                  <Label htmlFor="sanitize-id" className="text-xs cursor-pointer">
                    {t('import.sanitizeId', 'Очистить ID (только A-Z, 0-9, ._-)')}
                  </Label>
                  <Switch
                    id="sanitize-id"
                    checked={transformOptions.sanitize_id}
                    onCheckedChange={(checked) => setTransformOptions(prev => ({ ...prev, sanitize_id: checked }))}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <Label htmlFor="normalize-price" className="text-xs cursor-pointer">
                    {t('import.normalizePrice', 'Нормализовать цену (запятая→точка)')}
                  </Label>
                  <Switch
                    id="normalize-price"
                    checked={transformOptions.normalize_price}
                    onCheckedChange={(checked) => setTransformOptions(prev => ({ ...prev, normalize_price: checked }))}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <Label htmlFor="trim-text" className="text-xs cursor-pointer">
                    {t('import.trimText', 'Убрать пробелы по краям')}
                  </Label>
                  <Switch
                    id="trim-text"
                    checked={transformOptions.trim_text}
                    onCheckedChange={(checked) => setTransformOptions(prev => ({ ...prev, trim_text: checked }))}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Info about dry run */}
            {dryRun && (
              <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
                <CardContent className="p-3 flex items-start gap-2">
                  <Info className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-blue-800 dark:text-blue-300">
                    {t('import.dryRunInfo', 'В тестовом режиме данные не будут изменены. Вы увидите только результат проверки.')}
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Step 1.5: Uploading */}
        {step === 'uploading' && (
          <div className="py-6 space-y-4">
            <div className="text-center">
              <Loader2 className="h-10 w-10 mx-auto animate-spin text-primary mb-3" />
              <p className="text-sm text-muted-foreground">
                {t('import.uploadingToStorage', 'Загрузка файла в хранилище...')}
              </p>
            </div>
            <Progress value={uploadProgress} className="h-2" />
          </div>
        )}

        {/* Step 2: Pending - file uploaded, ready to validate */}
        {step === 'pending' && createdJob && (
          <div className="space-y-4">
            <Card className="bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800">
              <CardContent className="p-4 flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" />
                <div>
                  <p className="font-medium text-green-800 dark:text-green-300">
                    {t('import.fileUploaded', 'Файл загружен')}
                  </p>
                  <p className="text-xs text-green-700 dark:text-green-400 mt-1">
                    {t('import.clickValidate', 'Нажмите "Проверить" для валидации данных.')}
                  </p>
                </div>
              </CardContent>
            </Card>

            <div className="p-3 bg-muted/30 rounded-lg">
              <p className="text-xs text-muted-foreground mb-1">{t('import.storagePath', 'Путь в хранилище')}:</p>
              <code className="text-xs font-mono break-all">{createdJob.storagePath}</code>
            </div>

            <Button 
              onClick={() => validateMutation.mutate(undefined)}
              disabled={validateMutation.isPending}
              className="w-full"
            >
              {validateMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <PlayCircle className="h-4 w-4 mr-2" />
              )}
              {t('import.validate', 'Проверить')}
            </Button>
          </div>
        )}

        {/* Step 3: Validating */}
        {step === 'validating' && (
          <div className="py-8 text-center space-y-3">
            <Loader2 className="h-10 w-10 mx-auto animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              {t('import.validatingDesc', 'Проверяем структуру и данные файла...')}
            </p>
          </div>
        )}

        {/* Step 3.5: Column Mapping */}
        {step === 'mapping' && (
          <ColumnMappingStep
            detectedColumns={detectedColumns}
            missingRequired={missingRequired}
            suggestions={suggestions}
            mapping={columnMapping}
            onMappingChange={setColumnMapping}
          />
        )}

        {/* Step 4: Validated - auto-transition to normalizing */}
        {step === 'validated' && (
          <div className="space-y-4">
            <Card className="bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800">
              <CardContent className="p-4 flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" />
                <div>
                  <p className="font-medium text-green-800 dark:text-green-300">
                    {t('import.validationPassed', 'Проверка пройдена')}
                  </p>
                  <p className="text-xs text-green-700 dark:text-green-400 mt-1">
                    {t('import.validationPassedDesc', 'Переходим к нормализации данных...')}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Warning about rows with errors */}
            {validationStats && validationStats.invalidRows > 0 && (
              <Card className="bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800">
                <CardContent className="p-3 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div className="text-xs text-amber-800 dark:text-amber-300">
                    <p className="font-medium">
                      {t('import.hasErrors', 'Есть ошибки в {{count}} строках', { count: validationStats.invalidRows })}
                    </p>
                    <p className="mt-1">
                      {t('import.onlyValidWillBePublished', 'Будут опубликованы только валидные строки ({{count}} из {{total}})', { 
                        count: validationStats.validRows, 
                        total: validationStats.totalRows 
                      })}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {dryRun ? (
              <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
                <CardContent className="p-3 flex items-start gap-2">
                  <Info className="h-4 w-4 text-blue-600 mt-0.5" />
                  <p className="text-xs text-blue-800 dark:text-blue-300">
                    {t('import.dryRunComplete', 'Тестовый режим: данные не были изменены.')}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="py-4 text-center">
                <Loader2 className="h-8 w-8 mx-auto animate-spin text-primary mb-3" />
                <p className="text-sm text-muted-foreground">
                  {t('import.preparingNormalization', 'Подготовка нормализации...')}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Step 4.5: Normalizing */}
        {step === 'normalizing' && createdJob && profile?.organization_id && (
          <NormalizationWizard
            organizationId={profile.organization_id}
            importJobId={createdJob.id}
            stagingSample={stagingSample || []}
            onComplete={(result) => {
              setNormalizationResult(result);
              toast({
                title: t('normalize.applied', 'Нормализация применена'),
                description: result.patched_rows 
                  ? t('normalize.patchedRows', 'Обновлено строк: {{count}}', { count: result.patched_rows })
                  : t('normalize.noChangesNeeded', 'Изменения не требуются'),
              });
              // Auto-start publish after normalization
              publishMutation.mutate();
            }}
            onSkip={() => {
              setNormalizationResult({ skipped: true });
              publishMutation.mutate();
            }}
          />
        )}

        {/* Step 5: Publishing */}
        {step === 'publishing' && (
          <div className="py-8 text-center space-y-3">
            <Loader2 className="h-10 w-10 mx-auto animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              {t('import.publishingDesc', 'Обновляем каталог...')}
            </p>
            <p className="text-xs text-muted-foreground">
              {t(
                'import.publishingHint',
                'Если занимает долго — можно закрыть окно и продолжить работу. Задача идёт в фоне.',
              )}
            </p>
          </div>
        )}

        {/* Step 6: Done */}
        {step === 'done' && (
          <div className="py-6 space-y-6">
            <div className="text-center space-y-4">
              <CheckCircle2 className="h-12 w-12 mx-auto text-green-600" />
              <div>
                <p className="font-medium text-lg text-green-800 dark:text-green-300">
                  {t('import.importComplete', 'Импорт завершён!')}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {t('import.importCompleteDesc', 'Каталог успешно обновлён. Проверьте результаты во вкладке Импорт.')}
                </p>
              </div>
            </div>

            {/* Normalization summary */}
            {normalizationResult && !normalizationResult.skipped && (
              <Card className="bg-primary/5 border-primary/20">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <Sparkles className="h-5 w-5 text-primary flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">
                        {t('normalize.applied', 'Нормализация применена')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {normalizationResult.patched_rows 
                          ? t('normalize.patchedRowsSummary', 'Обновлено {{count}} строк в каталоге', { count: normalizationResult.patched_rows })
                          : t('normalize.noChangesNeeded', 'Все данные уже были нормализованы')}
                      </p>
                    </div>
                    <Badge variant="secondary">
                      {normalizationResult.patched_rows || 0} {t('common.rows', 'строк')}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* View history link */}
            <div className="text-center">
              <Button 
                variant="link" 
                size="sm"
                onClick={() => {
                  handleClose();
                  // Navigate to Normalization tab - parent can handle this via onSuccess
                }}
              >
                {t('import.viewNormalizationHistory', 'Открыть историю нормализаций →')}
              </Button>
            </div>
          </div>
        )}

        {/* Error state */}
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
                {t('catalog.startImport', 'Начать импорт')}
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
              <Button variant="outline" onClick={() => setStep('pending')}>
                {t('common.back', 'Назад')}
              </Button>
              <Button variant="ghost" onClick={handleClose}>
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

          {(step === 'pending' || step === 'validated') && (
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
