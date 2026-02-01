/**
 * ProductTypeFilter - Левая панель с категориями товаров
 * 
 * Показывает:
 * - Все товары
 * - Профнастил (нормализуемый)
 * - Металлочерепица (нормализуемый)
 * - Доборные элементы (только сортировка)
 * - Сэндвич-панели (только сортировка)
 * - Прочее
 */

import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Layers, Grid3X3, LayoutGrid, Wrench, Box, HelpCircle, Sparkles
} from 'lucide-react';
import type { ProductCategory } from './types';

interface CategoryStats {
  total: number;
  ready: number;
  needsAttention: number;
}

interface ProductTypeFilterProps {
  activeCategory: ProductCategory;
  onCategoryChange: (category: ProductCategory) => void;
  stats: Record<ProductCategory, CategoryStats>;
  loading?: boolean;
}

const CATEGORIES: Array<{
  key: ProductCategory;
  icon: React.ReactNode;
  normalizable: boolean;
}> = [
  { key: 'ALL', icon: <Layers className="h-4 w-4" />, normalizable: false },
  { key: 'PROFNASTIL', icon: <Grid3X3 className="h-4 w-4" />, normalizable: true },
  { key: 'METALLOCHEREPICA', icon: <LayoutGrid className="h-4 w-4" />, normalizable: true },
  { key: 'DOBOR', icon: <Wrench className="h-4 w-4" />, normalizable: false },
  { key: 'SANDWICH', icon: <Box className="h-4 w-4" />, normalizable: false },
  { key: 'OTHER', icon: <HelpCircle className="h-4 w-4" />, normalizable: false },
];

export function ProductTypeFilter({
  activeCategory,
  onCategoryChange,
  stats,
  loading,
}: ProductTypeFilterProps) {
  const { t } = useTranslation();
  
  const getCategoryLabel = (key: ProductCategory): string => {
    const labels: Record<ProductCategory, string> = {
      ALL: t('normalize.allProducts', 'Все товары'),
      PROFNASTIL: t('normalize.profnastil', 'Профнастил'),
      METALLOCHEREPICA: t('normalize.metallocherepica', 'Металлочерепица'),
      DOBOR: t('normalize.dobor', 'Доборные элементы'),
      SANDWICH: t('normalize.sandwich', 'Сэндвич-панели'),
      OTHER: t('normalize.other', 'Прочее'),
    };
    return labels[key];
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b">
        <h3 className="font-semibold text-sm">
          {t('normalize.categories', 'Категории')}
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          {t('normalize.selectCategory', 'Выберите тип товаров')}
        </p>
      </div>

      {/* Categories List */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {CATEGORIES.map(({ key, icon, normalizable }) => {
            const catStats = stats[key] || { total: 0, ready: 0, needsAttention: 0 };
            const isActive = activeCategory === key;
            
            return (
              <button
                key={key}
                onClick={() => onCategoryChange(key)}
                disabled={loading}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all",
                  "hover:bg-accent/50",
                  isActive && "bg-primary/10 border border-primary/30",
                  !isActive && "border border-transparent"
                )}
              >
                {/* Icon */}
                <div className={cn(
                  "p-1.5 rounded",
                  isActive ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                )}>
                  {icon}
                </div>
                
                {/* Label & Stats */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "font-medium text-sm truncate",
                      isActive && "text-primary"
                    )}>
                      {getCategoryLabel(key)}
                    </span>
                    {normalizable && (
                      <Sparkles className="h-3 w-3 text-primary shrink-0" />
                    )}
                  </div>
                  
                  {catStats.total > 0 && (
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-muted-foreground">
                        {catStats.total.toLocaleString()}
                      </span>
                      
                      {normalizable && key !== 'ALL' && (
                        <div className="flex items-center gap-1">
                          {catStats.ready > 0 && (
                            <Badge variant="outline" className="h-4 text-[10px] px-1 bg-green-50 text-green-700 border-green-200">
                              🟢 {catStats.ready}
                            </Badge>
                          )}
                          {catStats.needsAttention > 0 && (
                            <Badge variant="outline" className="h-4 text-[10px] px-1 bg-red-50 text-red-700 border-red-200">
                              🔴 {catStats.needsAttention}
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </ScrollArea>

      {/* Footer Info */}
      <div className="p-3 border-t bg-muted/30">
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <Sparkles className="h-3 w-3 mt-0.5 text-primary shrink-0" />
          <span>
            {t('normalize.normalizableHint', 'Нормализация доступна только для профнастила и металлочерепицы')}
          </span>
        </div>
      </div>
    </div>
  );
}
