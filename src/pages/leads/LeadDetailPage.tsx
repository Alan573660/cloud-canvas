import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Save, FileText, Phone, Mail, ShoppingCart } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StatusBadge } from '@/components/ui/status-badge';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';

// DB enum values - MUST match database exactly
const LEAD_STATUSES = ['NEW', 'IN_PROGRESS', 'CALCULATED', 'INVOICED', 'PAID', 'FAILED', 'HUMAN_REQUIRED'] as const;
const LEAD_SOURCES = ['call', 'email', 'manual'] as const;

type LeadStatus = typeof LEAD_STATUSES[number];
type LeadSource = typeof LEAD_SOURCES[number];

interface Lead {
  id: string;
  title: string | null;
  subject: string | null;
  source: LeadSource;
  status: LeadStatus;
  contact_id: string | null;
  buyer_company_id: string | null;
  assigned_to: string | null;
  raw_text_for_agent: string | null;
  created_at: string;
  updated_at: string;
}

interface Contact {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
}

interface BuyerCompany {
  id: string;
  company_name: string;
  inn: string | null;
}

interface Profile {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
}

interface Order {
  id: string;
  order_number: string | null;
  status: string;
  total_amount: number;
  created_at: string;
}

interface Invoice {
  id: string;
  invoice_number: string | null;
  status: string;
  total_amount: number;
  created_at: string;
}

interface CallSession {
  id: string;
  direction: string;
  status: string;
  duration_seconds: number;
  started_at: string | null;
  from_phone: string | null;
  to_phone: string | null;
}

interface EmailThread {
  id: string;
  subject: string | null;
  counterparty_email: string | null;
  last_message_at: string | null;
}

