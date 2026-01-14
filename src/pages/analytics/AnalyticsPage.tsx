import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { 
  Phone, Mail, Bot, CreditCard, TrendingUp, TrendingDown,
  Calendar, Wallet, Users, FileText, Package, Activity,
  ArrowUpRight, ArrowDownRight, Zap, Clock
} from 'lucide-react';
import { 
  LineChart, Line, BarChart, Bar, XAxis, YAxis, 
  CartesianGrid, Tooltip, ResponsiveContainer, 
  AreaChart, Area, PieChart, Pie, Cell
} from 'recharts';
import { format, subDays, startOfDay, eachDayOfInterval, differenceInDays } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PermissionDenied, EmptyState } from '@/components/ui/permission-denied';
import { cn } from '@/lib/utils';

type PeriodDays = 7 | 30 | 90;

// Metric card with trend indicator
function MetricCard({ 
  title, 
  value, 
  subtitle,
  icon: Icon, 
  trend,
  trendValue,
  loading,
  variant = 'default',
  className
}: { 
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  loading?: boolean;
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'destructive';
  className?: string;
}) {
  const variantStyles = {
    default: 'bg-card',
    primary: 'bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20',
    success: 'bg-gradient-to-br from-success/10 to-success/5 border-success/20',
    warning: 'bg-gradient-to-br from-warning/10 to-warning/5 border-warning/20',
    destructive: 'bg-gradient-to-br from-destructive/10 to-destructive/5 border-destructive/20',
  };

  const iconStyles = {
    default: 'bg-muted text-muted-foreground',
    primary: 'bg-primary/15 text-primary',
    success: 'bg-success/15 text-success',
    warning: 'bg-warning/15 text-warning',
    destructive: 'bg-destructive/15 text-destructive',
  };

  return (
    <Card className={cn('relative overflow-hidden transition-all hover:shadow-md', variantStyles[variant], className)}>
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            {loading ? (
              <Skeleton className="h-9 w-28" />
            ) : (
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold tracking-tight">{value}</span>
                {trend && trendValue && (
                  <Badge 
                    variant="outline" 
                    className={cn(
                      'text-xs font-medium',
                      trend === 'up' && 'border-success/30 bg-success/10 text-success',
                      trend === 'down' && 'border-destructive/30 bg-destructive/10 text-destructive',
                      trend === 'neutral' && 'border-muted bg-muted text-muted-foreground'
                    )}
                  >
                    {trend === 'up' && <ArrowUpRight className="mr-0.5 h-3 w-3" />}
                    {trend === 'down' && <ArrowDownRight className="mr-0.5 h-3 w-3" />}
                    {trendValue}
                  </Badge>
                )}
              </div>
            )}
            {subtitle && (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          <div className={cn('rounded-xl p-3', iconStyles[variant])}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Chart wrapper with consistent styling
function ChartCard({ 
  title, 
  description, 
  icon: Icon,
  children,
  loading,
  className
}: {
  title: string;
  description?: string;
  icon?: React.ElementType;
  children: React.ReactNode;
  loading?: boolean;
  className?: string;
}) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-5 w-5 text-muted-foreground" />}
          <CardTitle className="text-base font-semibold">{title}</CardTitle>
        </div>
        {description && (
          <CardDescription className="text-sm">{description}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="pb-6">
        {loading ? (
          <Skeleton className="h-[280px] w-full" />
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

export default function AnalyticsPage() {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();
  const [periodDays, setPeriodDays] = useState<PeriodDays>(30);
  const [activeTab, setActiveTab] = useState('overview');

  const dateLocale = i18n.language === 'ru' ? ru : enUS;
  const canViewAnalytics = profile?.role && ['owner', 'admin', 'accountant'].includes(profile.role);

  const periodStart = useMemo(() => 
    startOfDay(subDays(new Date(), periodDays)), 
    [periodDays]
  );

  const previousPeriodStart = useMemo(() => 
    startOfDay(subDays(periodStart, periodDays)), 
    [periodStart, periodDays]
  );

  const dateRange = useMemo(() => 
    eachDayOfInterval({ start: periodStart, end: new Date() }),
    [periodStart]
  );

  // Fetch current balance
  const { data: balance, isLoading: balanceLoading } = useQuery({
    queryKey: ['balance', profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return null;
      const { data, error } = await supabase
        .from('balances')
        .select('balance_rub, updated_at')
        .eq('organization_id', profile.organization_id)
        .single();
      if (error && error.code !== 'PGRST116') throw error;
      return data;
    },
    enabled: !!profile?.organization_id && canViewAnalytics,
  });

  // Fetch usage_logs
  const { data: usageLogs, isLoading: usageLoading } = useQuery({
    queryKey: ['usage-logs-analytics', profile?.organization_id, periodDays],
    queryFn: async () => {
      if (!profile?.organization_id) return [];
      const { data, error } = await supabase
        .from('usage_logs')
        .select('event_type, cost_rub, tokens_in, tokens_out, duration_seconds, created_at')
        .eq('organization_id', profile.organization_id)
        .gte('created_at', previousPeriodStart.toISOString())
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!profile?.organization_id && canViewAnalytics,
  });

  // Fetch call_sessions
  const { data: callSessions, isLoading: callsLoading } = useQuery({
    queryKey: ['call-sessions-analytics', profile?.organization_id, periodDays],
    queryFn: async () => {
      if (!profile?.organization_id) return [];
      const { data, error } = await supabase
        .from('call_sessions')
        .select('created_at, status, direction, duration_seconds, sentiment')
        .eq('organization_id', profile.organization_id)
        .gte('created_at', previousPeriodStart.toISOString())
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!profile?.organization_id && canViewAnalytics,
  });

  // Fetch email_outbox
  const { data: emailOutbox, isLoading: emailsLoading } = useQuery({
    queryKey: ['email-outbox-analytics', profile?.organization_id, periodDays],
    queryFn: async () => {
      if (!profile?.organization_id) return [];
      const { data, error } = await supabase
        .from('email_outbox')
        .select('queued_at, sent_at, status')
        .eq('organization_id', profile.organization_id)
        .gte('queued_at', previousPeriodStart.toISOString())
        .order('queued_at', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!profile?.organization_id && canViewAnalytics,
  });

  // Fetch leads
  const { data: leads, isLoading: leadsLoading } = useQuery({
    queryKey: ['leads-analytics', profile?.organization_id, periodDays],
    queryFn: async () => {
      if (!profile?.organization_id) return [];
      const { data, error } = await supabase
        .from('leads')
        .select('created_at, status, source')
        .eq('organization_id', profile.organization_id)
        .gte('created_at', previousPeriodStart.toISOString())
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!profile?.organization_id && canViewAnalytics,
  });

  // Fetch orders
  const { data: orders, isLoading: ordersLoading } = useQuery({
    queryKey: ['orders-analytics', profile?.organization_id, periodDays],
    queryFn: async () => {
      if (!profile?.organization_id) return [];
      const { data, error } = await supabase
        .from('orders')
        .select('created_at, status, total_amount')
        .eq('organization_id', profile.organization_id)
        .gte('created_at', previousPeriodStart.toISOString())
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!profile?.organization_id && canViewAnalytics,
  });

  // Calculate metrics with period comparison
  const metrics = useMemo(() => {
    const filterCurrentPeriod = <T extends { created_at?: string; queued_at?: string; sent_at?: string }>(
      items: T[] | undefined,
      dateField: 'created_at' | 'queued_at' | 'sent_at' = 'created_at'
    ) => items?.filter(item => {
      const date = item[dateField];
      return date && new Date(date) >= periodStart;
    }) || [];

    const filterPreviousPeriod = <T extends { created_at?: string; queued_at?: string; sent_at?: string }>(
      items: T[] | undefined,
      dateField: 'created_at' | 'queued_at' | 'sent_at' = 'created_at'
    ) => items?.filter(item => {
      const date = item[dateField];
      return date && new Date(date) >= previousPeriodStart && new Date(date) < periodStart;
    }) || [];

    // Current period
    const currentUsage = filterCurrentPeriod(usageLogs);
    const currentCalls = filterCurrentPeriod(callSessions);
    const currentEmails = filterCurrentPeriod(emailOutbox, 'queued_at');
    const currentLeads = filterCurrentPeriod(leads);
    const currentOrders = filterCurrentPeriod(orders);

    // Previous period
    const prevUsage = filterPreviousPeriod(usageLogs);
    const prevCalls = filterPreviousPeriod(callSessions);
    const prevEmails = filterPreviousPeriod(emailOutbox, 'queued_at');
    const prevLeads = filterPreviousPeriod(leads);
    const prevOrders = filterPreviousPeriod(orders);

    // Cost metrics
    const totalCost = currentUsage.reduce((sum, l) => sum + (l.cost_rub || 0), 0);
    const prevTotalCost = prevUsage.reduce((sum, l) => sum + (l.cost_rub || 0), 0);

    // Token metrics
    const totalTokensIn = currentUsage.reduce((sum, l) => sum + (l.tokens_in || 0), 0);
    const totalTokensOut = currentUsage.reduce((sum, l) => sum + (l.tokens_out || 0), 0);

    // Call metrics
    const completedCalls = currentCalls.filter(c => c.status === 'COMPLETED').length;
    const totalCallDuration = currentCalls.reduce((sum, c) => sum + (c.duration_seconds || 0), 0);
    const avgCallDuration = currentCalls.length > 0 ? totalCallDuration / currentCalls.length : 0;

    // Email metrics
    const sentEmails = currentEmails.filter(e => e.status === 'SENT').length;
    const failedEmails = currentEmails.filter(e => e.status === 'FAILED').length;

    // Lead metrics
    const newLeads = currentLeads.filter(l => l.status === 'NEW').length;
    const paidLeads = currentLeads.filter(l => l.status === 'PAID').length;
    const conversionRate = currentLeads.length > 0 
      ? (paidLeads / currentLeads.length) * 100 
      : 0;

    // Order metrics
    const paidOrders = currentOrders.filter(o => o.status === 'PAID');
    const totalRevenue = paidOrders.reduce((sum, o) => sum + (o.total_amount || 0), 0);
    const prevPaidOrders = prevOrders.filter(o => o.status === 'PAID');
    const prevRevenue = prevPaidOrders.reduce((sum, o) => sum + (o.total_amount || 0), 0);

    // Calculate trends
    const calcTrend = (current: number, previous: number): { trend: 'up' | 'down' | 'neutral'; value: string } => {
      if (previous === 0) return { trend: current > 0 ? 'up' : 'neutral', value: current > 0 ? '+100%' : '0%' };
      const change = ((current - previous) / previous) * 100;
      return {
        trend: change > 0 ? 'up' : change < 0 ? 'down' : 'neutral',
        value: `${change > 0 ? '+' : ''}${change.toFixed(1)}%`
      };
    };

    return {
      totalCost,
      costTrend: calcTrend(totalCost, prevTotalCost),
      totalTokensIn,
      totalTokensOut,
      totalCalls: currentCalls.length,
      callsTrend: calcTrend(currentCalls.length, prevCalls.length),
      completedCalls,
      avgCallDuration,
      totalEmails: currentEmails.length,
      emailsTrend: calcTrend(currentEmails.length, prevEmails.length),
      sentEmails,
      failedEmails,
      totalLeads: currentLeads.length,
      leadsTrend: calcTrend(currentLeads.length, prevLeads.length),
      newLeads,
      paidLeads,
      conversionRate,
      totalOrders: currentOrders.length,
      ordersTrend: calcTrend(currentOrders.length, prevOrders.length),
      totalRevenue,
      revenueTrend: calcTrend(totalRevenue, prevRevenue),
      // For charts - by source/status
      leadsBySource: currentLeads.reduce((acc, l) => {
        acc[l.source] = (acc[l.source] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      callsByDirection: currentCalls.reduce((acc, c) => {
        acc[c.direction] = (acc[c.direction] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
    };
  }, [usageLogs, callSessions, emailOutbox, leads, orders, periodStart, previousPeriodStart]);

  // Chart data preparation
  const chartData = useMemo(() => {
    return dateRange.map(date => {
      const dateStr = format(date, 'yyyy-MM-dd');
      
      const filterByDate = <T extends { created_at?: string; queued_at?: string; sent_at?: string }>(
        items: T[] | undefined,
        dateField: 'created_at' | 'queued_at' | 'sent_at' = 'created_at'
      ) => items?.filter(item => {
        const d = item[dateField];
        return d && format(new Date(d), 'yyyy-MM-dd') === dateStr;
      }) || [];

      const dayCost = filterByDate(usageLogs).reduce((sum, l) => sum + (l.cost_rub || 0), 0);
      const dayCalls = filterByDate(callSessions).length;
      const dayEmails = filterByDate(emailOutbox, 'sent_at').filter(e => e.status === 'SENT').length;
      const dayLeads = filterByDate(leads).length;
      const dayOrders = filterByDate(orders).length;
      const dayRevenue = filterByDate(orders).filter(o => o.status === 'PAID').reduce((sum, o) => sum + (o.total_amount || 0), 0);

      const dayLLM = filterByDate(usageLogs).filter(l => l.event_type === 'LLM');
      const tokensIn = dayLLM.reduce((sum, l) => sum + (l.tokens_in || 0), 0);
      const tokensOut = dayLLM.reduce((sum, l) => sum + (l.tokens_out || 0), 0);

      return {
        date: format(date, 'd MMM', { locale: dateLocale }),
        fullDate: dateStr,
        cost: Math.round(dayCost * 100) / 100,
        calls: dayCalls,
        emails: dayEmails,
        leads: dayLeads,
        orders: dayOrders,
        revenue: Math.round(dayRevenue * 100) / 100,
        tokensIn,
        tokensOut,
      };
    });
  }, [dateRange, usageLogs, callSessions, emailOutbox, leads, orders, dateLocale]);

  // Pie chart data
  const leadSourceData = useMemo(() => {
    const sources = metrics.leadsBySource;
    const colors = ['hsl(var(--primary))', 'hsl(var(--accent))', 'hsl(var(--success))'];
    return Object.entries(sources).map(([name, value], i) => ({
      name: t(`leads.source.${name.toLowerCase()}`) || name,
      value,
      color: colors[i % colors.length]
    }));
  }, [metrics.leadsBySource, t]);

  const callDirectionData = useMemo(() => {
    const directions = metrics.callsByDirection;
    const colors = ['hsl(var(--primary))', 'hsl(var(--accent))'];
    return Object.entries(directions).map(([name, value], i) => ({
      name: t(`calls.direction.${name.toLowerCase()}`) || name,
      value,
      color: colors[i % colors.length]
    }));
  }, [metrics.callsByDirection, t]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat(i18n.language === 'ru' ? 'ru-RU' : 'en-US', {
      style: 'currency',
      currency: 'RUB',
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatNumber = (value: number) => {
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
    return value.toString();
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const isLoading = balanceLoading || usageLoading || callsLoading || emailsLoading || leadsLoading || ordersLoading;
  const hasData = chartData.some(d => d.cost > 0 || d.calls > 0 || d.emails > 0 || d.leads > 0);

  if (!canViewAnalytics) {
    return <PermissionDenied />;
  }

  const tooltipStyle = {
    backgroundColor: 'hsl(var(--card))',
    border: '1px solid hsl(var(--border))',
    borderRadius: '8px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
    padding: '12px'
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('nav.analytics')}</h1>
          <p className="text-sm text-muted-foreground">{t('analytics.description')}</p>
        </div>
        <div className="flex items-center gap-3">
          <Select
            value={String(periodDays)}
            onValueChange={(v) => setPeriodDays(Number(v) as PeriodDays)}
          >
            <SelectTrigger className="w-[160px] bg-background">
              <Calendar className="mr-2 h-4 w-4 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">{t('analytics.last7days')}</SelectItem>
              <SelectItem value="30">{t('analytics.last30days')}</SelectItem>
              <SelectItem value="90">{t('analytics.last90days')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="bg-muted/50">
          <TabsTrigger value="overview" className="gap-2">
            <Activity className="h-4 w-4" />
            {t('analytics.overview')}
          </TabsTrigger>
          <TabsTrigger value="operations" className="gap-2">
            <Phone className="h-4 w-4" />
            {t('analytics.operations')}
          </TabsTrigger>
          <TabsTrigger value="financial" className="gap-2">
            <CreditCard className="h-4 w-4" />
            {t('analytics.financial')}
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          {/* Key Metrics Grid */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              title={t('analytics.revenue')}
              value={formatCurrency(metrics.totalRevenue)}
              subtitle={t('analytics.paidOrders', { count: orders?.filter(o => o.status === 'PAID').length || 0 })}
              icon={TrendingUp}
              trend={metrics.revenueTrend.trend}
              trendValue={metrics.revenueTrend.value}
              loading={isLoading}
              variant="success"
            />
            <MetricCard
              title={t('analytics.newLeads')}
              value={metrics.totalLeads}
              subtitle={`${metrics.conversionRate.toFixed(1)}% ${t('analytics.conversion')}`}
              icon={Users}
              trend={metrics.leadsTrend.trend}
              trendValue={metrics.leadsTrend.value}
              loading={isLoading}
              variant="primary"
            />
            <MetricCard
              title={t('analytics.totalCalls')}
              value={metrics.totalCalls}
              subtitle={`Ø ${formatDuration(metrics.avgCallDuration)}`}
              icon={Phone}
              trend={metrics.callsTrend.trend}
              trendValue={metrics.callsTrend.value}
              loading={isLoading}
            />
            <MetricCard
              title={t('analytics.currentBalance')}
              value={formatCurrency(balance?.balance_rub || 0)}
              icon={Wallet}
              loading={balanceLoading}
              variant={balance?.balance_rub && balance.balance_rub > 0 ? 'success' : 'warning'}
            />
          </div>

          {/* Charts Row */}
          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard
              title={t('analytics.revenueOverTime')}
              description={t('analytics.revenueOverTimeDesc')}
              icon={TrendingUp}
              loading={isLoading}
            >
              {!hasData ? (
                <EmptyState 
                  icon={Activity} 
                  message={t('analytics.noData')} 
                />
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--success))" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="hsl(var(--success))" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted/50" vertical={false} />
                    <XAxis 
                      dataKey="date" 
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                    />
                    <YAxis 
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                      tickFormatter={(v) => formatCurrency(v)}
                      width={80}
                    />
                    <Tooltip 
                      formatter={(value: number) => [formatCurrency(value), t('analytics.revenue')]}
                      contentStyle={tooltipStyle}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="revenue" 
                      stroke="hsl(var(--success))" 
                      strokeWidth={2}
                      fill="url(#revenueGradient)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard
              title={t('analytics.leadsOverTime')}
              description={t('analytics.leadsOverTimeDesc')}
              icon={Users}
              loading={isLoading}
            >
              {!hasData ? (
                <EmptyState 
                  icon={Activity} 
                  message={t('analytics.noData')} 
                />
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted/50" vertical={false} />
                    <XAxis 
                      dataKey="date" 
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                    />
                    <YAxis 
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                      allowDecimals={false}
                    />
                    <Tooltip 
                      formatter={(value: number) => [value, t('leads.title')]}
                      contentStyle={tooltipStyle}
                    />
                    <Bar 
                      dataKey="leads" 
                      fill="hsl(var(--primary))" 
                      radius={[4, 4, 0, 0]}
                      maxBarSize={40}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>

          {/* Distribution Charts */}
          {(leadSourceData.length > 0 || callDirectionData.length > 0) && (
            <div className="grid gap-6 lg:grid-cols-2">
              {leadSourceData.length > 0 && (
                <ChartCard
                  title={t('analytics.leadsBySource')}
                  icon={Users}
                  loading={isLoading}
                >
                  <div className="flex items-center justify-center">
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie
                          data={leadSourceData}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={80}
                          paddingAngle={4}
                          dataKey="value"
                        >
                          {leadSourceData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex flex-col gap-2">
                      {leadSourceData.map((entry, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <div 
                            className="h-3 w-3 rounded-full" 
                            style={{ backgroundColor: entry.color }}
                          />
                          <span className="text-sm text-muted-foreground">
                            {entry.name}: {entry.value}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </ChartCard>
              )}

              {callDirectionData.length > 0 && (
                <ChartCard
                  title={t('analytics.callsByDirection')}
                  icon={Phone}
                  loading={isLoading}
                >
                  <div className="flex items-center justify-center">
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie
                          data={callDirectionData}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={80}
                          paddingAngle={4}
                          dataKey="value"
                        >
                          {callDirectionData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex flex-col gap-2">
                      {callDirectionData.map((entry, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <div 
                            className="h-3 w-3 rounded-full" 
                            style={{ backgroundColor: entry.color }}
                          />
                          <span className="text-sm text-muted-foreground">
                            {entry.name}: {entry.value}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </ChartCard>
              )}
            </div>
          )}
        </TabsContent>

        {/* Operations Tab */}
        <TabsContent value="operations" className="space-y-6">
          {/* Operations Metrics */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              title={t('analytics.totalCalls')}
              value={metrics.totalCalls}
              subtitle={`${metrics.completedCalls} ${t('analytics.completed')}`}
              icon={Phone}
              trend={metrics.callsTrend.trend}
              trendValue={metrics.callsTrend.value}
              loading={isLoading}
              variant="primary"
            />
            <MetricCard
              title={t('analytics.avgCallDuration')}
              value={formatDuration(metrics.avgCallDuration)}
              icon={Clock}
              loading={isLoading}
            />
            <MetricCard
              title={t('analytics.emailsSent')}
              value={metrics.sentEmails}
              subtitle={metrics.failedEmails > 0 ? `${metrics.failedEmails} ${t('analytics.failed')}` : undefined}
              icon={Mail}
              trend={metrics.emailsTrend.trend}
              trendValue={metrics.emailsTrend.value}
              loading={isLoading}
              variant={metrics.failedEmails > 0 ? 'warning' : 'default'}
            />
            <MetricCard
              title={t('analytics.llmTokens')}
              value={formatNumber(metrics.totalTokensIn + metrics.totalTokensOut)}
              subtitle={`↓${formatNumber(metrics.totalTokensIn)} ↑${formatNumber(metrics.totalTokensOut)}`}
              icon={Bot}
              loading={isLoading}
            />
          </div>

          {/* Operations Charts */}
          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard
              title={t('analytics.callsByDay')}
              description={t('analytics.callsByDayDesc')}
              icon={Phone}
              loading={isLoading}
            >
              {!hasData ? (
                <EmptyState icon={Phone} message={t('analytics.noData')} />
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted/50" vertical={false} />
                    <XAxis 
                      dataKey="date" 
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                    />
                    <YAxis 
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                      allowDecimals={false}
                    />
                    <Tooltip 
                      formatter={(value: number) => [value, t('calls.title')]}
                      contentStyle={tooltipStyle}
                    />
                    <Bar 
                      dataKey="calls" 
                      fill="hsl(var(--primary))" 
                      radius={[4, 4, 0, 0]}
                      maxBarSize={40}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard
              title={t('analytics.emailsByDay')}
              description={t('analytics.emailsByDayDesc')}
              icon={Mail}
              loading={isLoading}
            >
              {!hasData ? (
                <EmptyState icon={Mail} message={t('analytics.noData')} />
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted/50" vertical={false} />
                    <XAxis 
                      dataKey="date" 
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                    />
                    <YAxis 
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                      allowDecimals={false}
                    />
                    <Tooltip 
                      formatter={(value: number) => [value, t('email.sent')]}
                      contentStyle={tooltipStyle}
                    />
                    <Bar 
                      dataKey="emails" 
                      fill="hsl(var(--accent))" 
                      radius={[4, 4, 0, 0]}
                      maxBarSize={40}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>

          {/* LLM Tokens Chart */}
          <ChartCard
            title={t('analytics.tokensByDay')}
            description={t('analytics.tokensByDayDesc')}
            icon={Bot}
            loading={isLoading}
          >
            {!hasData ? (
              <EmptyState icon={Bot} message={t('analytics.noData')} />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="tokensInGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="tokensOutGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--accent))" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="hsl(var(--accent))" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted/50" vertical={false} />
                  <XAxis 
                    dataKey="date" 
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                  />
                  <YAxis 
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                    tickFormatter={(v) => formatNumber(v)}
                  />
                  <Tooltip 
                    formatter={(value: number, name: string) => [
                      value.toLocaleString(), 
                      name === 'tokensIn' ? t('analytics.tokensIn') : t('analytics.tokensOut')
                    ]}
                    contentStyle={tooltipStyle}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="tokensIn" 
                    stroke="hsl(var(--primary))" 
                    strokeWidth={2}
                    fill="url(#tokensInGradient)"
                    name="tokensIn"
                  />
                  <Area 
                    type="monotone" 
                    dataKey="tokensOut" 
                    stroke="hsl(var(--accent))" 
                    strokeWidth={2}
                    fill="url(#tokensOutGradient)"
                    name="tokensOut"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </TabsContent>

        {/* Financial Tab */}
        <TabsContent value="financial" className="space-y-6">
          {/* Financial Metrics */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              title={t('analytics.totalCost')}
              value={formatCurrency(metrics.totalCost)}
              icon={TrendingDown}
              trend={metrics.costTrend.trend === 'up' ? 'down' : metrics.costTrend.trend === 'down' ? 'up' : 'neutral'}
              trendValue={metrics.costTrend.value}
              loading={isLoading}
              variant="destructive"
            />
            <MetricCard
              title={t('analytics.revenue')}
              value={formatCurrency(metrics.totalRevenue)}
              icon={TrendingUp}
              trend={metrics.revenueTrend.trend}
              trendValue={metrics.revenueTrend.value}
              loading={isLoading}
              variant="success"
            />
            <MetricCard
              title={t('analytics.ordersCount')}
              value={metrics.totalOrders}
              icon={Package}
              trend={metrics.ordersTrend.trend}
              trendValue={metrics.ordersTrend.value}
              loading={isLoading}
            />
            <MetricCard
              title={t('analytics.currentBalance')}
              value={formatCurrency(balance?.balance_rub || 0)}
              icon={Wallet}
              loading={balanceLoading}
              variant={balance?.balance_rub && balance.balance_rub > 0 ? 'success' : 'warning'}
            />
          </div>

          {/* Financial Charts */}
          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard
              title={t('analytics.costByDay')}
              description={t('analytics.costByDayDesc')}
              icon={CreditCard}
              loading={isLoading}
            >
              {!hasData ? (
                <EmptyState icon={CreditCard} message={t('analytics.noData')} />
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--destructive))" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="hsl(var(--destructive))" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted/50" vertical={false} />
                    <XAxis 
                      dataKey="date" 
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                    />
                    <YAxis 
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                      tickFormatter={(v) => `${v}₽`}
                      width={60}
                    />
                    <Tooltip 
                      formatter={(value: number) => [formatCurrency(value), t('analytics.cost')]}
                      contentStyle={tooltipStyle}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="cost" 
                      stroke="hsl(var(--destructive))" 
                      strokeWidth={2}
                      fill="url(#costGradient)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard
              title={t('analytics.ordersOverTime')}
              description={t('analytics.ordersOverTimeDesc')}
              icon={Package}
              loading={isLoading}
            >
              {!hasData ? (
                <EmptyState icon={Package} message={t('analytics.noData')} />
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted/50" vertical={false} />
                    <XAxis 
                      dataKey="date" 
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                    />
                    <YAxis 
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                      allowDecimals={false}
                    />
                    <Tooltip 
                      formatter={(value: number) => [value, t('orders.title')]}
                      contentStyle={tooltipStyle}
                    />
                    <Bar 
                      dataKey="orders" 
                      fill="hsl(var(--primary))" 
                      radius={[4, 4, 0, 0]}
                      maxBarSize={40}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
