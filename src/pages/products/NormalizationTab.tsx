import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Sparkles, Play, Clock, CheckCircle2,
  XCircle, RefreshCw, FileText, Loader2,
  AlertTriangle, Ruler, Palette, Layers,
  BarChart3, TrendingUp, Activity
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { NormalizationWizard } from '@/components/normalization/NormalizationWizard';
import { useNormalization, type DashboardQuestionCard } from '@/hooks/use-normalization';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

interface NormalizationSession {
  id: string;
  created_at: string;
  file_name: string | null;
  status: string;
  total_rows: number;
  summary: {
    enrich?: {
      run_id?: string;
      patched_rows?: number;
      questions_count?: number;
      completed_at?: string;
    };
  };
}

// ─── Question type icons and labels ──────────────────────────

const QUESTION_TYPE_CONFIG: Record<string, { icon: React.ElementType; label: string; colorClass: string }> = {
  WIDTH_MASTER:      { icon: Ruler,       label: 'Ширины',           colorClass: 'border-l-4 border-l-blue-500 bg-muted/50' },
  COATING_MAP:       { icon: Layers,      label: 'Покрытия',         colorClass: 'border-l-4 border-l-orange-500 bg-muted/50' },
  COLOR_MAP:         { icon: Palette,     label: 'Цвета',            colorClass: 'border-l-4 border-l-purple-500 bg-muted/50' },
  THICKNESS_SET:     { icon: BarChart3,   label: 'Толщины',          colorClass: 'border-l-4 border-l-green-500 bg-muted/50' },
  PROFILE_MAP:       { icon: TrendingUp,  label: 'Профили',          colorClass: 'border-l-4 border-l-cyan-500 bg-muted/50' },
  CATEGORY_FIX:      { icon: Activity,    label: 'Категории',        colorClass: 'border-l-4 border-l-destructive bg-muted/50' },
  PRODUCT_KIND_MAP:  { icon: Activity,    label: 'Тип продукции',    colorClass: 'border-l-4 border-l-amber-500 bg-muted/50' },
};

function getQuestionConfig(type: string) {
  return QUESTION_TYPE_CONFIG[type] || { icon: AlertTriangle, label: type, colorClass: 'border-l-4 border-l-muted bg-muted/50' };
}

// ─── KPI Dashboard from /api/enrich/dashboard ────────────────

