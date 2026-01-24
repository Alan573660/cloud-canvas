/**
 * BigQuery Catalog API Client
 * 
 * Reads product data from BigQuery via Cloud Run (pricing-api-saas).
 * Supabase product_catalog is used ONLY for overrides (is_active, custom fields).
 */

// Cloud Run API base URL (pricing-api-saas)
const CATALOG_API_BASE = import.meta.env.VITE_CATALOG_API_URL || 'https://pricing-api-saas-37830921583.us-central1.run.app';

// ============= Types =============

/** Raw item from BigQuery API */
export interface CatalogItem {
  id: string;              // BigQuery primary key (bq_key)
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
 * Fetch catalog items from BigQuery via Cloud Run API
 */
export async function fetchCatalogItems(
  params: CatalogItemsRequest
): Promise<CatalogItemsResponse> {
  const url = new URL(`${CATALOG_API_BASE}/api/catalog/items`);
  
  url.searchParams.set('organization_id', params.organization_id);
  if (params.limit) url.searchParams.set('limit', String(params.limit));
  if (params.offset !== undefined) url.searchParams.set('offset', String(params.offset));
  if (params.q) url.searchParams.set('q', params.q);
  if (params.unit) url.searchParams.set('unit', params.unit);
  if (params.cat_name) url.searchParams.set('cat_name', params.cat_name);
  if (params.sort) url.searchParams.set('sort', params.sort);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Catalog API error: ${response.status} - ${error}`);
  }

  return response.json();
}

/**
 * Fetch unique filter values (facets) from BigQuery
 */
export async function fetchCatalogFacets(
  params: CatalogFacetsRequest
): Promise<CatalogFacets> {
  const url = new URL(`${CATALOG_API_BASE}/api/catalog/facets`);
  url.searchParams.set('organization_id', params.organization_id);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Catalog Facets API error: ${response.status} - ${error}`);
  }

  const data: CatalogFacetsResponse = await response.json();
  
  // Return facets with cnt preserved for UI display
  return {
    units: data.units.filter(u => u.unit),
    categories: data.categories.filter(c => c.cat_name),
    priceMin: data.price_min,
    priceMax: data.price_max,
    total: data.total,
  };
}

// ============= Supabase Overrides =============

export interface ProductOverride {
  bq_key: string;          // Matches item.id from BQ
  is_active: boolean;
}

/**
 * Merge BigQuery items with Supabase overrides
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
