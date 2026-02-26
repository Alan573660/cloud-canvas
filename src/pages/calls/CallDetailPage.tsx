import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { 
  ArrowLeft, Phone, PhoneIncoming, PhoneOutgoing, 
  Play, FileText, AlertCircle, Clock, User, ExternalLink, Mic, Brain,
  Calendar, Timer, Smile, Meh, Frown
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { StatusBadge } from '@/components/ui/status-badge';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { DetailPageSkeleton } from '@/components/ui/page-skeleton';
import { NotFound, PermissionDenied } from '@/components/ui/permission-denied';
import { openSignedUrl } from '@/lib/file-utils';
import { showErrorToast } from '@/lib/error-utils';
import { hasPermission } from '@/lib/security-utils';
import { format } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';

interface CallSession {
  id: string;
  direction: string;
  from_phone: string | null;
  to_phone: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number;
  status: string;
  error_reason: string | null;
  recording_url: string | null;
  transcript_text: string | null;
  transcript_url: string | null;
  ai_summary: string | null;
  sentiment: string | null;
  lead_id: string | null;
  created_at: string;
  updated_at: string;
}

interface Lead {
  id: string;
  title: string | null;
  subject: string | null;
  status: string;
  source: string;
}

export default function CallDetailPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();

  const dateLocale = i18n.language === 'ru' ? ru : enUS;

  // Role check: accountant cannot access calls
  const canViewCalls = hasPermission(profile?.role, 'calls', 'view');

  // Fetch call session — hooks MUST be before early return
  const { data: call, isLoading, error } = useQuery({
    queryKey: ['call', id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from('call_sessions')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as CallSession;
    },
    enabled: !!id && canViewCalls,
  });

  // Fetch linked lead
  const { data: lead } = useQuery({
    queryKey: ['call-lead', call?.lead_id],
    queryFn: async () => {
      if (!call?.lead_id) return null;
      const { data, error } = await supabase
        .from('leads')
        .select('id, title, subject, status, source')
        .eq('id', call.lead_id)
        .single();
      if (error) return null;
      return data as Lead;
    },
    enabled: !!call?.lead_id,
  });

  // Permission denied — AFTER all hooks
  if (!canViewCalls && profile) {
    return <PermissionDenied />;
  }

  // Show error toast if query failed
  if (error) {
    showErrorToast(error, { logPrefix: 'CallDetailPage' });
  }

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatFullDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins === 0) return `${secs} ${t('calls.seconds', 'сек')}`;
    return `${mins} ${t('calls.minutes', 'мин')} ${secs} ${t('calls.seconds', 'сек')}`;
  };

  const getStatusLabel = (status: string) => {
    const key = `calls.statuses.${status.toLowerCase()}`;
    return t(key, status);
  };

  const getStatusType = (status: string) => {
    switch (status) {
      case 'DONE':
        return 'success' as const;
      case 'IN_PROGRESS':
      case 'RINGING':
        return 'info' as const;
      case 'FAILED':
      case 'NO_ANSWER':
      case 'BUSY':
        return 'error' as const;
      default:
        return 'default' as const;
    }
  };

  const getSentimentIcon = (sentiment: string | null) => {
    switch (sentiment?.toLowerCase()) {
      case 'positive':
        return <Smile className="h-5 w-5 text-green-500" />;
      case 'negative':
        return <Frown className="h-5 w-5 text-red-500" />;
      case 'neutral':
        return <Meh className="h-5 w-5 text-gray-500" />;
      default:
        return null;
    }
  };

  const getSentimentLabel = (sentiment: string | null) => {
    if (!sentiment) return null;
    const key = `calls.sentiments.${sentiment.toLowerCase()}`;
    return t(key, sentiment);
  };

  const getSentimentColor = (sentiment: string | null) => {
    switch (sentiment?.toLowerCase()) {
      case 'positive':
        return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800';
      case 'negative':
        return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800';
      case 'neutral':
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200 border-gray-200 dark:border-gray-700';
    }
  };

  const getLeadSourceLabel = (source: string) => {
    const key = `leads.sources.${source.toLowerCase()}`;
    return t(key, source);
  };

  if (isLoading) {
    return <DetailPageSkeleton />;
  }

  if (!call) {
    return <NotFound resourceType={t('calls.title')} backPath="/calls" />;
  }

  const hasRecording = !!call.recording_url;
  const hasTranscript = !!call.transcript_text || !!call.transcript_url;
  const hasSummary = !!call.ai_summary;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => navigate('/calls')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t('common.back')}
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              {call.direction === 'inbound' ? (
                <PhoneIncoming className="h-6 w-6 text-green-500" />
              ) : (
                <PhoneOutgoing className="h-6 w-6 text-blue-500" />
              )}
              {t('calls.callDetails')}
            </h1>
            <p className="text-sm text-muted-foreground">
              {call.started_at
                ? format(new Date(call.started_at), 'dd MMMM yyyy, HH:mm', { locale: dateLocale })
                : format(new Date(call.created_at), 'dd MMMM yyyy, HH:mm', { locale: dateLocale })}
            </p>
          </div>
        </div>

        {hasRecording && (
          <Button onClick={() => openSignedUrl(call.recording_url, 'recording.mp3')}>
            <Play className="h-4 w-4 mr-2" />
            {t('calls.playRecording')}
          </Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Call Info Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Phone className="h-5 w-5" />
              {t('calls.callInfo')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Direction & Status */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {t('calls.direction')}
                </p>
                <div className="flex items-center gap-2">
                  {call.direction === 'inbound' ? (
                    <>
                      <div className="p-1.5 rounded-full bg-green-100 dark:bg-green-900/30">
                        <PhoneIncoming className="h-4 w-4 text-green-600 dark:text-green-400" />
                      </div>
                      <span className="font-medium">{t('calls.inbound')}</span>
                    </>
                  ) : (
                    <>
                      <div className="p-1.5 rounded-full bg-blue-100 dark:bg-blue-900/30">
                        <PhoneOutgoing className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      </div>
                      <span className="font-medium">{t('calls.outbound')}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {t('common.status')}
                </p>
                <StatusBadge
                  status={getStatusLabel(call.status)}
                  type={getStatusType(call.status)}
                />
              </div>
            </div>

            <Separator />

            {/* Phone Numbers */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {t('calls.fromPhone')}
                </p>
                <p className="font-mono text-lg">{call.from_phone || '—'}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {t('calls.toPhone')}
                </p>
                <p className="font-mono text-lg">{call.to_phone || '—'}</p>
              </div>
            </div>

            <Separator />

            {/* Time Info */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {t('calls.startedAt')}
                </p>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span>
                    {call.started_at
                      ? format(new Date(call.started_at), 'dd.MM.yyyy HH:mm:ss', { locale: dateLocale })
                      : '—'}
                  </span>
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {t('calls.endedAt')}
                </p>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span>
                    {call.ended_at
                      ? format(new Date(call.ended_at), 'dd.MM.yyyy HH:mm:ss', { locale: dateLocale })
                      : '—'}
                  </span>
                </div>
              </div>
            </div>

            {/* Duration & Sentiment */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {t('calls.duration')}
                </p>
                <div className="flex items-center gap-2">
                  <Timer className="h-4 w-4 text-muted-foreground" />
                  <span className="font-mono text-lg tabular-nums">{formatDuration(call.duration_seconds)}</span>
                  <span className="text-sm text-muted-foreground">
                    ({formatFullDuration(call.duration_seconds)})
                  </span>
                </div>
              </div>
              {call.sentiment && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {t('calls.sentiment')}
                  </p>
                  <div className="flex items-center gap-2">
                    {getSentimentIcon(call.sentiment)}
                    <Badge variant="outline" className={getSentimentColor(call.sentiment)}>
                      {getSentimentLabel(call.sentiment)}
                    </Badge>
                  </div>
                </div>
              )}
            </div>

            {/* Error */}
            {call.error_reason && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive rounded-lg">
                <p className="text-sm font-medium flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  {t('common.error')}
                </p>
                <p className="text-sm mt-1 opacity-90">{call.error_reason}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Linked Lead & Additional Info */}
        <div className="space-y-6">
          {lead && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  {t('calls.linkedLead')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-2">
                    <p className="font-semibold text-lg">
                      {lead.title || lead.subject || `#${lead.id.slice(0, 8)}`}
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <StatusBadge status={lead.status} type="default" />
                      <Badge variant="outline" className="text-xs">
                        {getLeadSourceLabel(lead.source)}
                      </Badge>
                    </div>
                  </div>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => navigate(`/leads/${lead.id}`)}
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    {t('common.open')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Quick Stats Card */}
          {(hasRecording || hasTranscript || hasSummary) && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">
                  {t('calls.availableData', 'Доступные данные')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {hasRecording && (
                    <Badge variant="secondary" className="flex items-center gap-1">
                      <Mic className="h-3 w-3" />
                      {t('calls.recording', 'Запись')}
                    </Badge>
                  )}
                  {hasTranscript && (
                    <Badge variant="secondary" className="flex items-center gap-1">
                      <FileText className="h-3 w-3" />
                      {t('calls.transcript')}
                    </Badge>
                  )}
                  {hasSummary && (
                    <Badge variant="secondary" className="flex items-center gap-1">
                      <Brain className="h-3 w-3" />
                      {t('calls.aiSummary')}
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {!lead && !hasSummary && !hasTranscript && !hasRecording && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                <Phone className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p>{t('calls.noAdditionalInfo', 'Дополнительная информация отсутствует')}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Tabs for Summary, Transcript, Recording */}
      {(hasSummary || hasTranscript || hasRecording) && (
        <Card>
          <Tabs defaultValue={hasSummary ? 'summary' : hasTranscript ? 'transcript' : 'recording'}>
            <CardHeader>
              <TabsList>
                {hasSummary && (
                  <TabsTrigger value="summary" className="flex items-center gap-2">
                    <Brain className="h-4 w-4" />
                    {t('calls.aiSummary')}
                  </TabsTrigger>
                )}
                {hasTranscript && (
                  <TabsTrigger value="transcript" className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    {t('calls.transcript')}
                  </TabsTrigger>
                )}
                {hasRecording && (
                  <TabsTrigger value="recording" className="flex items-center gap-2">
                    <Mic className="h-4 w-4" />
                    {t('calls.recording', 'Запись')}
                  </TabsTrigger>
                )}
              </TabsList>
            </CardHeader>
            <CardContent>
              {hasSummary && (
                <TabsContent value="summary" className="mt-0">
                  <div className="prose dark:prose-invert max-w-none">
                    <p className="whitespace-pre-wrap">{call.ai_summary}</p>
                  </div>
                </TabsContent>
              )}

              {hasTranscript && (
                <TabsContent value="transcript" className="mt-0">
                  {call.transcript_url && (
                    <div className="mb-4">
                      <Button
                        variant="outline"
                        onClick={() => openSignedUrl(call.transcript_url, 'transcript.txt')}
                      >
                        <ExternalLink className="h-4 w-4 mr-2" />
                        {t('calls.openTranscriptFile')}
                      </Button>
                    </div>
                  )}
                  
                  {call.transcript_text && (
                    <pre className="text-sm whitespace-pre-wrap bg-muted p-4 rounded-lg max-h-96 overflow-auto font-mono">
                      {call.transcript_text}
                    </pre>
                  )}

                  {!call.transcript_text && call.transcript_url && (
                    <p className="text-muted-foreground">
                      {t('calls.transcriptInFile', 'Транскрипт доступен в файле')}
                    </p>
                  )}
                </TabsContent>
              )}

              {hasRecording && (
                <TabsContent value="recording" className="mt-0">
                  <div className="flex flex-col items-center gap-4 py-8">
                    <div className="rounded-full bg-primary/10 p-6">
                      <Mic className="h-12 w-12 text-primary" />
                    </div>
                    <p className="text-muted-foreground text-center">
                      {t('calls.recordingAvailable', 'Запись разговора доступна')}
                    </p>
                    <Button onClick={() => openSignedUrl(call.recording_url, 'recording.mp3')}>
                      <Play className="h-4 w-4 mr-2" />
                      {t('calls.playRecording')}
                    </Button>
                  </div>
                </TabsContent>
              )}
            </CardContent>
          </Tabs>
        </Card>
      )}
    </div>
  );
}