function DashboardPanel({ organizationId, onLaunchWizard }: { organizationId: string; onLaunchWizard: (jobId?: string) => void }) {
  const { t } = useTranslation();
  const norm = useNormalization({ organizationId });
  const {
    fetchDashboard,
    dashboardResult: dash,
    dashboardLoading,
  } = norm;

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  const progress = dash?.progress;
  const questionCards = dash?.question_cards || [];

  if (dashboardLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-3 text-muted-foreground">{t('normalize.loadingDashboard', 'Загрузка сводки…')}</span>
      </div>
    );
  }

  if (!dash && !dashboardLoading) {
    return (
      <div className="text-center py-12">
        <Activity className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <p className="text-muted-foreground text-sm">{t('normalize.noDashboard', 'Сводка недоступна. Убедитесь, что каталог-энричер запущен.')}</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => fetchDashboard()}>
          <RefreshCw className="h-4 w-4 mr-2" />{t('common.retry', 'Повторить')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI Row */}
      {progress && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">{t('normalize.totalRows', 'Всего товаров')}</span>
                <FileText className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="text-2xl font-bold">{progress.total.toLocaleString('ru')}</div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">{t('normalize.readyCount', 'Готово')}</span>
                <CheckCircle2 className="h-4 w-4 text-primary" />
              </div>
              <div className="text-2xl font-bold">{progress.ready.toLocaleString('ru')}</div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">{t('normalize.needsAttention', 'Требуют внимания')}</span>
                <AlertTriangle className="h-4 w-4 text-destructive" />
              </div>
              <div className="text-2xl font-bold text-destructive">{progress.needs_attention.toLocaleString('ru')}</div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">{t('normalize.readyPct', 'Готовность')}</span>
                <TrendingUp className="h-4 w-4 text-primary" />
              </div>
              <div className="text-2xl font-bold text-primary">{progress.ready_pct.toFixed(1)}%</div>
              <Progress value={progress.ready_pct} className="h-1.5 mt-2" />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Question cards by type */}
      {questionCards.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
            {t('normalize.openTasks', 'Задачи нормализации')}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {questionCards
              .sort((a, b) => (b.count || 0) - (a.count || 0))
              .map((card: DashboardQuestionCard) => {
                const cfg = getQuestionConfig(card.type);
                const Icon = cfg.icon;
                return (
                  <button
                    key={card.type}
                    onClick={() => onLaunchWizard()}
                    className={`text-left p-4 rounded-lg border transition-all hover:shadow-md ${cfg.colorClass}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4" />
                        <span className="font-medium text-sm">{card.label || cfg.label}</span>
                      </div>
                      <Badge variant="secondary" className="text-xs font-bold">
                        {card.count}
                      </Badge>
                    </div>
                    {card.examples && card.examples.length > 0 && (
                      <p className="text-xs text-muted-foreground truncate">
                        {card.examples.slice(0, 2).join(', ')}
                      </p>
                    )}
                    <p className="text-xs mt-1 text-muted-foreground/60">{t('normalize.clickToFix', 'Нажмите для исправления →')}</p>
                  </button>
                );
              })}
          </div>
        </div>
      )}

      {questionCards.length === 0 && progress && progress.needs_attention === 0 && (
        <div className="text-center py-8">
          <CheckCircle2 className="h-12 w-12 mx-auto text-primary mb-3" />
          <h3 className="font-semibold">{t('normalize.allGood', 'Каталог нормализован!')}</h3>
          <p className="text-muted-foreground text-sm mt-1">{t('normalize.allGoodDesc', 'Все товары заполнены корректно.')}</p>
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={() => fetchDashboard()} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />{t('common.refresh', 'Обновить')}
        </Button>
      </div>
    </div>
  );
}

// ─── Main Tab ─────────────────────────────────────────────────

export function NormalizationTab() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const organizationId = profile?.organization_id;

  const [wizardOpen, setWizardOpen] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const { data: sessions, isLoading, refetch } = useQuery({
    queryKey: ['normalization-sessions', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from('import_jobs')
        .select('id, created_at, file_name, status, total_rows, summary')
        .eq('organization_id', organizationId)
        .eq('entity_type', 'PRODUCT_CATALOG')
        .in('status', ['COMPLETED', 'VALIDATED', 'APPLYING', 'DONE'])
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data || []) as NormalizationSession[];
    },
    enabled: !!organizationId,
  });

  const handleLaunchWizard = useCallback((jobId?: string) => {
    setSelectedJobId(jobId || null);
    setWizardOpen(true);
  }, []);

  const handleWizardComplete = useCallback(() => {
    setWizardOpen(false);
    refetch();
  }, [refetch]);

  const getStatusBadge = (status: string, summary: NormalizationSession['summary']) => {
    const hasEnrich = !!summary?.enrich?.completed_at;
    if (hasEnrich) {
      return <Badge className="text-xs bg-primary text-primary-foreground"><CheckCircle2 className="h-3 w-3 mr-1" />{t('normalize.normalized', 'Нормализован')}</Badge>;
    }
    if (status === 'COMPLETED' || status === 'DONE') {
      return <Badge variant="secondary" className="text-xs"><CheckCircle2 className="h-3 w-3 mr-1" />{t('normalize.imported', 'Импортирован')}</Badge>;
    }
    if (status === 'VALIDATED') {
      return <Badge variant="outline" className="text-xs"><Clock className="h-3 w-3 mr-1" />{t('normalize.awaitingNormalization', 'Ожидает')}</Badge>;
    }
    return <Badge variant="destructive" className="text-xs"><XCircle className="h-3 w-3 mr-1" />{status}</Badge>;
  };

  if (!organizationId) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            {t('normalize.title', 'Нормализация прайса')}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('normalize.description', 'ИИ-стандартизация: профили, толщины, покрытия, цвета')}
          </p>
        </div>
        <Button onClick={() => handleLaunchWizard()}>
          <Sparkles className="h-4 w-4 mr-2" />
          {t('normalize.launchWizard', 'Запустить мастер')}
        </Button>
      </div>

      {/* Dashboard — KPI from enricher */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4" />
            {t('normalize.catalogHealth', 'Состояние каталога')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DashboardPanel organizationId={organizationId} onLaunchWizard={handleLaunchWizard} />
        </CardContent>
      </Card>

      {/* Session history */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" />
              {t('normalize.sessionHistory', 'История импортов')}
            </CardTitle>
            <Button onClick={() => refetch()} variant="ghost" size="sm">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !sessions?.length ? (
            <div className="text-center py-10">
              <FileText className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground text-sm">
                {t('normalize.noSessions', 'Нет импортов. Загрузите прайс-лист на вкладке «Импорт».')}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('normalize.file', 'Файл')}</TableHead>
                  <TableHead>{t('normalize.date', 'Дата')}</TableHead>
                  <TableHead>{t('normalize.rows', 'Строк')}</TableHead>
                  <TableHead>{t('normalize.status', 'Статус')}</TableHead>
                  <TableHead className="text-right">{t('common.actions', 'Действия')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session) => {
                  const hasEnrich = !!session.summary?.enrich?.completed_at;
                  return (
                    <TableRow key={session.id}>
                      <TableCell className="font-medium max-w-[200px] truncate text-sm">
                        {session.file_name || 'import.xlsx'}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {format(new Date(session.created_at), 'dd MMM yyyy, HH:mm', { locale: ru })}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{session.total_rows.toLocaleString('ru')}</Badge>
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(session.status, session.summary)}
                        {session.summary?.enrich?.patched_rows != null && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            ({session.summary.enrich.patched_rows} исправлений)
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant={hasEnrich ? 'outline' : 'default'}
                          onClick={() => handleLaunchWizard(session.id)}
                        >
                          {hasEnrich
                            ? <><RefreshCw className="h-3 w-3 mr-1" />{t('normalize.rerun', 'Повторить')}</>
                            : <><Play className="h-3 w-3 mr-1" />{t('normalize.start', 'Нормализовать')}</>}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Full-featured Normalization Wizard */}
      <NormalizationWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        organizationId={organizationId}
        importJobId={selectedJobId || undefined}
        onComplete={handleWizardComplete}
      />
    </div>
  );
}
