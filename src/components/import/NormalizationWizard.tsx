/**
 * NormalizationWizard (Import Flow) — Thin wrapper
 * 
 * Delegates to the canonical NormalizationWizard from components/normalization/.
 * This wrapper bridges the import-flow props (inline, onComplete/onSkip)
 * to the full wizard which runs as a dialog.
 * 
 * @deprecated Use components/normalization/NormalizationWizard directly.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Sparkles, CheckCircle2, SkipForward, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useNormalization } from '@/hooks/use-normalization';

interface StagingRow {
  row_number: number;
  data: Record<string, unknown>;
}

interface NormalizationWizardProps {
  organizationId: string;
  importJobId: string;
  stagingSample: StagingRow[];
  onComplete: (result: { patched_rows?: number; skipped?: boolean }) => void;
  onSkip: () => void;
  autoStart?: boolean;
}

/**
 * Thin wrapper: runs auto dry_run, shows summary, delegates full editing
 * to the canonical normalization wizard (available in Products > Normalization tab).
 */
export function NormalizationWizard({
  organizationId,
  importJobId,
  onComplete,
  onSkip,
  autoStart = true,
}: NormalizationWizardProps) {
  const { t } = useTranslation();
  const norm = useNormalization({ organizationId, importJobId });
  const autoStartedRef = useRef(false);
  const [phase, setPhase] = useState<'scanning' | 'ready' | 'applying' | 'done' | 'error'>('scanning');

  // Auto dry_run on mount
  useEffect(() => {
    if (!autoStart || autoStartedRef.current) return;
    autoStartedRef.current = true;
    
    console.warn('[NormalizationWizard/import] DEPRECATED: Using legacy thin wrapper. Prefer normalization/NormalizationWizard.');
    
    norm.executeDryRun({ aiSuggest: true, limit: 2000, onlyWhereNull: false })
      .then(result => {
        if (result) {
          setPhase('ready');
        } else {
          setPhase('error');
        }
      });
  }, [autoStart, norm]);

  // Track apply state
  useEffect(() => {
    if (norm.applyState === 'DONE') {
      setPhase('done');
      setTimeout(() => {
        onComplete({ patched_rows: norm.applyReport?.total || 0 });
      }, 1500);
    } else if (norm.applyState === 'ERROR') {
      setPhase('error');
    } else if (norm.applyState === 'RUNNING' || norm.applyState === 'PENDING' || norm.applyState === 'STARTING') {
      setPhase('applying');
    }
  }, [norm.applyState, norm.applyReport, onComplete]);

  const handleApply = useCallback(() => {
    norm.executeApply();
  }, [norm]);

  const patchesReady = norm.dryRunResult?.stats?.patches_ready || 0;
  const questionsCount = norm.dryRunResult?.questions?.length || 0;
  const rowsScanned = norm.dryRunResult?.stats?.rows_scanned || 0;

  return (
    <div className="space-y-4 py-4">
      {/* Deprecation notice */}
      <Alert variant="default" className="bg-muted/50">
        <Sparkles className="h-4 w-4" />
        <AlertTitle className="text-sm">{t('normalize.quickAnalysis', 'Быстрый анализ каталога')}</AlertTitle>
        <AlertDescription className="text-xs text-muted-foreground">
          {t('normalize.fullWizardHint', 'Полный мастер нормализации доступен в разделе Каталог → Нормализация')}
        </AlertDescription>
      </Alert>

      {/* Scanning */}
      {phase === 'scanning' && (
        <div className="text-center py-8 space-y-3">
          <Loader2 className="h-8 w-8 mx-auto animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">{t('normalize.scanning', 'Анализируем каталог…')}</p>
        </div>
      )}

      {/* Ready — show summary */}
      {phase === 'ready' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center p-3 rounded-lg bg-muted/30 border">
              <div className="text-2xl font-bold">{rowsScanned.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">{t('normalize.rowsScanned', 'Строк проверено')}</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-primary/5 border border-primary/20">
              <div className="text-2xl font-bold text-primary">{patchesReady}</div>
              <div className="text-xs text-muted-foreground">{t('normalize.patchesReady', 'Исправлений найдено')}</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-muted/30 border">
              <div className="text-2xl font-bold">{questionsCount}</div>
              <div className="text-xs text-muted-foreground">{t('normalize.questionsCount', 'Вопросов')}</div>
            </div>
          </div>

          {questionsCount > 0 && (
            <Alert>
              <AlertDescription className="text-xs">
                {t('normalize.questionsHint', 'Есть {{count}} вопросов, требующих внимания. Откройте полный мастер для детальной настройки.', { count: questionsCount })}
              </AlertDescription>
            </Alert>
          )}

          <div className="flex gap-2">
            {patchesReady > 0 && (
              <Button onClick={handleApply} className="flex-1">
                <CheckCircle2 className="h-4 w-4 mr-2" />
                {t('normalize.applyPatches', 'Применить {{count}} исправлений', { count: patchesReady })}
              </Button>
            )}
            <Button variant="outline" onClick={onSkip}>
              <SkipForward className="h-4 w-4 mr-2" />
              {patchesReady === 0 ? t('normalize.continue', 'Продолжить') : t('normalize.skipNormalization', 'Пропустить')}
            </Button>
          </div>
        </div>
      )}

      {/* Applying */}
      {phase === 'applying' && (
        <div className="text-center py-6 space-y-3">
          <Loader2 className="h-8 w-8 mx-auto animate-spin text-primary" />
          <p className="text-sm">{t('normalize.applying', 'Применяем исправления…')}</p>
          {norm.applyProgress > 0 && (
            <div className="max-w-xs mx-auto space-y-1">
              <Progress value={norm.applyProgress} className="h-2" />
              <p className="text-xs text-muted-foreground">{norm.applyProgress}%</p>
            </div>
          )}
        </div>
      )}

      {/* Done */}
      {phase === 'done' && (
        <div className="text-center py-6 space-y-2">
          <CheckCircle2 className="h-10 w-10 mx-auto text-primary" />
          <p className="text-sm font-medium">{t('normalize.done', 'Нормализация завершена')}</p>
        </div>
      )}

      {/* Error */}
      {phase === 'error' && (
        <div className="space-y-3">
          <Alert variant="destructive">
            <AlertTitle>{t('normalize.error', 'Ошибка')}</AlertTitle>
            <AlertDescription className="text-xs">{norm.applyError || t('normalize.scanFailed', 'Не удалось завершить анализ')}</AlertDescription>
          </Alert>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setPhase('scanning'); norm.executeDryRun({ aiSuggest: false, limit: 500 }); }}>
              {t('normalize.retry', 'Повторить')}
            </Button>
            <Button variant="ghost" onClick={onSkip}>
              {t('normalize.skipNormalization', 'Пропустить')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default NormalizationWizard;
