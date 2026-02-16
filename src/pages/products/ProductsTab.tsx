import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Palette, Calculator, Receipt, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DataTable, Column } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { RalColorsDialog } from './RalColorsDialog';
import { PriceByColorDialog } from './PriceByColorDialog';
import { PriceQuoteDialog } from './PriceQuoteDialog';
import { ProductDetailSheet } from './ProductDetailSheet';
import { CategoryTreeSidebar } from './CategoryTreeSidebar';
import { useCatalogItems, useCatalogFacets, useToggleProductActive } from '@/hooks/use-catalog-items';
import type { CatalogItemWithOverrides } from '@/lib/catalog-api';

interface LegacyProduct {
  id: string; sku: string | null; title: string | null; profile: string | null;
  coating: string | null; thickness_mm: number | null; width_work_mm: number | null;
  width_full_mm: number | null; weight_kg_m2: number | null; base_price_rub_m2: number;
  is_active: boolean; notes: string | null; bq_key: string | null;
  created_at: string; updated_at: string;
}

function toLegacyProduct(item: CatalogItemWithOverrides): LegacyProduct {
  return {
    id: item.id, sku: item.id, title: item.title, profile: item.cat_name,
    coating: null, thickness_mm: null, width_work_mm: null, width_full_mm: null,
    weight_kg_m2: null, base_price_rub_m2: item.price_rub_m2, is_active: item.is_active,
    notes: null, bq_key: item.id, created_at: '', updated_at: '',
  };
}

export function ProductsTab() {
  const { t } = useTranslation();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [catNameFilter, setCatNameFilter] = useState<string | null>(null);

  // Dialog states
  const [ralDialogOpen, setRalDialogOpen] = useState(false);
  const [priceDialogOpen, setPriceDialogOpen] = useState(false);
  const [quoteDialogOpen, setQuoteDialogOpen] = useState(false);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<LegacyProduct | null>(null);

  const { facets, isLoading: facetsLoading } = useCatalogFacets();
  const { items, totalCount, isLoading } = useCatalogItems({
    q: search || undefined,
    page,
    pageSize,
    catName: catNameFilter || undefined,
  });

  const toggleActiveMutation = useToggleProductActive();

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(value);

  const handleOpenQuoteDialog = useCallback((item: CatalogItemWithOverrides) => { setSelectedProduct(toLegacyProduct(item)); setQuoteDialogOpen(true); }, []);
  const handleOpenRalDialog = useCallback((item: CatalogItemWithOverrides) => { setSelectedProduct(toLegacyProduct(item)); setRalDialogOpen(true); }, []);
  const handleOpenPriceDialog = useCallback((item: CatalogItemWithOverrides) => { setSelectedProduct(toLegacyProduct(item)); setPriceDialogOpen(true); }, []);
  const handleOpenDetailSheet = useCallback((item: CatalogItemWithOverrides) => { setSelectedProduct(toLegacyProduct(item)); setDetailSheetOpen(true); }, []);

  const handleSelectCategory = (catName: string | null) => {
    setCatNameFilter(catName);
    setPage(1);
  };

  const columns: Column<CatalogItemWithOverrides>[] = [
    {
      key: 'product',
      header: t('catalog.product', 'Товар'),
      cell: (row) => (
        <div className="min-w-[200px]">
          <p className="font-medium truncate">{row.title || t('catalog.noTitle', 'Без названия')}</p>
          <p className="text-xs text-muted-foreground font-mono">{row.id || '—'}</p>
        </div>
      ),
    },
    {
      key: 'cat_name',
      header: t('products.category', 'Категория'),
      cell: (row) => <Badge variant="outline" className="font-mono">{row.cat_name || '—'}</Badge>,
    },
    {
      key: 'unit',
      header: t('products.unit', 'Ед.'),
      cell: (row) => row.unit || '—',
    },
    {
      key: 'price_rub_m2',
      header: t('products.basePrice', 'Цена'),
      cell: (row) => <span className="font-semibold text-primary">{formatCurrency(row.price_rub_m2)}/м²</span>,
    },
    {
      key: 'is_active',
      header: t('products.isActive', 'Активен'),
      cell: (row) => (
        <Switch
          checked={row.is_active}
          onCheckedChange={(checked) => toggleActiveMutation.mutate({ bqKey: row.id, isActive: checked })}
          disabled={toggleActiveMutation.isPending}
        />
      ),
    },
    {
      key: 'actions',
      header: t('common.actions', 'Действия'),
      cell: (row) => (
        <div className="flex items-center gap-0.5">
          <TooltipProvider>
            <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" onClick={() => handleOpenQuoteDialog(row)}><Receipt className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent>{t('products.requestQuote', 'Запросить цену')}</TooltipContent></Tooltip>
            <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" onClick={() => handleOpenRalDialog(row)}><Palette className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent>{t('products.availableColors', 'Доступные цвета')}</TooltipContent></Tooltip>
            <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" onClick={() => handleOpenPriceDialog(row)}><Calculator className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent>{t('products.priceByColor', 'Цена по цвету')}</TooltipContent></Tooltip>
            <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" onClick={() => handleOpenDetailSheet(row)}><Eye className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent>{t('common.details', 'Подробнее')}</TooltipContent></Tooltip>
          </TooltipProvider>
        </div>
      ),
    },
  ];

  return (
    <div className="flex gap-6">
      {/* Category Tree Sidebar */}
      {facets && facets.categories.length > 0 && (
        <div className="hidden lg:block w-56 flex-shrink-0">
          <div className="sticky top-4 max-h-[calc(100vh-200px)] overflow-y-auto rounded-lg border bg-card p-2">
            <CategoryTreeSidebar
              categories={facets.categories}
              selectedCategory={catNameFilter}
              onSelectCategory={handleSelectCategory}
            />
          </div>
        </div>
      )}

      {/* Main Table */}
      <div className="flex-1 min-w-0">
        <DataTable
          columns={columns}
          data={items}
          loading={isLoading || facetsLoading}
          searchPlaceholder={t('catalog.searchPlaceholder', 'Поиск по названию, SKU...')}
          onSearch={(v) => { setSearch(v); setPage(1); }}
          searchValue={search}
          page={page}
          pageSize={pageSize}
          totalCount={totalCount}
          onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
          emptyMessage={t('products.noProducts', 'Товары не найдены')}
        />
      </div>

      {/* Dialogs */}
      <RalColorsDialog open={ralDialogOpen} onOpenChange={setRalDialogOpen} product={selectedProduct} />
      <PriceByColorDialog open={priceDialogOpen} onOpenChange={setPriceDialogOpen} product={selectedProduct} />
      <PriceQuoteDialog open={quoteDialogOpen} onOpenChange={setQuoteDialogOpen} product={selectedProduct} />
      <ProductDetailSheet open={detailSheetOpen} onOpenChange={setDetailSheetOpen} product={selectedProduct} />
    </div>
  );
}
