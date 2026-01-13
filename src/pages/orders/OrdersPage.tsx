import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Plus, Eye } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { DataTable, Column } from '@/components/ui/data-table';
import { StatusBadge, getStatusType } from '@/components/ui/status-badge';
import { format } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';

interface Order {
  id: string;
  order_number: string | null;
  status: string;
  total_amount: number;
  items_total: number;
  delivery_price: number;
  currency: string;
  created_at: string;
  contact: {
    full_name: string | null;
  } | null;
  buyer_company: {
    company_name: string;
  } | null;
}

export default function OrdersPage() {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const { data, isLoading } = useQuery({
    queryKey: ['orders', profile?.organization_id, search, page, pageSize],
    queryFn: async () => {
      if (!profile?.organization_id) return { data: [], count: 0 };

      let query = supabase
        .from('orders')
        .select(
          `
          *,
          contact:contacts(full_name),
          buyer_company:buyer_companies(company_name)
        `,
          { count: 'exact' }
        )
        .eq('organization_id', profile.organization_id)
        .order('created_at', { ascending: false });

      if (search) {
        query = query.ilike('order_number', `%${search}%`);
      }

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      query = query.range(from, to);

      const { data, count, error } = await query;
      if (error) throw error;

      return { data: data as Order[], count: count || 0 };
    },
    enabled: !!profile?.organization_id,
  });

  const formatCurrency = (value: number, currency: string = 'RUB') => {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const getStatusLabel = (status: string) => {
    const statusMap: Record<string, string> = {
      draft: t('orders.statuses.draft'),
      pending: t('orders.statuses.pending'),
      confirmed: t('orders.statuses.confirmed'),
      in_production: t('orders.statuses.inProduction'),
      shipped: t('orders.statuses.shipped'),
      delivered: t('orders.statuses.delivered'),
      cancelled: t('orders.statuses.cancelled'),
    };
    return statusMap[status] || status;
  };

  const columns: Column<Order>[] = [
    {
      key: 'order_number',
      header: t('orders.orderNumber'),
      cell: (row) => (
        <span className="font-medium">{row.order_number || row.id.slice(0, 8)}</span>
      ),
    },
    {
      key: 'customer',
      header: t('orders.customer'),
      cell: (row) =>
        row.buyer_company?.company_name ||
        row.contact?.full_name ||
        '—',
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
      key: 'items_total',
      header: t('orders.itemsTotal'),
      cell: (row) => formatCurrency(row.items_total, row.currency),
    },
    {
      key: 'delivery_price',
      header: t('orders.deliveryPrice'),
      cell: (row) => formatCurrency(row.delivery_price, row.currency),
    },
    {
      key: 'total_amount',
      header: t('orders.total'),
      cell: (row) => (
        <span className="font-semibold">
          {formatCurrency(row.total_amount, row.currency)}
        </span>
      ),
    },
    {
      key: 'created_at',
      header: t('common.date'),
      cell: (row) =>
        format(new Date(row.created_at), 'dd MMM yyyy', {
          locale: i18n.language === 'ru' ? ru : enUS,
        }),
    },
    {
      key: 'actions',
      header: t('common.actions'),
      cell: (row) => (
        <Button variant="ghost" size="icon">
          <Eye className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('orders.title')}</h1>
        </div>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          {t('orders.newOrder')}
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
        emptyMessage={t('orders.noOrders')}
      />
    </div>
  );
}
