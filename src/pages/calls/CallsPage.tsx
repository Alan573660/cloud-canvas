import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Phone, PhoneIncoming, PhoneOutgoing, Eye, Filter, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { DataTable, Column } from '@/components/ui/data-table';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { format } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';

// DB status values
const CALL_STATUSES = ['RINGING', 'IN_PROGRESS', 'DONE', 'FAILED', 'NO_ANSWER', 'BUSY'] as const;
type CallStatus = typeof CALL_STATUSES[number];

interface CallSession {
  id: string;
  direction: string;
  from_phone: string | null;
  to_phone: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number;
  status: CallStatus;
  error_reason: string | null;
  lead_id: string | null;
  created_at: string;
}

export default function CallsPage() {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [statusFilter, setStatusFilter] = useState<CallStatus | 'all'>('all');

  const dateLocale = i18n.language === 'ru' ? ru : enUS;

  const { data, isLoading } = useQuery({
    queryKey: ['calls', profile?.organization_id, page, pageSize, statusFilter, search],
    queryFn: async () => {
      if (!profile?.organization_id) return { data: [], count: 0 };

      let query = supabase
        .from('call_sessions')
        .select('*', { count: 'exact' })
        .eq('organization_id', profile.organization_id)
        .order('created_at', { ascending: false });

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      if (search) {
        query = query.or(`from_phone.ilike.%${search}%,to_phone.ilike.%${search}%`);
      }

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      query = query.range(from, to);

      const { data, count, error } = await query;
      if (error) throw error;

      return { data: data as CallSession[], count: count || 0 };
    },
    enabled: !!profile?.organization_id,
  });

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getStatusLabel = (status: CallStatus) => {
    const key = `calls.statuses.${status.toLowerCase()}`;
    return t(key, status);
  };

  const getStatusType = (status: CallStatus) => {
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

  const getDirectionIcon = (direction: string) => {
    return direction === 'inbound' ? (
      <PhoneIncoming className="h-4 w-4 text-green-500" />
    ) : (
      <PhoneOutgoing className="h-4 w-4 text-blue-500" />
    );
  };

  const clearFilters = () => {
    setStatusFilter('all');
    setPage(1);
  };

  const hasActiveFilters = statusFilter !== 'all';

  const columns: Column<CallSession>[] = [
    {
      key: 'direction',
      header: t('calls.direction'),
      cell: (row) => (
        <div className="flex items-center gap-2">
          {getDirectionIcon(row.direction)}
          <span>{row.direction === 'inbound' ? t('calls.inbound') : t('calls.outbound')}</span>
        </div>
      ),
    },
    {
      key: 'from_phone',
      header: t('calls.fromPhone'),
      cell: (row) => row.from_phone || '—',
    },
    {
      key: 'to_phone',
      header: t('calls.toPhone'),
      cell: (row) => row.to_phone || '—',
    },
    {
      key: 'started_at',
      header: t('calls.startedAt'),
      cell: (row) =>
        row.started_at
          ? format(new Date(row.started_at), 'dd MMM HH:mm', { locale: dateLocale })
          : '—',
    },
    {
      key: 'duration_seconds',
      header: t('calls.duration'),
      cell: (row) => (
        <span className="font-mono">{formatDuration(row.duration_seconds)}</span>
      ),
    },
    {
      key: 'status',
      header: t('common.status'),
      cell: (row) => (
        <div className="flex flex-col gap-1">
          <StatusBadge
            status={getStatusLabel(row.status)}
            type={getStatusType(row.status)}
          />
          {row.error_reason && (
            <span className="text-xs text-destructive truncate max-w-[150px]" title={row.error_reason}>
              {row.error_reason}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: t('common.actions'),
      cell: (row) => (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate(`/calls/${row.id}`)}
          title={t('common.details')}
        >
          <Eye className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Phone className="h-8 w-8" />
            {t('calls.title')}
          </h1>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4 p-4 bg-card rounded-lg border">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{t('common.filter')}:</span>
        </div>

        <Select
          value={statusFilter}
          onValueChange={(value) => {
            setStatusFilter(value as CallStatus | 'all');
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={t('common.status')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('common.allStatuses')}</SelectItem>
            {CALL_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {getStatusLabel(status)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="h-4 w-4 mr-1" />
            {t('common.reset')}
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={data?.data || []}
        loading={isLoading}
        searchPlaceholder={t('calls.searchPhone')}
        onSearch={setSearch}
        searchValue={search}
        page={page}
        pageSize={pageSize}
        totalCount={data?.count || 0}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        emptyMessage={t('calls.noCalls')}
      />
    </div>
  );
}
