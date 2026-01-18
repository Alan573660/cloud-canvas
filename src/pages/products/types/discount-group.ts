// Types for discount grouping logic

export interface DiscountRule {
  id: string;
  rule_name: string;
  applies_to: string;
  discount_type: string;
  discount_value: number;
  min_qty: number;
  max_qty: number | null;
  is_active: boolean;
  product_id: string | null;
  category_code: string | null;
  created_at: string;
  organization_id: string;
}

export interface ProductInfo {
  id: string;
  title: string | null;
  sku: string | null;
  profile: string | null;
  thickness_mm: number | null;
  coating: string | null;
  bq_key: string | null;
}

export interface DiscountStep {
  id: string;
  min_qty: number;
  max_qty: number | null;
  discount_value: number;
}

export interface DiscountGroup {
  id: string; // Generated unique ID for the group
  base_rule_name: string;
  applies_to: 'ALL' | 'CATEGORY' | 'PRODUCT';
  discount_type: 'PERCENT' | 'FIXED';
  category_code: string | null;
  product_ids: string[];
  products: ProductInfo[];
  steps: DiscountStep[];
  is_active: boolean | 'partial'; // true if all active, false if all inactive, 'partial' if mixed
  rules: DiscountRule[]; // All raw rules in this group
  min_qty_range: number; // Minimum min_qty across all steps
  max_qty_range: number | null; // Maximum max_qty across all steps (null = unlimited)
  created_at: string;
}

// Extract base rule name by removing "(ступень N)" suffix
export function extractBaseRuleName(ruleName: string): string {
  return ruleName.replace(/\s*\(ступень\s*\d+\)\s*$/i, '').trim();
}

// Group discount rules into logical bundles
export function groupDiscountRules(rules: DiscountRule[], products: ProductInfo[]): DiscountGroup[] {
  const productMap = new Map(products.map(p => [p.id, p]));
  
  // Group by: base_rule_name + applies_to + discount_type + category_code
  const groupMap = new Map<string, DiscountRule[]>();
  
  for (const rule of rules) {
    const baseName = extractBaseRuleName(rule.rule_name);
    const key = `${baseName}|${rule.applies_to}|${rule.discount_type}|${rule.category_code || ''}`;
    
    if (!groupMap.has(key)) {
      groupMap.set(key, []);
    }
    groupMap.get(key)!.push(rule);
  }
  
  // Convert to DiscountGroup objects
  const groups: DiscountGroup[] = [];
  
  for (const [_, groupRules] of groupMap) {
    if (groupRules.length === 0) continue;
    
    const firstRule = groupRules[0];
    const baseName = extractBaseRuleName(firstRule.rule_name);
    
    // Collect unique product IDs
    const productIds = [...new Set(groupRules.map(r => r.product_id).filter(Boolean))] as string[];
    
    // Get product info
    const groupProducts = productIds.map(id => productMap.get(id)).filter(Boolean) as ProductInfo[];
    
    // Collect unique steps (by min_qty, max_qty, discount_value)
    const stepsMap = new Map<string, DiscountStep>();
    for (const rule of groupRules) {
      const stepKey = `${rule.min_qty}|${rule.max_qty}|${rule.discount_value}`;
      if (!stepsMap.has(stepKey)) {
        stepsMap.set(stepKey, {
          id: rule.id,
          min_qty: rule.min_qty,
          max_qty: rule.max_qty,
          discount_value: rule.discount_value,
        });
      }
    }
    
    // Sort steps by min_qty
    const steps = Array.from(stepsMap.values()).sort((a, b) => a.min_qty - b.min_qty);
    
    // Determine active status
    const activeCount = groupRules.filter(r => r.is_active).length;
    let isActive: boolean | 'partial' = false;
    if (activeCount === groupRules.length) {
      isActive = true;
    } else if (activeCount > 0) {
      isActive = 'partial';
    }
    
    // Calculate min/max range across all steps
    const minQtyRange = Math.min(...steps.map(s => s.min_qty));
    const maxQtyValues = steps.map(s => s.max_qty);
    const maxQtyRange = maxQtyValues.includes(null) ? null : Math.max(...(maxQtyValues as number[]));
    
    groups.push({
      id: firstRule.id, // Use first rule's ID as group ID
      base_rule_name: baseName,
      applies_to: firstRule.applies_to as 'ALL' | 'CATEGORY' | 'PRODUCT',
      discount_type: firstRule.discount_type as 'PERCENT' | 'FIXED',
      category_code: firstRule.category_code,
      product_ids: productIds,
      products: groupProducts,
      steps,
      is_active: isActive,
      rules: groupRules,
      min_qty_range: minQtyRange,
      max_qty_range: maxQtyRange,
      created_at: firstRule.created_at,
    });
  }
  
  // Sort by created_at descending
  return groups.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}
