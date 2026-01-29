import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, Calculator, Plus, Sparkles } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CatalogStatsCards } from './CatalogStatsCards';
import { CatalogActionRail } from './CatalogActionRail';
import { ProductsTab } from './ProductsTab';
import { DiscountRulesTab } from './DiscountRulesTab';
import { ImportTab } from './ImportTab';
import { NormalizationTab } from './NormalizationTab';
import { PriceQuoteDialog } from './PriceQuoteDialog';
import { DiscountRuleDialog } from './DiscountRuleDialog';
import { ImportPriceDialog } from './ImportPriceDialog';
import { ActiveImportBanner } from '@/components/import/ActiveImportBanner';
import { useActiveImportJob } from '@/hooks/use-active-import';

export default function ProductsPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const { isInProgress } = useActiveImportJob();

  const [activeTab, setActiveTab] = useState('products');
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [quoteDialogOpen, setQuoteDialogOpen] = useState(false);
  const [discountDialogOpen, setDiscountDialogOpen] = useState(false);

  const canManageDiscounts = profile?.role === 'owner' || profile?.role === 'admin';

  const handleNavigateToImport = () => {
    setActiveTab('import');
  };

  return (
    <div className="space-y-6">
      {/* Active Import Banner */}
      <ActiveImportBanner 
        onNavigateToImport={handleNavigateToImport}
      />

      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{t('catalog.pageTitle', 'Прайс и каталог')}</h1>
          <p className="text-muted-foreground mt-1">
            {t('catalog.pageDescription', 'Управление товарами, обновление прайса, скидки и проверка цены')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setImportDialogOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />
            {t('catalog.uploadPrice', 'Загрузить прайс')}
          </Button>
          <Button variant="outline" onClick={() => setQuoteDialogOpen(true)}>
            <Calculator className="h-4 w-4 mr-2" />
            {t('catalog.checkPrice', 'Проверить цену')}
          </Button>
          {canManageDiscounts && (
            <Button onClick={() => setDiscountDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              {t('catalog.createDiscount', 'Создать скидку')}
            </Button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <CatalogStatsCards />

      {/* Main Content with Optional Sidebar */}
      <div className="flex gap-6">
        {/* Main Content */}
        <div className="flex-1 min-w-0">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
            <TabsList>
              <TabsTrigger value="products">{t('catalog.productsTab', 'Товары')}</TabsTrigger>
              {canManageDiscounts && (
                <TabsTrigger value="discounts">{t('products.discounts')}</TabsTrigger>
              )}
              <TabsTrigger value="import" className="relative">
                {t('catalog.importTab', 'Импорт')}
                {isInProgress && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 bg-primary rounded-full animate-pulse" />
                )}
              </TabsTrigger>
              <TabsTrigger value="normalization" className="flex items-center gap-1">
                <Sparkles className="h-3 w-3" />
                {t('catalog.normalizationTab', 'Нормализация')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="products">
              <ProductsTab />
            </TabsContent>

            {canManageDiscounts && (
              <TabsContent value="discounts">
                <DiscountRulesTab />
              </TabsContent>
            )}

            <TabsContent value="import">
              <ImportTab />
            </TabsContent>

            <TabsContent value="normalization">
              <NormalizationTab />
            </TabsContent>
          </Tabs>
        </div>

        {/* Action Rail (Desktop only) */}
        <div className="hidden xl:block w-64 flex-shrink-0">
          <CatalogActionRail
            onUploadPrice={() => setImportDialogOpen(true)}
            onCheckPrice={() => setActiveTab('pricing')}
            onCreateDiscount={() => setDiscountDialogOpen(true)}
          />
        </div>
      </div>

      {/* Dialogs */}
      <ImportPriceDialog 
        open={importDialogOpen} 
        onOpenChange={setImportDialogOpen} 
      />
      <PriceQuoteDialog 
        open={quoteDialogOpen} 
        onOpenChange={setQuoteDialogOpen} 
        product={null} 
      />
      <DiscountRuleDialog 
        open={discountDialogOpen} 
        onOpenChange={setDiscountDialogOpen} 
        group={null} 
      />
    </div>
  );
}
