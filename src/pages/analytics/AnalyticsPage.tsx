import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { 
  Phone, Mail, Bot, CreditCard, TrendingDown, 
  Calendar, BarChart3, Wallet 
} from 'lucide-react';
import { 
  LineChart, Line, BarChart, Bar, XAxis, YAxis, 
  CartesianGrid, Tooltip, ResponsiveContainer, Legend 
} from 'recharts';
import { format, subDays, startOfDay, eachDayOfInterval } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

type PeriodDays = 7 | 30 | 90;

export default function AnalyticsPage() {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();
  const [periodDays, setPeriodDays] = useState<PeriodDays>(7);

  const dateLocale = i18n.language === 'ru' ? ru : enUS;

  // Role check: only owner, admin, accountant can view
  const canViewAnalytics = profile?.role && ['owner', 'admin', 'accountant'].includes(profile.role);

  const periodStart = useMemo(() => 
    startOfDay(subDays(new Date(), periodDays)), 
    [periodDays]
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
        .select('balance_rub')
        .eq('organization_id', profile.organization_id)
        .single();
      if (error && error.code !== 'PGRST116') throw error;
      return data?.balance_rub ?? 0;
    },
    enabled: !!profile?.organization_id && canViewAnalytics,
  });

  // Fetch usage_logs for cost and tokens
  const { data: usageLogs, isLoading: usageLoading } = useQuery({
    queryKey: ['usage-logs-analytics', profile?.organization_id, periodDays],
    queryFn: async () => {
      if (!profile?.organization_id) return [];
      const { data, error } = await supabase
        .from('usage_logs')
        .select('event_type, cost_rub, tokens_in, tokens_out, created_at')
        .eq('organization_id', profile.organization_id)
        .gte('created_at', periodStart.toISOString());
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
        .select('created_at, status')
        .eq('organization_id', profile.organization_id)
        .gte('created_at', periodStart.toISOString());
      if (error) throw error;
      return data || [];
    },
    enabled: !!profile?.organization_id && canViewAnalytics,
  });

  // Fetch email_outbox (sent emails)
  const { data: emailOutbox, isLoading: emailsLoading } = useQuery({
    queryKey: ['email-outbox-analytics', profile?.organization_id, periodDays],
    queryFn: async () => {
      if (!profile?.organization_id) return [];
      const { data, error } = await supabase
        .from('email_outbox')
        .select('sent_at, status')
        .eq('organization_id', profile.organization_id)
        .eq('status', 'SENT')
        .gte('queued_at', periodStart.toISOString());
      if (error) throw error;
      return data || [];
    },
    enabled: !!profile?.organization_id && canViewAnalytics,
  });

  // Calculate KPIs for last 7 days
  const kpis = useMemo(() => {
    const last7DaysStart = startOfDay(subDays(new Date(), 7));
    
    const totalCost7d = usageLogs
      ?.filter(l => new Date(l.created_at) >= last7DaysStart)
      .reduce((sum, l) => sum + (l.cost_rub || 0), 0) || 0;

    const totalCalls7d = callSessions
      ?.filter(c => new Date(c.created_at) >= last7DaysStart)
      .length || 0;

    const totalEmails7d = emailOutbox
      ?.filter(e => e.sent_at && new Date(e.sent_at) >= last7DaysStart)
      .length || 0;

    return { totalCost7d, totalCalls7d, totalEmails7d };
  }, [usageLogs, callSessions, emailOutbox]);

  // Prepare chart data
  const chartData = useMemo(() => {
    return dateRange.map(date => {
      const dateStr = format(date, 'yyyy-MM-dd');
      const nextDay = new Date(date);
      nextDay.setDate(nextDay.getDate() + 1);

      // Cost by day
      const dayCost = usageLogs
        ?.filter(l => {
          const logDate = format(new Date(l.created_at), 'yyyy-MM-dd');
          return logDate === dateStr;
        })
        .reduce((sum, l) => sum + (l.cost_rub || 0), 0) || 0;

      // Calls by day
      const dayCalls = callSessions
        ?.filter(c => format(new Date(c.created_at), 'yyyy-MM-dd') === dateStr)
        .length || 0;

      // Emails sent by day
      const dayEmails = emailOutbox
        ?.filter(e => e.sent_at && format(new Date(e.sent_at), 'yyyy-MM-dd') === dateStr)
        .length || 0;

      // Tokens by day (LLM only)
      const dayLLM = usageLogs
        ?.filter(l => {
          const logDate = format(new Date(l.created_at), 'yyyy-MM-dd');
          return logDate === dateStr && l.event_type === 'LLM';
        });
      const tokensIn = dayLLM?.reduce((sum, l) => sum + (l.tokens_in || 0), 0) || 0;
      const tokensOut = dayLLM?.reduce((sum, l) => sum + (l.tokens_out || 0), 0) || 0;

      return {
        date: format(date, 'd MMM', { locale: dateLocale }),
        fullDate: dateStr,
        cost: Math.round(dayCost * 100) / 100,
        calls: dayCalls,
        emails: dayEmails,
        tokensIn,
        tokensOut,
      };
    });
  }, [dateRange, usageLogs, callSessions, emailOutbox, dateLocale]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat(i18n.language === 'ru' ? 'ru-RU' : 'en-US', {
      style: 'currency',
      currency: 'RUB',
      maximumFractionDigits: 2,
    }).format(value);
  };

  const isLoading = balanceLoading || usageLoading || callsLoading || emailsLoading;

  if (!canViewAnalytics) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">{t('common.noPermission')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with period filter */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold">{t('nav.analytics')}</h1>
          <p className="text-muted-foreground">{t('analytics.description')}</p>
        </div>
        <Select
          value={String(periodDays)}
          onValueChange={(v) => setPeriodDays(Number(v) as PeriodDays)}
        >
          <SelectTrigger className="w-[180px]">
            <Calendar className="mr-2 h-4 w-4" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">{t('analytics.last7days')}</SelectItem>
            <SelectItem value="30">{t('analytics.last30days')}</SelectItem>
            <SelectItem value="90">{t('analytics.last90days')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('analytics.cost7days')}
            </CardTitle>
            <TrendingDown className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold">{formatCurrency(kpis.totalCost7d)}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('analytics.calls7days')}
            </CardTitle>
            <Phone className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{kpis.totalCalls7d}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('analytics.emails7days')}
            </CardTitle>
            <Mail className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{kpis.totalEmails7d}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('analytics.currentBalance')}
            </CardTitle>
            <Wallet className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            {balanceLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold">{formatCurrency(balance || 0)}</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Cost Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              {t('analytics.costByDay')}
            </CardTitle>
            <CardDescription>{t('analytics.costByDayDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[300px] w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis 
                    dataKey="date" 
                    className="text-xs fill-muted-foreground"
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis 
                    className="text-xs fill-muted-foreground"
                    tick={{ fontSize: 12 }}
                    tickFormatter={(v) => `${v}₽`}
                  />
                  <Tooltip 
                    formatter={(value: number) => [formatCurrency(value), t('analytics.cost')]}
                    labelClassName="font-medium"
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px'
                    }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="cost" 
                    stroke="hsl(var(--destructive))" 
                    strokeWidth={2}
                    dot={{ fill: 'hsl(var(--destructive))' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Calls Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Phone className="h-5 w-5" />
              {t('analytics.callsByDay')}
            </CardTitle>
            <CardDescription>{t('analytics.callsByDayDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[300px] w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis 
                    dataKey="date" 
                    className="text-xs fill-muted-foreground"
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis 
                    className="text-xs fill-muted-foreground"
                    tick={{ fontSize: 12 }}
                    allowDecimals={false}
                  />
                  <Tooltip 
                    formatter={(value: number) => [value, t('calls.title')]}
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px'
                    }}
                  />
                  <Bar 
                    dataKey="calls" 
                    fill="hsl(var(--primary))" 
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Emails Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              {t('analytics.emailsByDay')}
            </CardTitle>
            <CardDescription>{t('analytics.emailsByDayDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[300px] w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis 
                    dataKey="date" 
                    className="text-xs fill-muted-foreground"
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis 
                    className="text-xs fill-muted-foreground"
                    tick={{ fontSize: 12 }}
                    allowDecimals={false}
                  />
                  <Tooltip 
                    formatter={(value: number) => [value, t('email.sent')]}
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px'
                    }}
                  />
                  <Bar 
                    dataKey="emails" 
                    fill="hsl(var(--accent))" 
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* LLM Tokens Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5" />
              {t('analytics.tokensByDay')}
            </CardTitle>
            <CardDescription>{t('analytics.tokensByDayDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[300px] w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis 
                    dataKey="date" 
                    className="text-xs fill-muted-foreground"
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis 
                    className="text-xs fill-muted-foreground"
                    tick={{ fontSize: 12 }}
                    tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}
                  />
                  <Tooltip 
                    formatter={(value: number, name: string) => [
                      value.toLocaleString(), 
                      name === 'tokensIn' ? t('analytics.tokensIn') : t('analytics.tokensOut')
                    ]}
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px'
                    }}
                  />
                  <Legend 
                    formatter={(value) => 
                      value === 'tokensIn' ? t('analytics.tokensIn') : t('analytics.tokensOut')
                    }
                  />
                  <Line 
                    type="monotone" 
                    dataKey="tokensIn" 
                    stroke="hsl(var(--primary))" 
                    strokeWidth={2}
                    dot={{ fill: 'hsl(var(--primary))' }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="tokensOut" 
                    stroke="hsl(var(--secondary))" 
                    strokeWidth={2}
                    dot={{ fill: 'hsl(var(--secondary))' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
