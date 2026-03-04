/**
 * ClusterDetailPanel - Панель детализации кластера
 * 
 * Показывает:
 * - AI-вопросы с формами для WIDTH/PROFILE/CATEGORY/COLOR/COATING/THICKNESS
 * - Таблицу товаров с отображением цвета + цинка
 */

import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  CheckCircle2, AlertCircle, Sparkles, HelpCircle, Send, Loader2
} from 'lucide-react';
import type { CanonicalProduct, ClusterPath, AIQuestion, AIQuestionType } from './types';
import { validateProduct } from './types';

interface ClusterDetailPanelProps {
  items: CanonicalProduct[];
  clusterPath: ClusterPath | null;
  loading?: boolean;
  aiQuestions?: AIQuestion[];
  onAnswerQuestion?: (questionId: string, value: string | number) => void;
  answeringQuestion?: boolean;
  simpleMode?: boolean;
}

// =========================================
// Color Display Helper
// =========================================
function ColorCell({ item }: { item: CanonicalProduct }) {
  const hasColor = item.color_system && item.color_code;
  const hasZinc = !!item.zinc_label;

  if (!hasColor && !hasZinc) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {hasColor && (
        <Badge variant="outline" className="text-xs font-mono whitespace-nowrap">
          {item.color_system} {item.color_code}
        </Badge>
      )}
      {hasZinc && (
        <Badge variant="secondary" className="text-xs font-mono whitespace-nowrap bg-slate-200 dark:bg-slate-700">
          {item.zinc_label}
        </Badge>
      )}
    </div>
  );
}

// =========================================
// Field Cell Component
// =========================================
function FieldCell({
  value, fieldName, missingFields,
}: {
  value: string | number | undefined | null;
  fieldName: string;
  missingFields: string[];
}) {
  const isMissing = missingFields.includes(fieldName);
  if (isMissing || value === undefined || value === null || value === '') {
    return (
      <span className="flex items-center gap-1 text-destructive">
        <AlertCircle className="h-3 w-3" />
        <span className="text-xs italic">—</span>
      </span>
    );
  }
  return <span className="text-sm">{value}</span>;
}

// =========================================
// Question type labels
// =========================================
function getQuestionLabel(type: AIQuestionType, t: (key: string, fallback: string) => string, ask?: string): string {
  if (ask) return ask;
  switch (type) {
    case 'width': return t('normalize.aiAskWidth', 'Какая ширина для этого семейства?');
    case 'profile': return t('normalize.aiAskProfile', 'Какой профиль?');
    case 'category': return t('normalize.aiAskCategory', 'Какая категория?');
    case 'thickness': return t('normalize.aiAskThickness', 'Какая толщина для этого кластера?');
    case 'coating': return t('normalize.aiAskCoating', 'Какое покрытие?');
    case 'color': return t('normalize.aiAskColor', 'Какой RAL / цвет?');
  }
}