export default function LeadDetailPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState<{
    title: string;
    subject: string;
    status: LeadStatus;
    source: LeadSource;
    contact_id: string | null;
    buyer_company_id: string | null;
    assigned_to: string | null;
  }>({
    title: '',
    subject: '',
    status: 'NEW',
    source: 'manual',
    contact_id: null,
    buyer_company_id: null,
    assigned_to: null,
  });

  // Fetch lead data
  const { data: lead, isLoading: leadLoading } = useQuery({
    queryKey: ['lead', id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .eq('id', id)
        .single();
      
      if (error) throw error;
      return data as Lead;
    },
    enabled: !!id,
  });

  // Fetch contacts for dropdown
  const { data: contacts } = useQuery({
    queryKey: ['contacts-list', profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return [];
      const { data, error } = await supabase
        .from('contacts')
        .select('id, full_name, email, phone')
        .eq('organization_id', profile.organization_id)
        .order('full_name');
      
      if (error) throw error;
      return data as Contact[];
    },
    enabled: !!profile?.organization_id,
  });

  // Fetch buyer companies for dropdown
  const { data: companies } = useQuery({
    queryKey: ['buyer-companies-list', profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return [];
      const { data, error } = await supabase
        .from('buyer_companies')
        .select('id, company_name, inn')
        .eq('organization_id', profile.organization_id)
        .order('company_name');
      
      if (error) {
        // RLS might deny access for operators - just return empty
        console.warn('Cannot fetch companies:', error.message);
        return [];
      }
      return data as BuyerCompany[];
    },
    enabled: !!profile?.organization_id,
  });

  // Fetch org members for assigned_to dropdown
  const { data: orgMembers } = useQuery({
    queryKey: ['org-members', profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return [];
      const { data, error } = await supabase
        .from('profiles')
        .select('id, user_id, full_name, email')
        .eq('organization_id', profile.organization_id)
        .order('full_name');
      
      if (error) throw error;
      return data as Profile[];
    },
    enabled: !!profile?.organization_id,
  });

  // Fetch related orders
  const { data: orders } = useQuery({
    queryKey: ['lead-orders', id],
    queryFn: async () => {
      if (!id) return [];
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, status, total_amount, created_at')
        .eq('lead_id', id)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data as Order[];
    },
    enabled: !!id,
  });

  // Fetch related invoices (via orders)
  const { data: invoices } = useQuery({
    queryKey: ['lead-invoices', id, orders],
    queryFn: async () => {
      if (!orders || orders.length === 0) return [];
      const orderIds = orders.map(o => o.id);
      const { data, error } = await supabase
        .from('invoices')
        .select('id, invoice_number, status, total_amount, created_at')
        .in('order_id', orderIds)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data as Invoice[];
    },
    enabled: !!orders && orders.length > 0,
  });

  // Fetch related call sessions
  const { data: calls } = useQuery({
    queryKey: ['lead-calls', id],
    queryFn: async () => {
      if (!id) return [];
      const { data, error } = await supabase
        .from('call_sessions')
        .select('id, direction, status, duration_seconds, started_at, from_phone, to_phone')
        .eq('lead_id', id)
        .order('started_at', { ascending: false });
      
      if (error) {
        console.warn('Cannot fetch calls:', error.message);
        return [];
      }
      return data as CallSession[];
    },
    enabled: !!id,
  });

  // Fetch related email threads
  const { data: emailThreads } = useQuery({
    queryKey: ['lead-emails', id],
    queryFn: async () => {
      if (!id) return [];
      const { data, error } = await supabase
        .from('email_threads')
        .select('id, subject, counterparty_email, last_message_at')
        .eq('lead_id', id)
        .order('last_message_at', { ascending: false });
      
      if (error) throw error;
      return data as EmailThread[];
    },
    enabled: !!id,
  });

  // Update form when lead data loads
  useEffect(() => {
    if (lead) {
      setFormData({
        title: lead.title || '',
        subject: lead.subject || '',
        status: lead.status as LeadStatus,
        source: lead.source as LeadSource,
        contact_id: lead.contact_id,
        buyer_company_id: lead.buyer_company_id,
        assigned_to: lead.assigned_to,
      });
    }
  }, [lead]);

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('No lead ID');
      
      const { error } = await supabase
        .from('leads')
        .update({
          title: formData.title || null,
          subject: formData.subject || null,
          status: formData.status,
          source: formData.source,
          contact_id: formData.contact_id,
          buyer_company_id: formData.buyer_company_id,
          assigned_to: formData.assigned_to,
        })
        .eq('id', id);

      if (error) {
        if (error.code === '42501' || error.message?.includes('permission')) {
          throw new Error('permission_denied');
        }
        throw error;
      }
    },
    onSuccess: () => {
      toast.success(t('common.success'));
      queryClient.invalidateQueries({ queryKey: ['lead', id] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: (error: Error) => {
      console.error('Update error:', error);
      if (error.message === 'permission_denied') {
        toast.error(t('errors.forbidden'));
      } else {
        toast.error(t('errors.generic'));
      }
    },
  });

  const getStatusLabel = (status: LeadStatus) => {
    const statusMap: Record<LeadStatus, string> = {
      NEW: t('leads.statuses.new'),
      IN_PROGRESS: t('leads.statuses.inProgress'),
      CALCULATED: t('leads.statuses.calculated'),
      INVOICED: t('leads.statuses.invoiced'),
      PAID: t('leads.statuses.paid'),
      FAILED: t('leads.statuses.failed'),
      HUMAN_REQUIRED: t('leads.statuses.humanRequired'),
    };
    return statusMap[status] || status;
  };

  const getSourceLabel = (source: LeadSource) => {
    const sourceMap: Record<LeadSource, string> = {
      call: t('leads.sources.call'),
      email: t('leads.sources.email'),
      manual: t('leads.sources.manual'),
    };
    return sourceMap[source] || source;
  };

  const getLeadStatusType = (status: string) => {
    switch (status) {
      case 'PAID':
        return 'success' as const;
      case 'NEW':
      case 'IN_PROGRESS':
      case 'CALCULATED':
        return 'warning' as const;
      case 'INVOICED':
        return 'info' as const;
      case 'FAILED':
      case 'HUMAN_REQUIRED':
        return 'error' as const;
      default:
        return 'default' as const;
    }
  };

  const getOrderStatusType = (status: string) => {
    switch (status) {
      case 'PAID': return 'success' as const;
      case 'DRAFT': case 'CONFIRMED': return 'warning' as const;
      case 'INVOICED': return 'info' as const;
      case 'CANCELLED': case 'FAILED': return 'error' as const;
      default: return 'default' as const;
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    return format(new Date(dateStr), 'dd MMM yyyy, HH:mm', {
      locale: i18n.language === 'ru' ? ru : enUS,
    });
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (leadLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => navigate('/leads')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t('common.back')}
        </Button>
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            {t('errors.notFound')}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => navigate('/leads')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t('common.back')}
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{t('leads.editLead')}</h1>
            <p className="text-sm text-muted-foreground">
              {t('common.date')}: {formatDate(lead.created_at)}
            </p>
          </div>
        </div>
        <Button 
          onClick={() => updateMutation.mutate()}
          disabled={updateMutation.isPending}
        >
          {updateMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          {t('common.save')}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Main Info */}
        <Card>
          <CardHeader>
            <CardTitle>{t('common.info')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">{t('common.name')}</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder={i18n.language === 'ru' ? 'Название лида' : 'Lead name'}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="subject">{t('leads.subject')}</Label>
              <Textarea
                id="subject"
                value={formData.subject}
                onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                placeholder={i18n.language === 'ru' ? 'Тема обращения' : 'Subject'}
                rows={3}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t('common.status')}</Label>
                <Select
                  value={formData.status}
                  onValueChange={(value) => setFormData({ ...formData, status: value as LeadStatus })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LEAD_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {getStatusLabel(status)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>{t('leads.source')}</Label>
                <Select
                  value={formData.source}
                  onValueChange={(value) => setFormData({ ...formData, source: value as LeadSource })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LEAD_SOURCES.map((source) => (
                      <SelectItem key={source} value={source}>
                        {getSourceLabel(source)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Relations */}
        <Card>
          <CardHeader>
            <CardTitle>{i18n.language === 'ru' ? 'Связи' : 'Relations'}</CardTitle>
            <CardDescription>
              {i18n.language === 'ru' ? 'Привяжите контакт, компанию или ответственного' : 'Link contact, company or assignee'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>{t('leads.contact')}</Label>
              <Select
                value={formData.contact_id || 'none'}
                onValueChange={(value) => setFormData({ 
                  ...formData, 
                  contact_id: value === 'none' ? null : value 
                })}
              >
                <SelectTrigger>
                  <SelectValue placeholder={i18n.language === 'ru' ? 'Выберите контакт' : 'Select contact'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— {i18n.language === 'ru' ? 'Не выбран' : 'Not selected'} —</SelectItem>
                  {contacts?.map((contact) => (
                    <SelectItem key={contact.id} value={contact.id}>
                      {contact.full_name || contact.email || contact.phone || contact.id.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t('leads.company')}</Label>
              <Select
                value={formData.buyer_company_id || 'none'}
                onValueChange={(value) => setFormData({ 
                  ...formData, 
                  buyer_company_id: value === 'none' ? null : value 
                })}
              >
                <SelectTrigger>
                  <SelectValue placeholder={i18n.language === 'ru' ? 'Выберите компанию' : 'Select company'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— {i18n.language === 'ru' ? 'Не выбрана' : 'Not selected'} —</SelectItem>
                  {companies?.map((company) => (
                    <SelectItem key={company.id} value={company.id}>
                      {company.company_name} {company.inn ? `(ИНН: ${company.inn})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t('leads.assignedTo')}</Label>
              <Select
                value={formData.assigned_to || 'none'}
                onValueChange={(value) => setFormData({ 
                  ...formData, 
                  assigned_to: value === 'none' ? null : value 
                })}
              >
                <SelectTrigger>
                  <SelectValue placeholder={i18n.language === 'ru' ? 'Выберите ответственного' : 'Select assignee'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— {i18n.language === 'ru' ? 'Не назначен' : 'Not assigned'} —</SelectItem>
                  {orgMembers?.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.full_name || member.email || member.user_id.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Raw text accordion */}
      {lead.raw_text_for_agent && (
        <Accordion type="single" collapsible className="bg-card border rounded-lg">
          <AccordionItem value="raw-text" className="border-0">
            <AccordionTrigger className="px-6">
              {i18n.language === 'ru' ? 'Исходный текст обращения' : 'Original request text'}
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-4">
              <pre className="whitespace-pre-wrap text-sm bg-muted p-4 rounded-lg max-h-64 overflow-auto font-mono">
                {lead.raw_text_for_agent}
              </pre>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}

      {/* Related Data Tabs */}
      <Card>
        <CardHeader>
          <CardTitle>{i18n.language === 'ru' ? 'Связанные данные' : 'Related Data'}</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="orders" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="orders" className="flex items-center gap-2">
                <ShoppingCart className="h-4 w-4" />
                {t('nav.orders')} ({orders?.length || 0})
              </TabsTrigger>
              <TabsTrigger value="invoices" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                {t('nav.invoices')} ({invoices?.length || 0})
              </TabsTrigger>
              <TabsTrigger value="calls" className="flex items-center gap-2">
                <Phone className="h-4 w-4" />
                {t('calls.title')} ({calls?.length || 0})
              </TabsTrigger>
              <TabsTrigger value="emails" className="flex items-center gap-2">
                <Mail className="h-4 w-4" />
                {t('nav.email')} ({emailThreads?.length || 0})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="orders" className="mt-4">
              {orders && orders.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('orders.orderNumber')}</TableHead>
                      <TableHead>{t('common.status')}</TableHead>
                      <TableHead>{t('orders.total')}</TableHead>
                      <TableHead>{t('common.date')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((order) => (
                      <TableRow 
                        key={order.id} 
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => navigate(`/orders/${order.id}`)}
                      >
                        <TableCell className="font-medium">{order.order_number || order.id.slice(0, 8)}</TableCell>
                        <TableCell>
                          <StatusBadge status={order.status} type={getOrderStatusType(order.status)} />
                        </TableCell>
                        <TableCell>{order.total_amount.toLocaleString()} ₽</TableCell>
                        <TableCell>{formatDate(order.created_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="py-8 text-center text-muted-foreground">
                  {t('orders.noOrders')}
                </div>
              )}
            </TabsContent>

            <TabsContent value="invoices" className="mt-4">
              {invoices && invoices.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('invoices.invoiceNumber')}</TableHead>
                      <TableHead>{t('common.status')}</TableHead>
                      <TableHead>{t('invoices.amount')}</TableHead>
                      <TableHead>{t('common.date')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoices.map((invoice) => (
                      <TableRow 
                        key={invoice.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => navigate(`/invoices/${invoice.id}`)}
                      >
                        <TableCell className="font-medium">{invoice.invoice_number || invoice.id.slice(0, 8)}</TableCell>
                        <TableCell>
                          <StatusBadge status={invoice.status} type={getOrderStatusType(invoice.status)} />
                        </TableCell>
                        <TableCell>{invoice.total_amount.toLocaleString()} ₽</TableCell>
                        <TableCell>{formatDate(invoice.created_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="py-8 text-center text-muted-foreground">
                  {t('invoices.noInvoices')}
                </div>
              )}
            </TabsContent>

            <TabsContent value="calls" className="mt-4">
              {calls && calls.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('calls.direction')}</TableHead>
                      <TableHead>{t('calls.fromPhone')}</TableHead>
                      <TableHead>{t('calls.toPhone')}</TableHead>
                      <TableHead>{t('calls.duration')}</TableHead>
                      <TableHead>{t('common.status')}</TableHead>
                      <TableHead>{t('common.date')}</TableHead>
                      <TableHead>{t('common.actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {calls.map((call) => (
                      <TableRow key={call.id}>
                        <TableCell>
                          {call.direction === 'inbound' ? (
                            <span className="flex items-center gap-1">📞 {t('calls.inbound')}</span>
                          ) : (
                            <span className="flex items-center gap-1">📲 {t('calls.outbound')}</span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-sm">{call.from_phone || '—'}</TableCell>
                        <TableCell className="font-mono text-sm">{call.to_phone || '—'}</TableCell>
                        <TableCell className="font-mono">{formatDuration(call.duration_seconds)}</TableCell>
                        <TableCell>
                          <StatusBadge status={call.status} type={call.status === 'DONE' ? 'success' : call.status === 'FAILED' ? 'error' : 'warning'} />
                        </TableCell>
                        <TableCell>{formatDate(call.started_at)}</TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => navigate(`/calls/${call.id}`)}
                          >
                            {t('common.details')}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="py-8 text-center text-muted-foreground">
                  {t('calls.noCalls')}
                </div>
              )}
            </TabsContent>

            <TabsContent value="emails" className="mt-4">
              {emailThreads && emailThreads.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('email.subject')}</TableHead>
                      <TableHead>{i18n.language === 'ru' ? 'Контрагент' : 'Counterparty'}</TableHead>
                      <TableHead>{i18n.language === 'ru' ? 'Последнее сообщение' : 'Last message'}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {emailThreads.map((thread) => (
                      <TableRow key={thread.id}>
                        <TableCell className="font-medium">{thread.subject || '—'}</TableCell>
                        <TableCell>{thread.counterparty_email || '—'}</TableCell>
                        <TableCell>{formatDate(thread.last_message_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="py-8 text-center text-muted-foreground">
                  {i18n.language === 'ru' ? 'Нет писем' : 'No emails'}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
