import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { 
  Phone, PhoneIncoming, PhoneOutgoing, Eye, Filter, X, Calendar, 
  Clock, TrendingUp, AlertCircle, CheckCircle, Smile, Meh, Frown, Link2
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { DataTable, Column } from '@/components/ui/data-table';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageSkeleton } from '@/components/ui/page-skeleton';
import { PermissionDenied } from '@/components/ui/permission-denied';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { showErrorToast } from '@/lib/error-utils';
import { sanitizeSearchQuery, hasPermission } from '@/lib/security-utils';
import { logListView } from '@/lib/audit-utils';
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';
import { DateRange } from 'react-day-picker';

// DB status values
const CALL_STATUSES = ['RINGING', 'IN_PROGRESS', 'DONE', 'FAILED', 'NO_ANSWER', 'BUSY'] as const;
type CallStatus = typeof CALL_STATUSES[number];

const DIRECTIONS = ['inbound', 'outbound'] as const;
type Direction = typeof DIRECTIONS[number];

const SENTIMENTS = ['positive', 'neutral', 'negative'] as const;
type Sentiment = typeof SENTIMENTS[number];

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
  sentiment: string | null;
  ai_summary: string | null;
  created_at: string;
}

interface CallStats {
  total: number;
  completed: number;
  failed: number;
  avgDuration: number;
  inbound: number;
  outbound: number;
}

