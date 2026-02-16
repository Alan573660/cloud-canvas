import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { 
  Sparkles, History, Play, Clock, CheckCircle2, 
  XCircle, RefreshCw, FileText, Loader2
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { NormalizationWizard } from '@/components/normalization';
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

export function NormalizationTab() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const organizationId = profile?.organization_id;

  const [dialogOpen, setDialogOpen] = useState(false);
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
    setDialogOpen(true);
  };

  const handleNormalizeCurrent = () => {
    setSelectedJobId(null);
    setDialogOpen(true);
  };

  const getStatusBadge = (status: string, summary: NormalizationSession['summary']) => {
    const hasEnrich = !!summary?.enrich?.completed_at;
    if (hasEnrich) {
      return <Badge variant="default" className="bg-green-600"><CheckCircle2 className="h-3 w-3 mr-1" />{t('normalize.normalized', 'Нормализован')}</Badge>;
    }
    if (status === 'COMPLETED') {
      return <Badge variant="secondary"><CheckCircle2 className="h-3 w-3 mr-1" />{t('normalize.imported', 'Импортирован')}</Badge>;
    }
    if (status === 'VALIDATED') {
      return <Badge variant="outline"><Clock className="h-3 w-3 mr-1" />{t('normalize.awaitingNormalization', 'Ожидает')}</Badge>;
    }
    return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />{status}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            {t('normalize.title', 'Нормализация прайса')}
          </h2>
          <p className="text-muted-foreground mt-1">{t('normalize.description', 'Стандартизация данных каталога')}</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleNormalizeCurrent}><Sparkles className="h-4 w-4 mr-2" />{t('normalize.normalizeCurrent', 'Нормализовать каталог')}</Button>
          <Button onClick={() => refetch()} variant="outline" size="sm"><RefreshCw className="h-4 w-4 mr-2" />{t('common.refresh', 'Обновить')}</Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />{t('normalize.sessionHistory', 'История сессий')}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
          ) : !sessions?.length ? (
            <div className="text-center py-12"><FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" /><p className="text-muted-foreground">{t('normalize.noSessions', 'Нет сессий')}</p></div>
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
                {sessions.map((session) => (
                  <TableRow key={session.id}>
                    <TableCell className="font-medium max-w-[200px] truncate">{session.file_name || 'import.xlsx'}</TableCell>
                    <TableCell className="text-muted-foreground">{format(new Date(session.created_at), 'dd MMM yyyy, HH:mm', { locale: ru })}</TableCell>
                    <TableCell><Badge variant="outline">{session.total_rows}</Badge></TableCell>
                    <TableCell>{getStatusBadge(session.status, session.summary)}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant={session.summary?.enrich?.completed_at ? 'outline' : 'default'} onClick={() => handleStartNormalization(session.id)}>
                        {session.summary?.enrich?.completed_at ? <><RefreshCw className="h-3 w-3 mr-1" />{t('normalize.rerun', 'Повторить')}</> : <><Play className="h-3 w-3 mr-1" />{t('normalize.start', 'Запустить')}</>}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {organizationId && (
        <NormalizationWizard
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          organizationId={organizationId}
          importJobId={selectedJobId || undefined}
          onComplete={() => { setDialogOpen(false); refetch(); }}
        />
      )}
    </div>
  );
}