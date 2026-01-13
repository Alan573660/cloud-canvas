import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Plus, Loader2, Filter } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, Column } from '@/components/ui/data-table';
import { StatusBadge, getStatusType } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';
import QueueEmailForm from './QueueEmailForm';

// DB status values - MUST match database exactly
const OUTBOX_STATUSES = ['QUEUED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED'] as const;
type OutboxStatus = typeof OUTBOX_STATUSES[number];

interface EmailOutbox {
  id: string;
  to_email: string;
  subject: string | null;
  status: OutboxStatus;
  queued_at: string;
  sent_at: string | null;
  error_reason: string | null;
  provider_message_id: string | null;
}

export default function EmailOutboxTab() {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<OutboxStatus | 'all'>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const pageSize = 10;

  const dateLocale = i18n.language === 'ru' ? ru : enUS;

  // Role permissions
  const canQueue = profile?.role && ['owner', 'admin', 'operator'].includes(profile.role);
  const canCancel = profile?.role && ['owner', 'admin'].includes(profile.role);

  const { data: outbox, isLoading } = useQuery({
    queryKey: ['email-outbox', profile?.organization_id, page, statusFilter],
    queryFn: async () => {
      if (!profile?.organization_id) return { data: [], count: 0 };

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      let query = supabase
        .from('email_outbox')
        .select('*', { count: 'exact' })
        .eq('organization_id', profile.organization_id)
        .order('queued_at', { ascending: false });

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      const { data, count, error } = await query.range(from, to);

      if (error) throw error;
      return { data: data as EmailOutbox[], count: count || 0 };
    },
    enabled: !!profile?.organization_id,
  });

  const cancelMutation = useMutation({
    mutationFn: async (outboxId: string) => {
      if (!profile?.organization_id) throw new Error('No organization');

      const { data, error } = await supabase.rpc('rpc_cancel_outbound_email', {
        p_organization_id: profile.organization_id,
        p_outbox_id: outboxId,
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (success) => {
      if (success) {
        toast({ title: t('common.success') });
        queryClient.invalidateQueries({ queryKey: ['email-outbox'] });
        queryClient.invalidateQueries({ queryKey: ['email-outbox-count'] });
      } else {
        toast({ title: t('common.error'), description: t('email.cannotCancel'), variant: 'destructive' });
      }
      setCancelId(null);
    },
    onError: (error: Error) => {
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
      setCancelId(null);
    },
  });

  const getStatusLabel = (status: OutboxStatus) => {
    const key = `email.statuses.${status.toLowerCase()}`;
    return t(key, status);
  };

  const outboxColumns: Column<EmailOutbox>[] = [
    {
      key: 'to_email',
      header: t('email.to'),
      cell: (row) => row.to_email,
    },
    {
      key: 'subject',
      header: t('email.subject'),
      cell: (row) => (
        <span className="max-w-xs truncate block">{row.subject || '—'}</span>
      ),
    },
    {
      key: 'status',
      header: t('common.status'),
      cell: (row) => (
        <div className="flex flex-col gap-1">
          <StatusBadge status={getStatusLabel(row.status)} type={getStatusType(row.status)} />
          {row.error_reason && (
            <span className="text-xs text-destructive max-w-xs truncate" title={row.error_reason}>
              {row.error_reason}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'queued_at',
      header: t('email.queuedAt'),
      cell: (row) => format(new Date(row.queued_at), 'dd MMM HH:mm', { locale: dateLocale }),
    },
    {
      key: 'sent_at',
      header: t('email.sentAt'),
      cell: (row) =>
        row.sent_at
          ? format(new Date(row.sent_at), 'dd MMM HH:mm', { locale: dateLocale })
          : '—',
    },
    {
      key: 'provider_message_id',
      header: t('email.providerMessageId'),
      cell: (row) => (
        <span className="text-xs text-muted-foreground max-w-[100px] truncate block" title={row.provider_message_id || undefined}>
          {row.provider_message_id || '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: t('common.actions'),
      cell: (row) => (
        row.status === 'QUEUED' && canCancel ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCancelId(row.id)}
          >
            <X className="h-4 w-4 mr-1" />
            {t('common.cancel')}
          </Button>
        ) : null
      ),
    },
  ];

  const hasActiveFilters = statusFilter !== 'all';

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center flex-wrap gap-4">
        {/* Filters */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{t('common.filter')}:</span>
          </div>
          
          <Select
            value={statusFilter}
            onValueChange={(value) => {
              setStatusFilter(value as OutboxStatus | 'all');
              setPage(1);
            }}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder={t('common.status')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('common.allStatuses')}</SelectItem>
              {OUTBOX_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {getStatusLabel(status)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={() => setStatusFilter('all')}>
              <X className="h-4 w-4 mr-1" />
              {t('common.reset')}
            </Button>
          )}
        </div>

        {/* Queue button - available for operator, admin, owner */}
        {canQueue && (
          <Dialog open={formOpen} onOpenChange={setFormOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                {t('email.compose')}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>{t('email.compose')}</DialogTitle>
              </DialogHeader>
              <QueueEmailForm
                onSuccess={() => {
                  setFormOpen(false);
                  queryClient.invalidateQueries({ queryKey: ['email-outbox'] });
                  queryClient.invalidateQueries({ queryKey: ['email-outbox-count'] });
                }}
                onCancel={() => setFormOpen(false)}
              />
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card>
        <CardContent className="pt-6">
          <DataTable
            columns={outboxColumns}
            data={outbox?.data || []}
            loading={isLoading}
            page={page}
            pageSize={pageSize}
            totalCount={outbox?.count || 0}
            onPageChange={setPage}
            emptyMessage={t('email.noOutbox')}
          />
        </CardContent>
      </Card>

      {/* Cancel confirmation dialog */}
      <AlertDialog open={!!cancelId} onOpenChange={() => setCancelId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('common.confirm')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('email.cancelConfirm')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => cancelId && cancelMutation.mutate(cancelId)}
              disabled={cancelMutation.isPending}
            >
              {cancelMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t('common.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
