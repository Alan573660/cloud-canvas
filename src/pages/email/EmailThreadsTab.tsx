import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { 
  Mail, ArrowLeft, Paperclip, FileText, ExternalLink, 
  User, MessageSquare, Clock, ArrowUpRight, ArrowDownLeft,
  ChevronDown, ChevronUp
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { openSignedUrl } from '@/lib/file-utils';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { DataTable, Column } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { format } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';

interface EmailThread {
  id: string;
  subject: string | null;
  counterparty_email: string | null;
  last_message_at: string | null;
  created_at: string;
  lead_id: string | null;
  contact_id: string | null;
}

interface EmailMessage {
  id: string;
  direction: string;
  from_email: string | null;
  to_email: string | null;
  subject: string | null;
  body_text: string | null;
  raw_text_for_agent: string | null;
  received_at: string | null;
  sent_at: string | null;
  status: string;
  has_attachments: boolean;
  error_reason: string | null;
}

interface EmailAttachment {
  id: string;
  message_id: string;
  filename: string | null;
  mime_type: string | null;
  storage_url: string | null;
  extracted_text: string | null;
}

interface Contact {
  id: string;
  full_name: string | null;
  email: string | null;
}

interface Lead {
  id: string;
  title: string | null;
  subject: string | null;
}

export default function EmailThreadsTab() {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
  const pageSize = 10;

  const dateLocale = i18n.language === 'ru' ? ru : enUS;

  // Fetch threads with message count
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

  // Fetch message counts for threads
  const threadIds = threads?.data.map(t => t.id) || [];
  const { data: messageCounts } = useQuery({
    queryKey: ['email-message-counts', threadIds],
    queryFn: async () => {
      if (threadIds.length === 0) return {};

      const { data, error } = await supabase
        .from('email_messages')
        .select('thread_id')
        .in('thread_id', threadIds);

      if (error) throw error;

      const counts: Record<string, number> = {};
      data?.forEach(m => {
        counts[m.thread_id] = (counts[m.thread_id] || 0) + 1;
      });
      return counts;
    },
    enabled: threadIds.length > 0,
  });

  // Fetch contacts for threads
  const contactIds = threads?.data.filter(t => t.contact_id).map(t => t.contact_id!) || [];
  const { data: contacts } = useQuery({
    queryKey: ['thread-contacts', contactIds],
    queryFn: async () => {
      if (contactIds.length === 0) return {};

      const { data, error } = await supabase
        .from('contacts')
        .select('id, full_name, email')
        .in('id', contactIds);

      if (error) throw error;

      const map: Record<string, Contact> = {};
      data?.forEach(c => { map[c.id] = c; });
      return map;
    },
    enabled: contactIds.length > 0,
  });

  // Fetch leads for threads
  const leadIds = threads?.data.filter(t => t.lead_id).map(t => t.lead_id!) || [];
  const { data: leads } = useQuery({
    queryKey: ['thread-leads', leadIds],
    queryFn: async () => {
      if (leadIds.length === 0) return {};

      const { data, error } = await supabase
        .from('leads')
        .select('id, title, subject')
        .in('id', leadIds);

      if (error) throw error;

      const map: Record<string, Lead> = {};
      data?.forEach(l => { map[l.id] = l; });
      return map;
    },
    enabled: leadIds.length > 0,
  });

  // Fetch messages for selected thread
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

  // Fetch attachments for all messages in the thread
  const messageIds = messages?.map(m => m.id) || [];
  const { data: attachments } = useQuery({
    queryKey: ['email-attachments', messageIds],
    queryFn: async () => {
      if (messageIds.length === 0) return [];

      const { data, error } = await supabase
        .from('email_attachments')
        .select('*')
        .in('message_id', messageIds);

      if (error) throw error;
      return data as EmailAttachment[];
    },
    enabled: messageIds.length > 0,
  });

  const getAttachmentsForMessage = (messageId: string) => {
    return attachments?.filter(a => a.message_id === messageId) || [];
  };

  const toggleMessageExpansion = (messageId: string) => {
    setExpandedMessages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
      }
      return newSet;
    });
  };

  const threadColumns: Column<EmailThread>[] = [
    {
      key: 'counterparty_email',
      header: t('email.correspondent'),
      cell: (row) => (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{row.counterparty_email || '—'}</span>
          </div>
          {row.contact_id && contacts?.[row.contact_id] && (
            <span className="text-xs text-muted-foreground ml-6">
              {contacts[row.contact_id].full_name}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'subject',
      header: t('email.subject'),
      cell: (row) => (
        <div className="max-w-md">
          <span className="truncate block font-medium">{row.subject || t('email.noSubject')}</span>
          {row.lead_id && leads?.[row.lead_id] && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link 
                    to={`/leads/${row.lead_id}`}
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ArrowUpRight className="h-3 w-3" />
                    {leads[row.lead_id].title || leads[row.lead_id].subject || t('leads.title')}
                  </Link>
                </TooltipTrigger>
                <TooltipContent>{t('email.linkedLead')}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      ),
    },
    {
      key: 'messages_count',
      header: t('email.messagesCount'),
      cell: (row) => (
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <span>{messageCounts?.[row.id] || 0}</span>
        </div>
      ),
    },
    {
      key: 'last_message_at',
      header: t('email.lastActivity'),
      cell: (row) => (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Clock className="h-4 w-4" />
          {row.last_message_at
            ? format(new Date(row.last_message_at), 'dd MMM yyyy HH:mm', { locale: dateLocale })
            : '—'}
        </div>
      ),
    },
    {
      key: 'actions',
      header: t('common.actions'),
      cell: (row) => (
        <Button variant="outline" size="sm" onClick={() => setSelectedThreadId(row.id)}>
          {t('common.open')}
        </Button>
      ),
    },
  ];

  // Thread detail view
  if (selectedThreadId) {
    const selectedThread = threads?.data.find(t => t.id === selectedThreadId);
    const threadContact = selectedThread?.contact_id ? contacts?.[selectedThread.contact_id] : null;
    const threadLead = selectedThread?.lead_id ? leads?.[selectedThread.lead_id] : null;

    return (
      <div className="space-y-4">
        {/* Back button and header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={() => setSelectedThreadId(null)}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              {t('common.back')}
            </Button>
            <Separator orientation="vertical" className="h-6" />
            <div>
              <h2 className="text-xl font-semibold">
                {selectedThread?.subject || t('email.noSubject')}
              </h2>
              <p className="text-sm text-muted-foreground">
                {selectedThread?.counterparty_email}
              </p>
            </div>
          </div>
        </div>

        {/* Thread info cards */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Mail className="h-4 w-4" />
                {t('email.threadInfo')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('email.correspondent')}:</span>
                <span className="font-medium">{selectedThread?.counterparty_email || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('email.messagesCount')}:</span>
                <span className="font-medium">{messages?.length || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('common.createdAt')}:</span>
                <span className="font-medium">
                  {selectedThread?.created_at
                    ? format(new Date(selectedThread.created_at), 'dd MMM yyyy HH:mm', { locale: dateLocale })
                    : '—'}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <User className="h-4 w-4" />
                {t('email.linkedData')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">{t('contacts.title')}:</span>
                {threadContact ? (
                  <span className="font-medium">{threadContact.full_name || threadContact.email}</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">{t('leads.title')}:</span>
                {threadLead ? (
                  <Link 
                    to={`/leads/${selectedThread?.lead_id}`}
                    className="font-medium text-primary hover:underline flex items-center gap-1"
                  >
                    {threadLead.title || threadLead.subject}
                    <ArrowUpRight className="h-3 w-3" />
                  </Link>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Messages list */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              {t('email.messages')} ({messages?.length || 0})
            </CardTitle>
            <CardDescription>{t('email.conversationHistory')}</CardDescription>
          </CardHeader>
          <CardContent>
            {messagesLoading ? (
              <div className="text-muted-foreground text-center py-8">{t('common.loading')}</div>
            ) : messages && messages.length > 0 ? (
              <ScrollArea className="max-h-[600px]">
                <div className="space-y-4 pr-4">
                  {messages.map((msg, index) => {
                    const msgAttachments = getAttachmentsForMessage(msg.id);
                    const isOutbound = msg.direction === 'outbound';
                    const isExpanded = expandedMessages.has(msg.id);
                    const bodyPreview = msg.body_text && msg.body_text.length > 300 
                      ? msg.body_text.slice(0, 300) + '...'
                      : msg.body_text;

                    return (
                      <div
                        key={msg.id}
                        className={`relative rounded-lg border transition-all ${
                          isOutbound
                            ? 'bg-primary/5 border-primary/20 ml-8'
                            : 'bg-muted/50 border-border mr-8'
                        }`}
                      >
                        {/* Message header */}
                        <div className="p-4 pb-2">
                          <div className="flex justify-between items-start mb-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge 
                                variant={isOutbound ? 'default' : 'secondary'}
                                className="flex items-center gap-1"
                              >
                                {isOutbound ? (
                                  <ArrowUpRight className="h-3 w-3" />
                                ) : (
                                  <ArrowDownLeft className="h-3 w-3" />
                                )}
                                {isOutbound ? t('email.outbox') : t('email.inbox')}
                              </Badge>

                              {msg.status !== 'delivered' && msg.status !== 'received' && (
                                <Badge variant="outline" className="text-xs">
                                  {msg.status}
                                </Badge>
                              )}

                              {msg.has_attachments && (
                                <Badge variant="outline" className="flex items-center gap-1">
                                  <Paperclip className="h-3 w-3" />
                                  {msgAttachments.length}
                                </Badge>
                              )}

                              {msg.error_reason && (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger>
                                      <Badge variant="destructive" className="text-xs">
                                        {t('common.error')}
                                      </Badge>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-sm">
                                      {msg.error_reason}
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                            </div>
                            
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {(msg.received_at || msg.sent_at) 
                                ? format(new Date(msg.received_at || msg.sent_at!), 'dd MMM yyyy HH:mm', { locale: dateLocale })
                                : '—'}
                            </span>
                          </div>
                          
                          <div className="text-sm text-muted-foreground mb-2">
                            {isOutbound 
                              ? `${t('email.to')}: ${msg.to_email}`
                              : `${t('email.from')}: ${msg.from_email}`}
                          </div>
                          
                          {msg.subject && (
                            <div className="font-medium text-sm mb-2">{msg.subject}</div>
                          )}
                        </div>

                        {/* Message body */}
                        <div className="px-4 pb-4">
                          <div className="whitespace-pre-wrap text-sm bg-background/50 rounded p-3">
                            {msg.body_text && msg.body_text.length > 300 ? (
                              <Collapsible open={isExpanded} onOpenChange={() => toggleMessageExpansion(msg.id)}>
                                <div>
                                  {isExpanded ? msg.body_text : bodyPreview}
                                </div>
                                <CollapsibleTrigger asChild>
                                  <Button variant="ghost" size="sm" className="mt-2 text-xs">
                                    {isExpanded ? (
                                      <>
                                        <ChevronUp className="h-3 w-3 mr-1" />
                                        {t('email.showLess')}
                                      </>
                                    ) : (
                                      <>
                                        <ChevronDown className="h-3 w-3 mr-1" />
                                        {t('email.showMore')}
                                      </>
                                    )}
                                  </Button>
                                </CollapsibleTrigger>
                              </Collapsible>
                            ) : (
                              msg.body_text || '—'
                            )}
                          </div>

                          {/* Attachments */}
                          {msgAttachments.length > 0 && (
                            <div className="mt-3 pt-3 border-t">
                              <div className="text-sm font-medium mb-2 flex items-center gap-1">
                                <Paperclip className="h-4 w-4" />
                                {t('email.attachments')} ({msgAttachments.length})
                              </div>
                              <div className="space-y-2">
                                {msgAttachments.map((att) => (
                                  <div key={att.id} className="flex items-start gap-2 text-sm bg-muted/50 p-2 rounded">
                                    <FileText className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2">
                                        <span className="truncate">{att.filename || 'attachment'}</span>
                                        {att.mime_type && (
                                          <span className="text-xs text-muted-foreground shrink-0">
                                            ({att.mime_type})
                                          </span>
                                        )}
                                        {att.storage_url && (
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-6 px-2 shrink-0"
                                            onClick={() => openSignedUrl(att.storage_url, att.filename || 'attachment')}
                                          >
                                            <ExternalLink className="h-3 w-3" />
                                          </Button>
                                        )}
                                      </div>
                                      {att.extracted_text && (
                                        <Accordion type="single" collapsible className="mt-1">
                                          <AccordionItem value="extracted" className="border-0">
                                            <AccordionTrigger className="py-1 text-xs hover:no-underline">
                                              {t('email.extractedText')}
                                            </AccordionTrigger>
                                            <AccordionContent>
                                              <pre className="text-xs whitespace-pre-wrap bg-background p-2 rounded max-h-32 overflow-auto">
                                                {att.extracted_text}
                                              </pre>
                                            </AccordionContent>
                                          </AccordionItem>
                                        </Accordion>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Raw text for agent */}
                          {msg.raw_text_for_agent && (
                            <Accordion type="single" collapsible className="mt-3">
                              <AccordionItem value="raw" className="border rounded">
                                <AccordionTrigger className="px-3 py-2 text-sm hover:no-underline">
                                  {t('email.rawTextForAgent')}
                                </AccordionTrigger>
                                <AccordionContent className="px-3 pb-3">
                                  <pre className="text-xs whitespace-pre-wrap bg-muted p-2 rounded max-h-48 overflow-auto">
                                    {msg.raw_text_for_agent}
                                  </pre>
                                </AccordionContent>
                              </AccordionItem>
                            </Accordion>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            ) : (
              <div className="text-muted-foreground text-center py-8">{t('common.noData')}</div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Threads list view
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
          searchPlaceholder={t('email.searchPlaceholder')}
          emptyMessage={t('email.noThreads')}
        />
      </CardContent>
    </Card>
  );
}
