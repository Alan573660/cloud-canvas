import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Plus, FileDown, Eye } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { DataTable, Column } from '@/components/ui/data-table';
import { StatusBadge, getStatusType } from '@/components/ui/status-badge';
import { format } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';

interface Invoice {
  id: string;
  invoice_number: string | null;
  status: string;
  total_amount: number;
  sent_at: string | null;
  paid_at: string | null;
  pdf_url: string | null;
  created_at: string;
  order_id: string;
}

export default function InvoicesPage() {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const { data, isLoading } = useQuery({
    queryKey: ['invoices', profile?.organization_id, search, page, pageSize],
    queryFn: async () => {
      if (!profile?.organization_id) return { data: [], count: 0 };

      let query = supabase
        .from('invoices')
        .select('*', { count: 'exact' })
        .eq('organization_id', profile.organization_id)
        .order('created_at', { ascending: false });

      if (search) {
        query = query.ilike('invoice_number', `%${search}%`);
      }

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      query = query.range(from, to);

      const { data, count, error } = await query;
      if (error) throw error;

      return { data: data as Invoice[], count: count || 0 };
    },
    enabled: !!profile?.organization_id,
  });

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      maximumFractionDigits: 0,
    }).format(value);
  };

  const getStatusLabel = (status: string) => {
    const statusMap: Record<string, string> = {
      draft: t('invoices.statuses.draft'),
      sent: t('invoices.statuses.sent'),
      paid: t('invoices.statuses.paid'),
      overdue: t('invoices.statuses.overdue'),
      cancelled: t('invoices.statuses.cancelled'),
    };
    return statusMap[status] || status;
  };

  const columns: Column<Invoice>[] = [
    {
      key: 'invoice_number',
      header: t('invoices.invoiceNumber'),
      cell: (row) => (
        <span className="font-medium">{row.invoice_number || row.id.slice(0, 8)}</span>
      ),
    },
    {
      key: 'order_id',
      header: t('invoices.order'),
      cell: (row) => row.order_id?.slice(0, 8) || '—',
    },
    {
      key: 'status',
      header: t('common.status'),
      cell: (row) => (
        <StatusBadge
          status={getStatusLabel(row.status)}
          type={getStatusType(row.status)}
        />
      ),
    },
    {
      key: 'total_amount',
      header: t('invoices.amount'),
      cell: (row) => (
        <span className="font-semibold">{formatCurrency(row.total_amount)}</span>
      ),
    },
    {
      key: 'sent_at',
      header: t('invoices.sentAt'),
      cell: (row) =>
        row.sent_at
          ? format(new Date(row.sent_at), 'dd MMM yyyy', {
              locale: i18n.language === 'ru' ? ru : enUS,
            })
          : '—',
    },
    {
      key: 'paid_at',
      header: t('invoices.paidAt'),
      cell: (row) =>
        row.paid_at
          ? format(new Date(row.paid_at), 'dd MMM yyyy', {
              locale: i18n.language === 'ru' ? ru : enUS,
            })
          : '—',
    },
    {
      key: 'actions',
      header: t('common.actions'),
      cell: (row) => (
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon">
            <Eye className="h-4 w-4" />
          </Button>
          {row.pdf_url && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => window.open(row.pdf_url!, '_blank')}
            >
              <FileDown className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('invoices.title')}</h1>
        </div>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          {t('invoices.newInvoice')}
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data?.data || []}
        loading={isLoading}
        searchPlaceholder={t('common.search')}
        onSearch={setSearch}
        searchValue={search}
        page={page}
        pageSize={pageSize}
        totalCount={data?.count || 0}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        emptyMessage={t('invoices.noInvoices')}
      />
    </div>
  );
}
