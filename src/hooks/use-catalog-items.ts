/**
 * React Query hook for BigQuery Catalog API with Supabase overrides
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
  search?: string;
  page?: number;
  pageSize?: number;
  profile?: string;
  coating?: string;
  thickness?: number;
  isActive?: boolean;
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

  // Fetch items from BigQuery
  const itemsQuery = useQuery({
    queryKey: ['catalog-items', organizationId, params],
    queryFn: async () => {
      if (!organizationId) throw new Error('No organization');
      
      const request: CatalogItemsRequest = {
        organization_id: organizationId,
        page: params.page || 1,
        page_size: params.pageSize || 15,
        search: params.search || undefined,
        profile: params.profile || undefined,
        coating: params.coating || undefined,
        thickness_mm: params.thickness,
        is_active: params.isActive,
      };

      return fetchCatalogItems(request);
    },
    enabled: !!organizationId,
    staleTime: 30_000, // 30 seconds
  });

  // Fetch overrides from Supabase for current page items
  const bqIds = itemsQuery.data?.items.map(i => i.bq_id) || [];
  
  const overridesQuery = useQuery({
    queryKey: ['catalog-overrides', organizationId, bqIds],
    queryFn: async () => {
      if (!organizationId || bqIds.length === 0) return new Map<string, ProductOverride>();
      
      const { data, error } = await supabase
        .from('product_catalog')
        .select('bq_key, is_active')
        .eq('organization_id', organizationId)
        .in('bq_key', bqIds);
      
      if (error) throw error;
      
      const map = new Map<string, ProductOverride>();
      data?.forEach(row => {
        if (row.bq_key) {
          map.set(row.bq_key, {
            bq_id: row.bq_key,
            is_active: row.is_active,
          });
        }
      });
      return map;
    },
    enabled: !!organizationId && bqIds.length > 0,
    staleTime: 30_000,
  });

  // Merge BQ items with Supabase overrides
  const mergedItems = itemsQuery.data?.items
    ? mergeWithOverrides(itemsQuery.data.items, overridesQuery.data || new Map())
    : [];

  return {
    items: mergedItems,
    totalCount: itemsQuery.data?.total_count || 0,
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
 */
export function useToggleProductActive() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ bqId, isActive }: { bqId: string; isActive: boolean }) => {
      if (!profile?.organization_id) throw new Error('No organization');

      // Upsert override in Supabase
      const { error } = await supabase
        .from('product_catalog')
        .upsert({
          bq_key: bqId,
          organization_id: profile.organization_id,
          is_active: isActive,
          // Minimal required fields for upsert
          sku: bqId, // Use bq_id as sku placeholder
          base_price_rub_m2: 0, // Will be read from BQ anyway
        }, {
          onConflict: 'organization_id,bq_key',
        });

      if (error) throw error;
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
