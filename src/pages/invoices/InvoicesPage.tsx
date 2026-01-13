import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { FileDown, Eye, Filter, X, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { DataTable, Column } from '@/components/ui/data-table';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { format } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';

// DB status values - MUST match database exactly
const INVOICE_STATUSES = ['DRAFT', 'CREATED', 'SENT', 'PAID', 'CANCELLED', 'FAILED'] as const;
type InvoiceStatus = typeof INVOICE_STATUSES[number];

interface Invoice {
  id: string;
  invoice_number: string | null;
  status: InvoiceStatus;
  total_amount: number;
  sent_at: string | null;
  paid_at: string | null;
  pdf_url: string | null;
  created_at: string;
  order_id: string;
  order: {
    order_number: string | null;
  } | null;
}

export default function InvoicesPage() {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'all'>('all');

  const { data, isLoading } = useQuery({
    queryKey: ['invoices', profile?.organization_id, search, page, pageSize, statusFilter],
    queryFn: async () => {
      if (!profile?.organization_id) return { data: [], count: 0 };

      let query = supabase
        .from('invoices')
        .select(`
          *,
          order:orders!invoices_order_id_fkey(order_number)
        `, { count: 'exact' })
        .eq('organization_id', profile.organization_id)
        .order('created_at', { ascending: false });

      // Apply status filter
      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

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

  const getStatusLabel = (status: InvoiceStatus) => {
    const statusMap: Record<InvoiceStatus, string> = {
      DRAFT: t('invoices.statuses.draft', 'Черновик'),
      CREATED: t('invoices.statuses.created', 'Создан'),
      SENT: t('invoices.statuses.sent', 'Отправлен'),
      PAID: t('invoices.statuses.paid', 'Оплачен'),
      CANCELLED: t('invoices.statuses.cancelled', 'Отменён'),
      FAILED: t('invoices.statuses.failed', 'Ошибка'),
    };
    return statusMap[status] || status;
  };

  const getInvoiceStatusType = (status: InvoiceStatus) => {
    switch (status) {
      case 'PAID':
        return 'success' as const;
      case 'DRAFT':
      case 'CREATED':
        return 'warning' as const;
      case 'SENT':
        return 'info' as const;
      case 'CANCELLED':
      case 'FAILED':
        return 'error' as const;
      default:
        return 'default' as const;
    }
  };

  const clearFilters = () => {
    setStatusFilter('all');
    setPage(1);
  };

  const hasActiveFilters = statusFilter !== 'all';

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
      cell: (row) => (
        <Button
          variant="link"
          size="sm"
          className="p-0 h-auto"
          onClick={() => navigate(`/orders/${row.order_id}`)}
        >
          {row.order?.order_number || row.order_id?.slice(0, 8) || '—'}
        </Button>
      ),
    },
    {
      key: 'status',
      header: t('common.status'),
      cell: (row) => (
        <StatusBadge
          status={getStatusLabel(row.status)}
          type={getInvoiceStatusType(row.status)}
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
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => navigate(`/invoices/${row.id}`)}
            title="Подробнее"
          >
            <Eye className="h-4 w-4" />
          </Button>
          {row.pdf_url && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => window.open(row.pdf_url!, '_blank')}
              title="Открыть PDF"
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
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4 p-4 bg-card rounded-lg border">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{t('common.filter')}:</span>
        </div>
        
        <Select
          value={statusFilter}
          onValueChange={(value) => {
            setStatusFilter(value as InvoiceStatus | 'all');
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={t('common.status')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('common.status')}: все</SelectItem>
            {INVOICE_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {getStatusLabel(status)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="h-4 w-4 mr-1" />
            Сбросить
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={data?.data || []}
        loading={isLoading}
        searchPlaceholder={t('invoices.invoiceNumber')}
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
