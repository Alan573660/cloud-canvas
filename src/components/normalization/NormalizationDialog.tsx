/**
 * NormalizationDialog - Модальное окно нормализации каталога
 * 
 * Структура:
 * - Вверху: Вкладки категорий (Профнастил, Металлочерепица, Сэндвич, Доборы, Прочее)
 * - Слева: Группы/паттерны (WIDTH, COLOR, COATING, DECOR)
 * - Справа: Таблица товаров + фильтрация по категории и группе
 * - Снизу справа: AI-чат панель
 * 
 * Данные: import-normalize op=dry_run → patches_sample
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { toast } from '@/hooks/use-toast';
import { Sparkles, Check, Loader2, Zap, Download, RefreshCw } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { apiInvoke } from '@/lib/api-client';

import { GroupsSidebar, type PatternGroup } from './GroupsSidebar';
import { CatalogTable } from './CatalogTable';
import { AIChatPanel } from './AIChatPanel';
import { CategoryTabs, type ProductCategory, categorizeItem } from './CategoryTabs';

// =========================================
// Types
// =========================================
interface NormalizationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  importJobId?: string; // Optional: if from import flow
  onComplete?: () => void;
}

interface PatchSample {
  id: string;
  title?: string;
  profile?: string;
  sheet_kind?: string;
  color_system?: string;
  color_code?: string;
  thickness_mm?: number | string;
  coating?: string;
  width_work_mm?: number;
  width_full_mm?: number;
  weight_kg_m2?: number;
  unit?: string;
}

interface DryRunResponse {
  ok: boolean;
  run_id?: string;
  profile_hash?: string;
  stats?: {
    rows_scanned: number;
    candidates: number;
    patches_ready: number;
    questions: number;
  };
  patches_sample?: PatchSample[];
  questions?: Array<{
    type: string;
    profile?: string;
    token?: string;
    suggested?: { work_mm: number; full_mm: number };
    suggested_ral?: string;
    examples?: string[];
    affected_count?: number;
    aliases?: string[];
    coatings?: Array<{ token: string; aliases: string[]; examples?: string[]; affected_count?: number }>;
    colors?: Array<{ token: string; suggested_ral?: string; kind?: string; examples?: string[]; affected_count?: number }>;
  }>;
  error?: string;
  code?: string;
}

// =========================================
// Main Component
// =========================================
export function NormalizationDialog({
  open,
  onOpenChange,
  organizationId,
  importJobId,
  onComplete,
}: NormalizationDialogProps) {
  const { t } = useTranslation();
  
  // State
  const [activeGroup, setActiveGroup] = useState<PatternGroup | null>(null);
  const [groups, setGroups] = useState<PatternGroup[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [profileHash, setProfileHash] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false); // AI OFF по умолчанию
  const [dryRunLimit, setDryRunLimit] = useState(5000); // 5000 по умолчанию для полного каталога
  
  // Category filter
  const [activeCategory, setActiveCategory] = useState<ProductCategory>('ALL');
  
  // Catalog items from dry_run patches_sample
  const [previewItems, setPreviewItems] = useState<PatchSample[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100); // 100 по умолчанию для удобства
  
  // Loading state for "load more"
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // dry_run mutation to get questions/groups
  const dryRunMutation = useMutation({
    mutationFn: async (params: { limit: number; aiSuggest: boolean }) => {
      const result = await apiInvoke<DryRunResponse>('import-normalize', {
        op: 'dry_run',
        organization_id: organizationId,
        import_job_id: importJobId || 'current', // 'current' = normalize existing catalog
        scope: { only_where_null: true, limit: params.limit },
        ai_suggest: params.aiSuggest,
      });

      if (!result.ok) {
        throw new Error(result.error.message);
      }

      const data = result.data;

      // Timeout fallback: retry with smaller limit
      if (data?.code === 'TIMEOUT' && params.limit > 2000) {
        setDryRunLimit(2000);
        toast({
          title: t('normalize.timeoutRetry', 'Таймаут'),
          description: t('normalize.retryingSmaller', 'Повторяем с меньшим лимитом (2000)...'),
        });
        throw new Error('TIMEOUT_RETRY');
      }

      if (!data?.ok) throw new Error(data?.error || 'Dry run failed');
      return data;
    },
    onSuccess: (data) => {
      setRunId(data.run_id || null);
      setProfileHash(data.profile_hash || null);
      
      // Store patches_sample for table display
      setPreviewItems(prev => {
        // If loading more, append; otherwise replace
        if (isLoadingMore) {
          const existingIds = new Set(prev.map(p => p.id));
          const newItems = (data.patches_sample || []).filter(p => !existingIds.has(p.id));
          return [...prev, ...newItems];
        }
        return data.patches_sample || [];
      });
      setIsLoadingMore(false);
      
      // Parse questions into groups
      const parsedGroups = parseQuestionsToGroups(data.questions || []);
      setGroups(parsedGroups);
      
      // Select first group by default
      if (parsedGroups.length > 0 && !activeGroup) {
        setActiveGroup(parsedGroups[0]);
      }
    },
    onError: (error) => {
      setIsLoadingMore(false);
      // Retry with smaller limit on timeout
      if (error.message === 'TIMEOUT_RETRY') {
        dryRunMutation.mutate({ limit: 2000, aiSuggest: aiEnabled });
        return;
      }
      toast({
        title: t('common.error'),
        description: error.message,
        variant: 'destructive',
      });
    },
    retry: false,
  });

  // Filter by category, then by active group and search
  const filteredItems = useMemo(() => {
    let items = previewItems;
    
    // Filter by category first
    if (activeCategory !== 'ALL') {
      items = items.filter(item => categorizeItem(item) === activeCategory);
    }
    
    // Filter by active group
    if (activeGroup) {
      if (activeGroup.group_type === 'WIDTH') {
        items = items.filter(item => 
          item.profile?.toUpperCase().includes(activeGroup.group_key.toUpperCase())
        );
      } else if (activeGroup.group_type === 'COLOR' || activeGroup.group_type === 'DECOR') {
        items = items.filter(item =>
          item.color_code?.toUpperCase().includes(activeGroup.group_key.toUpperCase()) ||
          item.title?.toUpperCase().includes(activeGroup.group_key.toUpperCase())
        );
      } else if (activeGroup.group_type === 'COATING') {
        items = items.filter(item =>
          item.coating?.toUpperCase().includes(activeGroup.group_key.toUpperCase()) ||
          item.title?.toUpperCase().includes(activeGroup.group_key.toUpperCase())
        );
      }
    }
    
    // Filter by search query
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      items = items.filter(item =>
        item.title?.toLowerCase().includes(q) ||
        item.id?.toLowerCase().includes(q) ||
        item.profile?.toLowerCase().includes(q)
      );
    }
    
    return items;
  }, [previewItems, activeCategory, activeGroup, searchQuery]);
  
  const paginatedItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, page, pageSize]);
  
  const previewLoading = dryRunMutation.isPending && !isLoadingMore;

  // Run dry_run when dialog opens
  useEffect(() => {
    if (open && !dryRunMutation.isPending && groups.length === 0) {
      dryRunMutation.mutate({ limit: dryRunLimit, aiSuggest: aiEnabled });
    }
  }, [open]);
  
  // Toggle AI and re-run
  const handleToggleAI = () => {
    const newAiEnabled = !aiEnabled;
    setAiEnabled(newAiEnabled);
    // Re-run analysis with new AI setting
    setGroups([]);
    setActiveGroup(null);
    dryRunMutation.mutate({ limit: dryRunLimit, aiSuggest: newAiEnabled });
  };

  /**
   * Parse questions from Cloud Run dry_run response into PatternGroup format.
   * 
   * IMPORTANT: UI does NOT classify or filter data.
   * Source of truth = Cloud Run catalog-enricher.
   * - sheet_kind / color_system / color_code — computed by backend
   * - Accessories (выход/буклет/оклад/планка/саморез) → sheet_kind=OTHER (backend)
   * - #### → RAL#### by whitelist, RR → RR## (backend)
   * 
   * UI just displays what backend returns as-is.
   */
  const parseQuestionsToGroups = (questions: DryRunResponse['questions']): PatternGroup[] => {
    const result: PatternGroup[] = [];
    
    questions?.forEach(q => {
      // Backend determines group_type via sheet_kind/color_system
      // UI simply maps the question type to display groups
      
      if (q.type.startsWith('WIDTH_')) {
        // Backend already filtered: only valid roofing profiles have WIDTH_ type
        result.push({
          group_type: 'WIDTH',
          group_key: q.profile || q.token || '',
          affected_count: q.affected_count || 0,
          examples: q.examples || [],
          suggested: q.suggested ? `${q.suggested.work_mm}/${q.suggested.full_mm}мм` : undefined,
          current_confirmed: false,
          question: q,
        });
      }
      
      if (q.type === 'COATING_COLOR_MAP') {
        // Coatings
        q.coatings?.forEach(c => {
          result.push({
            group_type: 'COATING',
            group_key: c.token,
            affected_count: c.affected_count || 0,
            examples: c.examples || [],
            suggested: c.aliases?.join(', '),
            current_confirmed: false,
            question: { type: 'COATING', ...c },
          });
        });
        
        // Colors: backend sets kind=DECOR for decor patterns
        q.colors?.forEach(c => {
          result.push({
            group_type: c.kind === 'DECOR' ? 'DECOR' : 'COLOR',
            group_key: c.token,
            affected_count: c.affected_count || 0,
            examples: c.examples || [],
            suggested: c.suggested_ral, // Backend computed: RAL#### or RR##
            current_confirmed: false,
            question: { type: c.kind === 'DECOR' ? 'DECOR' : 'COLOR', ...c },
          });
        });
      }
    });
    
    return result;
  };

  // Handle group selection
  const handleGroupSelect = useCallback((group: PatternGroup) => {
    setActiveGroup(group);
    setPage(1);
    setSearchQuery('');
  }, []);

  // Handle apply to group
  const handleApplyToGroup = useCallback(async (group: PatternGroup, value: unknown) => {
    // Save to bot_settings via settings-merge
    let patch: Record<string, unknown> = {};
    
    if (group.group_type === 'WIDTH') {
      patch = {
        pricing: {
          widths_selected: {
            [group.group_key]: value,
          },
        },
      };
    } else if (group.group_type === 'COLOR' || group.group_type === 'DECOR') {
      const colorData = group.group_type === 'DECOR'
        ? { kind: 'DECOR', label: value }
        : value; // RAL code
      patch = {
        pricing: {
          colors: {
            ral_aliases: {
              [group.group_key]: colorData,
            },
          },
        },
      };
    } else if (group.group_type === 'COATING') {
      patch = {
        pricing: {
          coatings: {
            [group.group_key]: value,
          },
        },
      };
    }

    try {
      const result = await apiInvoke<{ ok: boolean; error?: string }>('settings-merge', {
          organization_id: organizationId,
          patch,
      });

      if (!result.ok || !result.data?.ok) throw new Error(result.ok ? (result.data?.error || 'Failed to save') : result.error.message);

      // Mark as confirmed
      setGroups(prev => prev.map(g =>
        g.group_key === group.group_key
          ? { ...g, current_confirmed: true }
          : g
      ));

      toast({
        title: t('normalize.applied', 'Применено'),
        description: t('normalize.appliedToRows', 'Применено к {{count}} строкам', { count: group.affected_count }),
      });
    } catch (err) {
      toast({
        title: t('common.error'),
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  }, [organizationId, t]);

  // Complete normalization - apply all and trigger publish
  const handleComplete = useCallback(async () => {
    if (!runId || !profileHash) {
      toast({
        title: t('common.error'),
        description: 'Missing run data',
        variant: 'destructive',
      });
      return;
    }

    try {
      // Start async apply
      const startResult = await apiInvoke<{ apply_id?: string; status?: string }>('import-normalize', {
          op: 'apply',
          organization_id: organizationId,
          import_job_id: importJobId || 'current',
          run_id: runId,
          profile_hash: profileHash,
      });

      if (!startResult.ok) throw new Error(startResult.error.message);

      const startData = startResult.data;

      // Poll for completion
      if (startData?.apply_id) {
        let status = 'PENDING';
        while (status !== 'DONE' && status !== 'COMPLETED' && status !== 'FAILED') {
          await new Promise(r => setTimeout(r, 2000));
          const statusResult = await apiInvoke<{ status?: string; error?: string }>('import-normalize', {
            op: 'apply_status',
            organization_id: organizationId,
            import_job_id: importJobId || 'current',
            apply_id: startData.apply_id,
          });

          if (!statusResult.ok) {
            throw new Error(statusResult.error.message);
          }

          status = String(statusResult.data?.status || 'FAILED').toUpperCase();
        }
        
        if (status === 'FAILED') {
          throw new Error('Apply failed');
        }
      }

      toast({
        title: t('normalize.complete', 'Готово'),
        description: t('normalize.catalogUpdated', 'Каталог обновлён'),
      });

      onComplete?.();
      onOpenChange(false);
    } catch (err) {
      toast({
        title: t('common.error'),
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  }, [runId, profileHash, organizationId, importJobId, onComplete, onOpenChange, t]);

  // Progress calculation
  const confirmedCount = groups.filter(g => g.current_confirmed).length;
  const progressPercent = groups.length > 0 ? (confirmedCount / groups.length) * 100 : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[1400px] h-[90vh] flex flex-col p-0">
        {/* Header */}
        <DialogHeader className="px-6 py-4 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Sparkles className="h-6 w-6 text-primary" />
              <div>
                <DialogTitle className="text-lg">
                  {t('normalize.title', 'AI-нормализация каталога')}
                </DialogTitle>
                <DialogDescription className="text-sm">
                  {t('normalize.description', 'Проверьте и подтвердите данные по группам')}
                </DialogDescription>
              </div>
            </div>
            
            {/* AI Toggle + Progress */}
            <div className="flex items-center gap-4">
              {/* AI Toggle */}
              <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 rounded-lg">
                <Switch 
                  id="ai-toggle"
                  checked={aiEnabled}
                  onCheckedChange={handleToggleAI}
                  disabled={dryRunMutation.isPending}
                />
                <Label htmlFor="ai-toggle" className="text-xs cursor-pointer flex items-center gap-1">
                  <Zap className="h-3 w-3" />
                  {t('normalize.enableAI', 'Включить AI')}
                  <span className="text-muted-foreground">({t('normalize.slow', 'медленно')})</span>
                </Label>
              </div>
              
              <div className="text-sm text-muted-foreground">
                {confirmedCount}/{groups.length} {t('normalize.confirmed', 'подтверждено')}
              </div>
              <Progress value={progressPercent} className="w-32 h-2" />
              <Button 
                variant="default" 
                onClick={handleComplete}
                disabled={confirmedCount === 0}
              >
                <Check className="h-4 w-4 mr-2" />
                {t('normalize.applyAll', 'Обновить каталог')}
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* Category Tabs */}
        <CategoryTabs
          items={previewItems}
          activeCategory={activeCategory}
          onCategoryChange={(cat) => {
            setActiveCategory(cat);
            setPage(1);
          }}
        />

        {/* Main Content - Split Layout */}
        <div className="flex-1 flex min-h-0">
          {/* Left Sidebar - Groups */}
          <div className="w-80 border-r flex flex-col">
            <GroupsSidebar
              groups={groups}
              activeGroup={activeGroup}
              onSelectGroup={handleGroupSelect}
              loading={dryRunMutation.isPending}
            />
          </div>

          {/* Right Content - Table + Chat */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Load more info bar */}
            {previewItems.length > 0 && (
              <div className="flex items-center justify-between px-4 py-2 bg-muted/30 border-b text-sm">
                <span className="text-muted-foreground">
                  {t('normalize.loaded', 'Загружено')}: <strong>{previewItems.length.toLocaleString()}</strong> {t('normalize.items', 'товаров')}
                </span>
                <div className="flex items-center gap-2">
                  {previewItems.length < 10000 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setIsLoadingMore(true);
                        const newLimit = Math.min(previewItems.length + 5000, 20000);
                        setDryRunLimit(newLimit);
                        dryRunMutation.mutate({ limit: newLimit, aiSuggest: aiEnabled });
                      }}
                      disabled={dryRunMutation.isPending}
                    >
                      {isLoadingMore ? (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      ) : (
                        <Download className="h-3 w-3 mr-1" />
                      )}
                      {t('normalize.loadMore', 'Загрузить ещё')} +5000
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setPreviewItems([]);
                      setGroups([]);
                      setActiveGroup(null);
                      dryRunMutation.mutate({ limit: dryRunLimit, aiSuggest: aiEnabled });
                    }}
                    disabled={dryRunMutation.isPending}
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    {t('normalize.refresh', 'Обновить')}
                  </Button>
                </div>
              </div>
            )}
            
            {/* Table Area */}
            <div className="flex-1 min-h-0">
              <CatalogTable
                items={paginatedItems}
                loading={previewLoading}
                activeGroup={activeGroup}
                onApplyToGroup={handleApplyToGroup}
                totalCount={filteredItems.length}
                page={page}
                pageSize={pageSize}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
              />
            </div>

            {/* AI Chat Panel (collapsible) */}
            <AIChatPanel
              open={chatOpen}
              onOpenChange={setChatOpen}
              organizationId={organizationId}
              importJobId={importJobId}
              activeGroup={activeGroup}
              onApplyPatch={(patch) => {
                // Handle AI-generated patch
                console.log('AI patch:', patch);
              }}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
