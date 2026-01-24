/**
 * BigQuery Catalog API Client
 * 
 * Reads product data from BigQuery via Cloud Run (pricing-api-saas).
 * Supabase product_catalog is used ONLY for overrides (is_active, custom fields).
 */

// Cloud Run API base URL (pricing-api-saas)
const CATALOG_API_BASE = import.meta.env.VITE_CATALOG_API_URL || 'https://pricing-api-saas-XXXXX.run.app';

// ============= Types =============

export interface CatalogItem {
  bq_id: string;           // BigQuery primary key
  sku: string | null;
  title: string | null;
  profile: string | null;
  coating: string | null;
  thickness_mm: number | null;
  width_work_mm: number | null;
  width_full_mm: number | null;
  weight_kg_m2: number | null;
  base_price_rub_m2: number;
  unit: string | null;
  currency: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CatalogItemWithOverrides extends CatalogItem {
  // Required for DataTable compatibility
  id: string;
  // Overrides from Supabase
  is_active: boolean;
  pinned: boolean;
  custom_name: string | null;
  featured: boolean;
  tags: string[] | null;
}

export interface CatalogFacets {
  profiles: string[];
  coatings: string[];
  thicknesses: number[];
}

export interface CatalogItemsRequest {
  organization_id: string;
  page?: number;
  page_size?: number;
  search?: string;
  profile?: string;
  coating?: string;
  thickness_mm?: number;
  is_active?: boolean;
}

export interface CatalogItemsResponse {
  items: CatalogItem[];
  total_count: number;
  page: number;
  page_size: number;
  has_next: boolean;
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
  if (params.page) url.searchParams.set('page', String(params.page));
  if (params.page_size) url.searchParams.set('page_size', String(params.page_size));
  if (params.search) url.searchParams.set('search', params.search);
  if (params.profile) url.searchParams.set('profile', params.profile);
  if (params.coating) url.searchParams.set('coating', params.coating);
  if (params.thickness_mm !== undefined) url.searchParams.set('thickness_mm', String(params.thickness_mm));
  if (params.is_active !== undefined) url.searchParams.set('is_active', String(params.is_active));

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
  bq_id: string;
  is_active: boolean;
  pinned?: boolean;
  custom_name?: string | null;
  featured?: boolean;
  tags?: string[] | null;
}

/**
 * Merge BigQuery items with Supabase overrides
 */
export function mergeWithOverrides(
  items: CatalogItem[],
  overrides: Map<string, ProductOverride>
): CatalogItemWithOverrides[] {
  return items.map(item => {
    const override = overrides.get(item.bq_id);
    return {
      ...item,
      id: item.bq_id, // Required for DataTable
      is_active: override?.is_active ?? true, // Default to active if no override
      pinned: override?.pinned ?? false,
      custom_name: override?.custom_name ?? null,
      featured: override?.featured ?? false,
      tags: override?.tags ?? null,
    };
  });
}
