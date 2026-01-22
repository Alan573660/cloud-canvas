import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Package, PackageCheck, History, AlertTriangle, Percent, TrendingUp } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { formatDistanceToNow } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';

export function CatalogStatsCards() {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();
  const dateLocale = i18n.language === 'ru' ? ru : enUS;

  // Products stats
  const { data: productStats, isLoading: loadingProducts } = useQuery({
    queryKey: ['catalog-stats-products', profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return { total: 0, active: 0 };
      
      const { count: total } = await supabase
        .from('product_catalog')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', profile.organization_id);

      const { count: active } = await supabase
        .from('product_catalog')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', profile.organization_id)
        .eq('is_active', true);

      return { total: total || 0, active: active || 0 };
    },
    enabled: !!profile?.organization_id,
  });

  // Discounts stats
  const { data: discountStats, isLoading: loadingDiscounts } = useQuery({
    queryKey: ['catalog-stats-discounts', profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return { total: 0, active: 0 };
      
      const { count: total } = await supabase
        .from('discount_rules')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', profile.organization_id);

      const { count: active } = await supabase
        .from('discount_rules')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', profile.organization_id)
        .eq('is_active', true);

      return { total: total || 0, active: active || 0 };
    },
    enabled: !!profile?.organization_id,
  });

  // Last import
  const { data: lastImport, isLoading: loadingImport } = useQuery({
    queryKey: ['catalog-stats-import', profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return null;
      
      const { data } = await supabase
        .from('import_jobs')
        .select('id, status, created_at, invalid_rows, total_rows, entity_type')
        .eq('organization_id', profile.organization_id)
        .eq('entity_type', 'PRODUCT_CATALOG')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      return data;
    },
    enabled: !!profile?.organization_id,
  });

  const isLoading = loadingProducts || loadingDiscounts || loadingImport;

  const cards = [
    {
      icon: PackageCheck,
      label: t('catalog.activeProducts', 'Активные товары'),
      value: productStats?.active ?? 0,
      subValue: `${t('catalog.ofTotal', 'из')} ${productStats?.total ?? 0}`,
      color: 'text-emerald-600',
      bgColor: 'bg-emerald-50 dark:bg-emerald-950/20',
    },
    {
      icon: Package,
      label: t('catalog.totalProducts', 'Всего товаров'),
      value: productStats?.total ?? 0,
      subValue: productStats?.active !== productStats?.total 
        ? `${productStats?.total ? productStats.total - (productStats.active || 0) : 0} ${t('catalog.inactive', 'неактивн.')}`
        : t('catalog.allActive', 'все активны'),
      color: 'text-blue-600',
      bgColor: 'bg-blue-50 dark:bg-blue-950/20',
    },
    {
      icon: Percent,
      label: t('catalog.activeDiscounts', 'Активные скидки'),
      value: discountStats?.active ?? 0,
      subValue: `${discountStats?.total ?? 0} ${t('catalog.rulesTotal', 'правил всего')}`,
      color: 'text-violet-600',
      bgColor: 'bg-violet-50 dark:bg-violet-950/20',
    },
    {
      icon: lastImport?.status === 'COMPLETED' ? History : lastImport?.status === 'FAILED' ? AlertTriangle : TrendingUp,
      label: t('catalog.lastImport', 'Последний импорт'),
      value: lastImport 
        ? formatDistanceToNow(new Date(lastImport.created_at), { addSuffix: true, locale: dateLocale })
        : t('catalog.noImports', 'Нет'),
      subValue: lastImport?.invalid_rows && lastImport.invalid_rows > 0 
        ? `${lastImport.invalid_rows} ${t('catalog.errors', 'ошибок')}`
        : lastImport?.status === 'COMPLETED' 
          ? t('catalog.success', 'успешно')
          : lastImport?.status === 'FAILED'
            ? t('catalog.failed', 'ошибка')
            : '',
      color: lastImport?.status === 'FAILED' ? 'text-red-600' : 'text-amber-600',
      bgColor: lastImport?.status === 'FAILED' ? 'bg-red-50 dark:bg-red-950/20' : 'bg-amber-50 dark:bg-amber-950/20',
    },
  ];

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <Skeleton className="h-4 w-24 mb-2" />
              <Skeleton className="h-8 w-16 mb-1" />
              <Skeleton className="h-3 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card, idx) => (
        <Card key={idx} className="hover:shadow-md transition-shadow">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${card.bgColor}`}>
                <card.icon className={`h-5 w-5 ${card.color}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground truncate">{card.label}</p>
                <p className="text-xl font-bold truncate">{card.value}</p>
                <p className="text-xs text-muted-foreground truncate">{card.subValue}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
