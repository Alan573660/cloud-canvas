import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { 
  Sparkles, History, Play, Clock, CheckCircle2, 
  XCircle, RefreshCw, ChevronRight, Calendar,
  FileText, Loader2
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { NormalizationWizard } from '@/components/import/NormalizationWizard';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { cn } from '@/lib/utils';

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

export function NormalizationTab() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const organizationId = profile?.organization_id;

  const [wizardOpen, setWizardOpen] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  // Fetch recent import jobs that have normalization data
  const { data: sessions, isLoading, refetch } = useQuery({
    queryKey: ['normalization-sessions', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];

      const { data, error } = await supabase
        .from('import_jobs')
        .select('id, created_at, file_name, status, total_rows, summary')
        .eq('organization_id', organizationId)
        .eq('entity_type', 'product_catalog')
        .in('status', ['COMPLETED', 'VALIDATED', 'APPLYING'])
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      return (data || []) as NormalizationSession[];
    },
    enabled: !!organizationId,
  });

  const handleStartNormalization = (jobId: string) => {
    setSelectedJobId(jobId);
    setWizardOpen(true);
  };

  const getStatusBadge = (status: string, summary: NormalizationSession['summary']) => {
    const hasEnrich = !!summary?.enrich?.completed_at;
    
    if (hasEnrich) {
      return (
        <Badge variant="default" className="bg-green-600">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          {t('normalize.normalized', 'Нормализован')}
        </Badge>
      );
    }

    if (status === 'COMPLETED') {
      return (
        <Badge variant="secondary">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          {t('normalize.imported', 'Импортирован')}
        </Badge>
      );
    }

    if (status === 'VALIDATED') {
      return (
        <Badge variant="outline">
          <Clock className="h-3 w-3 mr-1" />
          {t('normalize.awaitingNormalization', 'Ожидает')}
        </Badge>
      );
    }

    return (
      <Badge variant="destructive">
        <XCircle className="h-3 w-3 mr-1" />
        {status}
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            {t('normalize.title', 'Нормализация прайса')}
          </h2>
          <p className="text-muted-foreground mt-1">
            {t('normalize.description', 'AI-ассистент для стандартизации ширин, покрытий и цветов в каталоге')}
          </p>
        </div>
        <Button onClick={() => refetch()} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          {t('common.refresh', 'Обновить')}
        </Button>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t('normalize.totalSessions', 'Всего сессий')}</p>
                <p className="text-3xl font-bold">{sessions?.length || 0}</p>
              </div>
              <History className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t('normalize.normalizedImports', 'Нормализовано')}</p>
                <p className="text-3xl font-bold text-green-600">
                  {sessions?.filter(s => s.summary?.enrich?.completed_at).length || 0}
                </p>
              </div>
              <CheckCircle2 className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t('normalize.awaitingAction', 'Ожидают действия')}</p>
                <p className="text-3xl font-bold text-amber-600">
                  {sessions?.filter(s => s.status === 'VALIDATED' && !s.summary?.enrich).length || 0}
                </p>
              </div>
              <Clock className="h-8 w-8 text-amber-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sessions Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {t('normalize.sessionHistory', 'История сессий нормализации')}
          </CardTitle>
          <CardDescription>
            {t('normalize.sessionHistoryDesc', 'Все импорты с возможностью запуска или повторной нормализации')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : !sessions?.length ? (
            <div className="text-center py-12">
              <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">{t('normalize.noSessions', 'Нет сессий')}</h3>
              <p className="text-muted-foreground text-sm max-w-md mx-auto">
                {t('normalize.noSessionsDesc', 'Загрузите прайс через вкладку "Импорт", чтобы начать нормализацию')}
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
                  <TableHead>{t('normalize.result', 'Результат')}</TableHead>
                  <TableHead className="text-right">{t('common.actions', 'Действия')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session) => (
                  <TableRow key={session.id}>
                    <TableCell className="font-medium max-w-[200px] truncate">
                      {session.file_name || 'import.xlsx'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {format(new Date(session.created_at), 'dd MMM yyyy, HH:mm', { locale: ru })}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{session.total_rows}</Badge>
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(session.status, session.summary)}
                    </TableCell>
                    <TableCell>
                      {session.summary?.enrich?.patched_rows ? (
                        <span className="text-sm text-green-600">
                          +{session.summary.enrich.patched_rows} {t('normalize.patched', 'обновлено')}
                        </span>
                      ) : session.summary?.enrich?.questions_count ? (
                        <span className="text-sm text-muted-foreground">
                          {session.summary.enrich.questions_count} {t('normalize.questions', 'вопросов')}
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant={session.summary?.enrich?.completed_at ? 'outline' : 'default'}
                        onClick={() => handleStartNormalization(session.id)}
                      >
                        {session.summary?.enrich?.completed_at ? (
                          <>
                            <RefreshCw className="h-3 w-3 mr-1" />
                            {t('normalize.rerun', 'Повторить')}
                          </>
                        ) : (
                          <>
                            <Play className="h-3 w-3 mr-1" />
                            {t('normalize.start', 'Запустить')}
                          </>
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Normalization Wizard Dialog */}
      <Dialog open={wizardOpen} onOpenChange={setWizardOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              {t('normalize.wizardTitle', 'AI-нормализация каталога')}
            </DialogTitle>
            <DialogDescription>
              {t('normalize.wizardDesc', 'Проверьте и подтвердите предложения AI для стандартизации данных')}
            </DialogDescription>
          </DialogHeader>
          
          {selectedJobId && organizationId && (
            <NormalizationWizard
              organizationId={organizationId}
              importJobId={selectedJobId}
              stagingSample={[]}
              onComplete={() => {
                setWizardOpen(false);
                refetch();
              }}
              onSkip={() => setWizardOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
