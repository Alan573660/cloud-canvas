import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { 
  ArrowLeft, Loader2, Phone, PhoneIncoming, PhoneOutgoing, 
  Play, FileText, AlertCircle, Clock, User, ExternalLink
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { StatusBadge } from '@/components/ui/status-badge';
import { Badge } from '@/components/ui/badge';
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
}

export default function CallDetailPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const dateLocale = i18n.language === 'ru' ? ru : enUS;

  // Fetch call session
  const { data: call, isLoading } = useQuery({
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
    enabled: !!id,
  });

  // Fetch linked lead
  const { data: lead } = useQuery({
    queryKey: ['call-lead', call?.lead_id],
    queryFn: async () => {
      if (!call?.lead_id) return null;
      const { data, error } = await supabase
        .from('leads')
        .select('id, title, subject, status')
        .eq('id', call.lead_id)
        .single();
      if (error) return null;
      return data as Lead;
    },
    enabled: !!call?.lead_id,
  });

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
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

  const getSentimentLabel = (sentiment: string | null) => {
    if (!sentiment) return null;
    const key = `calls.sentiments.${sentiment.toLowerCase()}`;
    return t(key, sentiment);
  };

  const getSentimentColor = (sentiment: string | null) => {
    switch (sentiment?.toLowerCase()) {
      case 'positive':
        return 'bg-green-100 text-green-800';
      case 'negative':
        return 'bg-red-100 text-red-800';
      case 'neutral':
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!call) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => navigate('/calls')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t('common.back')}
        </Button>
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            {t('errors.notFound')}
          </CardContent>
        </Card>
      </div>
    );
  }

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

        {call.recording_url && (
          <Button onClick={() => window.open(call.recording_url!, '_blank')}>
            <Play className="h-4 w-4 mr-2" />
            {t('calls.playRecording')}
          </Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Call Info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Phone className="h-5 w-5" />
              {t('calls.callInfo')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">{t('calls.direction')}</p>
                <p className="font-medium flex items-center gap-2">
                  {call.direction === 'inbound' ? (
                    <>
                      <PhoneIncoming className="h-4 w-4 text-green-500" />
                      {t('calls.inbound')}
                    </>
                  ) : (
                    <>
                      <PhoneOutgoing className="h-4 w-4 text-blue-500" />
                      {t('calls.outbound')}
                    </>
                  )}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t('common.status')}</p>
                <div className="mt-1">
                  <StatusBadge
                    status={getStatusLabel(call.status)}
                    type={getStatusType(call.status)}
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">{t('calls.fromPhone')}</p>
                <p className="font-medium font-mono">{call.from_phone || '—'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t('calls.toPhone')}</p>
                <p className="font-medium font-mono">{call.to_phone || '—'}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">{t('calls.duration')}</p>
                <p className="font-medium flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  {formatDuration(call.duration_seconds)}
                </p>
              </div>
              {call.sentiment && (
                <div>
                  <p className="text-sm text-muted-foreground">{t('calls.sentiment')}</p>
                  <Badge className={getSentimentColor(call.sentiment)}>
                    {getSentimentLabel(call.sentiment)}
                  </Badge>
                </div>
              )}
            </div>

            {call.error_reason && (
              <div className="p-3 bg-destructive/10 text-destructive rounded-lg">
                <p className="text-sm font-medium flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  {t('common.error')}:
                </p>
                <p className="text-sm mt-1">{call.error_reason}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* AI Summary & Related Lead */}
        <div className="space-y-6">
          {call.ai_summary && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  {t('calls.aiSummary')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{call.ai_summary}</p>
              </CardContent>
            </Card>
          )}

          {lead && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  {t('calls.linkedLead')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{lead.title || lead.subject || lead.id.slice(0, 8)}</p>
                    <StatusBadge status={lead.status} type="default" />
                  </div>
                  <Button
                    variant="outline"
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
        </div>
      </div>

      {/* Transcript */}
      {(call.transcript_text || call.transcript_url) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {t('calls.transcript')}
            </CardTitle>
            <CardDescription>
              {t('calls.transcriptDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {call.transcript_url && (
              <div className="mb-4">
                <Button
                  variant="outline"
                  onClick={() => window.open(call.transcript_url!, '_blank')}
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  {t('calls.openTranscriptFile')}
                </Button>
              </div>
            )}
            
            {call.transcript_text && (
              <Accordion type="single" collapsible defaultValue="transcript">
                <AccordionItem value="transcript" className="border rounded">
                  <AccordionTrigger className="px-4">
                    {t('calls.viewTranscript')}
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pb-4">
                    <pre className="text-sm whitespace-pre-wrap bg-muted p-4 rounded max-h-96 overflow-auto">
                      {call.transcript_text}
                    </pre>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
