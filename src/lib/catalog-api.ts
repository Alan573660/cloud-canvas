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
  cat_name: string | null; // Category name (profile equivalent)
  cat_tree: string | null; // Full category path
  unit: string | null;
  cur: string | null;      // Currency
  price_rub_m2: number;    // Base price
}

/** Item with Supabase overrides merged */
export interface CatalogItemWithOverrides extends CatalogItem {
  // Overrides from Supabase
  is_active: boolean;
  pinned: boolean;
  custom_name: string | null;
  featured: boolean;
  tags: string[] | null;
}

export interface CatalogFacets {
  units: string[];
  cat_names: string[];
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

  return response.json();
}

// ============= Supabase Overrides =============

export interface ProductOverride {
  bq_key: string;          // Matches item.id from BQ
  is_active: boolean;
  pinned?: boolean;
  custom_name?: string | null;
  featured?: boolean;
  tags?: string[] | null;
}

/**
 * Merge BigQuery items with Supabase overrides
 * Overrides are matched by product_catalog.bq_key == item.id
 */
export function mergeWithOverrides(
  items: CatalogItem[],
  overrides: Map<string, ProductOverride>
): CatalogItemWithOverrides[] {
  return items.map(item => {
    const override = overrides.get(item.id); // Match by item.id (bq_key)
    return {
      ...item,
      is_active: override?.is_active ?? true, // Default to active if no override
      pinned: override?.pinned ?? false,
      custom_name: override?.custom_name ?? null,
      featured: override?.featured ?? false,
      tags: override?.tags ?? null,
    };
  });
}
