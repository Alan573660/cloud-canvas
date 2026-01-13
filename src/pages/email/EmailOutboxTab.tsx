import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Send, X, Plus, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, Column } from '@/components/ui/data-table';
import { StatusBadge, getStatusType } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';
import QueueEmailForm from './QueueEmailForm';

interface EmailOutbox {
  id: string;
  to_email: string;
  subject: string | null;
  status: string;
  queued_at: string;
  sent_at: string | null;
  error_reason: string | null;
}

export default function EmailOutboxTab() {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [formOpen, setFormOpen] = useState(false);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const pageSize = 10;

  const dateLocale = i18n.language === 'ru' ? ru : enUS;

  const canManage = profile?.role && ['owner', 'admin'].includes(profile.role);

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

      if (statusFilter) {
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
      } else {
        toast({ title: t('common.error'), description: 'Cannot cancel', variant: 'destructive' });
      }
      setCancelId(null);
    },
    onError: (error: Error) => {
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
      setCancelId(null);
    },
  });

  const getStatusLabel = (status: string) => {
    const statusMap: Record<string, string> = {
      QUEUED: t('email.statuses.queued'),
      SENDING: t('email.statuses.queued'),
      SENT: t('email.statuses.sent'),
      FAILED: t('email.statuses.failed'),
      CANCELLED: t('email.statuses.cancelled'),
    };
    return statusMap[status] || status;
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
        <span className="max-w-md truncate block">{row.subject || '—'}</span>
      ),
    },
    {
      key: 'status',
      header: t('common.status'),
      cell: (row) => (
        <div className="flex flex-col gap-1">
          <StatusBadge status={getStatusLabel(row.status)} type={getStatusType(row.status)} />
          {row.error_reason && (
            <span className="text-xs text-destructive">{row.error_reason}</span>
          )}
        </div>
      ),
    },
    {
      key: 'queued_at',
      header: t('common.date'),
      cell: (row) => format(new Date(row.queued_at), 'dd MMM yyyy HH:mm', { locale: dateLocale }),
    },
    {
      key: 'actions',
      header: t('common.actions'),
      cell: (row) => (
        row.status === 'QUEUED' && canManage ? (
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

  const statuses = ['QUEUED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED'];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex gap-2">
          <Button
            variant={statusFilter === '' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStatusFilter('')}
          >
            {t('common.filter')}: {t('common.noData').replace('Нет данных', 'Все').replace('No data', 'All')}
          </Button>
          {statuses.map((status) => (
            <Button
              key={status}
              variant={statusFilter === status ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter(status)}
            >
              {getStatusLabel(status)}
            </Button>
          ))}
        </div>

        {canManage && (
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
          />
        </CardContent>
      </Card>

      <AlertDialog open={!!cancelId} onOpenChange={() => setCancelId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('common.confirm')}</AlertDialogTitle>
            <AlertDialogDescription>
              {i18n.language === 'ru' 
                ? 'Вы уверены, что хотите отменить отправку этого письма?'
                : 'Are you sure you want to cancel sending this email?'}
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
