import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Phone, PhoneIncoming, PhoneOutgoing, Eye, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StatusBadge } from '@/components/ui/status-badge';
import { format } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';

interface CallSession {
  id: string;
  direction: string;
  from_phone: string | null;
  to_phone: string | null;
  started_at: string | null;
  duration_seconds: number;
  status: string;
  error_reason: string | null;
}

interface CallsListProps {
  leadId: string | null | undefined;
  showTitle?: boolean;
}

export function CallsList({ leadId, showTitle = true }: CallsListProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const dateLocale = i18n.language === 'ru' ? ru : enUS;

  const { data: calls, isLoading } = useQuery({
    queryKey: ['calls-for-lead', leadId],
    queryFn: async () => {
      if (!leadId) return [];
      const { data, error } = await supabase
        .from('call_sessions')
        .select('id, direction, from_phone, to_phone, started_at, duration_seconds, status, error_reason')
        .eq('lead_id', leadId)
        .order('started_at', { ascending: false });
      
      if (error) {
        console.warn('Cannot fetch calls:', error.message);
        return [];
      }
      return data as CallSession[];
    },
    enabled: !!leadId,
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

  if (!leadId) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          {t('calls.noCalls')}
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      {showTitle && (
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5" />
            {t('calls.title')}
          </CardTitle>
        </CardHeader>
      )}
      <CardContent className={showTitle ? '' : 'pt-6'}>
        {calls && calls.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('calls.direction')}</TableHead>
                <TableHead>{t('calls.fromPhone')}</TableHead>
                <TableHead>{t('calls.toPhone')}</TableHead>
                <TableHead>{t('calls.startedAt')}</TableHead>
                <TableHead>{t('calls.duration')}</TableHead>
                <TableHead>{t('common.status')}</TableHead>
                <TableHead>{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {calls.map((call) => (
                <TableRow key={call.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {call.direction === 'inbound' ? (
                        <PhoneIncoming className="h-4 w-4 text-green-500" />
                      ) : (
                        <PhoneOutgoing className="h-4 w-4 text-blue-500" />
                      )}
                      <span>
                        {call.direction === 'inbound' ? t('calls.inbound') : t('calls.outbound')}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {call.from_phone || '—'}
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {call.to_phone || '—'}
                  </TableCell>
                  <TableCell>
                    {call.started_at
                      ? format(new Date(call.started_at), 'dd MMM HH:mm', { locale: dateLocale })
                      : '—'}
                  </TableCell>
                  <TableCell className="font-mono">
                    {formatDuration(call.duration_seconds)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <StatusBadge
                        status={getStatusLabel(call.status)}
                        type={getStatusType(call.status)}
                      />
                      {call.error_reason && (
                        <span className="text-xs text-destructive truncate max-w-[100px]" title={call.error_reason}>
                          {call.error_reason}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => navigate(`/calls/${call.id}`)}
                      title={t('common.details')}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            {t('calls.noCalls')}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
