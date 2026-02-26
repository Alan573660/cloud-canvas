import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  ArrowLeft, Loader2, Save, Plus, Pencil, Trash2, 
  Package, User, Building2, FileText, ExternalLink, Truck
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { StatusBadge } from '@/components/ui/status-badge';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';

// DB status values - MUST match database exactly
const ORDER_STATUSES = ['DRAFT', 'CONFIRMED', 'INVOICED', 'PAID', 'CANCELLED', 'FAILED'] as const;
type OrderStatus = typeof ORDER_STATUSES[number];

const CAN_MANAGE_ORDERS: string[] = ['owner', 'admin', 'operator'];

interface Order {
  id: string;
  order_number: string | null;
  status: OrderStatus;
  total_amount: number;
  items_total: number;
  delivery_price: number;
  delivery_required: boolean;
  currency: string;
  comment: string | null;
  contact_id: string | null;
  buyer_company_id: string | null;
  lead_id: string | null;
  created_at: string;
  updated_at: string;
}

interface OrderItem {
  id: string;
  order_id: string;
  product_id: string | null;
  title: string | null;
  qty: number;
  unit: string;
  price_per_unit: number;
  amount: number;
  meta_json: unknown;
}

interface Contact {
  id: string;
  full_name: string | null;
  email: string | null;
}

interface BuyerCompany {
  id: string;
  company_name: string;
  inn: string | null;
}

interface Lead {
  id: string;
  title: string | null;
  subject: string | null;
  status: string;
}

interface Product {
  id: string;
  title: string | null;
  sku: string | null;
  base_price_rub_m2: number;
}