export default function CallsPage() {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();
  const navigate = useNavigate();

  // Role check: accountant cannot access calls
  const canViewCalls = hasPermission(profile?.role, 'calls', 'view');

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [statusFilter, setStatusFilter] = useState<CallStatus | 'all'>('all');
  const [directionFilter, setDirectionFilter] = useState<Direction | 'all'>('all');
  const [sentimentFilter, setSentimentFilter] = useState<Sentiment | 'all'>('all');
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  
  // Audit log on mount (only if allowed)
  useEffect(() => {
    if (profile?.organization_id && canViewCalls) {
      logListView(profile.organization_id, 'contacts'); // Using contacts as proxy for call_sessions audit
    }
  }, [profile?.organization_id, canViewCalls]);

  // If accountant, show permission denied — AFTER all hooks
  if (!canViewCalls && profile) {
    return <PermissionDenied />;
  }

  const dateLocale = i18n.language === 'ru' ? ru : enUS;

  // Fetch calls data
  const { data, isLoading, error } = useQuery({
    queryKey: ['calls', profile?.organization_id, page, pageSize, statusFilter, directionFilter, sentimentFilter, dateRange, search],
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

      if (sentimentFilter !== 'all') {
        query = query.eq('sentiment', sentimentFilter);
      }

      if (dateRange?.from) {
        query = query.gte('created_at', startOfDay(dateRange.from).toISOString());
      }
      if (dateRange?.to) {
        query = query.lte('created_at', endOfDay(dateRange.to).toISOString());
      }

      // Escape search for ILIKE
      if (search) {
        const escaped = sanitizeSearchQuery(search);
        if (escaped) {
          query = query.or(`from_phone.ilike.%${escaped}%,to_phone.ilike.%${escaped}%`);
        }
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

  // Fetch stats for the overview cards
  const { data: stats } = useQuery({
    queryKey: ['calls-stats', profile?.organization_id, dateRange],
    queryFn: async (): Promise<CallStats> => {
      if (!profile?.organization_id) return { total: 0, completed: 0, failed: 0, avgDuration: 0, inbound: 0, outbound: 0 };

      let query = supabase
        .from('call_sessions')
        .select('status, direction, duration_seconds')
        .eq('organization_id', profile.organization_id);

      if (dateRange?.from) {
        query = query.gte('created_at', startOfDay(dateRange.from).toISOString());
      }
      if (dateRange?.to) {
        query = query.lte('created_at', endOfDay(dateRange.to).toISOString());
      }

      const { data, error } = await query;
      if (error) {
        console.warn('Cannot fetch call stats:', error.message);
        return { total: 0, completed: 0, failed: 0, avgDuration: 0, inbound: 0, outbound: 0 };
      }

      const total = data?.length || 0;
      const completed = data?.filter(c => c.status === 'DONE').length || 0;
      const failed = data?.filter(c => ['FAILED', 'NO_ANSWER', 'BUSY'].includes(c.status)).length || 0;
      const inbound = data?.filter(c => c.direction === 'inbound').length || 0;
      const outbound = data?.filter(c => c.direction === 'outbound').length || 0;
      const totalDuration = data?.reduce((sum, c) => sum + (c.duration_seconds || 0), 0) || 0;
      const avgDuration = completed > 0 ? Math.round(totalDuration / completed) : 0;

      return { total, completed, failed, avgDuration, inbound, outbound };
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

  const getSentimentIcon = (sentiment: string | null) => {
    switch (sentiment?.toLowerCase()) {
      case 'positive':
        return <Smile className="h-4 w-4 text-green-500" />;
      case 'negative':
        return <Frown className="h-4 w-4 text-red-500" />;
      case 'neutral':
        return <Meh className="h-4 w-4 text-gray-500" />;
      default:
        return null;
    }
  };

  const getSentimentLabel = (sentiment: string | null) => {
    if (!sentiment) return null;
    const key = `calls.sentiments.${sentiment.toLowerCase()}`;
    return t(key, sentiment);
  };

  const clearFilters = () => {
    setStatusFilter('all');
    setDirectionFilter('all');
    setSentimentFilter('all');
    setDateRange(undefined);
    setPage(1);
  };

  const hasActiveFilters = statusFilter !== 'all' || directionFilter !== 'all' || sentimentFilter !== 'all' || dateRange !== undefined;

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
          <span className="text-sm">{row.direction === 'inbound' ? t('calls.inbound') : t('calls.outbound')}</span>
        </div>
      ),
    },
    {
      key: 'from_phone',
      header: t('calls.fromPhone'),
      cell: (row) => <span className="font-mono text-sm">{row.from_phone || '—'}</span>,
    },
    {
      key: 'to_phone',
      header: t('calls.toPhone'),
      cell: (row) => <span className="font-mono text-sm">{row.to_phone || '—'}</span>,
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
      key: 'sentiment',
      header: t('calls.sentiment'),
      cell: (row) => {
        if (!row.sentiment) return <span className="text-muted-foreground text-sm">—</span>;
        return (
          <div className="flex items-center gap-1.5">
            {getSentimentIcon(row.sentiment)}
            <span className="text-sm">{getSentimentLabel(row.sentiment)}</span>
          </div>
        );
      },
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
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-xs text-destructive truncate max-w-[100px] cursor-help">
                    {row.error_reason}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs">{row.error_reason}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      ),
    },
    {
      key: 'lead_id',
      header: t('calls.linkedLead'),
      cell: (row) => {
        if (!row.lead_id) return <span className="text-muted-foreground text-sm">—</span>;
        return (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/leads/${row.lead_id}`);
            }}
          >
            <Link2 className="h-3.5 w-3.5 mr-1" />
            <span className="text-xs">{t('calls.linkedLead')}</span>
          </Button>
        );
      },
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Phone className="h-8 w-8" />
            {t('calls.title')}
          </h1>
          <p className="text-muted-foreground mt-1">
            {t('calls.pageDescription', 'История и аналитика телефонных звонков')}
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t('calls.totalCalls', 'Всего звонков')}
            </CardTitle>
            <Phone className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.total || 0}</div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
              <PhoneIncoming className="h-3 w-3 text-green-500" />
              <span>{stats?.inbound || 0}</span>
              <PhoneOutgoing className="h-3 w-3 text-blue-500 ml-2" />
              <span>{stats?.outbound || 0}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t('calls.completedCalls', 'Успешных')}
            </CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{stats?.completed || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {stats?.total ? Math.round((stats.completed / stats.total) * 100) : 0}% {t('calls.successRate', 'успешных')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t('calls.failedCalls', 'Неудачных')}
            </CardTitle>
            <AlertCircle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{stats?.failed || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {t('calls.failedDesc', 'Нет ответа, занято, ошибка')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t('calls.avgDuration', 'Сред. длительность')}
            </CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">{formatDuration(stats?.avgDuration || 0)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {t('calls.avgDurationDesc', 'Для успешных звонков')}
            </p>
          </CardContent>
        </Card>
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

        <Select
          value={sentimentFilter}
          onValueChange={(value) => {
            setSentimentFilter(value as Sentiment | 'all');
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder={t('calls.sentiment')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('common.all')}</SelectItem>
            <SelectItem value="positive">
              <div className="flex items-center gap-2">
                <Smile className="h-4 w-4 text-green-500" />
                {t('calls.sentiments.positive')}
              </div>
            </SelectItem>
            <SelectItem value="neutral">
              <div className="flex items-center gap-2">
                <Meh className="h-4 w-4 text-gray-500" />
                {t('calls.sentiments.neutral')}
              </div>
            </SelectItem>
            <SelectItem value="negative">
              <div className="flex items-center gap-2">
                <Frown className="h-4 w-4 text-red-500" />
                {t('calls.sentiments.negative')}
              </div>
            </SelectItem>
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
