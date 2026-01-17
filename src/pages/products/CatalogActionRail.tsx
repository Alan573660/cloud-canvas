import { useTranslation } from 'react-i18next';
import { Database, FileSpreadsheet, Zap, Info, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

interface CatalogActionRailProps {
  onUploadPrice: () => void;
  onCheckPrice: () => void;
  onCreateDiscount: () => void;
}

export function CatalogActionRail({ onUploadPrice, onCheckPrice, onCreateDiscount }: CatalogActionRailProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      {/* Quick Actions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500" />
            {t('catalog.quickActions', 'Быстрые действия')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <button
            onClick={onUploadPrice}
            className="w-full text-left p-2 rounded-md hover:bg-muted transition-colors text-sm flex items-center gap-2"
          >
            <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
            {t('catalog.uploadPrice', 'Загрузить прайс')}
          </button>
          <button
            onClick={onCheckPrice}
            className="w-full text-left p-2 rounded-md hover:bg-muted transition-colors text-sm flex items-center gap-2"
          >
            <Database className="h-4 w-4 text-muted-foreground" />
            {t('catalog.checkPrice', 'Проверить цену')}
          </button>
          <button
            onClick={onCreateDiscount}
            className="w-full text-left p-2 rounded-md hover:bg-muted transition-colors text-sm flex items-center gap-2"
          >
            <Zap className="h-4 w-4 text-muted-foreground" />
            {t('catalog.createDiscount', 'Создать скидку')}
          </button>
        </CardContent>
      </Card>

      {/* Price Source Info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Database className="h-4 w-4 text-blue-500" />
            {t('catalog.priceSource', 'Источник цен')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{t('catalog.basePrice', 'Базовая цена')}</span>
            <Badge variant="outline" className="text-xs">BigQuery</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{t('catalog.finalPrice', 'Итоговая')}</span>
            <Badge variant="outline" className="text-xs">Pricing API</Badge>
          </div>
          <Separator />
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t('catalog.pricingNote', 'Финальная цена рассчитывается через Pricing API с учётом скидок, наценок за цвет и объёма.')}
          </p>
        </CardContent>
      </Card>

      {/* Import Format Info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Info className="h-4 w-4 text-slate-500" />
            {t('catalog.importFormat', 'Формат импорта')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="text-xs space-y-1">
            <p className="font-medium text-muted-foreground">{t('catalog.supported', 'Поддерживаемые')}:</p>
            <div className="flex flex-wrap gap-1">
              <Badge variant="secondary" className="text-[10px]">CSV</Badge>
              <Badge variant="secondary" className="text-[10px]">XLSX</Badge>
              <Badge variant="secondary" className="text-[10px]">JSONL</Badge>
              <Badge variant="secondary" className="text-[10px]">Parquet</Badge>
            </div>
          </div>
          <Separator />
          <div className="text-xs space-y-1">
            <p className="font-medium text-muted-foreground">{t('catalog.required', 'Обязательные')}:</p>
            <p className="text-muted-foreground font-mono text-[10px]">
              id, price_rub_m2, profile, thickness_mm, coating
            </p>
          </div>
          <div className="text-xs space-y-1">
            <p className="font-medium text-muted-foreground">{t('catalog.optional', 'Опционально')}:</p>
            <p className="text-muted-foreground font-mono text-[10px]">
              title, width_work_mm, width_full_mm, weight_kg_m2
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Documentation Link */}
      <Card className="bg-muted/30">
        <CardContent className="p-3">
          <a 
            href="#" 
            className="flex items-center gap-2 text-xs text-primary hover:underline"
            onClick={(e) => e.preventDefault()}
          >
            <ExternalLink className="h-3 w-3" />
            {t('catalog.documentation', 'Документация по импорту')}
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
