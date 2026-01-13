import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Building2, FileText, ShoppingCart, Receipt, Loader2 } from 'lucide-react';
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
import type { Json } from '@/integrations/supabase/types';

interface Company {
  id: string;
  company_name: string;
  inn: string | null;
  kpp: string | null;
  ogrn: string | null;
  legal_address: string | null;
  bank_details_json: Json;
  created_at: string;
}

interface CompanyDetailDialogProps {
  company: Company | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CompanyDetailDialog({ company, open, onOpenChange }: CompanyDetailDialogProps) {
  const { t } = useTranslation();
  const { profile } = useAuth();

  // Fetch related leads
  const { data: leads, isLoading: leadsLoading } = useQuery({
    queryKey: ['company-leads', company?.id],
    queryFn: async () => {
      if (!company?.id || !profile?.organization_id) return [];
      const { data, error } = await supabase
        .from('leads')
        .select('id, title, status, source, created_at')
        .eq('organization_id', profile.organization_id)
        .eq('buyer_company_id', company.id)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
    enabled: !!company?.id && !!profile?.organization_id && open,
  });

  // Fetch related orders
  const { data: orders, isLoading: ordersLoading } = useQuery({
    queryKey: ['company-orders', company?.id],
    queryFn: async () => {
      if (!company?.id || !profile?.organization_id) return [];
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, status, total_amount, created_at')
        .eq('organization_id', profile.organization_id)
        .eq('buyer_company_id', company.id)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
    enabled: !!company?.id && !!profile?.organization_id && open,
  });

  // Fetch related invoices (through orders)
  const { data: invoices, isLoading: invoicesLoading } = useQuery({
    queryKey: ['company-invoices', company?.id],
    queryFn: async () => {
      if (!company?.id || !profile?.organization_id || !orders?.length) return [];
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

  if (!company) return null;

  const bankDetails = company.bank_details_json as Record<string, string> | null;

  const getStatusBadge = (status: string, type: 'lead' | 'order' | 'invoice') => {
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
            <Building2 className="h-5 w-5" />
            {company.company_name}
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="info" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="info">Реквизиты</TabsTrigger>
            <TabsTrigger value="leads">Лиды</TabsTrigger>
            <TabsTrigger value="orders">Заказы</TabsTrigger>
            <TabsTrigger value="invoices">Счета</TabsTrigger>
          </TabsList>

          <ScrollArea className="h-[400px] mt-4">
            <TabsContent value="info" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Юридические реквизиты</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-muted-foreground">{t('companies.inn')}:</span>
                      <span className="ml-2 font-mono">{company.inn || '—'}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{t('companies.kpp')}:</span>
                      <span className="ml-2 font-mono">{company.kpp || '—'}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{t('companies.ogrn')}:</span>
                      <span className="ml-2 font-mono">{company.ogrn || '—'}</span>
                    </div>
                  </div>
                  {company.legal_address && (
                    <div>
                      <span className="text-muted-foreground">{t('companies.legalAddress')}:</span>
                      <p className="mt-1">{company.legal_address}</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {bankDetails && Object.values(bankDetails).some(v => v) && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">{t('companies.bankDetails')}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {bankDetails.bank_name && (
                      <div>
                        <span className="text-muted-foreground">Банк:</span>
                        <span className="ml-2">{bankDetails.bank_name}</span>
                      </div>
                    )}
                    {bankDetails.bank_bik && (
                      <div>
                        <span className="text-muted-foreground">БИК:</span>
                        <span className="ml-2 font-mono">{bankDetails.bank_bik}</span>
                      </div>
                    )}
                    {bankDetails.bank_account && (
                      <div>
                        <span className="text-muted-foreground">Р/с:</span>
                        <span className="ml-2 font-mono">{bankDetails.bank_account}</span>
                      </div>
                    )}
                    {bankDetails.bank_corr_account && (
                      <div>
                        <span className="text-muted-foreground">К/с:</span>
                        <span className="ml-2 font-mono">{bankDetails.bank_corr_account}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
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
                      {getStatusBadge(lead.status, 'lead')}
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
                      {getStatusBadge(order.status, 'order')}
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
                      {getStatusBadge(invoice.status, 'invoice')}
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
