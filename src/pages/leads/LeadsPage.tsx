import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, Pencil, Eye, Filter, X } from 'lucide-react';
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

// DB enum values - MUST match database
const LEAD_STATUSES = ['NEW', 'IN_PROGRESS', 'CALCULATED', 'INVOICED', 'PAID', 'FAILED', 'HUMAN_REQUIRED'] as const;
const LEAD_SOURCES = ['call', 'email', 'manual'] as const;

type LeadStatus = typeof LEAD_STATUSES[number];
type LeadSource = typeof LEAD_SOURCES[number];

interface Lead {
  id: string;
  title: string | null;
  source: LeadSource;
  status: LeadStatus;
  subject: string | null;
  created_at: string;
  contact: {
    full_name: string | null;
  } | null;
  buyer_company: {
    company_name: string;
  } | null;
  assigned_to_profile: {
    full_name: string | null;
  } | null;
}

export default function LeadsPage() {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [statusFilter, setStatusFilter] = useState<LeadStatus | 'all'>('all');
  const [sourceFilter, setSourceFilter] = useState<LeadSource | 'all'>('all');

  const { data, isLoading } = useQuery({
    queryKey: ['leads', profile?.organization_id, search, page, pageSize, statusFilter, sourceFilter],
    queryFn: async () => {
      if (!profile?.organization_id) return { data: [], count: 0 };

      let query = supabase
        .from('leads')
        .select(
          `
          *,
          contact:contacts(full_name),
          buyer_company:buyer_companies(company_name),
          assigned_to_profile:profiles!leads_assigned_to_fkey(full_name)
        `,
          { count: 'exact' }
        )
        .eq('organization_id', profile.organization_id)
        .order('created_at', { ascending: false });

      // Apply status filter
      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      // Apply source filter
      if (sourceFilter !== 'all') {
        query = query.eq('source', sourceFilter);
      }

      if (search) {
        query = query.or(`title.ilike.%${search}%,subject.ilike.%${search}%`);
      }

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      query = query.range(from, to);

      const { data, count, error } = await query;
      if (error) throw error;

      return { data: data as Lead[], count: count || 0 };
    },
    enabled: !!profile?.organization_id,
  });

  const getStatusLabel = (status: LeadStatus) => {
    const statusMap: Record<LeadStatus, string> = {
      NEW: t('leads.statuses.new'),
      IN_PROGRESS: t('leads.statuses.inProgress'),
      CALCULATED: t('leads.statuses.calculated'),
      INVOICED: t('leads.statuses.invoiced'),
      PAID: t('leads.statuses.paid'),
      FAILED: t('leads.statuses.failed'),
      HUMAN_REQUIRED: t('leads.statuses.humanRequired'),
    };
    return statusMap[status] || status;
  };

  const getSourceLabel = (source: LeadSource) => {
    const sourceMap: Record<LeadSource, string> = {
      call: t('leads.sources.call'),
      email: t('leads.sources.email'),
      manual: t('leads.sources.manual'),
    };
    return sourceMap[source] || source;
  };

  const getLeadStatusType = (status: LeadStatus) => {
    switch (status) {
      case 'PAID':
        return 'success' as const;
      case 'NEW':
      case 'IN_PROGRESS':
      case 'CALCULATED':
        return 'warning' as const;
      case 'INVOICED':
        return 'info' as const;
      case 'FAILED':
      case 'HUMAN_REQUIRED':
        return 'error' as const;
      default:
        return 'default' as const;
    }
  };

  const clearFilters = () => {
    setStatusFilter('all');
    setSourceFilter('all');
    setPage(1);
  };

  const hasActiveFilters = statusFilter !== 'all' || sourceFilter !== 'all';

  const columns: Column<Lead>[] = [
    {
      key: 'title',
      header: t('common.name'),
      cell: (row) => (
        <span className="font-medium">{row.title || row.subject || '—'}</span>
      ),
    },
    {
      key: 'contact',
      header: t('leads.contact'),
      cell: (row) =>
        row.contact?.full_name || row.buyer_company?.company_name || '—',
    },
    {
      key: 'source',
      header: t('leads.source'),
      cell: (row) => getSourceLabel(row.source),
    },
    {
      key: 'status',
      header: t('common.status'),
      cell: (row) => (
        <StatusBadge
          status={getStatusLabel(row.status)}
          type={getLeadStatusType(row.status)}
        />
      ),
    },
    {
      key: 'assigned_to',
      header: t('leads.assignedTo'),
      cell: (row) => row.assigned_to_profile?.full_name || '—',
    },
    {
      key: 'created_at',
      header: t('common.date'),
      cell: (row) =>
        format(new Date(row.created_at), 'dd MMM yyyy', {
          locale: i18n.language === 'ru' ? ru : enUS,
        }),
    },
    {
      key: 'actions',
      header: t('common.actions'),
      cell: (row) => (
        <div className="flex items-center gap-2">
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => navigate(`/leads/${row.id}`)}
          >
            <Eye className="h-4 w-4" />
          </Button>
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => navigate(`/leads/${row.id}`)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('leads.title')}</h1>
        </div>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          {t('leads.newLead')}
        </Button>
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
            setStatusFilter(value as LeadStatus | 'all');
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={t('common.status')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('common.status')}: все</SelectItem>
            {LEAD_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {getStatusLabel(status)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={sourceFilter}
          onValueChange={(value) => {
            setSourceFilter(value as LeadSource | 'all');
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={t('leads.source')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('leads.source')}: все</SelectItem>
            {LEAD_SOURCES.map((source) => (
              <SelectItem key={source} value={source}>
                {getSourceLabel(source)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="h-4 w-4 mr-1" />
            Сбросить
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={data?.data || []}
        loading={isLoading}
        searchPlaceholder={t('common.search')}
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
        emptyMessage={t('leads.noLeads')}
      />
    </div>
  );
}
