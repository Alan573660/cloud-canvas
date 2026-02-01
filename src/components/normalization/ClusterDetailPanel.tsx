/**
 * ClusterDetailPanel - Панель детализации кластера
 * 
 * Показывает:
 * - Состояние нормализации кластера (🟢 Готов / 🔴 Требует внимания)
 * - Список товаров в кластере с их статусами
 * - AI-вопросы для низкой уверенности
 * 
 * НЕ ПОКАЗЫВАЕТ:
 * - Кнопки "Принять", "Подтвердить товар" — готовность определяется автоматически
 * - Ручной ввод ширин — они берутся из базы профилей
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  CheckCircle2, AlertCircle, Sparkles, HelpCircle
} from 'lucide-react';
import type { CanonicalProduct, ClusterPath, NormalizationValidation, AIQuestion } from './types';
import { validateProduct } from './types';

interface ClusterDetailPanelProps {
  items: CanonicalProduct[];
  clusterPath: ClusterPath | null;
  loading?: boolean;
  aiQuestions?: AIQuestion[];
  onAnswerQuestion?: (questionId: string, value: string | number) => void;
}

// =========================================
// Field Cell Component
// =========================================
function FieldCell({
  value,
  fieldName,
  missingFields,
}: {
  value: string | number | undefined | null;
  fieldName: string;
  missingFields: string[];
}) {
  const isMissing = missingFields.includes(fieldName);
  
  if (isMissing || value === undefined || value === null || value === '') {
    return (
      <span className="flex items-center gap-1 text-red-500">
        <AlertCircle className="h-3 w-3" />
        <span className="text-xs italic">—</span>
      </span>
    );
  }
  
  return <span className="text-sm">{value}</span>;
}

// =========================================
// AI Question Card
// =========================================
function AIQuestionCard({
  question,
  onAnswer,
}: {
  question: AIQuestion;
  onAnswer: (value: string | number) => void;
}) {
  const { t } = useTranslation();
  
  return (
    <div className="p-3 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg mb-3">
      <div className="flex items-start gap-2">
        <Sparkles className="h-4 w-4 text-purple-600 mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-medium text-purple-900 dark:text-purple-100">
            {question.type === 'thickness' && t('normalize.aiAskThickness', 'Какая толщина для этого кластера?')}
            {question.type === 'coating' && t('normalize.aiAskCoating', 'Какое покрытие?')}
            {question.type === 'color' && t('normalize.aiAskColor', 'Какой RAL / цвет?')}
          </p>
          
          <p className="text-xs text-purple-700 dark:text-purple-300 mt-1">
            {t('normalize.aiAffects', 'Затрагивает {{count}} товаров', { count: question.affected_count })}
          </p>
          
          {/* Examples */}
          {question.examples.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              <span className="text-xs text-muted-foreground">{t('normalize.examples', 'Примеры')}:</span>
              {question.examples.slice(0, 3).map((ex, i) => (
                <Badge key={i} variant="outline" className="text-xs">
                  {ex}
                </Badge>
              ))}
            </div>
          )}
          
          {/* Suggestions */}
          <div className="mt-3 flex flex-wrap gap-2">
            {question.suggestions.map((suggestion, i) => (
              <Button
                key={i}
                size="sm"
                variant={i === 0 ? 'default' : 'outline'}
                onClick={() => onAnswer(suggestion)}
                className="h-7 text-xs"
              >
                {suggestion}
                {i === 0 && question.confidence > 0.8 && (
                  <CheckCircle2 className="h-3 w-3 ml-1" />
                )}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// =========================================
// Cluster Header
// =========================================
function ClusterHeader({
  clusterPath,
  readyCount,
  needsAttentionCount,
}: {
  clusterPath: ClusterPath;
  readyCount: number;
  needsAttentionCount: number;
}) {
  const { t } = useTranslation();
  
  // Build breadcrumb
  const parts: string[] = [];
  if (clusterPath.profile) parts.push(clusterPath.profile);
  if (clusterPath.thickness_mm) parts.push(`${clusterPath.thickness_mm}мм`);
  if (clusterPath.coating) parts.push(clusterPath.coating);
  if (clusterPath.color_or_ral) parts.push(clusterPath.color_or_ral);
  
  const isReady = needsAttentionCount === 0;
  
  return (
    <div className="px-4 py-3 border-b bg-muted/30">
      <div className="flex items-center gap-3">
        {isReady ? (
          <CheckCircle2 className="h-5 w-5 text-green-600" />
        ) : (
          <AlertCircle className="h-5 w-5 text-red-500" />
        )}
        
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {parts.map((part, i) => (
              <span key={i} className="flex items-center gap-2">
                {i > 0 && <span className="text-muted-foreground">→</span>}
                <Badge variant="secondary" className="font-mono">
                  {part}
                </Badge>
              </span>
            ))}
          </div>
          
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-green-600" />
              {readyCount} {t('normalize.ready', 'готово')}
            </span>
            <span className="flex items-center gap-1">
              <AlertCircle className="h-3 w-3 text-red-500" />
              {needsAttentionCount} {t('normalize.needsAttention', 'требует внимания')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// =========================================
// Main Component
// =========================================
export function ClusterDetailPanel({
  items,
  clusterPath,
  loading,
  aiQuestions = [],
  onAnswerQuestion,
}: ClusterDetailPanelProps) {
  const { t } = useTranslation();
  
  // Filter items by cluster path
  const filteredItems = useMemo(() => {
    if (!clusterPath) return items;
    
    return items.filter(item => {
      if (clusterPath.profile && item.profile !== clusterPath.profile) return false;
      if (clusterPath.thickness_mm && item.thickness_mm !== clusterPath.thickness_mm) return false;
      if (clusterPath.coating && item.coating !== clusterPath.coating) return false;
      if (clusterPath.color_or_ral && item.color_or_ral !== clusterPath.color_or_ral) return false;
      return true;
    });
  }, [items, clusterPath]);
  
  // Calculate stats
  const itemsWithValidation = useMemo(() => {
    return filteredItems.map(item => ({
      item,
      validation: validateProduct(item),
    }));
  }, [filteredItems]);
  
  const readyCount = itemsWithValidation.filter(i => i.validation.status === 'ready').length;
  const needsAttentionCount = itemsWithValidation.filter(i => i.validation.status === 'needs_attention').length;
  
  // Filter AI questions for this cluster
  const relevantQuestions = aiQuestions.filter(q => {
    if (!clusterPath) return false;
    // Match questions to cluster path
    return (
      q.cluster_path.profile === clusterPath.profile &&
      (q.cluster_path.thickness_mm === clusterPath.thickness_mm || !clusterPath.thickness_mm) &&
      (q.cluster_path.coating === clusterPath.coating || !clusterPath.coating)
    );
  });
  
  if (loading) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  
  if (!clusterPath) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <HelpCircle className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p className="text-sm">{t('normalize.selectCluster', 'Выберите кластер для просмотра')}</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="flex flex-col h-full">
      {/* Cluster Header */}
      <ClusterHeader
        clusterPath={clusterPath}
        readyCount={readyCount}
        needsAttentionCount={needsAttentionCount}
      />
      
      {/* AI Questions */}
      {relevantQuestions.length > 0 && (
        <div className="p-3 border-b">
          {relevantQuestions.map(q => (
            <AIQuestionCard
              key={q.cluster_path.profile + q.type}
              question={q}
              onAnswer={(value) => onAnswerQuestion?.(q.cluster_path.profile + q.type, value)}
            />
          ))}
        </div>
      )}
      
      {/* Items Table */}
      <ScrollArea className="flex-1">
        <Table>
          <TableHeader className="sticky top-0 bg-background z-10">
            <TableRow>
              <TableHead className="w-[40px]"></TableHead>
              <TableHead className="w-[100px]">ID</TableHead>
              <TableHead className="min-w-[150px]">{t('normalize.title', 'Название')}</TableHead>
              <TableHead className="w-[80px]">{t('normalize.profile', 'Профиль')}</TableHead>
              <TableHead className="w-[70px]">{t('normalize.thickness', 'Толщ.')}</TableHead>
              <TableHead className="w-[100px]">{t('normalize.coating', 'Покрытие')}</TableHead>
              <TableHead className="w-[80px]">{t('normalize.colorRal', 'RAL/Zn')}</TableHead>
              <TableHead className="w-[80px]">{t('normalize.workWidth', 'Раб. шир.')}</TableHead>
              <TableHead className="w-[80px]">{t('normalize.fullWidth', 'Полн. шир.')}</TableHead>
              <TableHead className="w-[80px]">{t('normalize.price', 'Цена')}</TableHead>
              <TableHead className="w-[50px]">{t('normalize.unit', 'Ед.')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {itemsWithValidation.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="h-32 text-center text-muted-foreground">
                  {t('common.noData', 'Нет данных')}
                </TableCell>
              </TableRow>
            ) : (
              itemsWithValidation.map(({ item, validation }) => (
                <TableRow
                  key={item.id}
                  className={cn(
                    validation.status === 'needs_attention' && "bg-red-50/50 dark:bg-red-900/10"
                  )}
                >
                  <TableCell>
                    {validation.status === 'ready' ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-red-500" />
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{item.id.slice(0, 8)}...</TableCell>
                  <TableCell className="max-w-[150px] truncate text-sm" title={item.title}>
                    {item.title || '—'}
                  </TableCell>
                  <TableCell>
                    <FieldCell value={item.profile} fieldName="profile" missingFields={validation.missing_fields} />
                  </TableCell>
                  <TableCell>
                    <FieldCell 
                      value={item.thickness_mm ? `${item.thickness_mm}` : undefined} 
                      fieldName="thickness_mm" 
                      missingFields={validation.missing_fields} 
                    />
                  </TableCell>
                  <TableCell>
                    <FieldCell value={item.coating} fieldName="coating" missingFields={validation.missing_fields} />
                  </TableCell>
                  <TableCell>
                    <FieldCell value={item.color_or_ral} fieldName="color_or_ral" missingFields={validation.missing_fields} />
                  </TableCell>
                  <TableCell>
                    <FieldCell value={item.work_width_mm} fieldName="work_width_mm" missingFields={validation.missing_fields} />
                  </TableCell>
                  <TableCell>
                    <FieldCell value={item.full_width_mm} fieldName="full_width_mm" missingFields={validation.missing_fields} />
                  </TableCell>
                  <TableCell>
                    <FieldCell value={item.price} fieldName="price" missingFields={validation.missing_fields} />
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {item.unit === 'm2' ? 'м²' : 'шт'}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  );
}
