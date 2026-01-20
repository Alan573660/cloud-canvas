import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, formatDistanceToNow } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';
import { 
  History, 
  AlertCircle, 
  CheckCircle, 
  Clock, 
  Loader2, 
  Eye, 
  FileWarning,
  Upload,
  RefreshCw,
  Trash2,
  XCircle,
  Ban,
  RotateCcw,
  FileEdit
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { ImportPriceDialog } from './ImportPriceDialog';
import { StagingRowEditor } from './StagingRowEditor';

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
  
  // Staging row editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorRowNumber, setEditorRowNumber] = useState<number>(0);

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (jobIds: string[]) => {
      if (!profile?.organization_id) throw new Error('No organization');
      
      // 1. Delete from import_errors
      const { error: errorsError } = await supabase
        .from('import_errors')
        .delete()
        .eq('organization_id', profile.organization_id)
        .in('import_job_id', jobIds);
      
      if (errorsError) throw errorsError;
      
      // 2. Delete from import_staging_rows
      const { error: stagingError } = await supabase
        .from('import_staging_rows')
        .delete()
        .eq('organization_id', profile.organization_id)
        .in('import_job_id', jobIds);
      
      if (stagingError) throw stagingError;
      
      // 3. Delete from import_jobs
      const { error: jobsError } = await supabase
        .from('import_jobs')
        .delete()
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
    onError: (error: any) => {
      console.error('Delete error:', error);
      if (error.code === '42501' || error.message?.includes('policy')) {
        toast.error(t('common.permissionDenied', 'Недостаточно прав'));
      } else {
        toast.error(t('common.error', 'Ошибка'));
      }
    },
  });

  const handleSelectAll = (checked: boolean) => {
    if (checked && jobs) {
      setSelectedIds(new Set(jobs.map(j => j.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSelectOne = (jobId: string, checked: boolean) => {
    const newSet = new Set(selectedIds);
    if (checked) {
      newSet.add(jobId);
    } else {
      newSet.delete(jobId);
    }
    setSelectedIds(newSet);
  };

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return;
    deleteMutation.mutate(Array.from(selectedIds));
  };

  // Exclude single row mutation
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
    onError: (error: any) => {
      console.error('Exclude row error:', error);
      if (error.code === '42501' || error.message?.includes('policy')) {
        toast.error(t('common.permissionDenied', 'Недостаточно прав'));
      } else {
        toast.error(t('common.error', 'Ошибка'));
      }
    },
  });

  // Exclude all errored rows mutation
  const excludeAllErrorsMutation = useMutation({
    mutationFn: async (jobId: string) => {
      if (!profile?.organization_id || !errors) throw new Error('No data');

      // Get unique row numbers from errors
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
      queryClient.invalidateQueries({ queryKey: ['import-jobs'] });
    },
    onError: (error: any) => {
      console.error('Exclude all errors:', error);
      if (error.code === '42501' || error.message?.includes('policy')) {
        toast.error(t('common.permissionDenied', 'Недостаточно прав'));
      } else {
        toast.error(t('common.error', 'Ошибка'));
      }
    },
  });

  // Reset exclusions mutation
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
      queryClient.invalidateQueries({ queryKey: ['import-jobs'] });
    },
    onError: (error: any) => {
      console.error('Reset exclusions error:', error);
      if (error.code === '42501' || error.message?.includes('policy')) {
        toast.error(t('common.permissionDenied', 'Недостаточно прав'));
      } else {
        toast.error(t('common.error', 'Ошибка'));
      }
    },
  });

  const handleExcludeRow = (jobId: string, rowNumber: number | null) => {
    if (rowNumber == null) return;
    excludeRowMutation.mutate({ jobId, rowNumber });
  };

  const handleExcludeAllErrors = () => {
    if (!selectedJob) return;
    excludeAllErrorsMutation.mutate(selectedJob.id);
  };

  const handleResetExclusions = () => {
    if (!selectedJob) return;
    resetExclusionsMutation.mutate(selectedJob.id);
  };

  const handleOpenRowEditor = (rowNumber: number) => {
    setEditorRowNumber(rowNumber);
    setEditorOpen(true);
  };

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
      // Poll if any job is in progress
      const data = query.state.data;
      if (data?.some(j => ['QUEUED', 'VALIDATING', 'APPLYING'].includes(j.status))) {
        return 5000;
      }
      return false;
    },
  });

  // Fetch errors for selected job
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

  // Fetch preview for selected job
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
      case 'DONE':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'FAILED':
        return <AlertCircle className="h-4 w-4 text-red-600" />;
      case 'QUEUED':
      case 'VALIDATING':
      case 'APPLYING':
        return <Loader2 className="h-4 w-4 text-amber-600 animate-spin" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusVariant = (status: string): 'success' | 'error' | 'warning' | 'default' => {
    switch (status) {
      case 'DONE': return 'success';
      case 'FAILED': return 'error';
      case 'QUEUED':
      case 'VALIDATING':
      case 'APPLYING': return 'warning';
      default: return 'default';
    }
  };

  const handleViewErrors = (job: ImportJob) => {
    setSelectedJob(job);
    setErrorsDialogOpen(true);
  };

  const handleViewPreview = (job: ImportJob) => {
    setSelectedJob(job);
    setPreviewDialogOpen(true);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-10 w-32" />
        </div>
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
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

      {/* Delete Selected Button */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg border">
          <span className="text-sm text-muted-foreground">
            {t('common.selected', 'Выбрано')}: {selectedIds.size}
          </span>
          <Button 
            variant="destructive" 
            size="sm"
            onClick={handleDeleteSelected}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4 mr-2" />
            )}
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
                  <Checkbox 
                    checked={jobs.length > 0 && selectedIds.size === jobs.length}
                    onCheckedChange={handleSelectAll}
                  />
                </TableHead>
                <TableHead className="w-[180px]">{t('common.date')}</TableHead>
                <TableHead>{t('import.totalRows')}</TableHead>
                <TableHead>{t('import.validRows')}</TableHead>
                <TableHead>{t('import.invalidRows')}</TableHead>
                <TableHead>{t('import.insertedRows')}</TableHead>
                <TableHead>{t('common.status')}</TableHead>
                <TableHead className="text-right">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => (
                <TableRow key={job.id} className={selectedIds.has(job.id) ? 'bg-muted/50' : ''}>
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.has(job.id)}
                      onCheckedChange={(checked) => handleSelectOne(job.id, !!checked)}
                    />
                  </TableCell>
                  <TableCell>
                    <div>
                      <p className="text-sm font-medium">
                        {format(new Date(job.created_at), 'dd.MM.yyyy HH:mm', { locale: dateLocale })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {job.file_name || 'manual'}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>{job.total_rows}</TableCell>
                  <TableCell className="text-green-600">{job.valid_rows}</TableCell>
                  <TableCell className={job.invalid_rows > 0 ? 'text-red-600 font-medium' : ''}>
                    {job.invalid_rows}
                  </TableCell>
                  <TableCell>{job.inserted_rows + job.updated_rows}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {getStatusIcon(job.status)}
                      <StatusBadge status={job.status} type={getStatusVariant(job.status)} />
                      {job.dry_run && (
                        <Badge variant="outline" className="text-xs">
                          {t('import.dryRun')}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {job.invalid_rows > 0 && (
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => handleViewErrors(job)}
                        >
                          <FileWarning className="h-4 w-4 mr-1" />
                          {t('import.errors')}
                        </Button>
                      )}
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => handleViewPreview(job)}
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        Preview
                      </Button>
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
          <h3 className="text-lg font-medium mb-2">{t('import.noImports')}</h3>
          <p className="text-sm text-muted-foreground mb-4">
            {t('import.noImportsDesc')}
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
              {t('import.errors')}
            </DialogTitle>
            <DialogDescription>
              {selectedJob?.file_name} — {selectedJob?.invalid_rows} {t('import.invalidRows')}
            </DialogDescription>
          </DialogHeader>
          
          {/* Bulk action buttons */}
          {errors && errors.length > 0 && selectedJob && (
            <div className="flex justify-end gap-2 mb-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleResetExclusions}
                disabled={resetExclusionsMutation.isPending}
              >
                {resetExclusionsMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4 mr-2" />
                )}
                {t('import.resetExclusions', 'Сбросить исключения')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExcludeAllErrors}
                disabled={excludeAllErrorsMutation.isPending}
              >
                {excludeAllErrorsMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Ban className="h-4 w-4 mr-2" />
                )}
                {t('import.excludeAllErrors', 'Исключить все ошибочные')}
              </Button>
            </div>
          )}
          
          {loadingErrors ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : errors && errors.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[80px]">{t('import.rowNumber')}</TableHead>
                  <TableHead className="w-[120px]">{t('import.column')}</TableHead>
                  <TableHead>{t('import.message')}</TableHead>
                  <TableHead className="w-[150px]">{t('import.rawValue')}</TableHead>
                  <TableHead className="w-[140px] text-right">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {errors.map((err) => (
                  <TableRow key={err.id}>
                    <TableCell className="font-mono text-sm">{err.row_number || '—'}</TableCell>
                    <TableCell className="font-mono text-sm">{err.column_name || '—'}</TableCell>
                    <TableCell className="text-sm">{err.message}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground truncate max-w-[150px]">
                      {err.raw_value || '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {err.row_number != null && selectedJob && (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenRowEditor(err.row_number!)}
                            title={t('import.openRow', 'Открыть строку')}
                          >
                            <FileEdit className="h-4 w-4 text-muted-foreground hover:text-primary" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleExcludeRow(selectedJob.id, err.row_number)}
                            disabled={excludeRowMutation.isPending}
                            title={t('import.excludeRow', 'Исключить строку')}
                          >
                            <XCircle className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-center text-muted-foreground py-8">{t('import.noErrors')}</p>
          )}
        </DialogContent>
      </Dialog>

      {/* Staging Row Editor */}
      {selectedJob && (
        <StagingRowEditor
          open={editorOpen}
          onOpenChange={setEditorOpen}
          jobId={selectedJob.id}
          rowNumber={editorRowNumber}
        />
      )}

      {/* Preview Dialog */}
      <Dialog open={previewDialogOpen} onOpenChange={setPreviewDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5" />
              {t('import.preview')}
            </DialogTitle>
            <DialogDescription>
              {t('import.previewDescription')}
            </DialogDescription>
          </DialogHeader>
          
          {loadingPreview ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : previewRows && previewRows.length > 0 ? (
            <Accordion type="single" collapsible className="w-full">
              {previewRows.slice(0, 10).map((row, idx) => (
                <AccordionItem key={row.id} value={row.id}>
                  <AccordionTrigger className="text-sm">
                    <div className="flex items-center gap-3">
                      <Badge variant={row.validation_status === 'VALID' ? 'default' : 'destructive'} className="text-xs">
                        #{row.row_number}
                      </Badge>
                      <span className="font-mono text-xs text-muted-foreground">
                        {(row.data as any)?.sku || (row.data as any)?.id || 'N/A'}
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
                      {JSON.stringify(row.data, null, 2)}
                    </pre>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          ) : (
            <p className="text-center text-muted-foreground py-8">{t('import.noPreviewData')}</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
