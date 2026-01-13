import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

interface Product {
  id: string;
  title: string | null;
}

interface RalColor {
  ral: string;
  ral_name: string;
  group_code: string;
  availability_status: string;
  lead_time_days: number;
  surcharge_rub_m2: number;
}

interface RalColorsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product | null;
}

export function RalColorsDialog({ open, onOpenChange, product }: RalColorsDialogProps) {
  const { t } = useTranslation();

  const { data: colors, isLoading } = useQuery({
    queryKey: ['available-colors', product?.id],
    queryFn: async () => {
      if (!product?.id) return [];

      const { data, error } = await supabase.rpc('get_available_colors', {
        p_product_id: product.id,
      });

      if (error) throw error;
      return data as RalColor[];
    },
    enabled: open && !!product?.id,
  });

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      maximumFractionDigits: 0,
    }).format(value);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'IN_STOCK':
        return <Badge className="bg-green-100 text-green-800">{t('products.ralStatuses.inStock')}</Badge>;
      case 'ON_ORDER':
        return <Badge className="bg-yellow-100 text-yellow-800">{t('products.ralStatuses.onOrder')}</Badge>;
      case 'UNAVAILABLE':
        return <Badge variant="secondary">{t('products.ralStatuses.unavailable')}</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t('products.availableColors')}: {product?.title || '—'}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : colors && colors.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('products.ral')}</TableHead>
                <TableHead>{t('common.name')}</TableHead>
                <TableHead>{t('products.colorGroup')}</TableHead>
                <TableHead>{t('common.status')}</TableHead>
                <TableHead>{t('products.leadTimeDays')}</TableHead>
                <TableHead>{t('products.surcharge')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {colors.map((color) => (
                <TableRow key={color.ral}>
                  <TableCell className="font-mono">{color.ral}</TableCell>
                  <TableCell>{color.ral_name || '—'}</TableCell>
                  <TableCell>{color.group_code}</TableCell>
                  <TableCell>{getStatusBadge(color.availability_status)}</TableCell>
                  <TableCell>
                    {color.lead_time_days > 0
                      ? `${color.lead_time_days} ${t('products.days')}`
                      : '—'}
                  </TableCell>
                  <TableCell>
                    {color.surcharge_rub_m2 > 0
                      ? `+${formatCurrency(color.surcharge_rub_m2)}/м²`
                      : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-muted-foreground text-center py-8">
            {t('products.noColorsAvailable')}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
