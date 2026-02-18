/**
 * Catalog API Client
 * 
 * All requests go through Supabase Edge Function `catalog-proxy`.
 * Direct browser access to pricing-api-saas is prohibited.
 */

import { supabase } from '@/integrations/supabase/client';

// ============= Types =============

/** Raw item from Catalog API */
export interface CatalogItem {
  id: string;              // Primary key (bq_key)
  title: string | null;
  cat_name: string | null; // Category name
  cat_tree: string | null; // Full category path
  unit: string | null;
  cur: string | null;      // Currency
  price_rub_m2: number;    // Base price
  updated_at?: string;
}

/** Item with Supabase overrides merged */
export interface CatalogItemWithOverrides extends CatalogItem {
  is_active: boolean;
}

/** Facet item with count */
export interface UnitFacet {
  unit: string;
  cnt: number;
}

export interface CategoryFacet {
  cat_name: string;
  cnt: number;
}

/** Facets response from API */
export interface CatalogFacetsResponse {
  ok: boolean;
  organization_id: string;
  units: UnitFacet[];
  categories: CategoryFacet[];
  price_min: number;
  price_max: number;
  total: number;
}

/** Parsed facets for UI - preserving cnt for display */
export interface CatalogFacets {
  units: UnitFacet[];
  categories: CategoryFacet[];
  priceMin: number;
  priceMax: number;
  total: number;
}

export interface CatalogItemsRequest {
  organization_id: string;
  limit?: number;
  offset?: number;
  q?: string;              // Search query
  unit?: string;
  cat_name?: string;
  sort?: string;
}

export interface CatalogItemsResponse {
  ok: boolean;
  items: CatalogItem[];
  total: number;
}

export interface CatalogFacetsRequest {
  organization_id: string;
}

// ============= API Functions =============

/**
 * Fetch catalog items via catalog-proxy Edge Function
 */
export async function fetchCatalogItems(
  params: CatalogItemsRequest
): Promise<CatalogItemsResponse> {
  const { organization_id, ...rest } = params;

  const proxyParams: Record<string, string | number> = {};
  if (rest.limit) proxyParams.limit = rest.limit;
  if (rest.offset !== undefined) proxyParams.offset = rest.offset;
  if (rest.q) proxyParams.q = rest.q;
  if (rest.unit) proxyParams.unit = rest.unit;
  if (rest.cat_name) proxyParams.cat_name = rest.cat_name;
  if (rest.sort) proxyParams.sort = rest.sort;

  const { data, error } = await supabase.functions.invoke('catalog-proxy', {
    body: {
      endpoint: '/api/catalog/items',
      organization_id,
      params: proxyParams,
    },
  });

  if (error) throw new Error(`Catalog proxy error: ${error.message}`);

  const result = data as CatalogItemsResponse & { ok?: boolean; error?: string };
  if (result?.ok === false) {
    throw new Error(result.error || 'Catalog proxy returned error');
  }

  return result;
}

/**
 * Fetch unique filter values (facets) via catalog-proxy Edge Function
 */
export async function fetchCatalogFacets(
  params: CatalogFacetsRequest
): Promise<CatalogFacets> {
  const { data, error } = await supabase.functions.invoke('catalog-proxy', {
    body: {
      endpoint: '/api/catalog/facets',
      organization_id: params.organization_id,
      params: {},
    },
  });

  if (error) throw new Error(`Catalog facets proxy error: ${error.message}`);

  const result = data as CatalogFacetsResponse & { error?: string };
  if (result?.ok === false) {
    throw new Error((result as { error?: string }).error || 'Facets proxy returned error');
  }

  // Return facets with cnt preserved for UI display
  return {
    units: (result.units || []).filter(u => u.unit),
    categories: (result.categories || []).filter(c => c.cat_name),
    priceMin: result.price_min,
    priceMax: result.price_max,
    total: result.total,
  };
}

// ============= Supabase Overrides =============

export interface ProductOverride {
  bq_key: string;          // Matches item.id from BQ
  is_active: boolean;
}

/**
 * Merge Catalog items with Supabase overrides
 * 
 * IMPORTANT: Default is_active = true for all items.
 * Supabase only stores overrides (is_active=false).
 * If no override exists, item is considered active.
 */
export function mergeWithOverrides(
  items: CatalogItem[],
  overrides: Map<string, ProductOverride>
): CatalogItemWithOverrides[] {
  return items.map(item => {
    const override = overrides.get(item.id);
    return {
      ...item,
      // Default to active if no override exists
      is_active: override?.is_active ?? true,
    };
  });
}
