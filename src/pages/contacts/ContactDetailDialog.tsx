import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { User, FileText, ShoppingCart, Receipt, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Contact {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  created_at: string;
}

interface ContactDetailDialogProps {
  contact: Contact | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ContactDetailDialog({ contact, open, onOpenChange }: ContactDetailDialogProps) {
  const { t } = useTranslation();
  const { profile } = useAuth();

  // Fetch related leads
  const { data: leads, isLoading: leadsLoading } = useQuery({
    queryKey: ['contact-leads', contact?.id],
    queryFn: async () => {
      if (!contact?.id || !profile?.organization_id) return [];
      const { data, error } = await supabase
        .from('leads')
        .select('id, title, status, source, created_at')
        .eq('organization_id', profile.organization_id)
        .eq('contact_id', contact.id)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
    enabled: !!contact?.id && !!profile?.organization_id && open,
  });

  // Fetch related orders
  const { data: orders, isLoading: ordersLoading } = useQuery({
    queryKey: ['contact-orders', contact?.id],
    queryFn: async () => {
      if (!contact?.id || !profile?.organization_id) return [];
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, status, total_amount, created_at')
        .eq('organization_id', profile.organization_id)
        .eq('contact_id', contact.id)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
    enabled: !!contact?.id && !!profile?.organization_id && open,
  });

  // Fetch related invoices (through orders)
  const { data: invoices, isLoading: invoicesLoading } = useQuery({
    queryKey: ['contact-invoices', contact?.id],
    queryFn: async () => {
      if (!contact?.id || !profile?.organization_id || !orders?.length) return [];
      const orderIds = orders.map(o => o.id);
      const { data, error } = await supabase
        .from('invoices')
        .select('id, invoice_number, status, total_amount, created_at')
        .eq('organization_id', profile.organization_id)
        .in('order_id', orderIds)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
    enabled: !!orders?.length && open,
  });

  if (!contact) return null;

  const getStatusBadge = (status: string) => {
    const colorMap: Record<string, string> = {
      NEW: 'bg-blue-100 text-blue-800',
      IN_PROGRESS: 'bg-yellow-100 text-yellow-800',
      CALCULATED: 'bg-purple-100 text-purple-800',
      DRAFT: 'bg-gray-100 text-gray-800',
      CONFIRMED: 'bg-green-100 text-green-800',
      INVOICED: 'bg-indigo-100 text-indigo-800',
      PAID: 'bg-green-100 text-green-800',
      SENT: 'bg-blue-100 text-blue-800',
      CANCELLED: 'bg-red-100 text-red-800',
      FAILED: 'bg-red-100 text-red-800',
      CREATED: 'bg-gray-100 text-gray-800',
    };
    return (
      <Badge className={colorMap[status] || 'bg-gray-100 text-gray-800'}>
        {status}
      </Badge>
    );
  };

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(value);

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('ru-RU');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            {contact.full_name || 'Без имени'}
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="info" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="info">Контакт</TabsTrigger>
            <TabsTrigger value="leads">Лиды</TabsTrigger>
            <TabsTrigger value="orders">Заказы</TabsTrigger>
            <TabsTrigger value="invoices">Счета</TabsTrigger>
          </TabsList>

          <ScrollArea className="h-[400px] mt-4">
            <TabsContent value="info" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Контактная информация</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div>
                    <span className="text-muted-foreground">{t('contacts.fullName')}:</span>
                    <span className="ml-2 font-medium">{contact.full_name || '—'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{t('contacts.email')}:</span>
                    <span className="ml-2">{contact.email || '—'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{t('contacts.phone')}:</span>
                    <span className="ml-2">{contact.phone || '—'}</span>
                  </div>
                  {contact.notes && (
                    <div>
                      <span className="text-muted-foreground">{t('contacts.notes')}:</span>
                      <p className="mt-1 p-2 bg-muted rounded">{contact.notes}</p>
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground">Создан:</span>
                    <span className="ml-2">{formatDate(contact.created_at)}</span>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="leads" className="space-y-2">
              {leadsLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : leads?.length ? (
                leads.map((lead) => (
                  <Card key={lead.id} className="p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{lead.title || 'Без названия'}</p>
                        <p className="text-sm text-muted-foreground">
                          {formatDate(lead.created_at)} • {lead.source}
                        </p>
                      </div>
                      {getStatusBadge(lead.status)}
                    </div>
                  </Card>
                ))
              ) : (
                <p className="text-center text-muted-foreground py-8">{t('common.noData')}</p>
              )}
            </TabsContent>

            <TabsContent value="orders" className="space-y-2">
              {ordersLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : orders?.length ? (
                orders.map((order) => (
                  <Card key={order.id} className="p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{order.order_number || order.id.slice(0, 8)}</p>
                        <p className="text-sm text-muted-foreground">
                          {formatDate(order.created_at)} • {formatCurrency(order.total_amount)}
                        </p>
                      </div>
                      {getStatusBadge(order.status)}
                    </div>
                  </Card>
                ))
              ) : (
                <p className="text-center text-muted-foreground py-8">{t('common.noData')}</p>
              )}
            </TabsContent>

            <TabsContent value="invoices" className="space-y-2">
              {invoicesLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : invoices?.length ? (
                invoices.map((invoice) => (
                  <Card key={invoice.id} className="p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{invoice.invoice_number || invoice.id.slice(0, 8)}</p>
                        <p className="text-sm text-muted-foreground">
                          {formatDate(invoice.created_at)} • {formatCurrency(invoice.total_amount)}
                        </p>
                      </div>
                      {getStatusBadge(invoice.status)}
                    </div>
                  </Card>
                ))
              ) : (
                <p className="text-center text-muted-foreground py-8">{t('common.noData')}</p>
              )}
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
