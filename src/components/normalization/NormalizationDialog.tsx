/**
 * NormalizationDialog - Модальное окно нормализации каталога
 * 
 * Структура:
 * - Слева: Группы/паттерны (WIDTH, COLOR, COATING, DECOR)
 * - Справа: Таблица товаров (из preview_rows через Edge) + фильтрация по группе
 * - Снизу справа: AI-чат панель (Gemini через Edge proxy)
 * 
 * Данные: import-normalize op=preview_rows (proxy to catalog-enricher)
 */

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
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
import { supabase } from '@/integrations/supabase/client';
import { type CatalogItem } from '@/lib/catalog-api';
import { Sparkles, Check, Loader2, Zap } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

import { GroupsSidebar, type PatternGroup } from './GroupsSidebar';
import { CatalogTable } from './CatalogTable';
import { AIChatPanel } from './AIChatPanel';

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

interface PreviewRowsResponse {
  ok: boolean;
  rows?: Array<CatalogItem & {
    profile?: string;
    thickness_mm?: number;
    width_work_mm?: number;
    width_full_mm?: number;
    coating?: string;
    notes?: string;
  }>;
  total_count?: number;
  error?: string;
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
  const [dryRunLimit, setDryRunLimit] = useState(2000); // 2000 по умолчанию
  
  // Catalog items for table (filtered by active group)
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // dry_run mutation to get questions/groups
  const dryRunMutation = useMutation({
    mutationFn: async (params: { limit: number; aiSuggest: boolean }) => {
      const { data, error } = await supabase.functions.invoke<DryRunResponse>('import-normalize', {
        body: {
          op: 'dry_run',
          organization_id: organizationId,
          import_job_id: importJobId || 'current', // 'current' = normalize existing catalog
          scope: { only_where_null: true, limit: params.limit },
          ai_suggest: params.aiSuggest, // AI OFF по умолчанию
        },
      });

      if (error) throw new Error(error.message);
      
      // Timeout fallback: retry with smaller limit
      if (data?.code === 'TIMEOUT' && params.limit > 500) {
        setDryRunLimit(500);
        toast({
          title: t('normalize.timeoutRetry', 'Таймаут'),
          description: t('normalize.retryingSmaller', 'Повторяем с меньшим лимитом (500)...'),
        });
        // Re-throw to trigger retry
        throw new Error('TIMEOUT_RETRY');
      }
      
      if (!data?.ok) throw new Error(data?.error || 'Dry run failed');
      return data;
    },
    onSuccess: (data) => {
      setRunId(data.run_id || null);
      setProfileHash(data.profile_hash || null);
      
      // Parse questions into groups (WIDTH строго по regex)
      const parsedGroups = parseQuestionsToGroups(data.questions || []);
      setGroups(parsedGroups);
      
      // Select first group by default
      if (parsedGroups.length > 0) {
        setActiveGroup(parsedGroups[0]);
      }
    },
    onError: (error) => {
      // Retry with smaller limit on timeout
      if (error.message === 'TIMEOUT_RETRY') {
        dryRunMutation.mutate({ limit: 500, aiSuggest: aiEnabled });
        return;
      }
      toast({
        title: t('common.error'),
        description: error.message,
        variant: 'destructive',
      });
    },
    retry: false, // Manual retry for timeout
  });

  // Fetch preview rows via Edge Function (proxy to catalog-enricher)
  const { data: previewData, isLoading: previewLoading, refetch: refetchPreview } = useQuery({
    queryKey: ['normalization-preview', organizationId, activeGroup?.group_type, activeGroup?.group_key, searchQuery, page, pageSize],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke<PreviewRowsResponse>('import-normalize', {
        body: {
          op: 'preview_rows',
          organization_id: organizationId,
          import_job_id: importJobId,
          group_type: activeGroup?.group_type,
          filter_key: activeGroup?.group_key,
          q: searchQuery || undefined,
          limit: pageSize,
          offset: (page - 1) * pageSize,
        },
      });

      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || 'Preview failed');
      
      return {
        items: data.rows || [],
        total: data.total_count || 0,
      };
    },
    enabled: open && !!organizationId,
  });

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

  // WIDTH regex: только профили листовых кровельных
  const WIDTH_PROFILE_REGEX = /^(С|C|Н|H|НС|HC|МП|MP)-?\d{1,3}$/;
  
  // Parse questions array into PatternGroup format
  const parseQuestionsToGroups = (questions: DryRunResponse['questions']): PatternGroup[] => {
    const result: PatternGroup[] = [];
    
    questions?.forEach(q => {
      if (q.type.startsWith('WIDTH_')) {
        // СТРОГО: WIDTH только для профилей, соответствующих regex
        const profile = q.profile || '';
        if (!WIDTH_PROFILE_REGEX.test(profile)) {
          // Не WIDTH — пропускаем или можно добавить в OTHER
          console.log('[Normalization] Skipping non-WIDTH profile:', profile);
          return;
        }
        
        result.push({
          group_type: 'WIDTH',
          group_key: profile,
          affected_count: q.affected_count || 0,
          examples: q.examples || [],
          suggested: q.suggested ? `${q.suggested.work_mm}/${q.suggested.full_mm}мм` : undefined,
          current_confirmed: false, // TODO: check bot_settings
          question: q,
        });
      }
      
      if (q.type === 'COATING_COLOR_MAP') {
        // Add coating groups
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
        
        // Add color groups
        q.colors?.forEach(c => {
          const isDecor = c.kind === 'DECOR';
          result.push({
            group_type: isDecor ? 'DECOR' : 'COLOR',
            group_key: c.token,
            affected_count: c.affected_count || 0,
            examples: c.examples || [],
            suggested: c.suggested_ral,
            current_confirmed: false,
            question: { type: isDecor ? 'DECOR' : 'COLOR', ...c },
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
      const { data, error } = await supabase.functions.invoke('settings-merge', {
        body: {
          organization_id: organizationId,
          patch,
        },
      });

      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || 'Failed to save');

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
      const { data: startData, error: startError } = await supabase.functions.invoke('import-normalize', {
        body: {
          op: 'apply',
          organization_id: organizationId,
          import_job_id: importJobId || 'current',
          run_id: runId,
          profile_hash: profileHash,
        },
      });

      if (startError) throw new Error(startError.message);
      
      // Poll for completion
      if (startData?.apply_id) {
        let status = 'PENDING';
        while (status !== 'DONE' && status !== 'FAILED') {
          await new Promise(r => setTimeout(r, 2000));
          const { data: statusData } = await supabase.functions.invoke('import-normalize', {
            body: {
              op: 'apply_status',
              organization_id: organizationId,
              import_job_id: importJobId || 'current',
              apply_id: startData.apply_id,
            },
          });
          status = statusData?.status || 'FAILED';
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
            {/* Table Area */}
            <div className="flex-1 min-h-0">
              <CatalogTable
                items={previewData?.items || []}
                loading={previewLoading}
                activeGroup={activeGroup}
                onApplyToGroup={handleApplyToGroup}
                totalCount={previewData?.total || 0}
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
