/**
 * React Query hook for BigQuery Catalog API with Supabase overrides
 * 
 * IMPORTANT: Supabase product_catalog is used ONLY for overrides.
 * We do NOT create 71k rows - only store explicit is_active=false overrides.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { 
  fetchCatalogItems, 
  fetchCatalogFacets, 
  mergeWithOverrides,
  type CatalogItemsRequest,
  type CatalogItemWithOverrides,
  type CatalogFacets,
  type ProductOverride,
} from '@/lib/catalog-api';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from 'react-i18next';

interface UseCatalogItemsParams {
  q?: string;              // Search query
  page?: number;
  pageSize?: number;
  unit?: string;
  catName?: string;
  sort?: string;
}

interface UseCatalogItemsResult {
  items: CatalogItemWithOverrides[];
  totalCount: number;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Fetch catalog items from BigQuery + merge with Supabase overrides
 */
export function useCatalogItems(params: UseCatalogItemsParams): UseCatalogItemsResult {
  const { profile } = useAuth();
  const organizationId = profile?.organization_id;

  const page = params.page || 1;
  const pageSize = params.pageSize || 15;

  // Fetch items from BigQuery via Cloud Run API
  const itemsQuery = useQuery({
    queryKey: ['catalog-items', organizationId, params],
    queryFn: async () => {
      if (!organizationId) throw new Error('No organization');
      
      const request: CatalogItemsRequest = {
        organization_id: organizationId,
        limit: pageSize,
        offset: (page - 1) * pageSize,
        q: params.q || undefined,
        unit: params.unit || undefined,
        cat_name: params.catName || undefined,
        sort: params.sort || undefined,
      };

      return fetchCatalogItems(request);
    },
    enabled: !!organizationId,
    staleTime: 30_000, // 30 seconds
  });

  // Fetch overrides from Supabase for current page items ONLY
  // We only query items that have overrides (is_active=false)
  const bqKeys = itemsQuery.data?.items.map(i => i.id) || [];
  
  const overridesQuery = useQuery({
    queryKey: ['catalog-overrides', organizationId, bqKeys],
    queryFn: async () => {
      if (!organizationId || bqKeys.length === 0) return new Map<string, ProductOverride>();
      
      // Only fetch overrides for current page items
      const { data, error } = await supabase
        .from('product_catalog')
        .select('bq_key, is_active')
        .eq('organization_id', organizationId)
        .in('bq_key', bqKeys);
      
      if (error) throw error;
      
      const map = new Map<string, ProductOverride>();
      data?.forEach(row => {
        if (row.bq_key) {
          map.set(row.bq_key, {
            bq_key: row.bq_key,
            is_active: row.is_active,
          });
        }
      });
      return map;
    },
    enabled: !!organizationId && bqKeys.length > 0,
    staleTime: 30_000,
  });

  // Merge BQ items with Supabase overrides
  const mergedItems = itemsQuery.data?.items
    ? mergeWithOverrides(itemsQuery.data.items, overridesQuery.data || new Map())
    : [];

  return {
    items: mergedItems,
    totalCount: itemsQuery.data?.total || 0,
    isLoading: itemsQuery.isLoading || overridesQuery.isLoading,
    error: itemsQuery.error || overridesQuery.error || null,
  };
}

/**
 * Fetch facets (unique filter values) from BigQuery
 */
export function useCatalogFacets(): { facets: CatalogFacets | null; isLoading: boolean } {
  const { profile } = useAuth();
  const organizationId = profile?.organization_id;

  const query = useQuery({
    queryKey: ['catalog-facets', organizationId],
    queryFn: async () => {
      if (!organizationId) throw new Error('No organization');
      return fetchCatalogFacets({ organization_id: organizationId });
    },
    enabled: !!organizationId,
    staleTime: 5 * 60_000, // 5 minutes - facets change rarely
  });

  return {
    facets: query.data || null,
    isLoading: query.isLoading,
  };
}

/**
 * Toggle product is_active in Supabase overrides
 * 
 * IMPORTANT: We only store overrides, not all 71k products!
 * - If setting is_active=false: upsert the override
 * - If setting is_active=true: delete the override (default is active)
 */
export function useToggleProductActive() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ bqKey, isActive }: { bqKey: string; isActive: boolean }) => {
      if (!profile?.organization_id) throw new Error('No organization');

      if (isActive) {
        // Setting to active = remove override (default is active)
        const { error } = await supabase
          .from('product_catalog')
          .delete()
          .eq('organization_id', profile.organization_id)
          .eq('bq_key', bqKey);
        
        if (error) throw error;
      } else {
        // Setting to inactive = create override with ONLY required fields
        // No sku/base_price_rub_m2 filler - those have defaults in DB
        const { error } = await supabase
          .from('product_catalog')
          .upsert({
            bq_key: bqKey,
            organization_id: profile.organization_id,
            is_active: false,
          }, {
            onConflict: 'organization_id,bq_key',
          });

        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['catalog-overrides'] });
      queryClient.invalidateQueries({ queryKey: ['catalog-stats'] });
    },
    onError: () => {
      toast({
        title: t('common.error'),
        description: t('catalog.toggleError', 'Не удалось изменить статус'),
        variant: 'destructive',
      });
    },
  });
}