export default function OrderDetailPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const isNew = id === 'new';

  const canManageOrders = profile?.role && CAN_MANAGE_ORDERS.includes(profile.role);

  const [formData, setFormData] = useState<{
    status: OrderStatus;
    comment: string;
    contact_id: string | null;
    buyer_company_id: string | null;
    lead_id: string | null;
    delivery_required: boolean;
    delivery_price: number;
  }>({
    status: 'DRAFT',
    comment: '',
    contact_id: null,
    buyer_company_id: null,
    lead_id: null,
    delivery_required: false,
    delivery_price: 0,
  });

  const [isItemFormOpen, setIsItemFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<OrderItem | null>(null);
  const [deletingItem, setDeletingItem] = useState<OrderItem | null>(null);

  // Fetch order
  const { data: order, isLoading: orderLoading } = useQuery({
    queryKey: ['order', id],
    queryFn: async () => {
      if (isNew || !id) return null;
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as Order;
    },
    enabled: !isNew && !!id,
  });

  // Fetch order items
  const { data: orderItems, isLoading: itemsLoading } = useQuery({
    queryKey: ['order-items', id],
    queryFn: async () => {
      if (isNew || !id) return [];
      const { data, error } = await supabase
        .from('order_items')
        .select('*')
        .eq('order_id', id)
        .order('created_at');
      if (error) throw error;
      return data as OrderItem[];
    },
    enabled: !isNew && !!id,
  });

  // Fetch linked lead details
  const { data: linkedLead } = useQuery({
    queryKey: ['linked-lead', order?.lead_id],
    queryFn: async () => {
      if (!order?.lead_id) return null;
      const { data, error } = await supabase
        .from('leads')
        .select('id, title, subject, status')
        .eq('id', order.lead_id)
        .single();
      if (error) return null;
      return data as Lead;
    },
    enabled: !!order?.lead_id,
  });

  // Fetch contacts
  const { data: contacts } = useQuery({
    queryKey: ['contacts-list', profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return [];
      const { data, error } = await supabase
        .from('contacts')
        .select('id, full_name, email')
        .eq('organization_id', profile.organization_id)
        .order('full_name');
      if (error) throw error;
      return data as Contact[];
    },
    enabled: !!profile?.organization_id,
  });

  // Fetch buyer companies
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
        console.warn('Cannot fetch companies:', error.message);
        return [];
      }
      return data as BuyerCompany[];
    },
    enabled: !!profile?.organization_id,
  });

  // Fetch leads for dropdown
  const { data: leads } = useQuery({
    queryKey: ['leads-list', profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return [];
      const { data, error } = await supabase
        .from('leads')
        .select('id, title, subject')
        .eq('organization_id', profile.organization_id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as Lead[];
    },
    enabled: !!profile?.organization_id,
  });

  // Fetch products for items
  const { data: products } = useQuery({
    queryKey: ['products-list', profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return [];
      const { data, error } = await supabase
        .from('product_catalog')
        .select('id, title, sku, base_price_rub_m2')
        .eq('organization_id', profile.organization_id)
        .eq('is_active', true)
        .order('title');
      if (error) throw error;
      return data as Product[];
    },
    enabled: !!profile?.organization_id,
  });

  // Update form when order loads
  useEffect(() => {
    if (order) {
      setFormData({
        status: order.status as OrderStatus,
        comment: order.comment || '',
        contact_id: order.contact_id,
        buyer_company_id: order.buyer_company_id,
        lead_id: order.lead_id,
        delivery_required: order.delivery_required,
        delivery_price: order.delivery_price,
      });
    }
  }, [order]);

  // Create order mutation
  const createMutation = useMutation({
    mutationFn: async () => {
      if (!profile?.organization_id) throw new Error('No organization');
      
      const { data, error } = await supabase
        .from('orders')
        .insert({
          organization_id: profile.organization_id,
          status: formData.status,
          comment: formData.comment || null,
          contact_id: formData.contact_id,
          buyer_company_id: formData.buyer_company_id,
          lead_id: formData.lead_id,
          delivery_required: formData.delivery_required,
          delivery_price: formData.delivery_price,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(t('common.success'));
      navigate(`/orders/${data.id}`, { replace: true });
    },
    onError: (error) => {
      console.error('Create error:', error);
      toast.error(t('errors.generic'));
    },
  });

  // Update order mutation
  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!id || isNew) throw new Error('No order ID');
      
      const { error } = await supabase
        .from('orders')
        .update({
          status: formData.status,
          comment: formData.comment || null,
          contact_id: formData.contact_id,
          buyer_company_id: formData.buyer_company_id,
          lead_id: formData.lead_id,
          delivery_required: formData.delivery_required,
          delivery_price: formData.delivery_price,
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
      queryClient.invalidateQueries({ queryKey: ['order', id] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
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

  // Delete item mutation
  const deleteItemMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase
        .from('order_items')
        .delete()
        .eq('id', itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t('common.success'));
      queryClient.invalidateQueries({ queryKey: ['order-items', id] });
      queryClient.invalidateQueries({ queryKey: ['order', id] });
      setDeletingItem(null);
    },
    onError: (error) => {
      console.error('Delete item error:', error);
      toast.error(t('errors.generic'));
    },
  });

  const getStatusLabel = (status: OrderStatus) => {
    const statusMap: Record<OrderStatus, string> = {
      DRAFT: t('orders.statuses.draft'),
      CONFIRMED: t('orders.statuses.confirmed'),
      INVOICED: t('orders.statuses.invoiced'),
      PAID: t('orders.statuses.paid'),
      CANCELLED: t('orders.statuses.cancelled'),
      FAILED: t('orders.statuses.failed'),
    };
    return statusMap[status] || status;
  };

  const getOrderStatusType = (status: string) => {
    switch (status) {
      case 'PAID':
        return 'success' as const;
      case 'DRAFT':
      case 'CONFIRMED':
        return 'warning' as const;
      case 'INVOICED':
        return 'info' as const;
      case 'CANCELLED':
      case 'FAILED':
        return 'error' as const;
      default:
        return 'default' as const;
    }
  };

  const formatCurrency = (value: number, currency: string = 'RUB') => {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const handleSave = () => {
    if (isNew) {
      createMutation.mutate();
    } else {
      updateMutation.mutate();
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  if (!isNew && orderLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isNew && !order) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => navigate('/orders')}>
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
          <Button variant="ghost" onClick={() => navigate('/orders')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t('common.back')}
          </Button>
          <div>
            <h1 className="text-2xl font-bold">
              {isNew ? t('orders.newOrder') : `${t('orders.title')} ${order?.order_number || order?.id.slice(0, 8)}`}
            </h1>
            {!isNew && order && (
              <p className="text-sm text-muted-foreground">
                {t('common.date')}: {format(new Date(order.created_at), 'dd MMMM yyyy, HH:mm', {
                  locale: i18n.language === 'ru' ? ru : enUS,
                })}
              </p>
            )}
          </div>
        </div>
        {canManageOrders && (
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            {t('common.save')}
          </Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Info */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              {t('common.info')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t('common.status')}</Label>
                <Select
                  value={formData.status}
                  onValueChange={(value) => setFormData({ ...formData, status: value as OrderStatus })}
                  disabled={!canManageOrders}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ORDER_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {getStatusLabel(status)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>{t('orders.deliveryPrice')}</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={formData.delivery_price}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setFormData({ ...formData, delivery_price: isNaN(val) ? 0 : Math.max(0, val) });
                  }}
                  disabled={!canManageOrders}
                />
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="delivery_required"
                checked={formData.delivery_required}
                onCheckedChange={(checked) => setFormData({ ...formData, delivery_required: !!checked })}
                disabled={!canManageOrders}
              />
              <Label htmlFor="delivery_required" className="flex items-center gap-2 cursor-pointer">
                <Truck className="h-4 w-4" />
                {t('orders.deliveryRequired')}
              </Label>
            </div>

            <div className="space-y-2">
              <Label>{t('orders.comment')}</Label>
              <Textarea
                value={formData.comment}
                onChange={(e) => setFormData({ ...formData, comment: e.target.value })}
                placeholder={i18n.language === 'ru' ? 'Комментарий к заказу...' : 'Order comment...'}
                rows={3}
                disabled={!canManageOrders}
              />
            </div>

            {/* Totals */}
            {!isNew && order && (
              <div className="mt-6 p-4 bg-muted rounded-lg space-y-2">
                <div className="flex justify-between">
                  <span>{t('orders.itemsTotal')}:</span>
                  <span>{formatCurrency(order.items_total, order.currency)}</span>
                </div>
                <div className="flex justify-between">
                  <span>{t('orders.deliveryPrice')}:</span>
                  <span>{formatCurrency(order.delivery_price, order.currency)}</span>
                </div>
                <div className="flex justify-between font-bold text-lg pt-2 border-t">
                  <span>{t('orders.total')}:</span>
                  <span>{formatCurrency(order.total_amount, order.currency)}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Relations */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              {i18n.language === 'ru' ? 'Связи' : 'Relations'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <User className="h-4 w-4" />
                {t('leads.contact')}
              </Label>
              <Select
                value={formData.contact_id || 'none'}
                onValueChange={(value) => setFormData({ 
                  ...formData, 
                  contact_id: value === 'none' ? null : value 
                })}
                disabled={!canManageOrders}
              >
                <SelectTrigger>
                  <SelectValue placeholder={i18n.language === 'ru' ? 'Выберите контакт' : 'Select contact'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— {i18n.language === 'ru' ? 'Не выбран' : 'Not selected'} —</SelectItem>
                  {contacts?.map((contact) => (
                    <SelectItem key={contact.id} value={contact.id}>
                      {contact.full_name || contact.email || contact.id.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                {t('leads.company')}
              </Label>
              <Select
                value={formData.buyer_company_id || 'none'}
                onValueChange={(value) => setFormData({ 
                  ...formData, 
                  buyer_company_id: value === 'none' ? null : value 
                })}
                disabled={!canManageOrders}
              >
                <SelectTrigger>
                  <SelectValue placeholder={i18n.language === 'ru' ? 'Выберите компанию' : 'Select company'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— {i18n.language === 'ru' ? 'Не выбрана' : 'Not selected'} —</SelectItem>
                  {companies?.map((company) => (
                    <SelectItem key={company.id} value={company.id}>
                      {company.company_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                {i18n.language === 'ru' ? 'Лид' : 'Lead'}
              </Label>
              <Select
                value={formData.lead_id || 'none'}
                onValueChange={(value) => setFormData({ 
                  ...formData, 
                  lead_id: value === 'none' ? null : value 
                })}
                disabled={!canManageOrders}
              >
                <SelectTrigger>
                  <SelectValue placeholder={i18n.language === 'ru' ? 'Привязать к лиду' : 'Link to lead'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— {i18n.language === 'ru' ? 'Не привязан' : 'Not linked'} —</SelectItem>
                  {leads?.map((lead) => (
                    <SelectItem key={lead.id} value={lead.id}>
                      {lead.title || lead.subject || lead.id.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Show linked lead info */}
            {linkedLead && (
              <div className="p-3 bg-muted rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{linkedLead.title || linkedLead.subject}</p>
                    <StatusBadge status={linkedLead.status} type={getOrderStatusType(linkedLead.status)} />
                  </div>
                  <Button variant="ghost" size="sm" asChild>
                    <Link to={`/leads/${linkedLead.id}`}>
                      <ExternalLink className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Order Items */}
      {!isNew && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>{t('orders.items')}</CardTitle>
              <CardDescription>{i18n.language === 'ru' ? 'Позиции заказа' : 'Order items'}</CardDescription>
            </div>
            {canManageOrders && (
              <Button
                onClick={() => {
                  setEditingItem(null);
                  setIsItemFormOpen(true);
                }}
              >
                <Plus className="h-4 w-4 mr-2" />
                {i18n.language === 'ru' ? 'Добавить позицию' : 'Add item'}
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {itemsLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : orderItems && orderItems.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{i18n.language === 'ru' ? 'Название' : 'Title'}</TableHead>
                    <TableHead className="text-right">{i18n.language === 'ru' ? 'Кол-во' : 'Qty'}</TableHead>
                    <TableHead>{i18n.language === 'ru' ? 'Ед.' : 'Unit'}</TableHead>
                    <TableHead className="text-right">{i18n.language === 'ru' ? 'Цена' : 'Price'}</TableHead>
                    <TableHead className="text-right">{i18n.language === 'ru' ? 'Сумма' : 'Amount'}</TableHead>
                    {canManageOrders && <TableHead className="w-[100px]"></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orderItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.title || '—'}</TableCell>
                      <TableCell className="text-right">{item.qty}</TableCell>
                      <TableCell>{item.unit}</TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(item.price_per_unit)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(item.amount)}
                      </TableCell>
                      {canManageOrders && (
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setEditingItem(item);
                                setIsItemFormOpen(true);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setDeletingItem(item)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                {i18n.language === 'ru' ? 'Нет позиций в заказе' : 'No items in order'}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Order Item Form Dialog */}
      <Dialog open={isItemFormOpen} onOpenChange={setIsItemFormOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingItem 
                ? (i18n.language === 'ru' ? 'Редактировать позицию' : 'Edit item')
                : (i18n.language === 'ru' ? 'Добавить позицию' : 'Add item')
              }
            </DialogTitle>
          </DialogHeader>
          <OrderItemForm
            orderId={id!}
            organizationId={profile?.organization_id ?? ''}
            item={editingItem}
            products={products || []}
            onSuccess={() => {
              setIsItemFormOpen(false);
              setEditingItem(null);
              queryClient.invalidateQueries({ queryKey: ['order-items', id] });
              queryClient.invalidateQueries({ queryKey: ['order', id] });
            }}
            onCancel={() => {
              setIsItemFormOpen(false);
              setEditingItem(null);
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Delete Item Confirmation */}
      <AlertDialog open={!!deletingItem} onOpenChange={() => setDeletingItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('common.confirm')}</AlertDialogTitle>
            <AlertDialogDescription>
              {i18n.language === 'ru' 
                ? `Удалить позицию "${deletingItem?.title}"?` 
                : `Delete item "${deletingItem?.title}"?`
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingItem && deleteItemMutation.mutate(deletingItem.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Order Item Form Component
interface OrderItemFormProps {
  orderId: string;
  organizationId: string;
  item: OrderItem | null;
  products: Product[];
  onSuccess: () => void;
  onCancel: () => void;
}

function OrderItemForm({ orderId, organizationId, item, products, onSuccess, onCancel }: OrderItemFormProps) {
  const { t, i18n } = useTranslation();
  
  const [formData, setFormData] = useState({
    product_id: item?.product_id || '',
    title: item?.title || '',
    qty: item?.qty || 1,
    unit: item?.unit || 'м²',
    price_per_unit: item?.price_per_unit || 0,
  });

  const [errors, setErrors] = useState<{ qty?: string; price?: string }>({});

  const validate = (): boolean => {
    const newErrors: { qty?: string; price?: string } = {};
    
    if (formData.qty <= 0) {
      newErrors.qty = i18n.language === 'ru' ? 'Количество должно быть > 0' : 'Quantity must be > 0';
    }
    if (formData.price_per_unit < 0) {
      newErrors.price = i18n.language === 'ru' ? 'Цена не может быть отрицательной' : 'Price cannot be negative';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const mutation = useMutation({
    mutationFn: async () => {
      if (!validate()) throw new Error('Validation failed');
      
      const amount = formData.qty * formData.price_per_unit;
      
      const payload = {
        order_id: orderId,
        organization_id: organizationId,
        product_id: formData.product_id || null,
        title: formData.title || null,
        qty: formData.qty,
        unit: formData.unit,
        price_per_unit: formData.price_per_unit,
        amount,
      };

      if (item) {
        const { error } = await supabase
          .from('order_items')
          .update({
            product_id: payload.product_id,
            title: payload.title,
            qty: payload.qty,
            unit: payload.unit,
            price_per_unit: payload.price_per_unit,
            amount: payload.amount,
          })
          .eq('id', item.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('order_items')
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(t('common.success'));
      onSuccess();
    },
    onError: (error: Error) => {
      if (error.message !== 'Validation failed') {
        console.error('Item save error:', error);
        toast.error(t('errors.generic'));
      }
    },
  });

  const handleProductChange = (productId: string) => {
    const product = products.find(p => p.id === productId);
    if (product) {
      setFormData({
        ...formData,
        product_id: productId,
        title: product.title || product.sku || '',
        price_per_unit: product.base_price_rub_m2,
      });
    } else {
      setFormData({ ...formData, product_id: '' });
    }
  };

  const calculatedAmount = formData.qty * formData.price_per_unit;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>{i18n.language === 'ru' ? 'Товар из каталога' : 'Product from catalog'}</Label>
        <Select
          value={formData.product_id || 'none'}
          onValueChange={(value) => handleProductChange(value === 'none' ? '' : value)}
        >
          <SelectTrigger>
            <SelectValue placeholder={i18n.language === 'ru' ? 'Выберите товар' : 'Select product'} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">— {i18n.language === 'ru' ? 'Произвольная позиция' : 'Custom item'} —</SelectItem>
            {products.map((product) => (
              <SelectItem key={product.id} value={product.id}>
                {product.title || product.sku} ({product.base_price_rub_m2} ₽/м²)
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>{i18n.language === 'ru' ? 'Название' : 'Title'}</Label>
        <Input
          value={formData.title}
          onChange={(e) => setFormData({ ...formData, title: e.target.value })}
          placeholder={i18n.language === 'ru' ? 'Название позиции' : 'Item title'}
        />
      </div>

      <div className="grid gap-4 grid-cols-3">
        <div className="space-y-2">
          <Label>{i18n.language === 'ru' ? 'Кол-во' : 'Qty'}</Label>
          <Input
            type="number"
            min={0.01}
            step={0.01}
            value={formData.qty}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setFormData({ ...formData, qty: isNaN(val) ? 0 : val });
              setErrors({ ...errors, qty: undefined });
            }}
            className={errors.qty ? 'border-destructive' : ''}
          />
          {errors.qty && <p className="text-xs text-destructive">{errors.qty}</p>}
        </div>

        <div className="space-y-2">
          <Label>{i18n.language === 'ru' ? 'Ед. изм.' : 'Unit'}</Label>
          <Select
            value={formData.unit}
            onValueChange={(value) => setFormData({ ...formData, unit: value })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="м²">м²</SelectItem>
              <SelectItem value="шт">шт</SelectItem>
              <SelectItem value="м.п.">м.п.</SelectItem>
              <SelectItem value="кг">кг</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>{i18n.language === 'ru' ? 'Цена за ед.' : 'Price'}</Label>
          <Input
            type="number"
            min={0}
            step={0.01}
            value={formData.price_per_unit}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setFormData({ ...formData, price_per_unit: isNaN(val) ? 0 : Math.max(0, val) });
              setErrors({ ...errors, price: undefined });
            }}
            className={errors.price ? 'border-destructive' : ''}
          />
          {errors.price && <p className="text-xs text-destructive">{errors.price}</p>}
        </div>
      </div>

      <div className="p-3 bg-muted rounded-lg">
        <div className="flex justify-between font-medium">
          <span>{i18n.language === 'ru' ? 'Сумма:' : 'Amount:'}</span>
          <span>{new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(calculatedAmount)}</span>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
}
