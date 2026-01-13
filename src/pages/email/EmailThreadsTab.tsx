import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Mail, ArrowLeft } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, Column } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';

interface EmailThread {
  id: string;
  subject: string | null;
  counterparty_email: string | null;
  last_message_at: string | null;
  created_at: string;
}

interface EmailMessage {
  id: string;
  direction: string;
  from_email: string | null;
  to_email: string | null;
  subject: string | null;
  body_text: string | null;
  received_at: string | null;
  sent_at: string | null;
  status: string;
  has_attachments: boolean;
}

export default function EmailThreadsTab() {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const pageSize = 10;

  const dateLocale = i18n.language === 'ru' ? ru : enUS;

  const { data: threads, isLoading: threadsLoading } = useQuery({
    queryKey: ['email-threads', profile?.organization_id, page, search],
    queryFn: async () => {
      if (!profile?.organization_id) return { data: [], count: 0 };

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      let query = supabase
        .from('email_threads')
        .select('*', { count: 'exact' })
        .eq('organization_id', profile.organization_id)
        .order('last_message_at', { ascending: false });

      if (search) {
        query = query.or(`subject.ilike.%${search}%,counterparty_email.ilike.%${search}%`);
      }

      const { data, count, error } = await query.range(from, to);

      if (error) throw error;
      return { data: data as EmailThread[], count: count || 0 };
    },
    enabled: !!profile?.organization_id,
  });

  const { data: messages, isLoading: messagesLoading } = useQuery({
    queryKey: ['email-messages', selectedThreadId],
    queryFn: async () => {
      if (!selectedThreadId) return [];

      const { data, error } = await supabase
        .from('email_messages')
        .select('*')
        .eq('thread_id', selectedThreadId)
        .order('received_at', { ascending: true });

      if (error) throw error;
      return data as EmailMessage[];
    },
    enabled: !!selectedThreadId,
  });

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
          ? format(new Date(row.last_message_at), 'dd MMM yyyy HH:mm', { locale: dateLocale })
          : '—',
    },
    {
      key: 'actions',
      header: t('common.actions'),
      cell: (row) => (
        <Button variant="outline" size="sm" onClick={() => setSelectedThreadId(row.id)}>
          {t('common.edit')}
        </Button>
      ),
    },
  ];

  if (selectedThreadId) {
    const selectedThread = threads?.data.find(t => t.id === selectedThreadId);

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => setSelectedThreadId(null)}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t('common.back')}
          </Button>
          <h2 className="text-xl font-semibold">
            {selectedThread?.subject || t('email.threads')}
          </h2>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Mail className="h-5 w-5" />
              {selectedThread?.counterparty_email || '—'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {messagesLoading ? (
              <div className="text-muted-foreground">{t('common.loading')}</div>
            ) : messages && messages.length > 0 ? (
              <div className="space-y-4">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`p-4 rounded-lg border ${
                      msg.direction === 'outbound'
                        ? 'bg-primary/5 border-primary/20 ml-8'
                        : 'bg-muted/50 mr-8'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                        <Badge variant={msg.direction === 'outbound' ? 'default' : 'secondary'}>
                          {msg.direction === 'outbound' ? t('email.outbox') : t('email.inbox')}
                        </Badge>
                        {msg.has_attachments && (
                          <Badge variant="outline">{t('email.attachments')}</Badge>
                        )}
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {(msg.received_at || msg.sent_at) 
                          ? format(new Date(msg.received_at || msg.sent_at!), 'dd MMM yyyy HH:mm', { locale: dateLocale })
                          : '—'}
                      </span>
                    </div>
                    <div className="text-sm text-muted-foreground mb-1">
                      {msg.direction === 'outbound' 
                        ? `${t('email.to')}: ${msg.to_email}`
                        : `${t('email.from')}: ${msg.from_email}`}
                    </div>
                    {msg.subject && (
                      <div className="font-medium mb-2">{msg.subject}</div>
                    )}
                    <div className="whitespace-pre-wrap text-sm">
                      {msg.body_text || '—'}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-muted-foreground">{t('common.noData')}</div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <DataTable
          columns={threadColumns}
          data={threads?.data || []}
          loading={threadsLoading}
          page={page}
          pageSize={pageSize}
          totalCount={threads?.count || 0}
          onPageChange={setPage}
          searchValue={search}
          onSearch={setSearch}
          searchPlaceholder={t('common.search')}
        />
      </CardContent>
    </Card>
  );
}
