import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Save } from 'lucide-react';
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
  }>({
    title: '',
    subject: '',
    status: 'NEW',
    source: 'manual',
    contact_id: null,
    buyer_company_id: null,
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
      
      if (error) throw error;
      return data as BuyerCompany[];
    },
    enabled: !!profile?.organization_id,
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
        })
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t('common.success'));
      queryClient.invalidateQueries({ queryKey: ['lead', id] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: (error) => {
      console.error('Update error:', error);
      toast.error(t('errors.generic'));
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
              {t('common.date')}: {format(new Date(lead.created_at), 'dd MMMM yyyy, HH:mm', {
                locale: i18n.language === 'ru' ? ru : enUS,
              })}
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

      <div className="grid gap-6 md:grid-cols-2">
        {/* Main Info */}
        <Card>
          <CardHeader>
            <CardTitle>{t('common.info', 'Основная информация')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">{t('common.name')}</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="Название лида"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="subject">{t('leads.subject')}</Label>
              <Textarea
                id="subject"
                value={formData.subject}
                onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                placeholder="Тема обращения"
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
            <CardTitle>{t('leads.contact', 'Связи')}</CardTitle>
            <CardDescription>
              Привяжите контакт или компанию к лиду
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
                  <SelectValue placeholder="Выберите контакт" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Не выбран —</SelectItem>
                  {contacts?.map((contact) => (
                    <SelectItem key={contact.id} value={contact.id}>
                      {contact.full_name || contact.email || contact.phone || contact.id}
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
                  <SelectValue placeholder="Выберите компанию" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Не выбрана —</SelectItem>
                  {companies?.map((company) => (
                    <SelectItem key={company.id} value={company.id}>
                      {company.company_name} {company.inn ? `(ИНН: ${company.inn})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Raw text (read-only) */}
        {lead.raw_text_for_agent && (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Исходный текст обращения</CardTitle>
              <CardDescription>
                Текст, полученный от клиента (только для чтения)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap text-sm bg-muted p-4 rounded-lg max-h-64 overflow-auto">
                {lead.raw_text_for_agent}
              </pre>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
