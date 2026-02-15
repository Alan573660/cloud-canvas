/**
 * Normalization Components Index
 * 
 * v2: Fixed Schema for Profnastil & Metallocherepica
 */

// New v2 components (Fixed Schema)
export { NormalizationWizard } from './NormalizationWizard';
export { QualityGates } from './QualityGates';
export { ProductTypeFilter } from './ProductTypeFilter';
export { ClusterTree } from './ClusterTree';
export { ClusterDetailPanel } from './ClusterDetailPanel';
export * from './types';

// Legacy components (deprecated, kept for backward compatibility)
export { NormalizationDialog } from './NormalizationDialog';
export { GroupsSidebar, type PatternGroup } from './GroupsSidebar';
export { CatalogTable, type NormalizationItem } from './CatalogTable';
export { AIChatPanel } from './AIChatPanel';
export { CategoryTabs, categorizeItem, CATEGORIES } from './CategoryTabs';
