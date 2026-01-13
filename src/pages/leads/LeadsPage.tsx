import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Plus, Pencil, Eye } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { DataTable, Column } from '@/components/ui/data-table';
import { StatusBadge, getStatusType } from '@/components/ui/status-badge';
import { format } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';

interface Lead {
  id: string;
  title: string | null;
  source: string;
  status: string;
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

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const { data, isLoading } = useQuery({
    queryKey: ['leads', profile?.organization_id, search, page, pageSize],
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

  const getStatusLabel = (status: string) => {
    const statusMap: Record<string, string> = {
      new: t('leads.statuses.new'),
      in_progress: t('leads.statuses.inProgress'),
      qualified: t('leads.statuses.qualified'),
      converted: t('leads.statuses.converted'),
      lost: t('leads.statuses.lost'),
    };
    return statusMap[status] || status;
  };

  const getSourceLabel = (source: string) => {
    const sourceMap: Record<string, string> = {
      email: t('leads.sources.email'),
      phone: t('leads.sources.phone'),
      website: t('leads.sources.website'),
      referral: t('leads.sources.referral'),
      other: t('leads.sources.other'),
    };
    return sourceMap[source] || source;
  };

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
          type={getStatusType(row.status)}
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
          <Button variant="ghost" size="icon">
            <Eye className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon">
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
