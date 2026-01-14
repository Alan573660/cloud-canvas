import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Users,
  Target,
  ShoppingCart,
  FileText,
  CreditCard,
  TrendingUp,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { showErrorToast } from '@/lib/error-utils';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  description?: string;
  loading?: boolean;
  trend?: {
    value: number;
    isPositive: boolean;
  };
}

function StatCard({ title, value, icon, description, loading, trend }: StatCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <div className="text-muted-foreground">{icon}</div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <div className="text-2xl font-bold">{value}</div>
        )}
        {description && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        )}
        {trend && !loading && (
          <div
            className={`flex items-center text-xs mt-1 ${
              trend.isPositive ? 'text-success' : 'text-destructive'
            }`}
          >
            <TrendingUp
              className={`h-3 w-3 mr-1 ${!trend.isPositive && 'rotate-180'}`}
            />
            {trend.value}%
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();

  const { data: stats, isLoading, error } = useQuery({
    queryKey: ['dashboard-stats', profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return null;

      const [contactsRes, leadsRes, ordersRes, invoicesRes, balanceRes] =
        await Promise.all([
          supabase
            .from('contacts')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', profile.organization_id),
          supabase
            .from('leads')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', profile.organization_id),
          supabase
            .from('orders')
            .select('id, total_amount', { count: 'exact' })
            .eq('organization_id', profile.organization_id),
          supabase
            .from('invoices')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', profile.organization_id)
            .eq('status', 'SENT'),
          supabase
            .from('balances')
            .select('balance_rub')
            .eq('organization_id', profile.organization_id)
            .single(),
        ]);

      const totalRevenue =
        ordersRes.data?.reduce((sum, order) => sum + (order.total_amount || 0), 0) || 0;

      return {
        contacts: contactsRes.count || 0,
        leads: leadsRes.count || 0,
        orders: ordersRes.count || 0,
        pendingInvoices: invoicesRes.count || 0,
        totalRevenue,
        balance: balanceRes.data?.balance_rub || 0,
      };
    },
    enabled: !!profile?.organization_id,
  });

  // Show error toast if query failed
  if (error) {
    showErrorToast(error, { logPrefix: 'DashboardPage' });
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      maximumFractionDigits: 0,
    }).format(value);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t('dashboard.title')}</h1>
        <p className="text-muted-foreground">
          {t('dashboard.welcome')}, {profile?.full_name || profile?.email}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title={t('dashboard.activeContacts')}
          value={stats?.contacts || 0}
          icon={<Users className="h-4 w-4" />}
          loading={isLoading}
        />
        <StatCard
          title={t('dashboard.totalLeads')}
          value={stats?.leads || 0}
          icon={<Target className="h-4 w-4" />}
          loading={isLoading}
        />
        <StatCard
          title={t('dashboard.totalOrders')}
          value={stats?.orders || 0}
          icon={<ShoppingCart className="h-4 w-4" />}
          loading={isLoading}
        />
        <StatCard
          title={t('dashboard.pendingInvoices')}
          value={stats?.pendingInvoices || 0}
          icon={<FileText className="h-4 w-4" />}
          loading={isLoading}
        />
        <StatCard
          title={t('dashboard.totalRevenue')}
          value={formatCurrency(stats?.totalRevenue || 0)}
          icon={<TrendingUp className="h-4 w-4" />}
          loading={isLoading}
        />
        <StatCard
          title={t('dashboard.balance')}
          value={formatCurrency(stats?.balance || 0)}
          icon={<CreditCard className="h-4 w-4" />}
          loading={isLoading}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.recentActivity')}</CardTitle>
            <CardDescription>
              {t('dashboard.overview')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              {t('common.noData')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.quickStats')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              {t('common.noData')}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
