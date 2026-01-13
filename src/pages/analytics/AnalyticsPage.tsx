import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Phone, Mail, Bot, FileText } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function AnalyticsPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();

  const { data: usageStats } = useQuery({
    queryKey: ['usage-stats', profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return null;

      const { data, error } = await supabase
        .from('usage_logs')
        .select('event_type, cost_rub, tokens_in, tokens_out, duration_seconds')
        .eq('organization_id', profile.organization_id);

      if (error) throw error;

      const stats = {
        calls: { count: 0, cost: 0, duration: 0 },
        emails: { count: 0, cost: 0 },
        llm: { count: 0, cost: 0, tokens_in: 0, tokens_out: 0 },
        invoices: { count: 0, cost: 0 },
      };

      data?.forEach((log) => {
        switch (log.event_type) {
          case 'CALL':
            stats.calls.count++;
            stats.calls.cost += log.cost_rub;
            stats.calls.duration += log.duration_seconds;
            break;
          case 'EMAIL':
            stats.emails.count++;
            stats.emails.cost += log.cost_rub;
            break;
          case 'LLM':
            stats.llm.count++;
            stats.llm.cost += log.cost_rub;
            stats.llm.tokens_in += log.tokens_in;
            stats.llm.tokens_out += log.tokens_out;
            break;
          case 'INVOICE':
            stats.invoices.count++;
            stats.invoices.cost += log.cost_rub;
            break;
        }
      });

      return stats;
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

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t('nav.analytics')}</h1>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Звонки
            </CardTitle>
            <Phone className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{usageStats?.calls.count || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {formatDuration(usageStats?.calls.duration || 0)} • {formatCurrency(usageStats?.calls.cost || 0)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Email
            </CardTitle>
            <Mail className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{usageStats?.emails.count || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {formatCurrency(usageStats?.emails.cost || 0)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              LLM (AI)
            </CardTitle>
            <Bot className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{usageStats?.llm.count || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {((usageStats?.llm.tokens_in || 0) + (usageStats?.llm.tokens_out || 0)).toLocaleString()} tokens • {formatCurrency(usageStats?.llm.cost || 0)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Счета
            </CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{usageStats?.invoices.count || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {formatCurrency(usageStats?.invoices.cost || 0)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            {t('billing.usage')}
          </CardTitle>
          <CardDescription>
            Детальная статистика использования платформы
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Графики и детальная аналитика будут добавлены в следующих версиях.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
