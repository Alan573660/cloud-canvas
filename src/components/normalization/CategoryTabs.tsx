/**
 * CategoryTabs - Вкладки категорий для нормализации
 * 
 * Категории: Профнастил, Металлочерепица, Сэндвич-панели, Планки/Доборы, Прочее
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { 
  LayoutGrid, Layers, Square, Minus, Package, Grid3X3
} from 'lucide-react';

// =========================================
// Types
// =========================================
export type ProductCategory = 
  | 'ALL' 
  | 'PROFNASTIL' 
  | 'METALLOCHEREPICA' 
  | 'SANDWICH' 
  | 'DOBOR' 
  | 'OTHER';

interface CategoryTabsProps {
  items: Array<{ profile?: string; title?: string; sheet_kind?: string }>;
  activeCategory: ProductCategory;
  onCategoryChange: (category: ProductCategory) => void;
}

interface CategoryDef {
  key: ProductCategory;
  labelKey: string;
  defaultLabel: string;
  icon: typeof LayoutGrid;
  patterns: RegExp[];
}

// =========================================
// Category Definitions
// =========================================
const CATEGORIES: CategoryDef[] = [
  {
    key: 'ALL',
    labelKey: 'normalize.catAll',
    defaultLabel: 'Все товары',
    icon: Grid3X3,
    patterns: [],
  },
  {
    key: 'PROFNASTIL',
    labelKey: 'normalize.catProfnastil',
    defaultLabel: 'Профнастил',
    icon: LayoutGrid,
    patterns: [
      /^(С|C|Н|H|НС|HC|МП|MP)-?\d/i,
      /профнастил/i,
      /профлист/i,
    ],
  },
  {
    key: 'METALLOCHEREPICA',
    labelKey: 'normalize.catMetallocherepica',
    defaultLabel: 'Металлочерепица',
    icon: Layers,
    patterns: [
      /металлочерепица/i,
      /monterrey/i,
      /монтеррей/i,
      /каскад/i,
      /квинта/i,
      /банга/i,
      /^МЧ-?\d/i,
    ],
  },
  {
    key: 'SANDWICH',
    labelKey: 'normalize.catSandwich',
    defaultLabel: 'Сэндвич-панели',
    icon: Square,
    patterns: [
      /сэндвич/i,
      /sandwich/i,
      /панель.*стеновая/i,
      /панель.*кровельная/i,
    ],
  },
  {
    key: 'DOBOR',
    labelKey: 'normalize.catDobor',
    defaultLabel: 'Планки/Доборы',
    icon: Minus,
    patterns: [
      /планка/i,
      /добор/i,
      /конек/i,
      /карниз/i,
      /ендова/i,
      /отлив/i,
      /примыкан/i,
      /оклад/i,
      /водосток/i,
      /желоб/i,
      /труба/i,
      /воронка/i,
    ],
  },
  {
    key: 'OTHER',
    labelKey: 'normalize.catOther',
    defaultLabel: 'Прочее',
    icon: Package,
    patterns: [],
  },
];

// =========================================
// Helper: Categorize item
// =========================================
export function categorizeItem(item: { profile?: string; title?: string; sheet_kind?: string }): ProductCategory {
  const text = `${item.profile || ''} ${item.title || ''} ${item.sheet_kind || ''}`.toLowerCase();
  
  for (const cat of CATEGORIES.slice(1, -1)) { // Skip ALL and OTHER
    for (const pattern of cat.patterns) {
      if (pattern.test(text)) {
        return cat.key;
      }
    }
  }
  
  return 'OTHER';
}

// =========================================
// Main Component
// =========================================
export function CategoryTabs({
  items,
  activeCategory,
  onCategoryChange,
}: CategoryTabsProps) {
  const { t } = useTranslation();

  // Count items per category
  const categoryCounts = useMemo(() => {
    const counts: Record<ProductCategory, number> = {
      ALL: items.length,
      PROFNASTIL: 0,
      METALLOCHEREPICA: 0,
      SANDWICH: 0,
      DOBOR: 0,
      OTHER: 0,
    };

    items.forEach(item => {
      const cat = categorizeItem(item);
      counts[cat]++;
    });

    return counts;
  }, [items]);

  return (
    <div className="flex items-center gap-1 px-3 py-2 border-b bg-muted/30 overflow-x-auto">
      {CATEGORIES.map(cat => {
        const Icon = cat.icon;
        const count = categoryCounts[cat.key];
        const isActive = activeCategory === cat.key;
        
        // Skip categories with 0 items (except ALL and OTHER)
        if (count === 0 && cat.key !== 'ALL' && cat.key !== 'OTHER') {
          return null;
        }

        return (
          <button
            key={cat.key}
            onClick={() => onCategoryChange(cat.key)}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap",
              isActive 
                ? "bg-primary text-primary-foreground" 
                : "hover:bg-muted text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4" />
            <span>{t(cat.labelKey, cat.defaultLabel)}</span>
            <Badge 
              variant={isActive ? "secondary" : "outline"} 
              className={cn(
                "h-5 text-xs",
                isActive && "bg-primary-foreground/20 text-primary-foreground"
              )}
            >
              {count.toLocaleString()}
            </Badge>
          </button>
        );
      })}
    </div>
  );
}

export { CATEGORIES };
