import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Users,
  Target,
  ShoppingCart,
  FileText,
  CreditCard,
  TrendingUp,
  TestTube2,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { showErrorToast } from '@/lib/error-utils';
import { toast } from 'sonner';

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
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState<{ normalize?: string; merge?: string } | null>(null);

  // E2E Test function for Edge Functions
  const runEdgeFunctionTests = async () => {
    if (!profile?.organization_id) {
      toast.error('No organization_id');
      return;
    }

    setTesting(true);
    setTestResults(null);

    const results: { normalize?: string; merge?: string } = {};

    try {
      // Test 1: settings-merge
      console.log('[E2E Test] Testing settings-merge...');
      const mergeRes = await supabase.functions.invoke('settings-merge', {
        body: {
          organization_id: profile.organization_id,
          patch: { pricing: { widths_selected: { TEST: { work_mm: 1, full_mm: 2 } } } },
        },
      });
      
      if (mergeRes.error) {
        results.merge = `❌ ERROR: ${mergeRes.error.message}`;
        console.error('[E2E Test] settings-merge error:', mergeRes.error);
      } else {
        results.merge = mergeRes.data?.ok ? '✅ OK' : `❌ ${JSON.stringify(mergeRes.data)}`;
        console.log('[E2E Test] settings-merge result:', mergeRes.data);
      }

      // Test 2: import-normalize dry_run (need a valid import_job_id)
      console.log('[E2E Test] Testing import-normalize dry_run...');
      
      // First, get a recent import job
      const { data: jobs } = await supabase
        .from('import_jobs')
        .select('id')
        .eq('organization_id', profile.organization_id)
        .in('status', ['VALIDATED', 'COMPLETED'])
        .order('created_at', { ascending: false })
        .limit(1);

      if (!jobs?.length) {
        results.normalize = '⚠️ No import jobs found to test';
      } else {
        const normalizeRes = await supabase.functions.invoke('import-normalize', {
          body: {
            op: 'dry_run',
            organization_id: profile.organization_id,
            import_job_id: jobs[0].id,
            scope: { only_where_null: true, limit: 2000 },
            ai_suggest: true,
          },
        });

        if (normalizeRes.error) {
          results.normalize = `❌ ERROR: ${normalizeRes.error.message}`;
          console.error('[E2E Test] import-normalize error:', normalizeRes.error);
        } else {
          const data = normalizeRes.data;
          results.normalize = data?.ok !== false 
            ? `✅ OK | stats: ${JSON.stringify(data?.stats || {})} | questions: ${data?.questions?.length || 0}`
            : `❌ ${data?.error || JSON.stringify(data)}`;
          console.log('[E2E Test] import-normalize result:', data);
        }
      }

      setTestResults(results);
      toast.success('E2E tests completed - check console');
    } catch (err) {
      console.error('[E2E Test] Exception:', err);
      toast.error(`Test exception: ${err}`);
    } finally {
      setTesting(false);
    }
  };

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

      {/* E2E Test Card - temporary for debugging */}
      <Card className="border-dashed border-orange-500">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TestTube2 className="h-5 w-5 text-orange-500" />
            E2E Edge Function Test
          </CardTitle>
          <CardDescription>
            Test import-normalize and settings-merge with real JWT
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button 
            onClick={runEdgeFunctionTests} 
            disabled={testing}
            variant="outline"
            className="border-orange-500 text-orange-600 hover:bg-orange-50"
          >
            {testing ? 'Testing...' : 'Run E2E Tests'}
          </Button>
          
          {testResults && (
            <div className="text-sm font-mono space-y-1 bg-muted p-3 rounded">
              <div><strong>settings-merge:</strong> {testResults.merge}</div>
              <div><strong>import-normalize:</strong> {testResults.normalize}</div>
            </div>
          )}
        </CardContent>
      </Card>

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
