import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { CreditCard, ArrowUpRight, ArrowDownRight, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, Column } from '@/components/ui/data-table';
import { StatusBadge } from '@/components/ui/status-badge';
import { format } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';

interface Transaction {
  id: string;
  type: string;
  amount_rub: number;
  reason: string;
  reference_type: string | null;
  reference_id: string | null;
  created_at: string;
}

export default function BillingPage() {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const { data: balance } = useQuery({
    queryKey: ['balance', profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return null;

      const { data, error } = await supabase
        .from('balances')
        .select('balance_rub')
        .eq('organization_id', profile.organization_id)
        .single();

      if (error) throw error;
      return data?.balance_rub || 0;
    },
    enabled: !!profile?.organization_id,
  });

  const { data: transactions, isLoading } = useQuery({
    queryKey: ['transactions', profile?.organization_id, page, pageSize],
    queryFn: async () => {
      if (!profile?.organization_id) return { data: [], count: 0 };

      let query = supabase
        .from('billing_transactions')
        .select('*', { count: 'exact' })
        .eq('organization_id', profile.organization_id)
        .order('created_at', { ascending: false });

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      query = query.range(from, to);

      const { data, count, error } = await query;
      if (error) throw error;

      return { data: data as Transaction[], count: count || 0 };
    },
    enabled: !!profile?.organization_id,
  });

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      maximumFractionDigits: 2,
    }).format(value);
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'TOP_UP':
        return <ArrowUpRight className="h-4 w-4 text-green-600" />;
      case 'DEBIT':
        return <ArrowDownRight className="h-4 w-4 text-red-600" />;
      case 'REFUND':
        return <RefreshCw className="h-4 w-4 text-blue-600" />;
      default:
        return null;
    }
  };

  const getTypeLabel = (type: string) => {
    const typeMap: Record<string, string> = {
      TOP_UP: t('billing.types.topUp'),
      DEBIT: t('billing.types.debit'),
      REFUND: t('billing.types.refund'),
    };
    return typeMap[type] || type;
  };

  const getReasonLabel = (reason: string) => {
    const reasonMap: Record<string, string> = {
      CALL_COST: t('billing.reasons.callCost'),
      EMAIL_COST: t('billing.reasons.emailCost'),
      LLM_COST: t('billing.reasons.llmCost'),
      SUBSCRIPTION: t('billing.reasons.subscription'),
      MANUAL: t('billing.reasons.manual'),
      PAYMENT: t('billing.reasons.payment'),
    };
    return reasonMap[reason] || reason;
  };

  const columns: Column<Transaction>[] = [
    {
      key: 'type',
      header: t('billing.type'),
      cell: (row) => (
        <div className="flex items-center gap-2">
          {getTypeIcon(row.type)}
          <span>{getTypeLabel(row.type)}</span>
        </div>
      ),
    },
    {
      key: 'amount_rub',
      header: t('billing.amount'),
      cell: (row) => (
        <span
          className={`font-semibold ${
            row.type === 'DEBIT' ? 'text-red-600' : 'text-green-600'
          }`}
        >
          {row.type === 'DEBIT' ? '-' : '+'}
          {formatCurrency(row.amount_rub)}
        </span>
      ),
    },
    {
      key: 'reason',
      header: t('billing.reason'),
      cell: (row) => (
        <StatusBadge status={getReasonLabel(row.reason)} type="info" />
      ),
    },
    {
      key: 'reference',
      header: t('billing.reference'),
      cell: (row) =>
        row.reference_type
          ? `${row.reference_type}: ${row.reference_id?.slice(0, 8) || ''}`
          : '—',
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
      <div>
        <h1 className="text-3xl font-bold">{t('billing.title')}</h1>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('billing.balance')}
            </CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {formatCurrency(balance || 0)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('billing.transactions')}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={transactions?.data || []}
            loading={isLoading}
            page={page}
            pageSize={pageSize}
            totalCount={transactions?.count || 0}
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
