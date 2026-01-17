import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Palette, Calculator, Receipt, Check, X, Eye } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
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
import { toast } from '@/hooks/use-toast';
import { RalColorsDialog } from './RalColorsDialog';
import { PriceByColorDialog } from './PriceByColorDialog';
import { PriceQuoteDialog } from './PriceQuoteDialog';
import { ProductDetailSheet } from './ProductDetailSheet';

interface Product {
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

export function ProductsTab() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const queryClient = useQueryClient();

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
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  // Fetch unique profiles for filter
  const { data: profiles } = useQuery({
    queryKey: ['product-profiles', profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return [];
      const { data } = await supabase
        .from('product_catalog')
        .select('profile')
        .eq('organization_id', profile.organization_id)
        .not('profile', 'is', null);
      return [...new Set(data?.map((d) => d.profile).filter(Boolean))] as string[];
    },
    enabled: !!profile?.organization_id,
  });

  // Fetch unique thicknesses
  const { data: thicknesses } = useQuery({
    queryKey: ['product-thicknesses', profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return [];
      const { data } = await supabase
        .from('product_catalog')
        .select('thickness_mm')
        .eq('organization_id', profile.organization_id)
        .not('thickness_mm', 'is', null);
      const unique = [...new Set(data?.map((d) => d.thickness_mm).filter(Boolean))];
      return unique.sort((a, b) => (a ?? 0) - (b ?? 0)) as number[];
    },
    enabled: !!profile?.organization_id,
  });

  // Fetch unique coatings
  const { data: coatings } = useQuery({
    queryKey: ['product-coatings', profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return [];
      const { data } = await supabase
        .from('product_catalog')
        .select('coating')
        .eq('organization_id', profile.organization_id)
        .not('coating', 'is', null);
      return [...new Set(data?.map((d) => d.coating).filter(Boolean))] as string[];
    },
    enabled: !!profile?.organization_id,
  });

  // Main products query
  const { data, isLoading } = useQuery({
    queryKey: ['products', profile?.organization_id, search, page, pageSize, profileFilter, thicknessFilter, coatingFilter, activeFilter],
    queryFn: async () => {
      if (!profile?.organization_id) return { data: [], count: 0 };

      let query = supabase
        .from('product_catalog')
        .select('*', { count: 'exact' })
        .eq('organization_id', profile.organization_id)
        .order('profile', { ascending: true })
        .order('thickness_mm', { ascending: true })
        .order('base_price_rub_m2', { ascending: true });

      if (search) {
        query = query.or(`sku.ilike.%${search}%,title.ilike.%${search}%,profile.ilike.%${search}%,bq_key.ilike.%${search}%`);
      }

      if (profileFilter !== 'all') query = query.eq('profile', profileFilter);
      if (thicknessFilter !== 'all') query = query.eq('thickness_mm', parseFloat(thicknessFilter));
      if (coatingFilter !== 'all') query = query.eq('coating', coatingFilter);
      if (activeFilter !== 'all') query = query.eq('is_active', activeFilter === 'true');

      const from = (page - 1) * pageSize;
      query = query.range(from, from + pageSize - 1);

      const { data, count, error } = await query;
      if (error) throw error;

      return { data: data as Product[], count: count || 0 };
    },
    enabled: !!profile?.organization_id,
  });

  // Toggle active mutation
  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from('product_catalog')
        .update({ is_active })
        .eq('id', id)
        .eq('organization_id', profile!.organization_id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['catalog-stats-products'] });
    },
    onError: () => {
      toast({ title: t('common.error'), description: t('catalog.toggleError', 'Не удалось изменить статус'), variant: 'destructive' });
    },
  });

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      maximumFractionDigits: 0,
    }).format(value);
  };

  const handleOpenQuoteDialog = useCallback((product: Product) => {
    setSelectedProduct(product);
    setQuoteDialogOpen(true);
  }, []);

  const handleOpenRalDialog = useCallback((product: Product) => {
    setSelectedProduct(product);
    setRalDialogOpen(true);
  }, []);

  const handleOpenPriceDialog = useCallback((product: Product) => {
    setSelectedProduct(product);
    setPriceDialogOpen(true);
  }, []);

  const handleOpenDetailSheet = useCallback((product: Product) => {
    setSelectedProduct(product);
    setDetailSheetOpen(true);
  }, []);

  const columns: Column<Product>[] = [
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
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="font-semibold text-primary cursor-help">
                {formatCurrency(row.base_price_rub_m2)}/м²
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">{t('catalog.basePriceHint', 'Базовая цена из BigQuery (read-only)')}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ),
    },
    {
      key: 'is_active',
      header: t('products.isActive'),
      cell: (row) => (
        <Switch
          checked={row.is_active}
          onCheckedChange={(checked) => toggleActiveMutation.mutate({ id: row.id, is_active: checked })}
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
              {profiles?.map((p) => (
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
              {thicknesses?.map((th) => (
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
              {coatings?.map((c) => (
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
        data={data?.data || []}
        loading={isLoading}
        searchPlaceholder={t('catalog.searchPlaceholder', 'Поиск по названию, SKU, bq_key...')}
        onSearch={setSearch}
        searchValue={search}
        page={page}
        pageSize={pageSize}
        totalCount={data?.count || 0}
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
