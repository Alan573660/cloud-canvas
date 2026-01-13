import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Plus, Pencil, Check, X, Palette, Calculator } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { DataTable, Column } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { DiscountRulesTab } from './DiscountRulesTab';

interface Product {
  id: string;
  sku: string | null;
  title: string | null;
  profile: string | null;
  coating: string | null;
  thickness_mm: number | null;
  width_work_mm: number | null;
  base_price_rub_m2: number;
  is_active: boolean;
  created_at: string;
}

export default function ProductsPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Filters
  const [profileFilter, setProfileFilter] = useState<string>('all');
  const [thicknessFilter, setThicknessFilter] = useState<string>('all');
  const [activeFilter, setActiveFilter] = useState<string>('all');

  // Dialog states
  const [ralDialogOpen, setRalDialogOpen] = useState(false);
  const [priceDialogOpen, setPriceDialogOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  // Fetch unique profiles for filter
  const { data: profiles } = useQuery({
    queryKey: ['product-profiles', profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return [];
      const { data, error } = await supabase
        .from('product_catalog')
        .select('profile')
        .eq('organization_id', profile.organization_id)
        .not('profile', 'is', null);
      if (error) throw error;
      const uniqueProfiles = [...new Set(data.map((d) => d.profile).filter(Boolean))];
      return uniqueProfiles as string[];
    },
    enabled: !!profile?.organization_id,
  });

  // Fetch unique thicknesses for filter
  const { data: thicknesses } = useQuery({
    queryKey: ['product-thicknesses', profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return [];
      const { data, error } = await supabase
        .from('product_catalog')
        .select('thickness_mm')
        .eq('organization_id', profile.organization_id)
        .not('thickness_mm', 'is', null);
      if (error) throw error;
      const uniqueThicknesses = [...new Set(data.map((d) => d.thickness_mm).filter(Boolean))];
      return uniqueThicknesses.sort((a, b) => (a ?? 0) - (b ?? 0)) as number[];
    },
    enabled: !!profile?.organization_id,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['products', profile?.organization_id, search, page, pageSize, profileFilter, thicknessFilter, activeFilter],
    queryFn: async () => {
      if (!profile?.organization_id) return { data: [], count: 0 };

      let query = supabase
        .from('product_catalog')
        .select('*', { count: 'exact' })
        .eq('organization_id', profile.organization_id)
        .order('created_at', { ascending: false });

      if (search) {
        query = query.or(
          `sku.ilike.%${search}%,title.ilike.%${search}%,profile.ilike.%${search}%`
        );
      }

      if (profileFilter !== 'all') {
        query = query.eq('profile', profileFilter);
      }

      if (thicknessFilter !== 'all') {
        query = query.eq('thickness_mm', parseFloat(thicknessFilter));
      }

      if (activeFilter !== 'all') {
        query = query.eq('is_active', activeFilter === 'true');
      }

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      query = query.range(from, to);

      const { data, count, error } = await query;
      if (error) throw error;

      return { data: data as Product[], count: count || 0 };
    },
    enabled: !!profile?.organization_id,
  });

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      maximumFractionDigits: 0,
    }).format(value);
  };

  const handleOpenRalDialog = (product: Product) => {
    setSelectedProduct(product);
    setRalDialogOpen(true);
  };

  const handleOpenPriceDialog = (product: Product) => {
    setSelectedProduct(product);
    setPriceDialogOpen(true);
  };

  const columns: Column<Product>[] = [
    {
      key: 'sku',
      header: t('products.sku'),
      cell: (row) => (
        <span className="font-mono text-sm">{row.sku || '—'}</span>
      ),
    },
    {
      key: 'title',
      header: t('products.productTitle'),
      cell: (row) => row.title || '—',
    },
    {
      key: 'profile',
      header: t('products.profile'),
      cell: (row) => row.profile || '—',
    },
    {
      key: 'coating',
      header: t('products.coating'),
      cell: (row) => row.coating || '—',
    },
    {
      key: 'thickness_mm',
      header: t('products.thickness'),
      cell: (row) => (row.thickness_mm ? `${row.thickness_mm} мм` : '—'),
    },
    {
      key: 'width_work_mm',
      header: t('products.widthWork'),
      cell: (row) => (row.width_work_mm ? `${row.width_work_mm} мм` : '—'),
    },
    {
      key: 'base_price_rub_m2',
      header: t('products.basePrice'),
      cell: (row) => (
        <span className="font-semibold">
          {formatCurrency(row.base_price_rub_m2)} / м²
        </span>
      ),
    },
    {
      key: 'is_active',
      header: t('products.isActive'),
      cell: (row) =>
        row.is_active ? (
          <Badge className="bg-green-100 text-green-800">
            <Check className="h-3 w-3 mr-1" />
            {t('common.yes')}
          </Badge>
        ) : (
          <Badge variant="secondary">
            <X className="h-3 w-3 mr-1" />
            {t('common.no')}
          </Badge>
        ),
    },
    {
      key: 'actions',
      header: t('common.actions'),
      cell: (row) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleOpenRalDialog(row)}
            title={t('products.availableColors')}
          >
            <Palette className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleOpenPriceDialog(row)}
            title={t('products.priceByColor')}
          >
            <Calculator className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon">
            <Pencil className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  const canManageDiscounts = profile?.role === 'owner' || profile?.role === 'admin';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">{t('products.title')}</h1>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          {t('products.newProduct')}
        </Button>
      </div>

      <Tabs defaultValue="catalog" className="space-y-4">
        <TabsList>
          <TabsTrigger value="catalog">{t('products.catalog')}</TabsTrigger>
          {canManageDiscounts && (
            <TabsTrigger value="discounts">{t('products.discounts')}</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="catalog" className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-4 p-4 bg-muted/50 rounded-lg">
            <div className="flex flex-col gap-1.5">
              <Label className="text-sm">{t('products.profile')}</Label>
              <Select value={profileFilter} onValueChange={setProfileFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder={t('common.filter')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('common.filter')}: —</SelectItem>
                  {profiles?.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-sm">{t('products.thickness')}</Label>
              <Select value={thicknessFilter} onValueChange={setThicknessFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder={t('common.filter')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('common.filter')}: —</SelectItem>
                  {thicknesses?.map((th) => (
                    <SelectItem key={th} value={String(th)}>
                      {th} мм
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-sm">{t('products.isActive')}</Label>
              <Select value={activeFilter} onValueChange={setActiveFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder={t('common.filter')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('common.filter')}: —</SelectItem>
                  <SelectItem value="true">{t('common.yes')}</SelectItem>
                  <SelectItem value="false">{t('common.no')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DataTable
            columns={columns}
            data={data?.data || []}
            loading={isLoading}
            searchPlaceholder={t('common.search')}
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
        </TabsContent>

        {canManageDiscounts && (
          <TabsContent value="discounts">
            <DiscountRulesTab />
          </TabsContent>
        )}
      </Tabs>

      {/* Dialogs */}
      <RalColorsDialog
        open={ralDialogOpen}
        onOpenChange={setRalDialogOpen}
        product={selectedProduct}
      />
      <PriceByColorDialog
        open={priceDialogOpen}
        onOpenChange={setPriceDialogOpen}
        product={selectedProduct}
      />
    </div>
  );
}
