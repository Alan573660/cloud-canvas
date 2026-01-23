import { useTranslation } from 'react-i18next';
import { 
  Loader2, 
  CheckCircle2, 
  XCircle, 
  ChevronRight,
  FileSpreadsheet,
  X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { useActiveImportJob, ActiveImportJob } from '@/hooks/use-active-import';

interface ActiveImportBannerProps {
  onNavigateToImport?: () => void;
  className?: string;
}

export function ActiveImportBanner({ onNavigateToImport, className }: ActiveImportBannerProps) {
  const { t } = useTranslation();
  const { 
    activeJob, 
    isInProgress, 
    isCompleted, 
    isFailed, 
    clearActiveJob,
    getStepInfo 
  } = useActiveImportJob();

  if (!activeJob) return null;

  const stepInfo = getStepInfo();
  const showBanner = isInProgress || isCompleted || isFailed;

  if (!showBanner) return null;

  const getStatusIcon = () => {
    if (isCompleted) return <CheckCircle2 className="h-5 w-5 text-green-600" />;
    if (isFailed) return <XCircle className="h-5 w-5 text-destructive" />;
    return <Loader2 className="h-5 w-5 text-primary animate-spin" />;
  };

  const getStatusLabel = () => {
    switch (activeJob.status) {
      case 'QUEUED': return t('import.status.queued', 'Подготовка...');
      case 'VALIDATING': return t('import.status.validating', 'Проверка файла...');
      case 'VALIDATED': return t('import.status.validated', 'Файл проверен');
      case 'APPLYING': return t('import.status.applying', 'Применение изменений...');
      case 'COMPLETED': return t('import.status.completed', 'Импорт завершён');
      case 'FAILED': return t('import.status.failed', 'Ошибка импорта');
      default: return activeJob.status;
    }
  };

  const getBannerStyle = () => {
    if (isCompleted) return 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800';
    if (isFailed) return 'bg-destructive/10 border-destructive/30';
    return 'bg-primary/5 border-primary/20';
  };

  return (
    <div 
      className={cn(
        'rounded-lg border p-4 transition-all duration-300',
        getBannerStyle(),
        className
      )}
    >
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div className="flex-shrink-0 mt-0.5">
          {getStatusIcon()}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-2">
          {/* Header */}
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-sm truncate">
              {activeJob.file_name || 'Import'}
            </span>
            <span className="text-sm text-muted-foreground">—</span>
            <span className="text-sm font-medium">{getStatusLabel()}</span>
          </div>

          {/* Progress bar */}
          {isInProgress && stepInfo && (
            <div className="space-y-1">
              <Progress value={stepInfo.progress} className="h-2" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>
                  {stepInfo.steps[stepInfo.currentIdx]?.label || ''}
                </span>
                <span>
                  {Math.round(stepInfo.progress)}%
                </span>
              </div>
            </div>
          )}

          {/* Stats for completed */}
          {isCompleted && (
            <div className="flex gap-4 text-sm">
              <span className="text-green-600">
                +{activeJob.inserted_rows} {t('import.inserted', 'добавлено')}
              </span>
              <span className="text-blue-600">
                ~{activeJob.updated_rows} {t('import.updated', 'обновлено')}
              </span>
              <span className="text-muted-foreground">
                / {activeJob.total_rows} {t('import.total', 'всего')}
              </span>
            </div>
          )}

          {/* Error message */}
          {isFailed && activeJob.error_message && (
            <p className="text-sm text-destructive line-clamp-2">
              {activeJob.error_message}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {onNavigateToImport && (
            <Button 
              variant="ghost" 
              size="sm"
              onClick={onNavigateToImport}
              className="gap-1"
            >
              {t('import.viewDetails', 'Подробнее')}
              <ChevronRight className="h-4 w-4" />
            </Button>
          )}
          
          {(isCompleted || isFailed) && (
            <Button 
              variant="ghost" 
              size="icon"
              onClick={clearActiveJob}
              className="h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
