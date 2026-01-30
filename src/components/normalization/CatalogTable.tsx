/**
 * CatalogTable - Таблица товаров для нормализации
 * 
 * Показывает реальные строки из Catalog API
 * Подсветка: желтый = пустое поле, зеленый = AI предложение
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { type CatalogItem } from '@/lib/catalog-api';
import { type PatternGroup } from './GroupsSidebar';
import {
  Search, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  Check, X, Edit2, AlertTriangle, Sparkles, ChevronDown
} from 'lucide-react';

// =========================================
// Types
// =========================================
interface CatalogTableProps {
  items: Array<CatalogItem & {
    profile?: string;
    thickness_mm?: number;
    width_work_mm?: number;
    width_full_mm?: number;
    coating?: string;
    notes?: string;
  }>;
  loading: boolean;
  activeGroup: PatternGroup | null;
  onApplyToGroup: (group: PatternGroup, value: unknown) => void;
  totalCount: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

// =========================================
// Helper: Cell with highlighting
// =========================================
function HighlightedCell({
  value,
  isEmpty,
  hasSuggestion,
  suggestion,
}: {
  value: string | number | null | undefined;
  isEmpty?: boolean;
  hasSuggestion?: boolean;
  suggestion?: string;
}) {
  const displayValue = value ?? '';
  
  if (hasSuggestion && suggestion) {
    return (
      <div className="flex items-center gap-1">
        <span className="text-muted-foreground line-through text-xs">{displayValue || '—'}</span>
        <span className="text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30 px-1 rounded font-mono text-xs">
          {suggestion}
        </span>
        <Badge variant="secondary" className="h-4 text-[10px] bg-green-100 text-green-700">
          <Sparkles className="h-2.5 w-2.5 mr-0.5" />
          AI
        </Badge>
      </div>
    );
  }
  
  if (isEmpty || !displayValue) {
    return (
      <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
        <AlertTriangle className="h-3 w-3" />
        <span className="text-xs italic">пусто</span>
      </span>
    );
  }
  
  return <span className="text-sm">{displayValue}</span>;
}

// =========================================
// Action Bar for Active Group
// =========================================
function GroupActionBar({
  group,
  onApply,
}: {
  group: PatternGroup;
  onApply: (value: unknown) => void;
}) {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState('');
  const [workMm, setWorkMm] = useState('');
  const [fullMm, setFullMm] = useState('');

  const handleApplySuggested = () => {
    if (group.group_type === 'WIDTH' && group.question) {
      const suggested = (group.question as { suggested?: { work_mm: number; full_mm: number } }).suggested;
      if (suggested) {
        onApply(suggested);
      }
    } else if (group.suggested) {
      onApply(group.suggested);
    }
  };

  const handleApplyCustom = () => {
    if (group.group_type === 'WIDTH') {
      if (workMm && fullMm) {
        onApply({ work_mm: parseInt(workMm), full_mm: parseInt(fullMm) });
      }
    } else {
      if (inputValue) {
        onApply(inputValue);
      }
    }
  };

  return (
    <div className="flex items-center gap-3 p-3 bg-primary/5 border-b">
      <div className="flex-1">
        <p className="text-sm font-medium">
          {t('normalize.editing', 'Редактирование')}: <span className="text-primary">{group.group_key}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          {t('normalize.affectsItems', 'Затрагивает {{count}} товаров', { count: group.affected_count })}
        </p>
      </div>

      {/* Quick apply suggested */}
      {group.suggested && !group.current_confirmed && (
        <Button size="sm" variant="default" onClick={handleApplySuggested}>
          <Sparkles className="h-3 w-3 mr-1" />
          {t('normalize.applySuggested', 'Применить')} "{group.suggested}"
        </Button>
      )}

      {/* Custom input based on group type */}
      {group.group_type === 'WIDTH' ? (
        <div className="flex items-center gap-2">
          <Input
            placeholder={t('normalize.workMm', 'Рабочая')}
            className="w-20 h-8 text-xs"
            type="number"
            value={workMm}
            onChange={(e) => setWorkMm(e.target.value)}
          />
          <span className="text-muted-foreground">/</span>
          <Input
            placeholder={t('normalize.fullMm', 'Полная')}
            className="w-20 h-8 text-xs"
            type="number"
            value={fullMm}
            onChange={(e) => setFullMm(e.target.value)}
          />
          <Button size="sm" variant="outline" onClick={handleApplyCustom} disabled={!workMm || !fullMm}>
            <Check className="h-3 w-3 mr-1" />
            {t('normalize.apply', 'Применить')}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Input
            placeholder={group.group_type === 'COLOR' ? 'RAL####' : t('normalize.value', 'Значение')}
            className="w-32 h-8 text-xs"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
          />
          <Button size="sm" variant="outline" onClick={handleApplyCustom} disabled={!inputValue}>
            <Check className="h-3 w-3 mr-1" />
            {t('normalize.apply', 'Применить')}
          </Button>
        </div>
      )}

      {/* Skip */}
      <Button size="sm" variant="ghost">
        <X className="h-3 w-3 mr-1" />
        {t('normalize.skip', 'Пропустить')}
      </Button>
    </div>
  );
}

