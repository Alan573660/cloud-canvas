/**
 * Fixed Normalization Schema Types
 * 
 * ВАЖНО: Схема для профнастила и металлочерепицы ФИКСИРОВАНА.
 * НЕ зависит от поставщика. Единственное различие — organization_id.
 */

// =========================================
// Product Types (only these are normalized)
// =========================================
export type ProductType = 'PROFNASTIL' | 'METALLOCHEREPICA' | 'DOBOR' | 'SANDWICH' | 'OTHER';
export type ProductCategory = 'ALL' | ProductType;

// =========================================
// Fixed Canonical Schema
// =========================================
export interface CanonicalProduct {
  id: string;
  organization_id: string;
  product_type: ProductType;
  
  // Required fields
  profile: string;
  thickness_mm: number;
  coating: string;
  color_or_ral: string;         // e.g., "RAL3005", "Zn"
  work_width_mm: number;
  full_width_mm: number;
  price: number;
  unit: 'm2' | 'sht';
  
  // Color display
  color_system?: string;        // RAL | RR | DECOR | ''
  color_code?: string;          // e.g., "3005", "32"
  zinc_label?: string;          // e.g., "ZN275" — extracted from notes ZINC:... token
  
  // Source data
  title?: string;
  notes?: string;
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
export type AIQuestionType = 'width' | 'profile' | 'category' | 'thickness' | 'coating' | 'color';

export interface AIQuestion {
  type: AIQuestionType;
  cluster_path: ClusterPath;
  token: string;
  examples: string[];
  affected_count: number;
  suggestions: string[];
  confidence: number;
  ask?: string; // human-readable question text from backend
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
