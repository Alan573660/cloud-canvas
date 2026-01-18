import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Package, ShoppingCart, Layers, Info } from 'lucide-react';
import { DiscountGroup } from './types/discount-group';

interface DiscountGroupViewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: DiscountGroup | null;
}

export function DiscountGroupViewDialog({ open, onOpenChange, group }: DiscountGroupViewDialogProps) {
  const { t } = useTranslation();

  if (!group) return null;

  const formatDiscountValue = (value: number) => {
    if (group.discount_type === 'PERCENT') {
      return `${value}%`;
    }
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      maximumFractionDigits: 0,
    }).format(value);
  };

  const getTargetLabel = () => {
    switch (group.applies_to) {
      case 'ALL':
        return (
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
            <span>{t('products.discountGroups.targetAllProducts')}</span>
          </div>
        );
      case 'CATEGORY':
        return (
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-muted-foreground" />
            <span>{t('products.discountGroups.targetProfile')}: <strong>{group.category_code}</strong></span>
          </div>
        );
      case 'PRODUCT':
        return (
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <span>{t('products.discountGroups.targetProducts')}: <strong>{group.products.length}</strong></span>
          </div>
        );
      default:
        return null;
    }
  };

  const getActiveStatusLabel = () => {
    if (group.is_active === true) {
      return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">{t('common.yes')}</Badge>;
    } else if (group.is_active === false) {
      return <Badge variant="secondary">{t('common.no')}</Badge>;
    }
    return <Badge variant="outline" className="border-yellow-500 text-yellow-600">{t('products.discountGroups.partiallyActive')}</Badge>;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {t('products.discountGroups.viewTitle')}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1">
          <div className="space-y-6 pr-4">
            {/* Basic Info */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">{group.base_rule_name}</h3>
                {getActiveStatusLabel()}
              </div>
              
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">{t('products.discountGroups.appliesTo')}:</span>
                  <div className="mt-1">{getTargetLabel()}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('products.discountType')}:</span>
                  <div className="mt-1 font-medium">
                    {group.discount_type === 'PERCENT' 
                      ? t('products.discountForm.typePercent') 
                      : t('products.discountForm.typeFixed')}
                  </div>
                </div>
              </div>
            </div>

            {/* Products List (if PRODUCT type) */}
            {group.applies_to === 'PRODUCT' && group.products.length > 0 && (
              <div className="space-y-3">
                <h4 className="font-medium">{t('products.discountGroups.productsList')}</h4>
                <div className="border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('products.productTitle')}</TableHead>
                        <TableHead>{t('products.sku')}</TableHead>
                        <TableHead>{t('products.profile')}</TableHead>
                        <TableHead>{t('products.thickness')}</TableHead>
                        <TableHead>{t('products.coating')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.products.map(product => (
                        <TableRow key={product.id}>
                          <TableCell className="font-medium">{product.title || '—'}</TableCell>
                          <TableCell className="text-muted-foreground text-xs font-mono">{product.sku || product.bq_key || '—'}</TableCell>
                          <TableCell>{product.profile || '—'}</TableCell>
                          <TableCell>{product.thickness_mm ? `${product.thickness_mm} мм` : '—'}</TableCell>
                          <TableCell>{product.coating || '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {/* Steps Table */}
            <div className="space-y-3">
              <h4 className="font-medium">
                {group.steps.length > 1 
                  ? t('products.discountGroups.stepsTitle', { count: group.steps.length })
                  : t('products.discountGroups.discountDetails')}
              </h4>
              <div className="border rounded-md overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('products.discountForm.volumeFrom')}</TableHead>
                      <TableHead>{t('products.discountForm.volumeTo')}</TableHead>
                      <TableHead>{t('products.discountValue')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.steps.map((step, index) => (
                      <TableRow key={step.id}>
                        <TableCell>{step.min_qty} м²</TableCell>
                        <TableCell>{step.max_qty !== null ? `${step.max_qty} м²` : '∞'}</TableCell>
                        <TableCell className="font-semibold text-green-600 dark:text-green-400">
                          -{formatDiscountValue(step.discount_value)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* Explanation Note */}
            <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg text-sm text-muted-foreground">
              <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <p>
                {t('products.discountGroups.explanation', 
                  'Это группа скидок. В базе хранится как {{count}} записей discount_rules.', 
                  { count: group.rules.length }
                )}
              </p>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
