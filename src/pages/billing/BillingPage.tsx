import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { CreditCard, ArrowUpRight, ArrowDownRight, RefreshCw, Download, Filter } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { DataTable, Column } from '@/components/ui/data-table';
import { StatusBadge } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
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

const TYPES = ['ALL', 'TOP_UP', 'DEBIT', 'REFUND'] as const;
const REASONS = ['ALL', 'CALL_COST', 'EMAIL_COST', 'LLM_COST', 'INVOICE_COST', 'SUBSCRIPTION', 'MANUAL', 'PAYMENT'] as const;

export default function BillingPage() {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [reasonFilter, setReasonFilter] = useState<string>('ALL');

  // Role check for export
  const canExport = profile?.role && ['owner', 'admin', 'accountant'].includes(profile.role);

  const { data: balance, isLoading: balanceLoading } = useQuery({
    queryKey: ['balance', profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return null;
      const { data, error } = await supabase
        .from('balances')
        .select('balance_rub')
        .eq('organization_id', profile.organization_id)
        .single();
      if (error && error.code !== 'PGRST116') throw error;
      return data?.balance_rub ?? 0;
    },
    enabled: !!profile?.organization_id,
  });

  const { data: transactions, isLoading } = useQuery({
    queryKey: ['transactions', profile?.organization_id, page, pageSize, typeFilter, reasonFilter],
    queryFn: async () => {
      if (!profile?.organization_id) return { data: [], count: 0 };

      let query = supabase
        .from('billing_transactions')
        .select('*', { count: 'exact' })
        .eq('organization_id', profile.organization_id)
        .order('created_at', { ascending: false });

      if (typeFilter !== 'ALL') {
        query = query.eq('type', typeFilter);
      }
      if (reasonFilter !== 'ALL') {
        query = query.eq('reason', reasonFilter);
      }

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      query = query.range(from, to);

      const { data, count, error } = await query;
      if (error) throw error;

      return { data: data as Transaction[], count: count || 0 };
    },
    enabled: !!profile?.organization_id,
  });

  // Fetch all transactions for CSV export (without pagination)
  const { data: allTransactions, refetch: fetchAllForExport, isFetching: exportLoading } = useQuery({
    queryKey: ['transactions-export', profile?.organization_id, typeFilter, reasonFilter],
    queryFn: async () => {
      if (!profile?.organization_id) return [];

      let query = supabase
        .from('billing_transactions')
        .select('id, type, amount_rub, reason, reference_type, reference_id, created_at')
        .eq('organization_id', profile.organization_id)
        .order('created_at', { ascending: false })
        .limit(1000);

      if (typeFilter !== 'ALL') {
        query = query.eq('type', typeFilter);
      }
      if (reasonFilter !== 'ALL') {
        query = query.eq('reason', reasonFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Transaction[];
    },
    enabled: false, // Only fetch on demand
  });

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat(i18n.language === 'ru' ? 'ru-RU' : 'en-US', {
      style: 'currency',
      currency: 'RUB',
      maximumFractionDigits: 2,
    }).format(value);
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'TOP_UP':
        return <ArrowUpRight className="h-4 w-4 text-success" />;
      case 'DEBIT':
        return <ArrowDownRight className="h-4 w-4 text-destructive" />;
      case 'REFUND':
        return <RefreshCw className="h-4 w-4 text-primary" />;
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
      INVOICE_COST: t('billing.reasons.invoiceCost'),
      SUBSCRIPTION: t('billing.reasons.subscription'),
      MANUAL: t('billing.reasons.manual'),
      PAYMENT: t('billing.reasons.payment'),
    };
    return reasonMap[reason] || reason;
  };

  const handleExportCSV = async () => {
    const result = await fetchAllForExport();
    const data = result.data || [];
    
    if (data.length === 0) return;

    const headers = [
      t('common.date'),
      t('billing.type'),
      t('billing.amount'),
      t('billing.reason'),
      t('billing.referenceType'),
      t('billing.referenceId'),
    ];

    const rows = data.map((tx) => [
      format(new Date(tx.created_at), 'yyyy-MM-dd HH:mm:ss'),
      tx.type,
      tx.amount_rub.toString(),
      tx.reason,
      tx.reference_type || '',
      tx.reference_id || '',
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
    ].join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `billing_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const columns: Column<Transaction>[] = [
    {
      key: 'created_at',
      header: t('common.date'),
      cell: (row) =>
        format(new Date(row.created_at), 'dd MMM yyyy HH:mm', {
          locale: i18n.language === 'ru' ? ru : enUS,
        }),
    },
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
            row.type === 'DEBIT' ? 'text-destructive' : 'text-success'
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
      key: 'reference_type',
      header: t('billing.referenceType'),
      cell: (row) => row.reference_type || '—',
    },
    {
      key: 'reference_id',
      header: t('billing.referenceId'),
      cell: (row) =>
        row.reference_id ? (
          <code className="text-xs bg-muted px-1 py-0.5 rounded">
            {row.reference_id.slice(0, 8)}...
          </code>
        ) : (
          '—'
        ),
    },
  ];

  const handleFilterChange = (filterType: 'type' | 'reason', value: string) => {
    if (filterType === 'type') {
      setTypeFilter(value);
    } else {
      setReasonFilter(value);
    }
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold">{t('billing.title')}</h1>
          <p className="text-muted-foreground">{t('billing.description')}</p>
        </div>
        {canExport && (
          <Button
            variant="outline"
            onClick={handleExportCSV}
            disabled={exportLoading || !transactions?.data?.length}
          >
            <Download className="mr-2 h-4 w-4" />
            {t('billing.exportCSV')}
          </Button>
        )}
      </div>

      {/* Balance Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {t('billing.currentBalance')}
          </CardTitle>
          <CreditCard className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {balanceLoading ? (
            <Skeleton className="h-9 w-32" />
          ) : (
            <div className="text-3xl font-bold">
              {formatCurrency(balance || 0)}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Transactions Table */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <CardTitle>{t('billing.transactions')}</CardTitle>
              <CardDescription>{t('billing.transactionsDesc')}</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Select value={typeFilter} onValueChange={(v) => handleFilterChange('type', v)}>
                <SelectTrigger className="w-[140px]">
                  <Filter className="mr-2 h-4 w-4" />
                  <SelectValue placeholder={t('billing.type')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">{t('common.all')}</SelectItem>
                  {TYPES.filter(t => t !== 'ALL').map((type) => (
                    <SelectItem key={type} value={type}>
                      {getTypeLabel(type)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={reasonFilter} onValueChange={(v) => handleFilterChange('reason', v)}>
                <SelectTrigger className="w-[160px]">
                  <Filter className="mr-2 h-4 w-4" />
                  <SelectValue placeholder={t('billing.reason')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">{t('common.all')}</SelectItem>
                  {REASONS.filter(r => r !== 'ALL').map((reason) => (
                    <SelectItem key={reason} value={reason}>
                      {getReasonLabel(reason)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
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
