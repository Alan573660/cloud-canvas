import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Mail, Send, Inbox } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable, Column } from '@/components/ui/data-table';
import { StatusBadge, getStatusType } from '@/components/ui/status-badge';
import { format } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';

interface EmailThread {
  id: string;
  subject: string | null;
  counterparty_email: string | null;
  last_message_at: string | null;
  created_at: string;
}

interface EmailOutbox {
  id: string;
  to_email: string;
  subject: string | null;
  status: string;
  queued_at: string;
  sent_at: string | null;
}

export default function EmailPage() {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();

  const [threadsPage, setThreadsPage] = useState(1);
  const [outboxPage, setOutboxPage] = useState(1);
  const pageSize = 10;

  const { data: threads, isLoading: threadsLoading } = useQuery({
    queryKey: ['email-threads', profile?.organization_id, threadsPage],
    queryFn: async () => {
      if (!profile?.organization_id) return { data: [], count: 0 };

      const from = (threadsPage - 1) * pageSize;
      const to = from + pageSize - 1;

      const { data, count, error } = await supabase
        .from('email_threads')
        .select('*', { count: 'exact' })
        .eq('organization_id', profile.organization_id)
        .order('last_message_at', { ascending: false })
        .range(from, to);

      if (error) throw error;
      return { data: data as EmailThread[], count: count || 0 };
    },
    enabled: !!profile?.organization_id,
  });

  const { data: outbox, isLoading: outboxLoading } = useQuery({
    queryKey: ['email-outbox', profile?.organization_id, outboxPage],
    queryFn: async () => {
      if (!profile?.organization_id) return { data: [], count: 0 };

      const from = (outboxPage - 1) * pageSize;
      const to = from + pageSize - 1;

      const { data, count, error } = await supabase
        .from('email_outbox')
        .select('*', { count: 'exact' })
        .eq('organization_id', profile.organization_id)
        .order('queued_at', { ascending: false })
        .range(from, to);

      if (error) throw error;
      return { data: data as EmailOutbox[], count: count || 0 };
    },
    enabled: !!profile?.organization_id,
  });

  const getStatusLabel = (status: string) => {
    const statusMap: Record<string, string> = {
      QUEUED: t('email.statuses.queued'),
      SENT: t('email.statuses.sent'),
      FAILED: t('email.statuses.failed'),
      CANCELLED: t('email.statuses.cancelled'),
    };
    return statusMap[status] || status;
  };

  const threadColumns: Column<EmailThread>[] = [
    {
      key: 'counterparty_email',
      header: t('email.from'),
      cell: (row) => row.counterparty_email || '—',
    },
    {
      key: 'subject',
      header: t('email.subject'),
      cell: (row) => (
        <span className="max-w-md truncate block">{row.subject || '—'}</span>
      ),
    },
    {
      key: 'last_message_at',
      header: t('common.date'),
      cell: (row) =>
        row.last_message_at
          ? format(new Date(row.last_message_at), 'dd MMM yyyy HH:mm', {
              locale: i18n.language === 'ru' ? ru : enUS,
            })
          : '—',
    },
  ];

  const outboxColumns: Column<EmailOutbox>[] = [
    {
      key: 'to_email',
      header: t('email.to'),
      cell: (row) => row.to_email,
    },
    {
      key: 'subject',
      header: t('email.subject'),
      cell: (row) => (
        <span className="max-w-md truncate block">{row.subject || '—'}</span>
      ),
    },
    {
      key: 'status',
      header: t('common.status'),
      cell: (row) => (
        <StatusBadge
          status={getStatusLabel(row.status)}
          type={getStatusType(row.status)}
        />
      ),
    },
    {
      key: 'queued_at',
      header: t('common.date'),
      cell: (row) =>
        format(new Date(row.queued_at), 'dd MMM yyyy HH:mm', {
          locale: i18n.language === 'ru' ? ru : enUS,
        }),
    },
  ];

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
            <div className="text-2xl font-bold">{threads?.count || 0}</div>
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
          <Card>
            <CardContent className="pt-6">
              <DataTable
                columns={threadColumns}
                data={threads?.data || []}
                loading={threadsLoading}
                page={threadsPage}
                pageSize={pageSize}
                totalCount={threads?.count || 0}
                onPageChange={setThreadsPage}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="outbox">
          <Card>
            <CardContent className="pt-6">
              <DataTable
                columns={outboxColumns}
                data={outbox?.data || []}
                loading={outboxLoading}
                page={outboxPage}
                pageSize={pageSize}
                totalCount={outbox?.count || 0}
                onPageChange={setOutboxPage}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
