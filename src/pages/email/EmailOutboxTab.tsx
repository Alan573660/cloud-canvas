import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  X, Plus, Loader2, Filter, Mail, Clock, CheckCircle, 
  XCircle, AlertCircle, Send, User, RefreshCw
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { DataTable, Column } from '@/components/ui/data-table';
import { StatusBadge, getStatusType } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
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
import { format, formatDistanceToNow } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';
import QueueEmailForm from './QueueEmailForm';

// DB status values - MUST match database exactly
const OUTBOX_STATUSES = ['QUEUED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED'] as const;
type OutboxStatus = typeof OUTBOX_STATUSES[number];

interface EmailOutbox {
  id: string;
  to_email: string;
  subject: string | null;
  body_text: string;
  status: OutboxStatus;
  queued_at: string;
  sent_at: string | null;
  error_reason: string | null;
  provider_message_id: string | null;
  from_account_id: string | null;
  created_by: string | null;
}

interface EmailAccount {
  id: string;
  email_address: string;
}

interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
}

export default function EmailOutboxTab() {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<OutboxStatus | 'all'>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<EmailOutbox | null>(null);
  const pageSize = 10;

  const dateLocale = i18n.language === 'ru' ? ru : enUS;

  // Role permissions
  const canQueue = profile?.role && ['owner', 'admin', 'operator'].includes(profile.role);
  const canCancel = profile?.role && ['owner', 'admin'].includes(profile.role);

  // Fetch outbox
  const { data: outbox, isLoading, refetch } = useQuery({
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

  // Fetch email accounts for display
  const accountIds = [...new Set(outbox?.data.filter(o => o.from_account_id).map(o => o.from_account_id!))];
  const { data: accounts } = useQuery({
    queryKey: ['email-accounts-map', accountIds],
    queryFn: async () => {
      if (accountIds.length === 0) return {};

      const { data, error } = await supabase
        .from('email_accounts')
        .select('id, email_address')
        .in('id', accountIds);

      if (error) throw error;

      const map: Record<string, EmailAccount> = {};
      data?.forEach(a => { map[a.id] = a; });
      return map;
    },
    enabled: accountIds.length > 0,
  });

  // Fetch profiles for created_by
  const profileIds = [...new Set(outbox?.data.filter(o => o.created_by).map(o => o.created_by!))];
  const { data: profiles } = useQuery({
    queryKey: ['profiles-map', profileIds],
    queryFn: async () => {
      if (profileIds.length === 0) return {};

      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('id', profileIds);

      if (error) throw error;

      const map: Record<string, Profile> = {};
      data?.forEach(p => { map[p.id] = p; });
      return map;
    },
    enabled: profileIds.length > 0,
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
        queryClient.invalidateQueries({ queryKey: ['email-outbox-stats'] });
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

  const getStatusIcon = (status: OutboxStatus) => {
    switch (status) {
      case 'QUEUED':
        return <Clock className="h-3 w-3" />;
      case 'SENDING':
        return <Loader2 className="h-3 w-3 animate-spin" />;
      case 'SENT':
        return <CheckCircle className="h-3 w-3" />;
      case 'FAILED':
        return <XCircle className="h-3 w-3" />;
      case 'CANCELLED':
        return <X className="h-3 w-3" />;
      default:
        return null;
    }
  };

  const outboxColumns: Column<EmailOutbox>[] = [
    {
      key: 'from_account',
      header: t('email.from'),
      cell: (row) => {
        const account = row.from_account_id ? accounts?.[row.from_account_id] : null;
        return (
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">{account?.email_address || '—'}</span>
          </div>
        );
      },
    },
    {
      key: 'to_email',
      header: t('email.to'),
      cell: (row) => (
        <div className="flex items-center gap-2">
          <User className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{row.to_email}</span>
        </div>
      ),
    },
    {
      key: 'subject',
      header: t('email.subject'),
      cell: (row) => (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="max-w-xs truncate block cursor-default">
                {row.subject || t('email.noSubject')}
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-md">
              <p className="font-medium">{row.subject || t('email.noSubject')}</p>
              <p className="text-xs text-muted-foreground mt-1 line-clamp-3">
                {row.body_text.slice(0, 200)}...
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ),
    },
    {
      key: 'status',
      header: t('common.status'),
      cell: (row) => (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            {getStatusIcon(row.status)}
            <StatusBadge status={getStatusLabel(row.status)} type={getStatusType(row.status)} />
          </div>
          {row.error_reason && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1 text-xs text-destructive cursor-help">
                    <AlertCircle className="h-3 w-3" />
                    <span className="max-w-[150px] truncate">{row.error_reason}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent className="max-w-sm">
                  <p className="text-sm">{row.error_reason}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      ),
    },
    {
      key: 'created_by',
      header: t('email.createdBy'),
      cell: (row) => {
        const creator = row.created_by ? profiles?.[row.created_by] : null;
        return (
          <span className="text-sm text-muted-foreground">
            {creator?.full_name || creator?.email || '—'}
          </span>
        );
      },
    },
    {
      key: 'queued_at',
      header: t('email.queuedAt'),
      cell: (row) => (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-sm cursor-default">
                {formatDistanceToNow(new Date(row.queued_at), { addSuffix: true, locale: dateLocale })}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {format(new Date(row.queued_at), 'dd MMM yyyy HH:mm:ss', { locale: dateLocale })}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ),
    },
    {
      key: 'sent_at',
      header: t('email.sentAt'),
      cell: (row) =>
        row.sent_at ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-sm text-green-600 cursor-default">
                  {formatDistanceToNow(new Date(row.sent_at), { addSuffix: true, locale: dateLocale })}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {format(new Date(row.sent_at), 'dd MMM yyyy HH:mm:ss', { locale: dateLocale })}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <span className="text-muted-foreground">—</span>
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
            className="text-destructive hover:text-destructive"
          >
            <X className="h-4 w-4 mr-1" />
            {t('common.cancel')}
          </Button>
        ) : row.provider_message_id ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="text-xs font-mono cursor-help">
                  {row.provider_message_id.slice(0, 8)}...
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs font-mono">{row.provider_message_id}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : null
      ),
    },
  ];

  const hasActiveFilters = statusFilter !== 'all';

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex justify-between items-center flex-wrap gap-4">
        {/* Filters */}
        <div className="flex items-center gap-4 flex-wrap">
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
                  <div className="flex items-center gap-2">
                    {getStatusIcon(status)}
                    {getStatusLabel(status)}
                  </div>
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

          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => refetch()}
            className="text-muted-foreground"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {/* Queue button */}
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
                <DialogTitle className="flex items-center gap-2">
                  <Send className="h-5 w-5" />
                  {t('email.compose')}
                </DialogTitle>
              </DialogHeader>
              <QueueEmailForm
                onSuccess={() => {
                  setFormOpen(false);
                  queryClient.invalidateQueries({ queryKey: ['email-outbox'] });
                  queryClient.invalidateQueries({ queryKey: ['email-outbox-count'] });
                  queryClient.invalidateQueries({ queryKey: ['email-outbox-stats'] });
                }}
                onCancel={() => setFormOpen(false)}
              />
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Data Table */}
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
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {cancelMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t('email.cancelEmail')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
