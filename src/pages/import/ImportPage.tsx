import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { 
  Upload, FileSpreadsheet, CheckCircle, XCircle, Clock, 
  AlertTriangle, Eye, ChevronDown, ChevronUp, FileWarning
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, Column } from '@/components/ui/data-table';
import { StatusBadge, getStatusType } from '@/components/ui/status-badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { EmptyState } from '@/components/ui/permission-denied';
import { showErrorToast } from '@/lib/error-utils';
import { format } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';

interface ImportJob {
  id: string;
  entity_type: string;
  file_name: string | null;
  status: string;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  inserted_rows: number;
  updated_rows: number;
  deleted_rows: number;
  error_message: string | null;
  error_code: string | null;
  created_at: string;
  finished_at: string | null;
  dry_run: boolean;
  mode: string;
  source: string;
}

interface ImportError {
  id: string;
  row_number: number | null;
  column_name: string | null;
  error_type: string;
  message: string;
  raw_value: string | null;
  sheet_name: string | null;
}

interface StagingRow {
  id: string;
  row_number: number;
  validation_status: string;
  data: Record<string, unknown>;
}

export default function ImportPage() {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [errorsOpen, setErrorsOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const dateLocale = i18n.language === 'ru' ? ru : enUS;

  // Fetch import jobs
  const { data, isLoading, error } = useQuery({
    queryKey: ['import-jobs', profile?.organization_id, page, pageSize],
    queryFn: async () => {
      if (!profile?.organization_id) return { data: [], count: 0 };

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      const { data, count, error } = await supabase
        .from('import_jobs')
        .select('*', { count: 'exact' })
        .eq('organization_id', profile.organization_id)
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) throw error;
      return { data: data as ImportJob[], count: count || 0 };
    },
    enabled: !!profile?.organization_id,
  });

  // Fetch errors for selected job
  const { data: jobErrors, isLoading: errorsLoading } = useQuery({
    queryKey: ['import-errors', selectedJobId],
    queryFn: async () => {
      if (!selectedJobId) return [];

      const { data, error } = await supabase
        .from('import_errors')
        .select('id, row_number, column_name, error_type, message, raw_value, sheet_name')
        .eq('import_job_id', selectedJobId)
        .order('row_number', { ascending: true })
        .limit(100);

      if (error) throw error;
      return data as ImportError[];
    },
    enabled: !!selectedJobId && errorsOpen,
  });

  // Fetch staging rows for preview
  const { data: stagingRows, isLoading: stagingLoading } = useQuery({
    queryKey: ['import-staging', selectedJobId],
    queryFn: async () => {
      if (!selectedJobId) return [];

      const { data, error } = await supabase
        .from('import_staging_rows')
        .select('id, row_number, validation_status, data')
        .eq('import_job_id', selectedJobId)
        .order('row_number', { ascending: true })
        .limit(50);

      if (error) throw error;
      return data as StagingRow[];
    },
    enabled: !!selectedJobId && previewOpen,
  });

  if (error) {
    showErrorToast(error, { logPrefix: 'ImportPage' });
  }

  const getStatusLabel = (status: string) => {
    const key = `import.statuses.${status.toLowerCase()}`;
    return t(key, status);
  };

  const getStatusIcon = (status: string) => {
    switch (status.toLowerCase()) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-600" />;
      case 'processing':
        return <Clock className="h-4 w-4 text-yellow-600 animate-pulse" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getEntityLabel = (entityType: string) => {
    const labels: Record<string, string> = {
      products: t('nav.products', 'Товары'),
      contacts: t('nav.contacts', 'Контакты'),
      companies: t('nav.companies', 'Компании'),
      leads: t('nav.leads', 'Лиды'),
      orders: t('nav.orders', 'Заказы'),
    };
    return labels[entityType] || entityType;
  };

  const handleViewErrors = (jobId: string) => {
    setSelectedJobId(jobId);
    setErrorsOpen(true);
  };

  const handleViewPreview = (jobId: string) => {
    setSelectedJobId(jobId);
    setPreviewOpen(true);
  };

  const columns: Column<ImportJob>[] = [
    {
      key: 'file_name',
      header: t('common.name'),
      cell: (row) => (
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
          <div>
            <span className="font-medium">{row.file_name || '—'}</span>
            {row.dry_run && (
              <Badge variant="outline" className="ml-2 text-xs">
                {t('import.dryRun', 'Тест')}
              </Badge>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'entity_type',
      header: t('import.selectEntity'),
      cell: (row) => (
        <Badge variant="secondary">{getEntityLabel(row.entity_type)}</Badge>
      ),
    },
    {
      key: 'status',
      header: t('common.status'),
      cell: (row) => (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            {getStatusIcon(row.status)}
            <StatusBadge
              status={getStatusLabel(row.status)}
              type={getStatusType(row.status)}
            />
          </div>
          {row.error_message && (
            <p className="text-xs text-destructive truncate max-w-[200px]" title={row.error_message}>
              {row.error_message}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'rows',
      header: t('import.totalRows'),
      cell: (row) => (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-green-600">+{row.inserted_rows}</span>
            <span className="text-blue-600">~{row.updated_rows}</span>
            <span className="text-muted-foreground">/ {row.total_rows}</span>
          </div>
          <Progress
            value={
              row.total_rows > 0
                ? ((row.inserted_rows + row.updated_rows) / row.total_rows) * 100
                : 0
            }
            className="h-1"
          />
        </div>
      ),
    },
    {
      key: 'valid_rows',
      header: t('import.validRows'),
      cell: (row) => (
        <span className="text-green-600 font-medium">{row.valid_rows}</span>
      ),
    },
    {
      key: 'invalid_rows',
      header: t('import.invalidRows'),
      cell: (row) => (
        <div className="flex items-center gap-2">
          <span className={row.invalid_rows > 0 ? 'text-red-600 font-medium' : 'text-muted-foreground'}>
            {row.invalid_rows}
          </span>
          {row.invalid_rows > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2"
              onClick={() => handleViewErrors(row.id)}
            >
              <Eye className="h-3 w-3" />
            </Button>
          )}
        </div>
      ),
    },
    {
      key: 'created_at',
      header: t('common.date'),
      cell: (row) =>
        format(new Date(row.created_at), 'dd MMM yyyy HH:mm', { locale: dateLocale }),
    },
    {
      key: 'actions',
      header: t('common.actions'),
      cell: (row) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleViewPreview(row.id)}
            title={t('import.preview')}
          >
            <Eye className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  const selectedJob = data?.data.find(j => j.id === selectedJobId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('import.title')}</h1>
          <p className="text-muted-foreground">{t('import.description', 'Загрузка и обработка данных из файлов')}</p>
        </div>
      </div>

      {/* Upload placeholder */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            {t('import.uploadFile')}
          </CardTitle>
          <CardDescription>
            {t('import.uploadDescription', 'Загрузите файл CSV или XLSX для импорта данных')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center hover:border-primary/50 transition-colors cursor-pointer">
            <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              {t('import.dragAndDrop', 'Перетащите файл сюда или нажмите для выбора')}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              {t('import.supportedFormats', 'Поддерживаемые форматы: CSV, XLSX')}
            </p>
            <p className="text-xs text-amber-600 mt-4 flex items-center justify-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {t('import.workerTodo', 'TODO: Интеграция с backend worker в разработке')}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Import jobs history */}
      <Card>
        <CardHeader>
          <CardTitle>{t('import.status')}</CardTitle>
          <CardDescription>{t('import.historyDescription', 'История импортов и их статусы')}</CardDescription>
        </CardHeader>
        <CardContent>
          {!isLoading && (!data?.data || data.data.length === 0) ? (
            <EmptyState
              icon={FileSpreadsheet}
              title={t('import.noImports', 'Нет импортов')}
              description={t('import.noImportsDesc', 'Загрузите файл для начала импорта данных')}
            />
          ) : (
            <DataTable
              columns={columns}
              data={data?.data || []}
              loading={isLoading}
              page={page}
              pageSize={pageSize}
              totalCount={data?.count || 0}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
              emptyMessage={t('import.noImports', 'Нет импортов')}
            />
          )}
        </CardContent>
      </Card>

      {/* Errors dialog */}
      <Dialog open={errorsOpen} onOpenChange={setErrorsOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileWarning className="h-5 w-5 text-destructive" />
              {t('import.errors')} — {selectedJob?.file_name}
            </DialogTitle>
            <DialogDescription>
              {t('import.errorsDescription', 'Ошибки валидации при обработке файла')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto">
            {errorsLoading ? (
              <div className="flex justify-center py-8">
                <Clock className="h-6 w-6 animate-spin" />
              </div>
            ) : jobErrors && jobErrors.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[80px]">{t('import.rowNumber', 'Строка')}</TableHead>
                    <TableHead>{t('import.column', 'Колонка')}</TableHead>
                    <TableHead>{t('import.errorType', 'Тип')}</TableHead>
                    <TableHead>{t('import.message', 'Сообщение')}</TableHead>
                    <TableHead>{t('import.rawValue', 'Значение')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobErrors.map((err) => (
                    <TableRow key={err.id}>
                      <TableCell className="font-mono">{err.row_number ?? '—'}</TableCell>
                      <TableCell className="font-medium">{err.column_name || '—'}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{err.error_type}</Badge>
                      </TableCell>
                      <TableCell className="max-w-[300px] truncate" title={err.message}>
                        {err.message}
                      </TableCell>
                      <TableCell className="font-mono text-xs max-w-[150px] truncate" title={err.raw_value || undefined}>
                        {err.raw_value || '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                {t('import.noErrors', 'Ошибок не найдено')}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Preview dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-5xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5" />
              {t('import.preview')} — {selectedJob?.file_name}
            </DialogTitle>
            <DialogDescription className="flex items-center gap-2">
              {t('import.previewDescription', 'Предварительный просмотр данных (первые 50 строк)')}
              {selectedJobId && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 font-mono text-xs"
                  onClick={() => {
                    navigator.clipboard.writeText(selectedJobId);
                    import('sonner').then(({ toast }) => toast.success(t('common.copied', 'ID скопирован')));
                  }}
                  title={t('import.copyJobId', 'Скопировать ID импорта')}
                >
                  ID: {selectedJobId.slice(0, 8)}…
                </Button>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto">
            {stagingLoading ? (
              <div className="flex justify-center py-8">
                <Clock className="h-6 w-6 animate-spin" />
              </div>
            ) : stagingRows && stagingRows.length > 0 ? (
              <div className="space-y-2">
                {stagingRows.map((row) => (
                  <Collapsible key={row.id}>
                    <CollapsibleTrigger asChild>
                      <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg hover:bg-muted cursor-pointer">
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-sm text-muted-foreground">
                            #{row.row_number}
                          </span>
                          <StatusBadge
                            status={row.validation_status}
                            type={row.validation_status === 'valid' ? 'success' : 'error'}
                          />
                        </div>
                        <ChevronDown className="h-4 w-4" />
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <pre className="p-3 bg-muted rounded-lg mt-1 text-xs overflow-auto max-h-48">
                        {JSON.stringify(row.data, null, 2)}
                      </pre>
                    </CollapsibleContent>
                  </Collapsible>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                {t('import.noPreviewData', 'Нет данных для предпросмотра')}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