// =========================================
// Main Component
// =========================================
export function CatalogTable({
  items,
  loading,
  activeGroup,
  onApplyToGroup,
  totalCount,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  searchQuery,
  onSearchChange,
}: CatalogTableProps) {
  const { t } = useTranslation();
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());

  const totalPages = Math.ceil(totalCount / pageSize);

  const toggleNotes = (id: string) => {
    setExpandedNotes(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Action Bar for Active Group */}
      {activeGroup && (
        <GroupActionBar
          group={activeGroup}
          onApply={(value) => onApplyToGroup(activeGroup, value)}
        />
      )}

      {/* Search & Filters Bar */}
      <div className="flex items-center gap-3 p-3 border-b">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('normalize.searchItems', 'Поиск по ID или названию...')}
            className="pl-9 h-9"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>

        <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
          <SelectTrigger className="w-20 h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="50">50</SelectItem>
            <SelectItem value="200">200</SelectItem>
            <SelectItem value="500">500</SelectItem>
          </SelectContent>
        </Select>

        <div className="text-sm text-muted-foreground">
          {t('normalize.total', 'Всего')}: {totalCount.toLocaleString()}
        </div>
      </div>

      {/* Table */}
      <ScrollArea className="flex-1">
        <Table>
          <TableHeader className="sticky top-0 bg-background z-10">
            <TableRow>
              <TableHead className="w-[120px]">ID</TableHead>
              <TableHead className="min-w-[200px]">{t('products.title', 'Название')}</TableHead>
              <TableHead className="w-[80px]">{t('products.profile', 'Профиль')}</TableHead>
              <TableHead className="w-[80px]">{t('products.thickness', 'Толщина')}</TableHead>
              <TableHead className="w-[100px]">{t('products.widthWork', 'Раб. ширина')}</TableHead>
              <TableHead className="w-[100px]">{t('products.widthFull', 'Полн. ширина')}</TableHead>
              <TableHead className="w-[100px]">{t('products.coating', 'Покрытие')}</TableHead>
              <TableHead className="w-[60px]">{t('products.unit', 'Ед.')}</TableHead>
              <TableHead className="w-[40px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 10 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 9 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="h-32 text-center text-muted-foreground">
                  {t('common.noData', 'Нет данных')}
                </TableCell>
              </TableRow>
            ) : (
              items.map(item => {
                const itemData = item as CatalogItem & {
                  profile?: string;
                  thickness_mm?: number;
                  width_work_mm?: number;
                  width_full_mm?: number;
                  coating?: string;
                  notes?: string;
                };
                
                return (
                  <Collapsible key={item.id} asChild>
                    <>
                      <TableRow className="group">
                        <TableCell className="font-mono text-xs">{item.id}</TableCell>
                        <TableCell className="max-w-[200px]">
                          <span className="truncate block text-sm" title={item.title || ''}>
                            {item.title || '—'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <HighlightedCell
                            value={itemData.profile}
                            isEmpty={!itemData.profile}
                          />
                        </TableCell>
                        <TableCell>
                          <HighlightedCell
                            value={itemData.thickness_mm ? `${itemData.thickness_mm}мм` : null}
                            isEmpty={!itemData.thickness_mm}
                          />
                        </TableCell>
                        <TableCell>
                          <HighlightedCell
                            value={itemData.width_work_mm}
                            isEmpty={!itemData.width_work_mm}
                          />
                        </TableCell>
                        <TableCell>
                          <HighlightedCell
                            value={itemData.width_full_mm}
                            isEmpty={!itemData.width_full_mm}
                          />
                        </TableCell>
                        <TableCell>
                          <HighlightedCell
                            value={itemData.coating}
                            isEmpty={!itemData.coating}
                          />
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {item.unit || 'шт'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {itemData.notes && (
                            <CollapsibleTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => toggleNotes(item.id)}
                              >
                                <ChevronDown className={cn(
                                  "h-4 w-4 transition-transform",
                                  expandedNotes.has(item.id) && "rotate-180"
                                )} />
                              </Button>
                            </CollapsibleTrigger>
                          )}
                        </TableCell>
                      </TableRow>
                      
                      {itemData.notes && (
                        <CollapsibleContent asChild>
                          <TableRow className="bg-muted/30">
                            <TableCell colSpan={9} className="py-2">
                              <div className="text-xs text-muted-foreground px-2">
                                <span className="font-medium">{t('products.notes', 'Заметки')}:</span>{' '}
                                {itemData.notes}
                              </div>
                            </TableCell>
                          </TableRow>
                        </CollapsibleContent>
                      )}
                    </>
                  </Collapsible>
                );
              })
            )}
          </TableBody>
        </Table>
      </ScrollArea>

      {/* Pagination */}
      {totalCount > 0 && (
        <div className="flex items-center justify-between px-4 py-2 border-t bg-muted/30">
          <div className="text-sm text-muted-foreground">
            {t('common.showing', 'Показано')} {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, totalCount)} {t('common.of', 'из')} {totalCount}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => onPageChange(1)}
              disabled={page <= 1}
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="px-3 text-sm">
              {page} / {totalPages || 1}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => onPageChange(totalPages)}
              disabled={page >= totalPages}
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
