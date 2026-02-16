import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, ChevronDown, FolderOpen, Folder } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CategoryFacet } from '@/lib/catalog-api';

// Known category groups with subcategories derived from cat_name
const CATEGORY_GROUPS: Record<string, { label_ru: string; label_en: string; prefixes: string[] }> = {
  profnastil: { label_ru: 'Профнастил', label_en: 'Profiled sheets', prefixes: ['С-', 'С8', 'С10', 'С20', 'С21', 'С44', 'НС', 'Н-', 'Н57', 'Н60', 'Н75', 'Н114', 'МП-'] },
  metallocherepitsa: { label_ru: 'Металлочерепица', label_en: 'Metal tiles', prefixes: ['Монтеррей', 'Супермонтеррей', 'Каскад', 'Банга', 'Андалузия', 'Кантри', 'Классик'] },
  dobor: { label_ru: 'Доборные элементы', label_en: 'Flashings', prefixes: ['Планка', 'Конёк', 'Ендова', 'Саморез', 'Водосток'] },
  sandwich: { label_ru: 'Сэндвич-панели', label_en: 'Sandwich panels', prefixes: ['Сэндвич', 'ПСБ', 'PIR'] },
};

interface CategoryTreeSidebarProps {
  categories: CategoryFacet[];
  selectedCategory: string | null;
  onSelectCategory: (catName: string | null) => void;
}

interface GroupedCategory {
  groupKey: string;
  label: string;
  children: CategoryFacet[];
  totalCount: number;
}

export function CategoryTreeSidebar({ categories, selectedCategory, onSelectCategory }: CategoryTreeSidebarProps) {
  const { t, i18n } = useTranslation();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['profnastil']));
  const isRu = i18n.language === 'ru';

  // Group categories by known prefixes
  const grouped: GroupedCategory[] = [];
  const ungrouped: CategoryFacet[] = [];
  const assigned = new Set<string>();

  for (const [groupKey, group] of Object.entries(CATEGORY_GROUPS)) {
    const children = categories.filter(c => 
      group.prefixes.some(p => c.cat_name.startsWith(p)) && !assigned.has(c.cat_name)
    );
    children.forEach(c => assigned.add(c.cat_name));
    
    if (children.length > 0) {
      grouped.push({
        groupKey,
        label: isRu ? group.label_ru : group.label_en,
        children: children.sort((a, b) => a.cat_name.localeCompare(b.cat_name)),
        totalCount: children.reduce((s, c) => s + c.cnt, 0),
      });
    }
  }

  // Ungrouped = "Прочее"
  categories.forEach(c => {
    if (!assigned.has(c.cat_name)) ungrouped.push(c);
  });

  const toggleGroup = (key: string) => {
    const next = new Set(expandedGroups);
    next.has(key) ? next.delete(key) : next.add(key);
    setExpandedGroups(next);
  };

  const totalAll = categories.reduce((s, c) => s + c.cnt, 0);

  return (
    <div className="w-full space-y-1">
      {/* All items */}
      <button
        onClick={() => onSelectCategory(null)}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors',
          selectedCategory === null ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted text-foreground'
        )}
      >
        <FolderOpen className="h-4 w-4 flex-shrink-0" />
        <span className="flex-1 text-left">{t('catalog.allProducts', 'Все товары')}</span>
        <span className="text-xs text-muted-foreground">{totalAll.toLocaleString('ru-RU')}</span>
      </button>

      {/* Grouped categories */}
      {grouped.map(group => {
        const isExpanded = expandedGroups.has(group.groupKey);
        const isGroupActive = group.children.some(c => c.cat_name === selectedCategory);

        return (
          <div key={group.groupKey}>
            <button
              onClick={() => toggleGroup(group.groupKey)}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors',
                isGroupActive ? 'bg-primary/5 font-medium' : 'hover:bg-muted'
              )}
            >
              {isExpanded ? <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" />}
              <Folder className="h-4 w-4 flex-shrink-0" />
              <span className="flex-1 text-left">{group.label}</span>
              <span className="text-xs text-muted-foreground">{group.totalCount.toLocaleString('ru-RU')}</span>
            </button>
            
            {isExpanded && (
              <div className="ml-5 border-l pl-2 space-y-0.5">
                {group.children.map(cat => (
                  <button
                    key={cat.cat_name}
                    onClick={() => onSelectCategory(cat.cat_name === selectedCategory ? null : cat.cat_name)}
                    className={cn(
                      'w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded transition-colors',
                      selectedCategory === cat.cat_name ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted text-muted-foreground'
                    )}
                  >
                    <span className="flex-1 text-left truncate">{cat.cat_name}</span>
                    <span className="text-[10px]">{cat.cnt.toLocaleString('ru-RU')}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Ungrouped = Прочее */}
      {ungrouped.length > 0 && (
        <div>
          <button
            onClick={() => toggleGroup('other')}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors"
          >
            {expandedGroups.has('other') ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            <Folder className="h-4 w-4" />
            <span className="flex-1 text-left">{t('catalog.otherCategory', 'Прочее')}</span>
            <span className="text-xs text-muted-foreground">{ungrouped.reduce((s, c) => s + c.cnt, 0).toLocaleString('ru-RU')}</span>
          </button>
          {expandedGroups.has('other') && (
            <div className="ml-5 border-l pl-2 space-y-0.5">
              {ungrouped.map(cat => (
                <button
                  key={cat.cat_name}
                  onClick={() => onSelectCategory(cat.cat_name === selectedCategory ? null : cat.cat_name)}
                  className={cn(
                    'w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded transition-colors',
                    selectedCategory === cat.cat_name ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted text-muted-foreground'
                  )}
                >
                  <span className="flex-1 text-left truncate">{cat.cat_name}</span>
                  <span className="text-[10px]">{cat.cnt.toLocaleString('ru-RU')}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
