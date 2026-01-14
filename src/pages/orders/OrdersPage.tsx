import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, Eye, Filter, X } from 'lucide-react';
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
const ORDER_STATUSES = ['DRAFT', 'CONFIRMED', 'INVOICED', 'PAID', 'CANCELLED', 'FAILED'] as const;
type OrderStatus = typeof ORDER_STATUSES[number];

// Roles that can manage orders
const CAN_MANAGE_ORDERS: string[] = ['owner', 'admin', 'operator'];

interface Order {
  id: string;
  order_number: string | null;
  status: OrderStatus;
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
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'all'>('all');

  const canManageOrders = profile?.role && CAN_MANAGE_ORDERS.includes(profile.role);

  const { data, isLoading } = useQuery({
    queryKey: ['orders', profile?.organization_id, search, page, pageSize, statusFilter],
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

      // Apply status filter
      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

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

  const getStatusLabel = (status: OrderStatus) => {
    const statusMap: Record<OrderStatus, string> = {
      DRAFT: t('orders.statuses.draft', 'Черновик'),
      CONFIRMED: t('orders.statuses.confirmed', 'Подтверждён'),
      INVOICED: t('orders.statuses.invoiced', 'Счёт выставлен'),
      PAID: t('orders.statuses.paid', 'Оплачен'),
      CANCELLED: t('orders.statuses.cancelled', 'Отменён'),
      FAILED: t('orders.statuses.failed', 'Ошибка'),
    };
    return statusMap[status] || status;
  };

  const getOrderStatusType = (status: OrderStatus) => {
    switch (status) {
      case 'PAID':
        return 'success' as const;
      case 'DRAFT':
      case 'CONFIRMED':
        return 'warning' as const;
      case 'INVOICED':
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
          type={getOrderStatusType(row.status)}
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
        <Button 
          variant="ghost" 
          size="icon"
          onClick={() => navigate(`/orders/${row.id}`)}
        >
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
        {canManageOrders && (
          <Button onClick={() => navigate('/orders/new')}>
            <Plus className="h-4 w-4 mr-2" />
            {t('orders.newOrder')}
          </Button>
        )}
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
            setStatusFilter(value as OrderStatus | 'all');
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={t('common.status')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('common.allStatuses')}</SelectItem>
            {ORDER_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {getStatusLabel(status)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="h-4 w-4 mr-1" />
            {t('common.reset')}
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={data?.data || []}
        loading={isLoading}
        searchPlaceholder={t('orders.orderNumber')}
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
