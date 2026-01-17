import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calculator, Loader2, Package, Palette, Hash, CheckCircle, XCircle } from 'lucide-react';
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
import { useAuth } from '@/contexts/AuthContext';

interface Product {
  id: string;
  sku: string | null;
  title: string | null;
  base_price_rub_m2: number;
  bq_key: string | null;
}

interface PriceQuoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product | null;
  embedded?: boolean;
}

interface QuoteBreakdown {
  base_price: number;
  discount: number;
  final_price: number;
  unit_price: number;
  currency: string;
}

interface ApiError {
  error: string;
  message?: string;
}

export function PriceQuoteDialog({ open, onOpenChange, product, embedded = false }: PriceQuoteDialogProps) {
  const { t } = useTranslation();
  const { profile } = useAuth();
  
  const [ral, setRal] = useState('');
  const [qty, setQty] = useState('');
  const [isCalculating, setIsCalculating] = useState(false);
  const [breakdown, setBreakdown] = useState<QuoteBreakdown | null>(null);
  const [error, setError] = useState<string | null>(null);

  const formatCurrency = (value: number, currency: string = 'RUB') => {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const handleCalculate = async () => {
    if (!product || !qty) {
      toast({
        title: t('common.error'),
        description: t('products.fillQuantity', 'Укажите количество'),
        variant: 'destructive',
      });
      return;
    }

    const qtyNum = parseInt(qty);
    if (isNaN(qtyNum) || qtyNum <= 0) {
      toast({
        title: t('common.error'),
        description: t('products.invalidQuantity', 'Некорректное количество'),
        variant: 'destructive',
      });
      return;
    }

    setIsCalculating(true);
    setBreakdown(null);
    setError(null);

    try {
      // Call the actual Pricing API
      const response = await fetch('/api/pricing/quote', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          organization_id: profile?.organization_id,
          items: [
            {
              bq_id: product.bq_key || product.sku || product.id,
              qty_m2: qtyNum,
              ...(ral.trim() && { ral: ral.trim().toUpperCase() }),
            },
          ],
          currency: 'RUB',
        }),
      });

      if (!response.ok) {
        const errorData: ApiError = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.message || errorData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      
      // Parse the response - adjust based on actual API response structure
      if (data.items && data.items.length > 0) {
        const item = data.items[0];
        setBreakdown({
          base_price: item.base_price || item.base_total || 0,
          discount: item.discount || item.discount_total || 0,
          final_price: item.final_price || item.total || 0,
          unit_price: item.unit_price || item.price_per_m2 || 0,
          currency: data.currency || 'RUB',
        });
      } else if (data.total !== undefined) {
        // Alternative response format
        setBreakdown({
          base_price: data.base_total || data.subtotal || 0,
          discount: data.discount_total || data.discount || 0,
          final_price: data.total || 0,
          unit_price: data.unit_price || 0,
          currency: data.currency || 'RUB',
        });
      } else {
        throw new Error(t('products.invalidApiResponse', 'Некорректный ответ API'));
      }

      toast({
        title: t('products.quoteCalculated', 'Расчёт готов'),
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : t('common.unknownError', 'Неизвестная ошибка');
      console.error('[PriceQuoteDialog] API error:', err);
      setError(errorMessage);
      toast({
        title: t('common.error'),
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setIsCalculating(false);
    }
  };

  const handleReset = () => {
    setRal('');
    setQty('');
    setBreakdown(null);
    setError(null);
  };

  // Handle integer-only input for quantity
  const handleQtyInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value;
    // Remove leading zeros
    if (value.length > 1 && value.startsWith('0')) {
      value = value.replace(/^0+/, '');
    }
    // Only allow digits
    value = value.replace(/[^0-9]/g, '');
    setQty(value);
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
              <Label htmlFor="qty" className="flex items-center gap-1">
                <Hash className="h-3 w-3" />
                {t('products.quantity', 'Количество (м²)')} *
              </Label>
              <Input
                id="qty"
                type="text"
                inputMode="numeric"
                placeholder={t('products.quantityPlaceholder', 'Например: 100')}
                value={qty}
                onChange={handleQtyInput}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ral" className="flex items-center gap-1">
                <Palette className="h-3 w-3" />
                {t('products.ral')} ({t('common.optional', 'опционально')})
              </Label>
              <Input
                id="ral"
                placeholder="9003"
                value={ral}
                onChange={(e) => setRal(e.target.value.toUpperCase())}
                maxLength={10}
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleCalculate}
              disabled={isCalculating || !qty}
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

          {/* Error state */}
          {error && (
            <Card className="bg-destructive/10 border-destructive/20">
              <CardContent className="flex items-center gap-3 p-4">
                <XCircle className="h-5 w-5 text-destructive flex-shrink-0" />
                <div>
                  <p className="font-medium text-destructive">{t('products.quoteError', 'Ошибка расчёта')}</p>
                  <p className="text-sm text-muted-foreground">{error}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Breakdown result */}
          {breakdown && (
            <Card className="bg-muted/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  {t('products.quoteBreakdown', 'Расчёт стоимости')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    {t('products.basePrice')} × {qty} м²
                  </span>
                  <span>{formatCurrency(breakdown.base_price, breakdown.currency)}</span>
                </div>
                
                {breakdown.discount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      {t('products.quantityDiscount', 'Скидка')}
                    </span>
                    <span className="text-green-600">-{formatCurrency(breakdown.discount, breakdown.currency)}</span>
                  </div>
                )}

                <Separator />

                <div className="flex justify-between font-semibold text-lg">
                  <span>{t('orders.total', 'Итого')}</span>
                  <span className="text-primary">{formatCurrency(breakdown.final_price, breakdown.currency)}</span>
                </div>

                {breakdown.unit_price > 0 && (
                  <div className="text-xs text-muted-foreground text-right">
                    {formatCurrency(breakdown.unit_price, breakdown.currency)}/м²
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
