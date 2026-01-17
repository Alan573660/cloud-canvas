import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';
import { Package, Calendar, Database, Save, Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface Product {
  id: string;
  sku: string | null;
  title: string | null;
  profile: string | null;
  coating: string | null;
  thickness_mm: number | null;
  width_work_mm: number | null;
  width_full_mm: number | null;
  weight_kg_m2: number | null;
  base_price_rub_m2: number;
  is_active: boolean;
  notes: string | null;
  bq_key: string | null;
  created_at: string;
  updated_at: string;
}

interface ProductDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product | null;
}

const formSchema = z.object({
  notes: z.string().nullable(),
});

type FormData = z.infer<typeof formSchema>;

export function ProductDetailSheet({ open, onOpenChange, product }: ProductDetailSheetProps) {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const dateLocale = i18n.language === 'ru' ? ru : enUS;

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      notes: product?.notes || '',
    },
  });

  // Reset form when product changes
  if (product && form.getValues('notes') !== (product.notes || '')) {
    form.reset({ notes: product.notes || '' });
  }

  const updateMutation = useMutation({
    mutationFn: async (data: FormData) => {
      if (!product || !profile?.organization_id) throw new Error('Invalid state');
      
      const { error } = await supabase
        .from('product_catalog')
        .update({ notes: data.notes })
        .eq('id', product.id)
        .eq('organization_id', profile.organization_id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: t('common.success'), description: t('catalog.productUpdated', 'Товар обновлён') });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: () => {
      toast({ title: t('common.error'), description: t('catalog.updateError', 'Не удалось обновить'), variant: 'destructive' });
    },
  });

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      maximumFractionDigits: 0,
    }).format(value);
  };

  if (!product) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            {t('catalog.productDetails', 'Детали товара')}
          </SheetTitle>
          <SheetDescription>
            {product.title || product.sku || product.id.slice(0, 8)}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6">
          {/* Status */}
          <div className="flex items-center gap-2">
            <Badge variant={product.is_active ? 'default' : 'secondary'}>
              {product.is_active ? t('catalog.active', 'Активен') : t('catalog.inactive', 'Неактивен')}
            </Badge>
            {product.bq_key && (
              <Badge variant="outline" className="font-mono text-xs">
                BQ: {product.bq_key}
              </Badge>
            )}
          </div>

          {/* Main Info */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t('catalog.specifications', 'Характеристики')}</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">{t('products.sku')}</p>
                <p className="font-mono">{product.sku || '—'}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">{t('products.profile')}</p>
                <p className="font-medium">{product.profile || '—'}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">{t('products.thickness')}</p>
                <p>{product.thickness_mm ? `${product.thickness_mm} мм` : '—'}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">{t('products.coating')}</p>
                <p>{product.coating || '—'}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">{t('products.widthWork')}</p>
                <p>{product.width_work_mm ? `${product.width_work_mm} мм` : '—'}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">{t('products.widthFull')}</p>
                <p>{product.width_full_mm ? `${product.width_full_mm} мм` : '—'}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">{t('products.weight')}</p>
                <p>{product.weight_kg_m2 ? `${product.weight_kg_m2} кг/м²` : '—'}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">{t('products.basePrice')}</p>
                <p className="font-semibold text-primary">{formatCurrency(product.base_price_rub_m2)}/м²</p>
              </div>
            </CardContent>
          </Card>

          {/* Price Source Note */}
          <Card className="bg-muted/30">
            <CardContent className="p-4 flex items-start gap-3">
              <Database className="h-4 w-4 text-muted-foreground mt-0.5" />
              <div className="text-xs text-muted-foreground">
                <p className="font-medium mb-1">{t('catalog.priceSourceNote', 'Базовая цена (read-only)')}</p>
                <p>{t('catalog.priceSourceDesc', 'Загружается из BigQuery. Редактирование через импорт прайса.')}</p>
              </div>
            </CardContent>
          </Card>

          {/* Notes (Editable) */}
          <div className="space-y-3">
            <Label htmlFor="notes" className="text-sm font-medium">
              {t('common.notes')}
            </Label>
            <Textarea
              id="notes"
              placeholder={t('catalog.notesPlaceholder', 'Заметки о товаре...')}
              className="min-h-[100px]"
              {...form.register('notes')}
            />
            <Button
              size="sm"
              onClick={() => updateMutation.mutate(form.getValues())}
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

          <Separator />

          {/* Timestamps */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              <span>{t('common.createdAt')}: {format(new Date(product.created_at), 'dd.MM.yyyy HH:mm', { locale: dateLocale })}</span>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