// =========================================
// WIDTH Question Form — full_mm + optional work_mm
// =========================================
function WidthQuestionForm({ question, onAnswer, disabled }: {
  question: AIQuestion;
  onAnswer: (value: string | number) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [fullMm, setFullMm] = useState('');
  const [workMm, setWorkMm] = useState('');

  const handleSubmit = () => {
    if (!fullMm) return;
    // Send as "full_mm" or "full_mm:work_mm" if work_mm provided
    const value = workMm ? `${fullMm}:${workMm}` : fullMm;
    onAnswer(value);
  };

  return (
    <div className="space-y-2 mt-2">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Label className="text-xs">{t('normalize.fullWidth', 'Полная ширина')}, мм *</Label>
          <Input
            type="number"
            value={fullMm}
            onChange={e => setFullMm(e.target.value)}
            placeholder="1200"
            className="h-8 text-sm"
            disabled={disabled}
          />
        </div>
        <div className="flex-1">
          <Label className="text-xs">{t('normalize.workWidth', 'Рабочая ширина')}, мм</Label>
          <Input
            type="number"
            value={workMm}
            onChange={e => setWorkMm(e.target.value)}
            placeholder={t('normalize.optional', 'необяз.')}
            className="h-8 text-sm"
            disabled={disabled}
          />
        </div>
        <Button size="sm" onClick={handleSubmit} disabled={!fullMm || disabled} className="h-8">
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
      {/* Pre-fill from suggestions */}
      {question.suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {question.suggestions
            .filter(s => typeof s === 'string' && !s.startsWith('{'))
            .map((s, i) => (
            <Button
              key={i}
              size="sm"
              variant={i === 0 ? 'default' : 'outline'}
              className="h-6 text-xs"
              disabled={disabled}
              onClick={() => onAnswer(s)}
            >
              {s} мм
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

// =========================================
// Generic Text/Select Question Form
// =========================================
function TextQuestionForm({ question, onAnswer, placeholder, disabled }: {
  question: AIQuestion;
  onAnswer: (value: string | number) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [manualValue, setManualValue] = useState('');

  return (
    <div className="space-y-2 mt-2">
      {/* Suggestion buttons */}
      {question.suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {question.suggestions
            .filter(s => typeof s === 'string' && !s.startsWith('{'))
            .map((s, i) => (
            <Button
              key={i}
              size="sm"
              variant={i === 0 ? 'default' : 'outline'}
              className="h-7 text-xs"
              disabled={disabled}
              onClick={() => onAnswer(s)}
            >
              {s}
              {i === 0 && question.confidence > 0.8 && (
                <CheckCircle2 className="h-3 w-3 ml-1" />
              )}
            </Button>
          ))}
        </div>
      )}
      {/* Manual input */}
      <div className="flex items-center gap-2">
        <Input
          value={manualValue}
          onChange={e => setManualValue(e.target.value)}
          placeholder={placeholder || 'Ввести вручную…'}
          className="h-8 text-sm flex-1"
          disabled={disabled}
          onKeyDown={e => {
            if (e.key === 'Enter' && manualValue.trim()) onAnswer(manualValue.trim());
          }}
        />
        <Button size="sm" onClick={() => onAnswer(manualValue.trim())} disabled={!manualValue.trim() || disabled} className="h-8">
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// =========================================
// AI Question Card — routes to proper form
// =========================================
function AIQuestionCard({
  question, onAnswer, disabled,
}: {
  question: AIQuestion;
  onAnswer: (value: string | number) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div className="p-3 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg mb-3">
      <div className="flex items-start gap-2">
        <Sparkles className="h-4 w-4 text-purple-600 mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-medium text-purple-900 dark:text-purple-100">
            {getQuestionLabel(question.type, t, question.ask)}
          </p>
          <div className="flex items-center gap-2 mt-0.5 text-xs text-purple-700 dark:text-purple-300">
            <span>{t('normalize.aiAffects', 'Затрагивает {{count}} товаров', { count: question.affected_count })}</span>
            {question.token && (
              <Badge variant="outline" className="text-[10px] h-4 px-1 font-mono">{question.token}</Badge>
            )}
          </div>

          {/* Examples */}
          {question.examples.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              <span className="text-xs text-muted-foreground">{t('normalize.examples', 'Примеры')}:</span>
              {question.examples.slice(0, 4).map((ex, i) => (
                <Badge key={i} variant="outline" className="text-xs max-w-[200px] truncate">{ex}</Badge>
              ))}
            </div>
          )}

          {/* Form per type */}
          {question.type === 'width' ? (
            <WidthQuestionForm question={question} onAnswer={onAnswer} disabled={disabled} />
          ) : (
            <TextQuestionForm
              question={question}
              onAnswer={onAnswer}
              disabled={disabled}
              placeholder={
                question.type === 'profile' ? 'C-8, MP-20, H-60…' :
                question.type === 'thickness' ? '0.45, 0.5, 0.7…' :
                question.type === 'category' ? 'Профнастил, Металлочерепица…' :
                question.type === 'coating' ? 'Полиэстер, Пурал…' :
                'RAL3005, RR32…'
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}

// =========================================
// Cluster Header
// =========================================
function ClusterHeader({
  clusterPath, readyCount, needsAttentionCount,
}: {
  clusterPath: ClusterPath; readyCount: number; needsAttentionCount: number;
}) {
  const { t } = useTranslation();
  const parts: string[] = [];
  if (clusterPath.profile) parts.push(clusterPath.profile);
  if (clusterPath.thickness_mm) parts.push(`${clusterPath.thickness_mm}мм`);
  if (clusterPath.coating) parts.push(clusterPath.coating);
  if (clusterPath.color_or_ral) parts.push(clusterPath.color_or_ral);
  const isReady = needsAttentionCount === 0;

  return (
    <div className="px-4 py-3 border-b bg-muted/30">
      <div className="flex items-center gap-3">
        {isReady ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : <AlertCircle className="h-5 w-5 text-destructive" />}
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {parts.map((part, i) => (
              <span key={i} className="flex items-center gap-2">
                {i > 0 && <span className="text-muted-foreground">→</span>}
                <Badge variant="secondary" className="font-mono">{part}</Badge>
              </span>
            ))}
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-green-600" />
              {readyCount} {t('normalize.ready', 'готово')}
            </span>
            <span className="flex items-center gap-1">
              <AlertCircle className="h-3 w-3 text-destructive" />
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
  items, clusterPath, loading, aiQuestions = [], onAnswerQuestion, answeringQuestion, simpleMode,
}: ClusterDetailPanelProps) {
  const { t } = useTranslation();

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

  const itemsWithValidation = useMemo(() => {
    return filteredItems.map(item => ({ item, validation: validateProduct(item) }));
  }, [filteredItems]);

  const readyCount = itemsWithValidation.filter(i => i.validation.status === 'ready').length;
  const needsAttentionCount = itemsWithValidation.filter(i => i.validation.status === 'needs_attention').length;

  // Filter AI questions for this cluster
  const relevantQuestions = useMemo(() => {
    return aiQuestions.filter(q => {
      if (!clusterPath) return true; // show all if no cluster selected
      return (
        q.cluster_path.profile === clusterPath.profile &&
        (q.cluster_path.thickness_mm === clusterPath.thickness_mm || !clusterPath.thickness_mm) &&
        (q.cluster_path.coating === clusterPath.coating || !clusterPath.coating)
      );
    });
  }, [aiQuestions, clusterPath]);

  if (loading) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // If no cluster selected but there are questions, show all questions
  if (!clusterPath && aiQuestions.length > 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 py-3 border-b bg-muted/30">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-600" />
            <h3 className="font-semibold text-sm">{t('normalize.allQuestions', 'Все вопросы нормализации')}</h3>
            <Badge variant="secondary">{aiQuestions.length}</Badge>
            {answeringQuestion && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
        </div>
        <ScrollArea className="flex-1 p-3">
          {aiQuestions.map((q, i) => (
            <AIQuestionCard
              key={`${q.token}-${q.type}-${i}`}
              question={q}
              onAnswer={(value) => onAnswerQuestion?.(q.token || `q-${i}`, value)}
              disabled={answeringQuestion}
            />
          ))}
        </ScrollArea>
      </div>
    );
  }

  if (!clusterPath && !simpleMode) {
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
      {clusterPath && <ClusterHeader clusterPath={clusterPath} readyCount={readyCount} needsAttentionCount={needsAttentionCount} />}

      {/* AI Questions for this cluster */}
      {relevantQuestions.length > 0 && (
        <div className="p-3 border-b">
          {answeringQuestion && (
            <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t('normalize.updatingResults', 'Обновляем результаты…')}
            </div>
          )}
          {relevantQuestions.map((q, i) => (
            <AIQuestionCard
              key={`${q.token}-${q.type}-${i}`}
              question={q}
              onAnswer={(value) => onAnswerQuestion?.(q.token || `q-${i}`, value)}
              disabled={answeringQuestion}
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
              <TableHead className="w-[120px]">{t('normalize.colorRal', 'Цвет / Zn')}</TableHead>
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
                  className={cn(validation.status === 'needs_attention' && "bg-destructive/5")}
                >
                  <TableCell>
                    {validation.status === 'ready' ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-destructive" />
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
                    <FieldCell value={item.thickness_mm ? `${item.thickness_mm}` : undefined} fieldName="thickness_mm" missingFields={validation.missing_fields} />
                  </TableCell>
                  <TableCell>
                    <FieldCell value={item.coating} fieldName="coating" missingFields={validation.missing_fields} />
                  </TableCell>
                  <TableCell>
                    <ColorCell item={item} />
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
