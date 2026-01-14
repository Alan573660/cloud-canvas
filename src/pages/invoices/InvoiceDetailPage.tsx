import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { 
  ArrowLeft, Loader2, FileDown, ExternalLink, 
  Send, Clock, CheckCircle, XCircle, AlertCircle 
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { openSignedUrl } from '@/lib/file-utils';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatusBadge } from '@/components/ui/status-badge';
import { format } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';

// DB status values
const INVOICE_STATUSES = ['DRAFT', 'CREATED', 'SENT', 'PAID', 'CANCELLED', 'FAILED'] as const;
type InvoiceStatus = typeof INVOICE_STATUSES[number];

const DELIVERY_STATUSES = ['QUEUED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED'] as const;
type DeliveryStatus = typeof DELIVERY_STATUSES[number];

interface Invoice {
  id: string;
  invoice_number: string | null;
  status: InvoiceStatus;
  total_amount: number;
  sent_at: string | null;
  paid_at: string | null;
  pdf_url: string | null;
  error_reason: string | null;
  created_at: string;
  updated_at: string;
  order_id: string;
}

interface InvoiceDelivery {
  id: string;
  channel: string;
  status: DeliveryStatus;
  to_address: string | null;
  sent_at: string | null;
  error_reason: string | null;
  created_at: string;
}

interface Order {
  id: string;
  order_number: string | null;
  total_amount: number;
  status: string;
}

