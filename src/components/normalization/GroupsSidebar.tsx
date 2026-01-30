/**
 * GroupsSidebar - Левая панель с группами паттернов
 * 
 * Группы: WIDTH, COLOR, COATING, DECOR
 * Каждая группа показывает: ключ, affected_count, suggested, примеры
 */

import { useTranslation } from 'react-i18next';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  Settings2, Palette, Paintbrush, TreeDeciduous, Check, Sparkles
} from 'lucide-react';

// =========================================
// Types
// =========================================
export interface PatternGroup {
  group_type: 'WIDTH' | 'COLOR' | 'COATING' | 'DECOR' | 'THICKNESS';
  group_key: string;
  affected_count: number;
  examples: string[];
  suggested?: string;
  current_confirmed: boolean;
  question: Record<string, unknown>;
}

interface GroupsSidebarProps {
  groups: PatternGroup[];
  activeGroup: PatternGroup | null;
  onSelectGroup: (group: PatternGroup) => void;
  loading?: boolean;
}

// =========================================
// Helper Components
// =========================================
function GroupIcon({ type }: { type: PatternGroup['group_type'] }) {
  switch (type) {
    case 'WIDTH':
      return <Settings2 className="h-4 w-4" />;
    case 'COLOR':
      return <Palette className="h-4 w-4" />;
    case 'COATING':
      return <Paintbrush className="h-4 w-4" />;
    case 'DECOR':
      return <TreeDeciduous className="h-4 w-4" />;
    default:
      return <Settings2 className="h-4 w-4" />;
  }
}

function GroupTypeLabel({ type }: { type: PatternGroup['group_type'] }) {
  const { t } = useTranslation();
  const labels: Record<string, string> = {
    WIDTH: t('normalize.widths', 'Ширины'),
    COLOR: t('normalize.colors', 'Цвета'),
    COATING: t('normalize.coatings', 'Покрытия'),
    DECOR: t('normalize.decors', 'Декоры'),
    THICKNESS: t('normalize.thickness', 'Толщина'),
  };
  return <>{labels[type] || type}</>;
}

function GroupCard({
  group,
  isActive,
  onClick,
}: {
  group: PatternGroup;
  isActive: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left p-3 rounded-lg border transition-all",
        "hover:bg-accent/50",
        isActive && "border-primary bg-primary/5",
        group.current_confirmed && "border-green-500/50 bg-green-50/50 dark:bg-green-900/10"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={cn(
            "p-1.5 rounded",
            isActive ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
          )}>
            <GroupIcon type={group.group_type} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-sm truncate">{group.group_key}</p>
            <p className="text-xs text-muted-foreground">
              {group.affected_count} {t('normalize.items', 'товаров')}
            </p>
          </div>
        </div>
        
        {group.current_confirmed ? (
          <Badge variant="outline" className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 shrink-0">
            <Check className="h-3 w-3 mr-1" />
            {t('normalize.confirmed', 'ОК')}
          </Badge>
        ) : group.suggested ? (
          <Badge variant="secondary" className="bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400 shrink-0">
            <Sparkles className="h-3 w-3 mr-1" />
            AI
          </Badge>
        ) : null}
      </div>

      {/* Suggested value */}
      {group.suggested && !group.current_confirmed && (
        <div className="mt-2 text-xs">
          <span className="text-muted-foreground">{t('normalize.suggested', 'Предложение')}:</span>
          <span className="ml-1 font-mono bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 px-1 rounded">
            {group.suggested}
          </span>
        </div>
      )}

      {/* Examples */}
      {group.examples.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {group.examples.slice(0, 2).map((ex, i) => (
            <span
              key={i}
              className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded truncate max-w-[120px]"
              title={ex}
            >
              {ex}
            </span>
          ))}
          {group.examples.length > 2 && (
            <span className="text-xs text-muted-foreground">
              +{group.examples.length - 2}
            </span>
          )}
        </div>
      )}
    </button>
  );
}

// =========================================
// Main Component
// =========================================
export function GroupsSidebar({
  groups,
  activeGroup,
  onSelectGroup,
  loading,
}: GroupsSidebarProps) {
  const { t } = useTranslation();

  // Group by type
  const groupsByType = groups.reduce((acc, group) => {
    if (!acc[group.group_type]) {
      acc[group.group_type] = [];
    }
    acc[group.group_type].push(group);
    return acc;
  }, {} as Record<string, PatternGroup[]>);

  const typeOrder: PatternGroup['group_type'][] = ['WIDTH', 'COLOR', 'COATING', 'DECOR', 'THICKNESS'];

  if (loading) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        <Settings2 className="h-10 w-10 mx-auto mb-3 opacity-50" />
        <p className="text-sm">{t('normalize.noGroups', 'Нет групп для нормализации')}</p>
        <p className="text-xs mt-1">{t('normalize.allDataNormalized', 'Все данные уже нормализованы')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b">
        <h3 className="font-semibold text-sm">
          {t('normalize.groups', 'Группы для исправления')}
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          {groups.length} {t('normalize.patterns', 'паттернов')}
        </p>
      </div>

      {/* Groups List */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-4">
          {typeOrder.map(type => {
            const typeGroups = groupsByType[type];
            if (!typeGroups?.length) return null;

            return (
              <div key={type}>
                <div className="flex items-center gap-2 mb-2 px-1">
                  <GroupIcon type={type} />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    <GroupTypeLabel type={type} />
                  </span>
                  <Badge variant="secondary" className="text-xs h-5">
                    {typeGroups.length}
                  </Badge>
                </div>
                <div className="space-y-2">
                  {typeGroups.map(group => (
                    <GroupCard
                      key={`${group.group_type}-${group.group_key}`}
                      group={group}
                      isActive={activeGroup?.group_key === group.group_key && activeGroup?.group_type === group.group_type}
                      onClick={() => onSelectGroup(group)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* Footer Stats */}
      <div className="p-3 border-t bg-muted/30">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{t('normalize.totalAffected', 'Затронуто товаров')}:</span>
          <span className="font-medium">
            {groups.reduce((sum, g) => sum + g.affected_count, 0)}
          </span>
        </div>
      </div>
    </div>
  );
}
