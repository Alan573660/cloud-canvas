import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, Calculator, Plus, FileSpreadsheet } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CatalogStatsCards } from './CatalogStatsCards';
import { CatalogActionRail } from './CatalogActionRail';
import { ProductsTab } from './ProductsTab';
import { DiscountRulesTab } from './DiscountRulesTab';
import { ImportTab } from './ImportTab';
import { PriceQuoteDialog } from './PriceQuoteDialog';
import { DiscountRuleDialog } from './DiscountRuleDialog';
import { ImportPriceDialog } from './ImportPriceDialog';

export default function ProductsPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();

  const [activeTab, setActiveTab] = useState('products');
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [quoteDialogOpen, setQuoteDialogOpen] = useState(false);
  const [discountDialogOpen, setDiscountDialogOpen] = useState(false);

  const canManageDiscounts = profile?.role === 'owner' || profile?.role === 'admin';

  return (
    <div className="space-y-6">
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
              <TabsTrigger value="import">{t('catalog.importTab', 'Импорт')}</TabsTrigger>
              <TabsTrigger value="pricing">{t('catalog.pricingTab', 'Проверка цены')}</TabsTrigger>
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

            <TabsContent value="pricing">
              <div className="max-w-xl">
                <PriceQuoteDialog 
                  open={true} 
                  onOpenChange={() => {}} 
                  product={null} 
                  embedded 
                />
              </div>
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
