import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Mail, Send, Inbox, CheckCircle, XCircle, Clock, TrendingUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import EmailThreadsTab from './EmailThreadsTab';
import EmailOutboxTab from './EmailOutboxTab';

export default function EmailPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();

  // Total threads count
  const { data: threadCount, isLoading: threadsLoading } = useQuery({
    queryKey: ['email-threads-count', profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return 0;

      const { count, error } = await supabase
        .from('email_threads')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', profile.organization_id);

      if (error) throw error;
      return count || 0;
    },
    enabled: !!profile?.organization_id,
  });

  // Total messages count
  const { data: messageCount, isLoading: messagesLoading } = useQuery({
    queryKey: ['email-messages-count', profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return 0;

      const { count, error } = await supabase
        .from('email_messages')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', profile.organization_id);

      if (error) throw error;
      return count || 0;
    },
    enabled: !!profile?.organization_id,
  });

  // Outbox stats
  const { data: outboxStats, isLoading: outboxLoading } = useQuery({
    queryKey: ['email-outbox-stats', profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return { queued: 0, sent: 0, failed: 0, total: 0 };

      const { data, error } = await supabase
        .from('email_outbox')
        .select('status')
        .eq('organization_id', profile.organization_id);

      if (error) throw error;

      const stats = {
        queued: 0,
        sent: 0,
        failed: 0,
        total: data?.length || 0,
      };

      data?.forEach(item => {
        if (item.status === 'QUEUED' || item.status === 'SENDING') stats.queued++;
        else if (item.status === 'SENT') stats.sent++;
        else if (item.status === 'FAILED') stats.failed++;
      });

      return stats;
    },
    enabled: !!profile?.organization_id,
  });

  // Email accounts count
  const { data: accountsCount, isLoading: accountsLoading } = useQuery({
    queryKey: ['email-accounts-count', profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return { total: 0, active: 0 };

      const { data, error } = await supabase
        .from('email_accounts')
        .select('status')
        .eq('organization_id', profile.organization_id);

      if (error) throw error;

      return {
        total: data?.length || 0,
        active: data?.filter(a => a.status === 'active').length || 0,
      };
    },
    enabled: !!profile?.organization_id,
  });

  const isLoading = threadsLoading || messagesLoading || outboxLoading || accountsLoading;

  const successRate = outboxStats && outboxStats.total > 0
    ? Math.round((outboxStats.sent / outboxStats.total) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">{t('email.title')}</h1>
        <p className="text-muted-foreground mt-1">{t('email.pageDescription')}</p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Threads Card */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('email.threads')}
            </CardTitle>
            <Mail className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <div className="text-2xl font-bold">{threadCount || 0}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {messageCount || 0} {t('email.messages').toLowerCase()}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Sent Successfully */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('email.sentSuccessfully')}
            </CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <div className="text-2xl font-bold text-green-600">{outboxStats?.sent || 0}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {successRate}% {t('email.successRate')}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Queued */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('email.inQueue')}
            </CardTitle>
            <Clock className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <div className="text-2xl font-bold text-yellow-600">{outboxStats?.queued || 0}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('email.awaitingSend')}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Failed */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('email.failedEmails')}
            </CardTitle>
            <XCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <div className="text-2xl font-bold text-red-600">{outboxStats?.failed || 0}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('email.requiresAttention')}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Accounts Info Card */}
      {accountsCount && accountsCount.total > 0 && (
        <Card className="bg-muted/50">
          <CardContent className="py-4">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">{t('email.accounts')}:</span>
              </div>
              <span className="text-sm">
                {accountsCount.active} {t('email.activeAccounts')} / {accountsCount.total} {t('email.totalAccounts')}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs defaultValue="threads" className="space-y-4">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="threads" className="flex items-center gap-2">
            <Inbox className="h-4 w-4" />
            {t('email.threads')}
          </TabsTrigger>
          <TabsTrigger value="outbox" className="flex items-center gap-2">
            <Send className="h-4 w-4" />
            {t('email.outbox')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="threads">
          <EmailThreadsTab />
        </TabsContent>

        <TabsContent value="outbox">
          <EmailOutboxTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
