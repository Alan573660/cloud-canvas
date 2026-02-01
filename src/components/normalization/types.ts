/**
 * Fixed Normalization Schema Types
 * 
 * ВАЖНО: Схема для профнастила и металлочерепицы ФИКСИРОВАНА.
 * НЕ зависит от поставщика. Единственное различие — organization_id.
 */

// =========================================
// Product Types (only these are normalized)
// =========================================
export type ProductType = 'PROFNASTIL' | 'METALLOCHEREPICA';
export type ProductCategory = 'ALL' | ProductType | 'DOBOR' | 'SANDWICH' | 'OTHER';

// =========================================
// Fixed Canonical Schema
// =========================================
export interface CanonicalProduct {
  id: string;
  organization_id: string;
  product_type: ProductType;
  
  // Required fields
  profile: string;              // e.g., "С20", "МП20", "Монтеррей"
  thickness_mm: number;         // e.g., 0.45, 0.5, 0.7
  coating: string;              // e.g., "Полиэстер", "Пластизол", "Оцинковка"
  color_or_ral: string;         // e.g., "RAL3005", "Zn" (for galvanized)
  work_width_mm: number;        // Рабочая ширина (из базы профилей)
  full_width_mm: number;        // Полная ширина (из базы профилей)
  price: number;                // Цена
  unit: 'm2' | 'sht';           // Единица измерения
  
  // Source data
  title?: string;               // Original title from price list
  raw_data?: Record<string, unknown>;
}

// =========================================
// Normalization Status
// =========================================
export type NormalizationStatus = 'ready' | 'needs_attention';

export interface NormalizationValidation {
  status: NormalizationStatus;
  missing_fields: string[];
}

// =========================================
// Cluster Hierarchy
// =========================================
// product_type → profile → thickness_mm → coating → color_or_ral

export interface ClusterNode {
  id: string;
  level: 'product_type' | 'profile' | 'thickness' | 'coating' | 'color';
  value: string;
  display_label: string;
  items_count: number;
  ready_count: number;
  needs_attention_count: number;
  children?: ClusterNode[];
  
  // For AI suggestions
  ai_suggestion?: string;
  ai_confidence?: number;
}

export interface ClusterPath {
  product_type?: ProductType;
  profile?: string;
  thickness_mm?: number;
  coating?: string;
  color_or_ral?: string;
}

// =========================================
// Profile Widths Database (from backend)
// =========================================
export interface ProfileWidths {
  profile: string;
  work_width_mm: number;
  full_width_mm: number;
}

// =========================================
// AI Assistant
// =========================================
export interface AIQuestion {
  type: 'thickness' | 'coating' | 'color';
  cluster_path: ClusterPath;
  token: string;
  examples: string[];
  affected_count: number;
  suggestions: string[];
  confidence: number;
}

export interface AIDecision {
  question_id: string;
  field: 'thickness_mm' | 'coating' | 'color_or_ral';
  value: string | number;
  apply_to_cluster: ClusterPath;
}

// =========================================
// Helper Functions
// =========================================
export function validateProduct(item: Partial<CanonicalProduct>): NormalizationValidation {
  const missing: string[] = [];
  
  if (!item.profile) missing.push('profile');
  if (!item.thickness_mm) missing.push('thickness_mm');
  if (!item.coating) missing.push('coating');
  
  // color_or_ral not required if coating is "Оцинковка"
  const isGalvanized = item.coating?.toLowerCase().includes('оцинк');
  if (!isGalvanized && !item.color_or_ral) {
    missing.push('color_or_ral');
  }
  
  if (!item.work_width_mm) missing.push('work_width_mm');
  if (!item.full_width_mm) missing.push('full_width_mm');
  if (!item.price && item.price !== 0) missing.push('price');
  
  return {
    status: missing.length === 0 ? 'ready' : 'needs_attention',
    missing_fields: missing,
  };
}

export function isProductNormalizable(productType: string | undefined): productType is ProductType {
  return productType === 'PROFNASTIL' || productType === 'METALLOCHEREPICA';
}

export function getStatusIcon(status: NormalizationStatus): string {
  return status === 'ready' ? '🟢' : '🔴';
}

export function getStatusLabel(status: NormalizationStatus, t: (key: string) => string): string {
  return status === 'ready' 
    ? t('normalize.statusReady')
    : t('normalize.statusNeedsAttention');
}
