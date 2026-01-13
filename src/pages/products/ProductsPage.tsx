import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Plus, Pencil, Check, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { DataTable, Column } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';

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

  const { data, isLoading } = useQuery({
    queryKey: ['products', profile?.organization_id, search, page, pageSize],
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
        <Button variant="ghost" size="icon">
          <Pencil className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('products.title')}</h1>
        </div>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          {t('products.newProduct')}
        </Button>
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
    </div>
  );
}
