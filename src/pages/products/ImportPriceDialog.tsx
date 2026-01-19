import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Upload, FileSpreadsheet, AlertTriangle, Loader2, Info, 
  Check, ChevronRight, PlayCircle, CheckCircle2, XCircle
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
  BackendConfig,
  STORAGE_BUCKET,
  type FileFormat 
} from '@/lib/backend';

interface ImportPriceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

type ImportStep = 'upload' | 'uploading' | 'pending' | 'validating' | 'validated' | 'publishing' | 'done' | 'error';

interface CreatedJob {
  id: string;
  storagePath: string;
  fileFormat: FileFormat;
}

export function ImportPriceDialog({ open, onOpenChange, onSuccess }: ImportPriceDialogProps) {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  const [file, setFile] = useState<File | null>(null);
  const [dryRun, setDryRun] = useState(false);
  const [archiveBeforeReplace, setArchiveBeforeReplace] = useState(true);
  
  // Multi-step state
  const [step, setStep] = useState<ImportStep>('upload');
  const [createdJob, setCreatedJob] = useState<CreatedJob | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
          upsert: true,
        });

      if (uploadError) {
        console.error('[ImportPriceDialog] Upload error:', uploadError);
        
        // Update job status to FAILED
        await supabase
          .from('import_jobs')
          .update({ 
            status: 'FAILED',
            error_message: `Upload failed: ${uploadError.message}`
          })
          .eq('id', job.id);

        throw new Error(`Failed to upload file: ${uploadError.message}`);
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
    mutationFn: async () => {
      if (!profile?.organization_id || !createdJob) throw new Error('Invalid state');

      setStep('validating');

      // Call Edge Function gateway
      const { data, error } = await supabase.functions.invoke(ImportGatewayApi.validate, {
        body: {
          organization_id: profile.organization_id,
          import_job_id: createdJob.id,
          file_path: createdJob.storagePath,
          file_format: createdJob.fileFormat,
        },
      });

      if (error) {
        console.error('[ImportPriceDialog] Validate error:', error);
        throw new Error(error.message || 'Validation failed');
      }

      // Check for error in response body
      if (data?.error) {
        throw new Error(data.error);
      }

      console.info('[ImportPriceDialog] Validate result:', data);
      return data;
    },
    onSuccess: () => {
      setStep('validated');
      queryClient.invalidateQueries({ queryKey: ['import-jobs'] });
      toast({
        title: t('import.validateSuccess', 'Проверка завершена'),
        description: t('import.validateSuccessDesc', 'Файл успешно проверен. Посмотрите результаты во вкладке Импорт.'),
      });
    },
    onError: async (error) => {
      console.error('[ImportPriceDialog] Validate failed:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Validation failed');
      setStep('error');
      queryClient.invalidateQueries({ queryKey: ['import-jobs'] });
    },
  });

  // Publish mutation - calls Edge Function gateway
  const publishMutation = useMutation({
    mutationFn: async () => {
      if (!profile?.organization_id || !createdJob) throw new Error('Invalid state');

      setStep('publishing');

      // Call Edge Function gateway
      const { data, error } = await supabase.functions.invoke(ImportGatewayApi.publish, {
        body: {
          organization_id: profile.organization_id,
          import_job_id: createdJob.id,
          file_path: createdJob.storagePath,
          file_format: createdJob.fileFormat,
          archive_before_replace: archiveBeforeReplace,
        },
      });

      if (error) {
        console.error('[ImportPriceDialog] Publish error:', error);
        throw new Error(error.message || 'Publish failed');
      }

      // Check for error in response body
      if (data?.error) {
        throw new Error(data.error);
      }

      console.info('[ImportPriceDialog] Publish result:', data);
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
      console.error('[ImportPriceDialog] Publish failed:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Publish failed');
      setStep('error');
      queryClient.invalidateQueries({ queryKey: ['import-jobs'] });
    },
  });

  const resetForm = () => {
    setFile(null);
    setDryRun(false);
    setArchiveBeforeReplace(true);
    setStep('upload');
    setCreatedJob(null);
    setUploadProgress(0);
    setErrorMessage(null);
  };

  const handleClose = () => {
    onOpenChange(false);
    // Reset after animation
    setTimeout(resetForm, 300);
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

  const fileFormat = file ? getFileFormat(file.name) : null;
  const isFormatAvailable = fileFormat ? isFormatSupported(fileFormat) : true;

  const isLoading = createJobMutation.isPending || validateMutation.isPending || publishMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
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
            {step === 'validated' && t('import.validated', 'Файл проверен. Можете опубликовать.')}
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

            {/* Backend config info (read-only) */}
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer hover:text-foreground">
                {t('import.backendConfig', 'Конфигурация бэкенда')}
              </summary>
              <div className="mt-2 p-2 bg-muted/50 rounded space-y-1 font-mono text-[10px]">
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="text-muted-foreground">Storage:</span>
                  <span className="break-all">{BackendConfig.storageBucket}</span>
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="text-muted-foreground">Worker:</span>
                  <span className="break-all">{BackendConfig.importWorkerUrl}</span>
                  {BackendConfig.isUsingFallbackWorkerUrl && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0">fallback</Badge>
                  )}
                </div>
              </div>
            </details>
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
              onClick={() => validateMutation.mutate()}
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

        {/* Step 4: Validated */}
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
                    {t('import.validationPassedDesc', 'Результаты доступны во вкладке Импорт. Нажмите "Опубликовать" для применения изменений.')}
                  </p>
                </div>
              </CardContent>
            </Card>

            {dryRun ? (
              <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
                <CardContent className="p-3 flex items-start gap-2">
                  <Info className="h-4 w-4 text-blue-600 mt-0.5" />
                  <p className="text-xs text-blue-800 dark:text-blue-300">
                    {t('import.dryRunComplete', 'Тестовый режим: данные не были изменены. Закройте окно или отключите тестовый режим для публикации.')}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Button 
                onClick={() => publishMutation.mutate()}
                disabled={publishMutation.isPending}
                className="w-full"
              >
                {publishMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <ChevronRight className="h-4 w-4 mr-2" />
                )}
                {t('import.publish', 'Опубликовать')}
              </Button>
            )}
          </div>
        )}

        {/* Step 5: Publishing */}
        {step === 'publishing' && (
          <div className="py-8 text-center space-y-3">
            <Loader2 className="h-10 w-10 mx-auto animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              {t('import.publishingDesc', 'Обновляем каталог...')}
            </p>
          </div>
        )}

        {/* Step 6: Done */}
        {step === 'done' && (
          <div className="py-6 text-center space-y-4">
            <CheckCircle2 className="h-12 w-12 mx-auto text-green-600" />
            <div>
              <p className="font-medium text-green-800 dark:text-green-300">
                {t('import.importComplete', 'Импорт завершён!')}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {t('import.importCompleteDesc', 'Каталог успешно обновлён. Проверьте результаты во вкладке Импорт.')}
              </p>
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
