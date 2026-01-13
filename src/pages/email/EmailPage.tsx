import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Mail, Send, Inbox } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import EmailThreadsTab from './EmailThreadsTab';
import EmailOutboxTab from './EmailOutboxTab';

export default function EmailPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();

  const { data: threadCount } = useQuery({
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

  const { data: outboxCount } = useQuery({
    queryKey: ['email-outbox-count', profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return 0;

      const { count, error } = await supabase
        .from('email_outbox')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', profile.organization_id)
        .eq('status', 'QUEUED');

      if (error) throw error;
      return count || 0;
    },
    enabled: !!profile?.organization_id,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t('email.title')}</h1>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('email.threads')}
            </CardTitle>
            <Mail className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{threadCount || 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('email.outbox')} ({t('email.statuses.queued')})
            </CardTitle>
            <Send className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{outboxCount || 0}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="threads">
        <TabsList>
          <TabsTrigger value="threads">
            <Inbox className="h-4 w-4 mr-2" />
            {t('email.threads')}
          </TabsTrigger>
          <TabsTrigger value="outbox">
            <Send className="h-4 w-4 mr-2" />
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
