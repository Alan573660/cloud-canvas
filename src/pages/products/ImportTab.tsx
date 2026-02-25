import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';
import { 
  History, AlertCircle, CheckCircle, Clock, Loader2, Eye, FileWarning,
  Upload, RefreshCw, Trash2, XCircle, Ban, RotateCcw, FileEdit, Copy
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { ImportPriceDialog } from './ImportPriceDialog';
import { StagingRowEditor } from './StagingRowEditor';
import { ActiveImportBanner } from '@/components/import/ActiveImportBanner';
import { useActiveImportJob } from '@/hooks/use-active-import';

// Dev mode flag - set to true for development debugging
const DEV_MODE = import.meta.env.DEV;

interface ImportJob {
  id: string;
  status: string;
  entity_type: string;
  file_name: string | null;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  inserted_rows: number;
  updated_rows: number;
  deleted_rows: number;
  dry_run: boolean;
  error_message: string | null;
  created_at: string;
  finished_at: string | null;
}

interface ImportError {
  id: string;
  row_number: number | null;
  column_name: string | null;
  error_type: string;
  message: string;
  raw_value: string | null;
}

interface StagingRow {
  id: string;
  row_number: number;
  validation_status: string;
  data: Record<string, unknown>;
}

// Staging row fields to display in preview table
const PREVIEW_FIELDS = ['title', 'id', 'cat_name', 'profile', 'thickness_mm', 'coating', 'color_or_ral', 'price_rub_m2', 'unit'] as const;
const PREVIEW_LABELS: Record<string, string> = {
  title: 'Название',
  id: 'ID',
  cat_name: 'Категория',
  profile: 'Профиль',
  thickness_mm: 'Толщина',
  coating: 'Покрытие',
  color_or_ral: 'Цвет',
  price_rub_m2: 'Цена',
  unit: 'Ед.',
};

export function ImportTab() {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const dateLocale = i18n.language === 'ru' ? ru : enUS;

  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [errorsDialogOpen, setErrorsDialogOpen] = useState(false);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<ImportJob | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorRowNumber, setEditorRowNumber] = useState<number>(0);

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (jobIds: string[]) => {
      if (!profile?.organization_id) throw new Error('No organization');
      
      const { error: errorsError } = await supabase
        .from('import_errors').delete()
        .eq('organization_id', profile.organization_id)
        .in('import_job_id', jobIds);
      if (errorsError) throw errorsError;
      
      const { error: stagingError } = await supabase
        .from('import_staging_rows').delete()
        .eq('organization_id', profile.organization_id)
        .in('import_job_id', jobIds);
      if (stagingError) throw stagingError;
      
      const { error: jobsError } = await supabase
        .from('import_jobs').delete()
        .eq('organization_id', profile.organization_id)
        .in('id', jobIds);
      if (jobsError) throw jobsError;
      
      return jobIds.length;
    },
    onSuccess: (count) => {
      toast.success(t('import.deletedCount', { count }));
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['import-jobs'] });
    },
    onError: (error: unknown) => {
      console.error('Delete error:', error);
      const err = error as { code?: string };
      toast.error(err.code === '42501' ? t('common.permissionDenied', 'Недостаточно прав') : t('common.error', 'Ошибка'));
    },
  });

  // Exclude mutations
  const excludeRowMutation = useMutation({
    mutationFn: async ({ jobId, rowNumber }: { jobId: string; rowNumber: number }) => {
      if (!profile?.organization_id) throw new Error('No organization');
      const { error } = await supabase
        .from('import_staging_rows')
        .update({ validation_status: 'EXCLUDED' })
        .eq('organization_id', profile.organization_id)
        .eq('import_job_id', jobId)
        .eq('row_number', rowNumber);
      if (error) throw error;
      return rowNumber;
    },
    onSuccess: (rowNumber) => {
      toast.success(t('import.rowExcluded', { row: rowNumber }));
      queryClient.invalidateQueries({ queryKey: ['import-errors'] });
      queryClient.invalidateQueries({ queryKey: ['import-jobs'] });
    },
    onError: (error: unknown) => {
      console.error('Exclude row error:', error);
      toast.error(t('common.error', 'Ошибка'));
    },
  });

  const excludeAllErrorsMutation = useMutation({
    mutationFn: async (jobId: string) => {
      if (!profile?.organization_id || !errors) throw new Error('No data');
      const rowNumbers = [...new Set(errors.filter(e => e.row_number != null).map(e => e.row_number!))];
      if (rowNumbers.length === 0) return 0;
      const { error } = await supabase
        .from('import_staging_rows')
        .update({ validation_status: 'EXCLUDED' })
        .eq('organization_id', profile.organization_id)
        .eq('import_job_id', jobId)
        .in('row_number', rowNumbers);
      if (error) throw error;
      return rowNumbers.length;
    },
    onSuccess: (count) => {
      toast.success(t('import.rowsExcluded', { count }));
      queryClient.invalidateQueries({ queryKey: ['import-errors'] });
    },
    onError: () => toast.error(t('common.error', 'Ошибка')),
  });

  const resetExclusionsMutation = useMutation({
    mutationFn: async (jobId: string) => {
      if (!profile?.organization_id) throw new Error('No organization');
      const { error, count } = await supabase
        .from('import_staging_rows')
        .update({ validation_status: 'INVALID' })
        .eq('organization_id', profile.organization_id)
        .eq('import_job_id', jobId)
        .eq('validation_status', 'EXCLUDED');
      if (error) throw error;
      return count ?? 0;
    },
    onSuccess: (count) => {
      toast.success(t('import.exclusionsReset', 'Сброшено исключений: {{count}}', { count }));
      queryClient.invalidateQueries({ queryKey: ['import-errors'] });
      queryClient.invalidateQueries({ queryKey: ['import-preview'] });
    },
    onError: () => toast.error(t('common.error', 'Ошибка')),
  });

  // Fetch import jobs
  const { data: jobs, isLoading, refetch } = useQuery({
    queryKey: ['import-jobs', profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return [];
      const { data, error } = await supabase
        .from('import_jobs')
        .select('*')
        .eq('organization_id', profile.organization_id)
        .eq('entity_type', 'PRODUCT_CATALOG')
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as ImportJob[];
    },
    enabled: !!profile?.organization_id,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.some(j => ['QUEUED', 'VALIDATING', 'APPLYING'].includes(j.status))) return 5000;
      return false;
    },
  });

  // Fetch errors
  const { data: errors, isLoading: loadingErrors } = useQuery({
    queryKey: ['import-errors', selectedJob?.id],
    queryFn: async () => {
      if (!selectedJob || !profile?.organization_id) return [];
      const { data, error } = await supabase
        .from('import_errors')
        .select('*')
        .eq('import_job_id', selectedJob.id)
        .eq('organization_id', profile.organization_id)
        .order('row_number', { ascending: true })
        .limit(100);
      if (error) throw error;
      return data as ImportError[];
    },
    enabled: !!selectedJob && errorsDialogOpen,
  });

  // Fetch preview
  const { data: previewRows, isLoading: loadingPreview } = useQuery({
    queryKey: ['import-preview', selectedJob?.id],
    queryFn: async () => {
      if (!selectedJob || !profile?.organization_id) return [];
      const { data, error } = await supabase
        .from('import_staging_rows')
        .select('*')
        .eq('import_job_id', selectedJob.id)
        .eq('organization_id', profile.organization_id)
        .order('row_number', { ascending: true })
        .limit(50);
      if (error) throw error;
      return data as StagingRow[];
    },
    enabled: !!selectedJob && previewDialogOpen,
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'COMPLETED': return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'FAILED': return <AlertCircle className="h-4 w-4 text-red-600" />;
      case 'QUEUED': case 'VALIDATING': case 'VALIDATED': case 'APPLYING':
        return <Loader2 className="h-4 w-4 text-amber-600 animate-spin" />;
      default: return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusVariant = (status: string): 'success' | 'error' | 'warning' | 'default' => {
    switch (status) {
      case 'COMPLETED': return 'success';
      case 'FAILED': return 'error';
      case 'QUEUED': case 'VALIDATING': case 'VALIDATED': case 'APPLYING': return 'warning';
      default: return 'default';
    }
  };

  const getStatusLabel = (status: string): string => {
    const labels: Record<string, string> = {
      QUEUED: t('import.statusQueued', 'В очереди'),
      VALIDATING: t('import.statusValidating', 'Проверка...'),
      VALIDATED: t('import.statusValidated', 'Проверен'),
      APPLYING: t('import.statusApplying', 'Импорт...'),
      COMPLETED: t('import.statusCompleted', 'Завершён'),
      FAILED: t('import.statusFailed', 'Ошибка'),
    };
    return labels[status] || status;
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-10 w-32" />
        </div>
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ActiveImportBanner className="mb-2" />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">{t('catalog.importHistory', 'История импорта')}</h3>
          <p className="text-sm text-muted-foreground">
            {t('catalog.importHistoryDesc', 'Загрузка прайс-листов и обновление каталога')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('common.refresh', 'Обновить')}
          </Button>
          <Button onClick={() => setImportDialogOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />
            {t('catalog.uploadPrice', 'Загрузить прайс')}
          </Button>
        </div>
      </div>

      {/* Bulk Delete */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg border">
          <span className="text-sm text-muted-foreground">
            {t('common.selected', 'Выбрано')}: {selectedIds.size}
          </span>
          <Button variant="destructive" size="sm" onClick={() => deleteMutation.mutate(Array.from(selectedIds))} disabled={deleteMutation.isPending}>
            {deleteMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
            {t('common.deleteSelected', 'Удалить выбранные')}
          </Button>
        </div>
      )}

      {/* Jobs Table */}
      {jobs && jobs.length > 0 ? (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]">
                  <Checkbox checked={jobs.length > 0 && selectedIds.size === jobs.length} onCheckedChange={(c) => c ? setSelectedIds(new Set(jobs.map(j => j.id))) : setSelectedIds(new Set())} />
                </TableHead>
                <TableHead>{t('import.file', 'Файл')}</TableHead>
                <TableHead>{t('common.date', 'Дата')}</TableHead>
                <TableHead>{t('common.status', 'Статус')}</TableHead>
                <TableHead>{t('import.totalRows', 'Строк')}</TableHead>
                <TableHead>{t('import.errors', 'Ошибки')}</TableHead>
                <TableHead className="text-right">{t('common.actions', 'Действия')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => (
                <TableRow key={job.id} className={selectedIds.has(job.id) ? 'bg-muted/50' : ''}>
                  <TableCell>
                    <Checkbox checked={selectedIds.has(job.id)} onCheckedChange={(checked) => {
                      const newSet = new Set(selectedIds);
                      checked ? newSet.add(job.id) : newSet.delete(job.id);
                      setSelectedIds(newSet);
                    }} />
                  </TableCell>
                  <TableCell>
                    <p className="text-sm font-medium">{job.file_name || t('import.manualImport', 'Ручной импорт')}</p>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(job.created_at), 'dd.MM.yyyy HH:mm', { locale: dateLocale })}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {getStatusIcon(job.status)}
                      <StatusBadge status={getStatusLabel(job.status)} type={getStatusVariant(job.status)} />
                    </div>
                  </TableCell>
                  <TableCell>{job.total_rows}</TableCell>
                  <TableCell>
                    {job.invalid_rows > 0 ? (
                      <Button variant="ghost" size="sm" className="text-red-600 h-auto p-0" onClick={() => { setSelectedJob(job); setErrorsDialogOpen(true); }}>
                        {job.invalid_rows}
                      </Button>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => { setSelectedJob(job); setPreviewDialogOpen(true); }}>
                        <Eye className="h-4 w-4 mr-1" />
                        {t('import.open', 'Открыть')}
                      </Button>
                      {/* Debug bundle - dev mode only */}
                      {DEV_MODE && (
                        <Button
                          variant="ghost"
                          size="sm"
                          title={t('import.copyDebugBundle')}
                          onClick={() => {
                            const bundle = {
                              org_id: profile?.organization_id,
                              import_job_id: job.id,
                              status: job.status,
                              last_error_code: job.error_message?.slice(0, 200) || null,
                              file_name: job.file_name,
                              created_at: job.created_at,
                            };
                            navigator.clipboard.writeText(JSON.stringify(bundle, null, 2));
                            toast.success(t('import.debugBundleCopied'));
                          }}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : (
        <Card className="p-8 text-center">
          <History className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">{t('import.noImports', 'Нет импортов')}</h3>
          <p className="text-sm text-muted-foreground mb-4">
            {t('import.noImportsDesc', 'Загрузите прайс-лист для обновления каталога')}
          </p>
          <Button onClick={() => setImportDialogOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />
            {t('catalog.uploadPrice', 'Загрузить прайс')}
          </Button>
        </Card>
      )}

      {/* Import Dialog */}
      <ImportPriceDialog 
        open={importDialogOpen} 
        onOpenChange={setImportDialogOpen}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['import-jobs'] });
          queryClient.invalidateQueries({ queryKey: ['catalog-stats-import'] });
        }}
      />

      {/* Errors Dialog */}
      <Dialog open={errorsDialogOpen} onOpenChange={setErrorsDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileWarning className="h-5 w-5 text-red-600" />
              {t('import.errors', 'Ошибки')}
            </DialogTitle>
            <DialogDescription>
              {selectedJob?.file_name} — {selectedJob?.invalid_rows} {t('import.errorsCount', 'ошибок')}
            </DialogDescription>
          </DialogHeader>
          
          {errors && errors.length > 0 && selectedJob && (
            <div className="flex justify-end gap-2 mb-2">
              <Button variant="outline" size="sm" onClick={() => resetExclusionsMutation.mutate(selectedJob.id)} disabled={resetExclusionsMutation.isPending}>
                {resetExclusionsMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-2" />}
                {t('import.resetExclusions', 'Сбросить исключения')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => excludeAllErrorsMutation.mutate(selectedJob.id)} disabled={excludeAllErrorsMutation.isPending}>
                {excludeAllErrorsMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Ban className="h-4 w-4 mr-2" />}
                {t('import.excludeAllErrors', 'Исключить все ошибочные')}
              </Button>
            </div>
          )}
          
          {loadingErrors ? (
            <div className="flex items-center justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : errors && errors.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[80px]">{t('import.rowNumber', '№ строки')}</TableHead>
                  <TableHead className="w-[120px]">{t('import.column', 'Колонка')}</TableHead>
                  <TableHead>{t('import.message', 'Описание')}</TableHead>
                  <TableHead className="w-[150px]">{t('import.rawValue', 'Значение')}</TableHead>
                  <TableHead className="w-[100px] text-right">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {errors.map((err) => (
                  <TableRow key={err.id}>
                    <TableCell className="font-mono text-sm">{err.row_number || '—'}</TableCell>
                    <TableCell className="font-mono text-sm">{err.column_name || '—'}</TableCell>
                    <TableCell className="text-sm">{err.message}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground truncate max-w-[150px]">{err.raw_value || '—'}</TableCell>
                    <TableCell className="text-right">
                      {err.row_number != null && selectedJob && (
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => { setEditorRowNumber(err.row_number!); setEditorOpen(true); }}>
                            <FileEdit className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => excludeRowMutation.mutate({ jobId: selectedJob.id, rowNumber: err.row_number! })} disabled={excludeRowMutation.isPending}>
                            <XCircle className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-center text-muted-foreground py-8">{t('import.noErrors', 'Ошибок нет')}</p>
          )}
        </DialogContent>
      </Dialog>

      {/* Staging Row Editor */}
      {selectedJob && (
        <StagingRowEditor open={editorOpen} onOpenChange={setEditorOpen} jobId={selectedJob.id} rowNumber={editorRowNumber} />
      )}

      {/* Preview Dialog - TABULAR instead of accordion */}
      <Dialog open={previewDialogOpen} onOpenChange={setPreviewDialogOpen}>
        <DialogContent className="max-w-5xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5" />
              {t('import.preview', 'Предпросмотр')}
            </DialogTitle>
            <DialogDescription>
              {selectedJob?.file_name} — {t('import.previewDescription', 'Первые 50 строк')}
            </DialogDescription>
          </DialogHeader>
          
          {loadingPreview ? (
            <div className="flex items-center justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : previewRows && previewRows.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]">#</TableHead>
                    {PREVIEW_FIELDS.map(field => (
                      <TableHead key={field}>{PREVIEW_LABELS[field] || field}</TableHead>
                    ))}
                    <TableHead>{t('common.status', 'Статус')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewRows.map((row) => (
                    <TableRow key={row.id} className={row.validation_status !== 'VALID' ? 'bg-red-50/50 dark:bg-red-950/10' : ''}>
                      <TableCell className="font-mono text-xs">{row.row_number}</TableCell>
                      {PREVIEW_FIELDS.map(field => (
                        <TableCell key={field} className="text-sm max-w-[150px] truncate">
                          {String((row.data as Record<string, unknown>)?.[field] ?? '—')}
                        </TableCell>
                      ))}
                      <TableCell>
                        <Badge variant={row.validation_status === 'VALID' ? 'default' : 'destructive'} className="text-xs">
                          {row.validation_status === 'VALID' ? '✓' : row.validation_status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-8">{t('import.noPreviewData', 'Нет данных для предпросмотра')}</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
