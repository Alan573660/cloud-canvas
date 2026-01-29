import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Palette, Calculator, Receipt, Check, X, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DataTable, Column } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { RalColorsDialog } from './RalColorsDialog';
import { PriceByColorDialog } from './PriceByColorDialog';
import { PriceQuoteDialog } from './PriceQuoteDialog';
import { ProductDetailSheet } from './ProductDetailSheet';
import { useCatalogItems, useCatalogFacets, useToggleProductActive } from '@/hooks/use-catalog-items';
import type { CatalogItemWithOverrides } from '@/lib/catalog-api';

// Legacy Product type for compatibility with existing dialogs
interface LegacyProduct {
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

// Map Catalog item to legacy format for existing dialogs
function toLegacyProduct(item: CatalogItemWithOverrides): LegacyProduct {
  return {
    id: item.id,
    sku: item.id, // Use id as SKU
    title: item.title,
    profile: item.cat_name, // cat_name is the category/profile
    coating: null, // Not in new API
    thickness_mm: null, // Not in new API
    width_work_mm: null, // Not in new API
    width_full_mm: null, // Not in new API
    weight_kg_m2: null, // Not in new API
    base_price_rub_m2: item.price_rub_m2,
    is_active: item.is_active,
    notes: null, // Not in new API
    bq_key: item.id,
    created_at: '', // Not in new API
    updated_at: '', // Not in new API
  };
}

export function ProductsTab() {
  const { t } = useTranslation();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  // Filters - adapted to new API fields
  const [unitFilter, setUnitFilter] = useState<string>('all');
  const [catNameFilter, setCatNameFilter] = useState<string>('all');
  const [activeFilter, setActiveFilter] = useState<string>('all');

  // Dialog states
  const [ralDialogOpen, setRalDialogOpen] = useState(false);
  const [priceDialogOpen, setPriceDialogOpen] = useState(false);
  const [quoteDialogOpen, setQuoteDialogOpen] = useState(false);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<LegacyProduct | null>(null);

  // Catalog API hooks
  const { facets, isLoading: facetsLoading } = useCatalogFacets();
  const { items, totalCount, isLoading } = useCatalogItems({
    q: search || undefined,
    page,
    pageSize,
    unit: unitFilter !== 'all' ? unitFilter : undefined,
    catName: catNameFilter !== 'all' ? catNameFilter : undefined,
  });

  const toggleActiveMutation = useToggleProductActive();

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      maximumFractionDigits: 0,
    }).format(value);
  };

  const handleOpenQuoteDialog = useCallback((item: CatalogItemWithOverrides) => {
    setSelectedProduct(toLegacyProduct(item));
    setQuoteDialogOpen(true);
  }, []);

  const handleOpenRalDialog = useCallback((item: CatalogItemWithOverrides) => {
    setSelectedProduct(toLegacyProduct(item));
    setRalDialogOpen(true);
  }, []);

  const handleOpenPriceDialog = useCallback((item: CatalogItemWithOverrides) => {
    setSelectedProduct(toLegacyProduct(item));
    setPriceDialogOpen(true);
  }, []);

  const handleOpenDetailSheet = useCallback((item: CatalogItemWithOverrides) => {
    setSelectedProduct(toLegacyProduct(item));
    setDetailSheetOpen(true);
  }, []);

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
      cell: (row) => (
        <Badge variant="outline" className="font-mono">
          {row.cat_name || '—'}
        </Badge>
      ),
    },
    {
      key: 'unit',
      header: t('products.unit', 'Ед.'),
      cell: (row) => row.unit || '—',
    },
    {
      key: 'price_rub_m2',
      header: t('products.basePrice'),
      cell: (row) => (
        <span className="font-semibold text-primary">
          {formatCurrency(row.price_rub_m2)}/м²
        </span>
      ),
    },
    {
      key: 'is_active',
      header: t('products.isActive'),
      cell: (row) => (
        <Switch
          checked={row.is_active}
          onCheckedChange={(checked) => 
            toggleActiveMutation.mutate({ bqKey: row.id, isActive: checked })
          }
          disabled={toggleActiveMutation.isPending}
        />
      ),
    },
    {
      key: 'actions',
      header: t('common.actions'),
      cell: (row) => (
        <div className="flex items-center gap-0.5">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={() => handleOpenQuoteDialog(row)}>
                  <Receipt className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('products.requestQuote')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={() => handleOpenRalDialog(row)}>
                  <Palette className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('products.availableColors')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={() => handleOpenPriceDialog(row)}>
                  <Calculator className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('products.priceByColor')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={() => handleOpenDetailSheet(row)}>
                  <Eye className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('common.details')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      ),
    },
  ];

  const clearFilters = () => {
    setUnitFilter('all');
    setCatNameFilter('all');
    setActiveFilter('all');
    setSearch('');
    setPage(1);
  };

  const hasActiveFilters = unitFilter !== 'all' || catNameFilter !== 'all' || activeFilter !== 'all' || search !== '';

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 p-4 bg-muted/30 rounded-lg border">
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">{t('products.category', 'Категория')}</Label>
          <Select value={catNameFilter} onValueChange={setCatNameFilter}>
            <SelectTrigger className="w-[220px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('common.all')}</SelectItem>
              {facets?.categories.map((c) => (
                <SelectItem key={c.cat_name} value={c.cat_name}>
                  {c.cat_name} ({c.cnt.toLocaleString('ru-RU')})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">{t('products.unit', 'Единица')}</Label>
          <Select value={unitFilter} onValueChange={setUnitFilter}>
            <SelectTrigger className="w-[140px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('common.all')}</SelectItem>
              {facets?.units.map((u) => (
                <SelectItem key={u.unit} value={u.unit}>
                  {u.unit} ({u.cnt.toLocaleString('ru-RU')})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">{t('products.isActive')}</Label>
          <Select value={activeFilter} onValueChange={setActiveFilter}>
            <SelectTrigger className="w-[120px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('common.all')}</SelectItem>
              <SelectItem value="true">
                <span className="flex items-center gap-1">
                  <Check className="h-3 w-3 text-green-600" />
                  {t('common.yes')}
                </span>
              </SelectItem>
              <SelectItem value="false">
                <span className="flex items-center gap-1">
                  <X className="h-3 w-3 text-muted-foreground" />
                  {t('common.no')}
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {hasActiveFilters && (
          <div className="flex items-end">
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9">
              {t('common.reset')}
            </Button>
          </div>
        )}
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        data={items}
        loading={isLoading || facetsLoading}
        searchPlaceholder={t('catalog.searchPlaceholder', 'Поиск по названию, SKU, bq_key...')}
        onSearch={setSearch}
        searchValue={search}
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        emptyMessage={t('products.noProducts')}
      />

      {/* Dialogs */}
      <RalColorsDialog open={ralDialogOpen} onOpenChange={setRalDialogOpen} product={selectedProduct} />
      <PriceByColorDialog open={priceDialogOpen} onOpenChange={setPriceDialogOpen} product={selectedProduct} />
      <PriceQuoteDialog open={quoteDialogOpen} onOpenChange={setQuoteDialogOpen} product={selectedProduct} />
      <ProductDetailSheet open={detailSheetOpen} onOpenChange={setDetailSheetOpen} product={selectedProduct} />
    </div>
  );
}
