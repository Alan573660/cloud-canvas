import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { 
  Phone, PhoneIncoming, PhoneOutgoing, Eye, Filter, X, Calendar 
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { DataTable, Column } from '@/components/ui/data-table';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageSkeleton } from '@/components/ui/page-skeleton';
import { EmptyState } from '@/components/ui/permission-denied';
import { showErrorToast } from '@/lib/error-utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';
import { DateRange } from 'react-day-picker';

// DB status values
const CALL_STATUSES = ['RINGING', 'IN_PROGRESS', 'DONE', 'FAILED', 'NO_ANSWER', 'BUSY'] as const;
type CallStatus = typeof CALL_STATUSES[number];

const DIRECTIONS = ['inbound', 'outbound'] as const;
type Direction = typeof DIRECTIONS[number];

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
  const [directionFilter, setDirectionFilter] = useState<Direction | 'all'>('all');
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

  const dateLocale = i18n.language === 'ru' ? ru : enUS;

  const { data, isLoading, error } = useQuery({
    queryKey: ['calls', profile?.organization_id, page, pageSize, statusFilter, directionFilter, dateRange, search],
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

      if (directionFilter !== 'all') {
        query = query.eq('direction', directionFilter);
      }

      if (dateRange?.from) {
        query = query.gte('created_at', startOfDay(dateRange.from).toISOString());
      }
      if (dateRange?.to) {
        query = query.lte('created_at', endOfDay(dateRange.to).toISOString());
      }

      if (search) {
        query = query.or(`from_phone.ilike.%${search}%,to_phone.ilike.%${search}%`);
      }

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      query = query.range(from, to);

      const { data, count, error } = await query;
      if (error) {
        console.error('Cannot fetch calls:', error.message);
        throw error;
      }

      return { data: data as CallSession[], count: count || 0 };
    },
    enabled: !!profile?.organization_id,
  });

  // Show error toast if query failed
  if (error) {
    showErrorToast(error, { logPrefix: 'CallsPage' });
  }

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
    setDirectionFilter('all');
    setDateRange(undefined);
    setPage(1);
  };

  const hasActiveFilters = statusFilter !== 'all' || directionFilter !== 'all' || dateRange !== undefined;

  // Quick date presets
  const setDatePreset = (days: number) => {
    const to = new Date();
    const from = subDays(to, days);
    setDateRange({ from, to });
    setPage(1);
  };

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
      cell: (row) => <span className="font-mono">{row.from_phone || '—'}</span>,
    },
    {
      key: 'to_phone',
      header: t('calls.toPhone'),
      cell: (row) => <span className="font-mono">{row.to_phone || '—'}</span>,
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
        <span className="font-mono tabular-nums">{formatDuration(row.duration_seconds)}</span>
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

  if (isLoading && !data) {
    return <PageSkeleton rows={8} showFilters />;
  }

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
          <SelectTrigger className="w-[160px]">
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

        <Select
          value={directionFilter}
          onValueChange={(value) => {
            setDirectionFilter(value as Direction | 'all');
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder={t('calls.direction')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('common.all')}</SelectItem>
            <SelectItem value="inbound">{t('calls.inbound')}</SelectItem>
            <SelectItem value="outbound">{t('calls.outbound')}</SelectItem>
          </SelectContent>
        </Select>

        {/* Date range picker */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="w-[200px] justify-start text-left font-normal">
              <Calendar className="mr-2 h-4 w-4" />
              {dateRange?.from ? (
                dateRange.to ? (
                  <>
                    {format(dateRange.from, 'dd.MM', { locale: dateLocale })} -{' '}
                    {format(dateRange.to, 'dd.MM', { locale: dateLocale })}
                  </>
                ) : (
                  format(dateRange.from, 'dd.MM.yyyy', { locale: dateLocale })
                )
              ) : (
                <span className="text-muted-foreground">{t('common.date')}</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <div className="p-2 border-b flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDatePreset(7)}>
                7 {t('products.days', 'дней')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setDatePreset(30)}>
                30 {t('products.days', 'дней')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setDatePreset(90)}>
                90 {t('products.days', 'дней')}
              </Button>
            </div>
            <CalendarComponent
              initialFocus
              mode="range"
              defaultMonth={dateRange?.from}
              selected={dateRange}
              onSelect={(range) => {
                setDateRange(range);
                setPage(1);
              }}
              numberOfMonths={2}
              locale={dateLocale}
            />
          </PopoverContent>
        </Popover>

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
