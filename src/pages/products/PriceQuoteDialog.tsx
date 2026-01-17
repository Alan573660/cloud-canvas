import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calculator, Loader2, AlertTriangle, Package, Palette, Hash } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { toast } from '@/hooks/use-toast';

interface Product {
  id: string;
  sku: string | null;
  title: string | null;
  base_price_rub_m2: number;
}

interface PriceQuoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product | null;
  embedded?: boolean;
}

interface QuoteBreakdown {
  base_price: number;
  color_surcharge: number;
  quantity_discount: number;
  subtotal: number;
  total: number;
}

export function PriceQuoteDialog({ open, onOpenChange, product, embedded = false }: PriceQuoteDialogProps) {
  const { t } = useTranslation();
  
  const [ral, setRal] = useState('');
  const [qty, setQty] = useState<number>(1);
  const [isCalculating, setIsCalculating] = useState(false);
  const [breakdown, setBreakdown] = useState<QuoteBreakdown | null>(null);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      maximumFractionDigits: 2,
    }).format(value);
  };

  const handleCalculate = async () => {
    if (!product || !ral || qty <= 0) {
      toast({
        title: t('common.error'),
        description: t('products.fillAllFields', 'Заполните все поля'),
        variant: 'destructive',
      });
      return;
    }

    setIsCalculating(true);
    setBreakdown(null);

    // TODO: Call actual pricing endpoint when ready
    // const response = await fetch('/api/pricing/quote', {
    //   method: 'POST',
    //   body: JSON.stringify({ product_id: product.id, ral, qty }),
    // });

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 800));

    // Mock breakdown calculation (placeholder)
    const basePrice = product.base_price_rub_m2 * qty;
    const colorSurcharge = ral.startsWith('90') ? basePrice * 0.15 : basePrice * 0.05; // Mock logic
    const quantityDiscount = qty >= 100 ? basePrice * 0.1 : qty >= 50 ? basePrice * 0.05 : 0;
    const subtotal = basePrice + colorSurcharge;
    const total = subtotal - quantityDiscount;

    setBreakdown({
      base_price: basePrice,
      color_surcharge: colorSurcharge,
      quantity_discount: quantityDiscount,
      subtotal,
      total,
    });

    setIsCalculating(false);

    // Log TODO for backend integration
    console.info('[PriceQuoteDialog] TODO: Integrate with /api/pricing/quote', {
      product_id: product.id,
      ral,
      qty,
      suggestedEndpoint: '/api/pricing/quote',
    });

    toast({
      title: t('products.quoteCalculated', 'Расчёт готов'),
      description: t('products.quoteTodo', 'TODO: Интеграция с /api/pricing/quote'),
    });
  };

  const handleReset = () => {
    setRal('');
    setQty(1);
    setBreakdown(null);
  };

  if (!product) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            {t('products.requestQuote', 'Рассчитать цену')}
          </DialogTitle>
          <DialogDescription>
            {product.title || product.sku || product.id.slice(0, 8)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Input form */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ral" className="flex items-center gap-1">
                <Palette className="h-3 w-3" />
                {t('products.ral')}
              </Label>
              <Input
                id="ral"
                placeholder="9003"
                value={ral}
                onChange={(e) => setRal(e.target.value.toUpperCase())}
                maxLength={10}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="qty" className="flex items-center gap-1">
                <Hash className="h-3 w-3" />
                {t('products.quantity', 'Количество (м²)')}
              </Label>
              <Input
                id="qty"
                type="number"
                min={1}
                value={qty}
                onChange={(e) => setQty(Math.max(1, parseInt(e.target.value) || 1))}
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleCalculate}
              disabled={isCalculating || !ral || qty <= 0}
              className="flex-1"
            >
              {isCalculating ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Calculator className="h-4 w-4 mr-2" />
              )}
              {t('products.calculate')}
            </Button>
            <Button variant="outline" onClick={handleReset}>
              {t('common.reset')}
            </Button>
          </div>

          {/* Breakdown result */}
          {breakdown && (
            <Card className="bg-muted/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  {t('products.quoteBreakdown', 'Расчёт стоимости')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    {t('products.basePrice')} × {qty} м²
                  </span>
                  <span>{formatCurrency(breakdown.base_price)}</span>
                </div>
                
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    {t('products.colorSurcharge', 'Наценка за цвет')} (RAL {ral})
                  </span>
                  <span className="text-amber-600">+{formatCurrency(breakdown.color_surcharge)}</span>
                </div>

                {breakdown.quantity_discount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      {t('products.quantityDiscount', 'Скидка за объём')}
                    </span>
                    <span className="text-green-600">-{formatCurrency(breakdown.quantity_discount)}</span>
                  </div>
                )}

                <Separator />

                <div className="flex justify-between font-semibold text-lg">
                  <span>{t('orders.total', 'Итого')}</span>
                  <span className="text-primary">{formatCurrency(breakdown.total)}</span>
                </div>

                <div className="flex items-center gap-2 p-2 bg-amber-50 dark:bg-amber-950/20 rounded text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                  <span>
                    {t('products.quotePlaceholder', 'Это демо-расчёт. Реальные цены будут доступны после интеграции с /api/pricing/quote')}
                  </span>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
