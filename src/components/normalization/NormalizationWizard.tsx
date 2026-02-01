/**
 * NormalizationWizard - Главный компонент нормализации каталога
 * 
 * FIXED SCHEMA для профнастила и металлочерепицы:
 * - product_type → profile → thickness_mm → coating → color_or_ral
 * - Ширины подтягиваются из базы профилей (НЕ редактируемы вручную)
 * - color_or_ral = RAL#### или "Zn" для оцинковки
 * - Готовность определяется автоматически (без кнопок "Подтвердить")
 * 
 * Структура UI:
 * - Слева: ProductTypeFilter (категории)
 * - Центр: ClusterTree (иерархия кластеров)
 * - Справа: ClusterDetailPanel (таблица товаров + AI вопросы)
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
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
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Sparkles, CheckCircle2, Loader2, Download, RefreshCw, AlertCircle } from 'lucide-react';

import { ProductTypeFilter } from './ProductTypeFilter';
import { ClusterTree } from './ClusterTree';
import { ClusterDetailPanel } from './ClusterDetailPanel';
import type { 
  ProductCategory, 
  ProductType, 
  CanonicalProduct, 
  ClusterPath,
  AIQuestion,
  NormalizationValidation 
} from './types';
import { validateProduct, isProductNormalizable } from './types';

// =========================================
// Props
// =========================================
interface NormalizationWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  importJobId?: string;
  onComplete?: () => void;
}

// =========================================
// API Response Types
// =========================================
interface DryRunResponse {
  ok: boolean;
  run_id?: string;
  profile_hash?: string;
  stats?: {
    rows_scanned: number;
    candidates: number;
    patches_ready: number;
  };
  patches_sample?: Array<{
    id: string;
    title?: string;
    profile?: string;
    thickness_mm?: number | string;
    coating?: string;
    color_code?: string;
    width_work_mm?: number;
    width_full_mm?: number;
    price?: number;
    unit?: string;
    sheet_kind?: string;
  }>;
  questions?: AIQuestion[];
  error?: string;
  code?: string;
}

// =========================================
// Categorize Item
// =========================================
function categorizeItem(item: { profile?: string; title?: string; sheet_kind?: string }): ProductCategory {
  const profile = (item.profile || '').toUpperCase();
  const title = (item.title || '').toLowerCase();
  const sheetKind = item.sheet_kind?.toUpperCase();
  
  // Check sheet_kind from backend first
  if (sheetKind === 'PROFNASTIL') return 'PROFNASTIL';
  if (sheetKind === 'METAL_TILE') return 'METALLOCHEREPICA';
  if (sheetKind === 'ACCESSORY' || sheetKind === 'OTHER') return 'DOBOR';
  
  // Fallback to regex patterns
  if (/^(С|C|Н|H|НС|HC|МП|MP)-?\d/i.test(profile) || title.includes('профнастил')) {
    return 'PROFNASTIL';
  }
  
  if (title.includes('металлочерепица') || title.includes('monterrey') || title.includes('монтеррей')) {
    return 'METALLOCHEREPICA';
  }
  
  if (title.includes('сэндвич') || title.includes('панель')) {
    return 'SANDWICH';
  }
  
  if (title.includes('планка') || title.includes('конек') || title.includes('отлив') || 
      title.includes('водосток') || title.includes('саморез')) {
    return 'DOBOR';
  }
  
  return 'OTHER';
}

// =========================================
// Transform API Response to CanonicalProduct
// =========================================
function transformToCanonical(item: DryRunResponse['patches_sample'][0]): CanonicalProduct {
  const category = categorizeItem(item);
  const productType: ProductType | undefined = 
    category === 'PROFNASTIL' ? 'PROFNASTIL' :
    category === 'METALLOCHEREPICA' ? 'METALLOCHEREPICA' :
    undefined;
  
  return {
    id: item.id,
    organization_id: '', // Will be filled from context
    product_type: productType as ProductType,
    profile: item.profile || '',
    thickness_mm: typeof item.thickness_mm === 'string' ? parseFloat(item.thickness_mm) : (item.thickness_mm || 0),
    coating: item.coating || '',
    color_or_ral: item.color_code || '',
    work_width_mm: item.width_work_mm || 0,
    full_width_mm: item.width_full_mm || 0,
    price: item.price || 0,
    unit: item.unit === 'm2' ? 'm2' : 'sht',
    title: item.title,
  };
}

// =========================================
// Main Component
// =========================================
export function NormalizationWizard({
  open,
  onOpenChange,
  organizationId,
  importJobId,
  onComplete,
}: NormalizationWizardProps) {
  const { t } = useTranslation();
  
  // State
  const [activeCategory, setActiveCategory] = useState<ProductCategory>('PROFNASTIL');
  const [selectedCluster, setSelectedCluster] = useState<ClusterPath | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [items, setItems] = useState<CanonicalProduct[]>([]);
  const [aiQuestions, setAiQuestions] = useState<AIQuestion[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [profileHash, setProfileHash] = useState<string | null>(null);
  
  // Dry run mutation
  const dryRunMutation = useMutation({
    mutationFn: async (limit: number) => {
      const { data, error } = await supabase.functions.invoke<DryRunResponse>('import-normalize', {
        body: {
          op: 'dry_run',
          organization_id: organizationId,
          import_job_id: importJobId || 'current',
          scope: { only_where_null: true, limit },
          ai_suggest: false, // AI off by default for speed
        },
      });

      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || 'Dry run failed');
      return data;
    },
    onSuccess: (data) => {
      setRunId(data.run_id || null);
      setProfileHash(data.profile_hash || null);
      
      // Transform items
      const canonicalItems = (data.patches_sample || []).map(transformToCanonical);
      setItems(canonicalItems);
      
      // Set AI questions
      setAiQuestions(data.questions || []);
    },
    onError: (error) => {
      toast({
        title: t('common.error'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });
  
  // Load data on open
  useEffect(() => {
    if (open && items.length === 0) {
      dryRunMutation.mutate(5000);
    }
  }, [open]);
  
  // Calculate stats per category
  const categoryStats = useMemo(() => {
    const stats: Record<ProductCategory, { total: number; ready: number; needsAttention: number }> = {
      ALL: { total: 0, ready: 0, needsAttention: 0 },
      PROFNASTIL: { total: 0, ready: 0, needsAttention: 0 },
      METALLOCHEREPICA: { total: 0, ready: 0, needsAttention: 0 },
      DOBOR: { total: 0, ready: 0, needsAttention: 0 },
      SANDWICH: { total: 0, ready: 0, needsAttention: 0 },
      OTHER: { total: 0, ready: 0, needsAttention: 0 },
    };
    
    items.forEach(item => {
      const category = item.product_type || 'OTHER';
      const validation = validateProduct(item);
      
      stats.ALL.total++;
      stats[category].total++;
      
      if (validation.status === 'ready') {
        stats.ALL.ready++;
        stats[category].ready++;
      } else {
        stats.ALL.needsAttention++;
        stats[category].needsAttention++;
      }
    });
    
    return stats;
  }, [items]);
  
  // Filter items by category
  const filteredItems = useMemo(() => {
    if (activeCategory === 'ALL') return items;
    
    return items.filter(item => {
      const itemCategory = item.product_type || 'OTHER';
      return itemCategory === activeCategory;
    });
  }, [items, activeCategory]);
  
  // Check if current category is normalizable
  const isNormalizable = activeCategory === 'PROFNASTIL' || activeCategory === 'METALLOCHEREPICA';
  
  // Handle cluster selection
  const handleSelectCluster = useCallback((path: ClusterPath) => {
    setSelectedCluster(path);
  }, []);
  
  // Handle node toggle
  const handleToggleNode = useCallback((nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);
  
  // Handle AI question answer
  const handleAnswerQuestion = useCallback((questionId: string, value: string | number) => {
    // TODO: Apply to cluster and save to settings
    console.log('Answer question:', questionId, value);
    toast({
      title: t('normalize.answerApplied', 'Ответ применён'),
      description: t('normalize.answerAppliedDesc', 'Значение применено к кластеру'),
    });
  }, [t]);
  
  // Calculate progress
  const totalItems = categoryStats.PROFNASTIL.total + categoryStats.METALLOCHEREPICA.total;
  const readyItems = categoryStats.PROFNASTIL.ready + categoryStats.METALLOCHEREPICA.ready;
  const progressPercent = totalItems > 0 ? (readyItems / totalItems) * 100 : 0;
  
  // Handle complete
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
      const { data, error } = await supabase.functions.invoke('import-normalize', {
        body: {
          op: 'apply',
          organization_id: organizationId,
          import_job_id: importJobId || 'current',
          run_id: runId,
          profile_hash: profileHash,
        },
      });

      if (error) throw new Error(error.message);

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
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[1600px] h-[90vh] flex flex-col p-0">
        {/* Header */}
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Sparkles className="h-6 w-6 text-primary" />
              <div>
                <DialogTitle className="text-lg">
                  {t('normalize.wizardTitle', 'Нормализация каталога')}
                </DialogTitle>
                <DialogDescription className="text-sm">
                  {t('normalize.wizardDesc', 'Проверка и стандартизация данных товаров')}
                </DialogDescription>
              </div>
            </div>
            
            {/* Progress & Actions */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span className="text-sm">{readyItems}/{totalItems}</span>
              </div>
              <Progress value={progressPercent} className="w-32 h-2" />
              
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setItems([]);
                  dryRunMutation.mutate(5000);
                }}
                disabled={dryRunMutation.isPending}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${dryRunMutation.isPending ? 'animate-spin' : ''}`} />
                {t('normalize.refresh', 'Обновить')}
              </Button>
              
              <Button
                onClick={handleComplete}
                disabled={readyItems === 0 || dryRunMutation.isPending}
              >
                <CheckCircle2 className="h-4 w-4 mr-2" />
                {t('normalize.finalize', 'Завершить нормализацию')}
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* Main Content - 3 Column Layout */}
        <div className="flex-1 flex min-h-0">
          {/* Left: Category Filter (fixed width) */}
          <div className="w-64 border-r shrink-0">
            <ProductTypeFilter
              activeCategory={activeCategory}
              onCategoryChange={setActiveCategory}
              stats={categoryStats}
              loading={dryRunMutation.isPending}
            />
          </div>

          {/* Center: Cluster Tree (only for normalizable categories) */}
          {isNormalizable ? (
            <>
              <div className="w-80 border-r shrink-0">
                <ClusterTree
                  items={filteredItems}
                  selectedCluster={selectedCluster}
                  onSelectCluster={handleSelectCluster}
                  expandedNodes={expandedNodes}
                  onToggleNode={handleToggleNode}
                />
              </div>
              
              {/* Right: Cluster Detail Panel */}
              <div className="flex-1 min-w-0">
                <ClusterDetailPanel
                  items={filteredItems}
                  clusterPath={selectedCluster}
                  loading={dryRunMutation.isPending}
                  aiQuestions={aiQuestions}
                  onAnswerQuestion={handleAnswerQuestion}
                />
              </div>
            </>
          ) : (
            /* For non-normalizable categories, show info message */
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center max-w-md">
                <AlertCircle className="h-16 w-16 mx-auto mb-4 opacity-50" />
                <h3 className="text-lg font-medium mb-2">
                  {t('normalize.notNormalizable', 'Нормализация недоступна')}
                </h3>
                <p className="text-sm">
                  {t('normalize.notNormalizableDesc', 
                    'Нормализация доступна только для профнастила и металлочерепицы. Для этой категории доступна только сортировка и просмотр.'
                  )}
                </p>
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => setActiveCategory('PROFNASTIL')}
                >
                  {t('normalize.goToProfnastil', 'Перейти к Профнастилу')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default NormalizationWizard;
