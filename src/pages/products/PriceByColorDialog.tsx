import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

interface Product {
  id: string;
  title: string | null;
  base_price_rub_m2: number;
}

interface PriceByColorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product | null;
}

export function PriceByColorDialog({ open, onOpenChange, product }: PriceByColorDialogProps) {
  const { t } = useTranslation();
  const [ral, setRal] = useState('');
  const [fetchPrice, setFetchPrice] = useState(false);

  const { data: price, isLoading, error, refetch } = useQuery({
    queryKey: ['price-by-color', product?.id, ral],
    queryFn: async () => {
      if (!product?.id || !ral) return null;

      const { data, error } = await supabase.rpc('get_price_by_color', {
        p_product_id: product.id,
        p_ral: ral.trim().toUpperCase(),
      });

      if (error) throw error;
      return data as number;
    },
    enabled: fetchPrice && !!product?.id && !!ral,
  });

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      maximumFractionDigits: 2,
    }).format(value);
  };

  const handleCalculate = () => {
    if (ral.trim()) {
      setFetchPrice(true);
      refetch();
    }
  };

  const handleClose = (openState: boolean) => {
    if (!openState) {
      setRal('');
      setFetchPrice(false);
    }
    onOpenChange(openState);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t('products.priceByColor')}: {product?.title || '—'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ral">{t('products.enterRal')}</Label>
            <div className="flex gap-2">
              <Input
                id="ral"
                placeholder="RAL 9005"
                value={ral}
                onChange={(e) => {
                  setRal(e.target.value);
                  setFetchPrice(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleCalculate();
                  }
                }}
              />
              <Button onClick={handleCalculate} disabled={!ral.trim() || isLoading}>
                {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {t('products.calculate')}
              </Button>
            </div>
          </div>

          {fetchPrice && !isLoading && price !== null && price !== undefined && (
            <Card>
              <CardContent className="pt-4">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-sm text-muted-foreground">{t('products.basePrice')}</p>
                    <p className="text-lg">{formatCurrency(product?.base_price_rub_m2 || 0)} / м²</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">
                      {t('products.priceWithColor')} ({ral.toUpperCase()})
                    </p>
                    <p className="text-2xl font-bold text-primary">{formatCurrency(price)} / м²</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {error && (
            <p className="text-sm text-destructive">
              {t('products.colorNotFound')}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