export default function InvoiceDetailPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();

  // Fetch invoice
  const { data: invoice, isLoading: invoiceLoading } = useQuery({
    queryKey: ['invoice', id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from('invoices')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as Invoice;
    },
    enabled: !!id,
  });

  // Fetch related order
  const { data: order } = useQuery({
    queryKey: ['order-for-invoice', invoice?.order_id],
    queryFn: async () => {
      if (!invoice?.order_id) return null;
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, total_amount, status')
        .eq('id', invoice.order_id)
        .single();
      if (error) throw error;
      return data as Order;
    },
    enabled: !!invoice?.order_id,
  });

  // Fetch delivery history
  const { data: deliveries, isLoading: deliveriesLoading } = useQuery({
    queryKey: ['invoice-deliveries', id],
    queryFn: async () => {
      if (!id) return [];
      const { data, error } = await supabase
        .from('invoice_delivery')
        .select('*')
        .eq('invoice_id', id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as InvoiceDelivery[];
    },
    enabled: !!id,
  });

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      maximumFractionDigits: 2,
    }).format(value);
  };

  const getStatusLabel = (status: InvoiceStatus) => {
    const statusMap: Record<InvoiceStatus, string> = {
      DRAFT: t('invoices.statuses.draft', 'Черновик'),
      CREATED: t('invoices.statuses.created', 'Создан'),
      SENT: t('invoices.statuses.sent', 'Отправлен'),
      PAID: t('invoices.statuses.paid', 'Оплачен'),
      CANCELLED: t('invoices.statuses.cancelled', 'Отменён'),
      FAILED: t('invoices.statuses.failed', 'Ошибка'),
    };
    return statusMap[status] || status;
  };

  const getInvoiceStatusType = (status: InvoiceStatus) => {
    switch (status) {
      case 'PAID':
        return 'success' as const;
      case 'DRAFT':
      case 'CREATED':
        return 'warning' as const;
      case 'SENT':
        return 'info' as const;
      case 'CANCELLED':
      case 'FAILED':
        return 'error' as const;
      default:
        return 'default' as const;
    }
  };

  const getDeliveryStatusLabel = (status: DeliveryStatus) => {
    const key = `invoices.deliveryStatuses.${status}`;
    return t(key, status);
  };

  const getDeliveryStatusIcon = (status: DeliveryStatus) => {
    switch (status) {
      case 'SENT':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'FAILED':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'QUEUED':
      case 'SENDING':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case 'CANCELLED':
        return <AlertCircle className="h-4 w-4 text-muted-foreground" />;
      default:
        return null;
    }
  };

  const getChannelLabel = (channel: string) => {
    return t(`invoices.channels.${channel}`, channel);
  };

  if (invoiceLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => navigate('/invoices')}>
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
          <Button variant="ghost" onClick={() => navigate('/invoices')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t('common.back')}
          </Button>
          <div>
            <h1 className="text-2xl font-bold">
              {t('invoices.title')} #{invoice.invoice_number || invoice.id.slice(0, 8)}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t('common.date')}: {format(new Date(invoice.created_at), 'dd MMMM yyyy, HH:mm', {
                locale: i18n.language === 'ru' ? ru : enUS,
              })}
            </p>
          </div>
        </div>
        
        {invoice.pdf_url && (
          <Button onClick={() => openSignedUrl(invoice.pdf_url, `invoice-${invoice.invoice_number || invoice.id}.pdf`)}>
            <FileDown className="h-4 w-4 mr-2" />
            {t('invoices.openPdf')}
          </Button>
        )}
      </div>

      <Tabs defaultValue="details" className="space-y-4">
        <TabsList>
          <TabsTrigger value="details">{t('common.details')}</TabsTrigger>
          <TabsTrigger value="delivery">
            {t('invoices.deliveryHistory')}
            {deliveries && deliveries.length > 0 && (
              <span className="ml-2 px-2 py-0.5 text-xs bg-muted rounded-full">
                {deliveries.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            {/* Invoice Info */}
            <Card>
              <CardHeader>
                <CardTitle>{t('invoices.invoiceInfo')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">{t('common.status')}</p>
                    <div className="mt-1">
                      <StatusBadge
                        status={getStatusLabel(invoice.status)}
                        type={getInvoiceStatusType(invoice.status)}
                      />
                    </div>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t('invoices.amount')}</p>
                    <p className="text-2xl font-bold">{formatCurrency(invoice.total_amount)}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">{t('invoices.sentAt')}</p>
                    <p className="font-medium">
                      {invoice.sent_at
                        ? format(new Date(invoice.sent_at), 'dd.MM.yyyy HH:mm', {
                            locale: i18n.language === 'ru' ? ru : enUS,
                          })
                        : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t('invoices.paidAt')}</p>
                    <p className="font-medium">
                      {invoice.paid_at
                        ? format(new Date(invoice.paid_at), 'dd.MM.yyyy HH:mm', {
                            locale: i18n.language === 'ru' ? ru : enUS,
                          })
                        : '—'}
                    </p>
                  </div>
                </div>

                {invoice.error_reason && (
                  <div className="p-3 bg-destructive/10 text-destructive rounded-lg">
                    <p className="text-sm font-medium">{t('invoices.errorReason')}:</p>
                    <p className="text-sm">{invoice.error_reason}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Related Order */}
            <Card>
              <CardHeader>
                <CardTitle>{t('invoices.relatedOrder')}</CardTitle>
              </CardHeader>
              <CardContent>
                {order ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">{t('orders.orderNumber')}</p>
                        <p className="font-medium">{order.order_number || order.id.slice(0, 8)}</p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate(`/orders/${order.id}`)}
                      >
                        <ExternalLink className="h-4 w-4 mr-2" />
                        {t('common.open')}
                      </Button>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">{t('invoices.amount')}</p>
                        <p className="font-medium">{formatCurrency(order.total_amount)}</p>
                      </div>
                      <StatusBadge status={order.status} type="default" />
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground">Загрузка...</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="delivery">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Send className="h-5 w-5" />
                {t('invoices.deliveryHistory')}
              </CardTitle>
              <CardDescription>
                {t('invoices.deliveryHistoryDescription')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {deliveriesLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : deliveries && deliveries.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('invoices.channel')}</TableHead>
                      <TableHead>{t('invoices.toAddress')}</TableHead>
                      <TableHead>{t('common.status')}</TableHead>
                      <TableHead>{t('common.createdAt')}</TableHead>
                      <TableHead>{t('invoices.sentAt')}</TableHead>
                      <TableHead>{t('invoices.errorReason')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deliveries.map((delivery) => (
                      <TableRow key={delivery.id}>
                        <TableCell className="font-medium">
                          {getChannelLabel(delivery.channel)}
                        </TableCell>
                        <TableCell>{delivery.to_address || '—'}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {getDeliveryStatusIcon(delivery.status)}
                            <span>{getDeliveryStatusLabel(delivery.status)}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {format(new Date(delivery.created_at), 'dd.MM.yyyy HH:mm', {
                            locale: i18n.language === 'ru' ? ru : enUS,
                          })}
                        </TableCell>
                        <TableCell>
                          {delivery.sent_at
                            ? format(new Date(delivery.sent_at), 'dd.MM.yyyy HH:mm', {
                                locale: i18n.language === 'ru' ? ru : enUS,
                              })
                            : '—'}
                        </TableCell>
                        <TableCell>
                          {delivery.error_reason && (
                            <span className="text-sm text-destructive">{delivery.error_reason}</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  {t('invoices.noDeliveries')}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
