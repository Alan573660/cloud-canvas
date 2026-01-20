import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, AlertCircle, Eye, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { sanitizeSearchQuery } from '@/lib/security-utils';
import { logListView } from '@/lib/audit-utils';
import { Button } from '@/components/ui/button';
import { DataTable, Column } from '@/components/ui/data-table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { CompanyForm } from './CompanyForm';
import { CompanyDetailDialog } from './CompanyDetailDialog';
import { toast } from 'sonner';
import type { Json } from '@/integrations/supabase/types';

interface Company {
  id: string;
  company_name: string;
  inn: string | null;
  kpp: string | null;
  ogrn: string | null;
  legal_address: string | null;
  bank_details_json: Json;
  created_at: string;
}

// Roles that can create/edit/delete companies (based on RLS)
const CAN_MANAGE_COMPANIES: string[] = ['owner', 'admin'];
const CAN_VIEW_COMPANIES: string[] = ['owner', 'admin', 'accountant'];

export default function CompaniesPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [deletingCompany, setDeletingCompany] = useState<Company | null>(null);
  const [viewingCompany, setViewingCompany] = useState<Company | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [expandedBankDetails, setExpandedBankDetails] = useState<string | null>(null);

  // Check permissions based on role
  const canManageCompanies = profile?.role && CAN_MANAGE_COMPANIES.includes(profile.role);
  const canViewCompanies = profile?.role && CAN_VIEW_COMPANIES.includes(profile.role);

  // Audit logging
  useEffect(() => {
    if (profile?.organization_id) {
      logListView(profile.organization_id, 'buyer_companies');
    }
  }, [profile?.organization_id]);

  const { data, isLoading, error: fetchError } = useQuery({
    queryKey: ['companies', profile?.organization_id, search, page, pageSize],
    queryFn: async () => {
      if (!profile?.organization_id) return { data: [], count: 0 };

      let query = supabase
        .from('buyer_companies')
        .select('*', { count: 'exact' })
        .eq('organization_id', profile.organization_id)
        .order('created_at', { ascending: false });

      if (search) {
        query = query.or(
          `company_name.ilike.%${search}%,inn.ilike.%${search}%`
        );
      }

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      query = query.range(from, to);

      const { data, count, error } = await query;
      
      if (error) {
        // Handle 403 permission error
        if (error.code === '42501' || error.message?.includes('permission') || error.message?.includes('policy')) {
          setPermissionError(t('errors.forbidden', 'Недостаточно прав для просмотра компаний'));
          return { data: [], count: 0 };
        }
        throw error;
      }

      setPermissionError(null);
      return { data: data as Company[], count: count || 0 };
    },
    enabled: !!profile?.organization_id,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('buyer_companies').delete().eq('id', id);
      if (error) {
        if (error.code === '42501' || error.message?.includes('permission') || error.message?.includes('policy')) {
          throw new Error(t('errors.forbidden', 'Недостаточно прав'));
        }
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      toast.success(t('common.success'));
      setDeletingCompany(null);
    },
    onError: (error) => {
      toast.error(error.message);
      setDeletingCompany(null);
    },
  });

  const renderBankDetails = (company: Company) => {
    const bankDetails = company.bank_details_json as Record<string, string> | null;
    if (!bankDetails || Object.values(bankDetails).every(v => !v)) {
      return <span className="text-muted-foreground">—</span>;
    }

    const isExpanded = expandedBankDetails === company.id;

    return (
      <Collapsible open={isExpanded} onOpenChange={() => setExpandedBankDetails(isExpanded ? null : company.id)}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="h-auto p-1">
            {isExpanded ? (
              <ChevronUp className="h-4 w-4 mr-1" />
            ) : (
              <ChevronDown className="h-4 w-4 mr-1" />
            )}
            {t('companies.bankDetails')}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 text-sm space-y-1">
          {bankDetails.bank_name && (
            <div><span className="text-muted-foreground">Банк:</span> {bankDetails.bank_name}</div>
          )}
          {bankDetails.bank_bik && (
            <div><span className="text-muted-foreground">БИК:</span> {bankDetails.bank_bik}</div>
          )}
          {bankDetails.bank_account && (
            <div><span className="text-muted-foreground">Р/с:</span> {bankDetails.bank_account}</div>
          )}
          {bankDetails.bank_corr_account && (
            <div><span className="text-muted-foreground">К/с:</span> {bankDetails.bank_corr_account}</div>
          )}
        </CollapsibleContent>
      </Collapsible>
    );
  };

  const columns: Column<Company>[] = [
    {
      key: 'company_name',
      header: t('companies.companyName'),
      cell: (row) => <span className="font-medium">{row.company_name}</span>,
    },
    {
      key: 'inn',
      header: t('companies.inn'),
      cell: (row) => <span className="font-mono">{row.inn || '—'}</span>,
    },
    {
      key: 'kpp',
      header: t('companies.kpp'),
      cell: (row) => <span className="font-mono">{row.kpp || '—'}</span>,
    },
    {
      key: 'ogrn',
      header: t('companies.ogrn'),
      cell: (row) => <span className="font-mono">{row.ogrn || '—'}</span>,
    },
    {
      key: 'bank_details',
      header: t('companies.bankDetails'),
      cell: (row) => renderBankDetails(row),
    },
    {
      key: 'actions',
      header: t('common.actions'),
      cell: (row) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setViewingCompany(row)}
            title="Подробнее"
          >
            <Eye className="h-4 w-4" />
          </Button>
          {canManageCompanies && (
            <>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setEditingCompany(row);
                  setIsFormOpen(true);
                }}
                title={t('common.edit')}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setDeletingCompany(row)}
                title={t('common.delete')}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  const handleFormSuccess = () => {
    setIsFormOpen(false);
    setEditingCompany(null);
    queryClient.invalidateQueries({ queryKey: ['companies'] });
  };

  const handleFormError = (error: Error) => {
    if (error.message?.includes('permission') || error.message?.includes('policy') || error.message?.includes('403')) {
      toast.error(t('errors.forbidden', 'Недостаточно прав'));
    } else {
      toast.error(error.message);
    }
  };

  // If user doesn't have permission to view, show access denied
  if (!canViewCompanies && profile?.role) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">{t('companies.title')}</h1>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{t('common.error')}</AlertTitle>
          <AlertDescription>{t('errors.forbidden', 'Недостаточно прав для просмотра компаний')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('companies.title')}</h1>
        </div>
        {canManageCompanies && (
          <Button
            onClick={() => {
              setEditingCompany(null);
              setIsFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            {t('companies.newCompany')}
          </Button>
        )}
      </div>

      {/* Permission error alert */}
      {permissionError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{t('common.error')}</AlertTitle>
          <AlertDescription>{permissionError}</AlertDescription>
        </Alert>
      )}

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
        emptyMessage={t('companies.noCompanies')}
      />

      {/* Create/Edit Modal */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingCompany ? t('companies.editCompany') : t('companies.newCompany')}
            </DialogTitle>
          </DialogHeader>
          <CompanyForm
            company={editingCompany}
            onSuccess={handleFormSuccess}
            onCancel={() => setIsFormOpen(false)}
            onError={handleFormError}
          />
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <CompanyDetailDialog
        company={viewingCompany}
        open={!!viewingCompany}
        onOpenChange={() => setViewingCompany(null)}
      />

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deletingCompany}
        onOpenChange={() => setDeletingCompany(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('common.confirm')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('companies.deleteConfirm')}
              {deletingCompany?.company_name && (
                <span className="font-medium block mt-2">
                  {deletingCompany.company_name}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingCompany && deleteMutation.mutate(deletingCompany.id)}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? t('common.loading') : t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
