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

function toLegacyProduct(item: CatalogItemWithOverrides): LegacyProduct {
  return {
    id: item.bq_id,
    sku: item.sku,
    title: item.title,
    profile: item.profile,
    coating: item.coating,
    thickness_mm: item.thickness_mm,
    width_work_mm: item.width_work_mm,
    width_full_mm: item.width_full_mm,
    weight_kg_m2: item.weight_kg_m2,
    base_price_rub_m2: item.base_price_rub_m2,
    is_active: item.is_active,
    notes: item.notes,
    bq_key: item.bq_id,
    created_at: item.created_at,
    updated_at: item.updated_at,
  };
}

export function ProductsTab() {
  const { t } = useTranslation();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  // Filters
  const [profileFilter, setProfileFilter] = useState<string>('all');
  const [thicknessFilter, setThicknessFilter] = useState<string>('all');
  const [coatingFilter, setCoatingFilter] = useState<string>('all');
  const [activeFilter, setActiveFilter] = useState<string>('all');

  // Dialog states
  const [ralDialogOpen, setRalDialogOpen] = useState(false);
  const [priceDialogOpen, setPriceDialogOpen] = useState(false);
  const [quoteDialogOpen, setQuoteDialogOpen] = useState(false);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<LegacyProduct | null>(null);

  // BigQuery API hooks
  const { facets, isLoading: facetsLoading } = useCatalogFacets();
  const { items, totalCount, isLoading } = useCatalogItems({
    search: search || undefined,
    page,
    pageSize,
    profile: profileFilter !== 'all' ? profileFilter : undefined,
    coating: coatingFilter !== 'all' ? coatingFilter : undefined,
    thickness: thicknessFilter !== 'all' ? parseFloat(thicknessFilter) : undefined,
    isActive: activeFilter !== 'all' ? activeFilter === 'true' : undefined,
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
          <p className="text-xs text-muted-foreground font-mono">{row.sku || '—'}</p>
        </div>
      ),
    },
    {
      key: 'profile',
      header: t('products.profile'),
      cell: (row) => (
        <Badge variant="outline" className="font-mono">
          {row.profile || '—'}
        </Badge>
      ),
    },
    {
      key: 'thickness_mm',
      header: t('products.thickness'),
      cell: (row) => row.thickness_mm ? `${row.thickness_mm} ${t('catalog.mm', 'мм')}` : '—',
    },
    {
      key: 'coating',
      header: t('products.coating'),
      cell: (row) => row.coating || '—',
    },
    {
      key: 'width_work_mm',
      header: t('products.widthWork'),
      cell: (row) => row.width_work_mm ? `${row.width_work_mm} ${t('catalog.mm', 'мм')}` : '—',
    },
    {
      key: 'base_price_rub_m2',
      header: t('products.basePrice'),
      cell: (row) => (
        <span className="font-semibold text-primary">
          {formatCurrency(row.base_price_rub_m2)}/м²
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
            toggleActiveMutation.mutate({ bqId: row.bq_id, isActive: checked })
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
    setProfileFilter('all');
    setThicknessFilter('all');
    setCoatingFilter('all');
    setActiveFilter('all');
    setSearch('');
    setPage(1);
  };

  const hasActiveFilters = profileFilter !== 'all' || thicknessFilter !== 'all' || coatingFilter !== 'all' || activeFilter !== 'all' || search !== '';

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 p-4 bg-muted/30 rounded-lg border">
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">{t('products.profile')}</Label>
          <Select value={profileFilter} onValueChange={setProfileFilter}>
            <SelectTrigger className="w-[140px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('common.all')}</SelectItem>
              {facets?.profiles.map((p) => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">{t('products.thickness')}</Label>
          <Select value={thicknessFilter} onValueChange={setThicknessFilter}>
            <SelectTrigger className="w-[120px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('common.all')}</SelectItem>
              {facets?.thicknesses.map((th) => (
                <SelectItem key={th} value={String(th)}>{th} мм</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">{t('products.coating')}</Label>
          <Select value={coatingFilter} onValueChange={setCoatingFilter}>
            <SelectTrigger className="w-[140px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('common.all')}</SelectItem>
              {facets?.coatings.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
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
