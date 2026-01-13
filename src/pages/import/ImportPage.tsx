import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Upload, FileSpreadsheet, CheckCircle, XCircle, Clock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, Column } from '@/components/ui/data-table';
import { StatusBadge, getStatusType } from '@/components/ui/status-badge';
import { Progress } from '@/components/ui/progress';
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
  created_at: string;
  finished_at: string | null;
}

export default function ImportPage() {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const { data, isLoading } = useQuery({
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

  const getStatusLabel = (status: string) => {
    const statusMap: Record<string, string> = {
      pending: t('import.statuses.pending'),
      processing: t('import.statuses.processing'),
      completed: t('import.statuses.completed'),
      failed: t('import.statuses.failed'),
    };
    return statusMap[status] || status;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-600" />;
      case 'processing':
        return <Clock className="h-4 w-4 text-yellow-600 animate-pulse" />;
      default:
        return <Clock className="h-4 w-4 text-gray-600" />;
    }
  };

  const columns: Column<ImportJob>[] = [
    {
      key: 'file_name',
      header: t('common.name'),
      cell: (row) => (
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{row.file_name || '—'}</span>
        </div>
      ),
    },
    {
      key: 'entity_type',
      header: t('import.selectEntity'),
      cell: (row) => <span className="capitalize">{row.entity_type}</span>,
    },
    {
      key: 'status',
      header: t('common.status'),
      cell: (row) => (
        <div className="flex items-center gap-2">
          {getStatusIcon(row.status)}
          <StatusBadge
            status={getStatusLabel(row.status)}
            type={getStatusType(row.status)}
          />
        </div>
      ),
    },
    {
      key: 'rows',
      header: t('import.totalRows'),
      cell: (row) => (
        <div className="space-y-1">
          <div className="text-sm">
            {row.inserted_rows + row.updated_rows} / {row.total_rows}
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
        <span className="text-green-600">{row.valid_rows}</span>
      ),
    },
    {
      key: 'invalid_rows',
      header: t('import.invalidRows'),
      cell: (row) => (
        <span className={row.invalid_rows > 0 ? 'text-red-600' : ''}>
          {row.invalid_rows}
        </span>
      ),
    },
    {
      key: 'created_at',
      header: t('common.date'),
      cell: (row) =>
        format(new Date(row.created_at), 'dd MMM yyyy HH:mm', {
          locale: i18n.language === 'ru' ? ru : enUS,
        }),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('import.title')}</h1>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            {t('import.uploadFile')}
          </CardTitle>
          <CardDescription>
            {t('import.selectEntity')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center">
            <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              Drag and drop your file here, or click to browse
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Supported formats: CSV, XLSX
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('import.status')}</CardTitle>
        </CardHeader>
        <CardContent>
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
          />
        </CardContent>
      </Card>
    </div>
  );
}
