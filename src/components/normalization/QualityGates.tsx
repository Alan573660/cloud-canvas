/**
 * QualityGates — серверные метрики заполненности после apply.
 */

import { useTranslation } from 'react-i18next';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import type { QualityMetrics } from '@/hooks/use-normalization';

interface QualityGatesProps {
  metrics: QualityMetrics;
}

interface MetricRow {
  key: string;
  label: string;
  value: number;
  total: number;
}

export function QualityGates({ metrics }: QualityGatesProps) {
  const { t } = useTranslation();
  const total = metrics.total || 1;

  const rows: MetricRow[] = [
    { key: 'profile', label: t('normalize.metricProfile', 'Профиль'), value: metrics.profile_filled ?? 0, total },
    { key: 'width_work', label: t('normalize.metricWidthWork', 'Раб. ширина'), value: metrics.width_work_filled ?? 0, total },
    { key: 'width_full', label: t('normalize.metricWidthFull', 'Полн. ширина'), value: metrics.width_full_filled ?? 0, total },
    { key: 'coating', label: t('normalize.metricCoating', 'Покрытие'), value: metrics.coating_filled ?? 0, total },
    { key: 'color_system', label: t('normalize.metricColorSystem', 'Цветовая система'), value: metrics.color_system_filled ?? 0, total },
    { key: 'color_code', label: t('normalize.metricColorCode', 'Код цвета'), value: metrics.color_code_filled ?? 0, total },
    { key: 'kind', label: t('normalize.metricKind', 'Тип != OTHER'), value: metrics.kind_non_other ?? 0, total },
  ];

  return (
    <div className="border rounded-lg p-4 bg-muted/30 space-y-3">
      <h4 className="text-sm font-semibold flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-green-600" />
        {t('normalize.qualityGates', 'Серверные метрики')}
        <Badge variant="outline" className="ml-auto text-xs">{t('normalize.totalRows', 'Всего')}: {total}</Badge>
      </h4>
      <div className="space-y-2">
        {rows.map(row => {
          const pct = total > 0 ? Math.round((row.value / total) * 100) : 0;
          const isGood = pct >= 90;
          return (
            <div key={row.key} className="flex items-center gap-3">
              <span className="text-xs w-28 shrink-0 text-muted-foreground">{row.label}</span>
              <Progress value={pct} className="flex-1 h-2" />
              <span className={`text-xs font-mono w-16 text-right ${isGood ? 'text-green-600' : 'text-amber-600'}`}>
                {row.value}/{total} ({pct}%)
              </span>
              {!isGood && <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
