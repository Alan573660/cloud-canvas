import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, AlertCircle, Eye } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
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
import { ContactForm } from './ContactForm';
import { ContactDetailDialog } from './ContactDetailDialog';
import { toast } from 'sonner';

interface Contact {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  created_at: string;
}

// Roles that can create/edit/delete contacts
const CAN_MANAGE_CONTACTS: string[] = ['owner', 'admin', 'operator'];

export default function ContactsPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [deletingContact, setDeletingContact] = useState<Contact | null>(null);
  const [viewingContact, setViewingContact] = useState<Contact | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  // Check if current user can manage contacts based on role
  const canManageContacts = profile?.role && CAN_MANAGE_CONTACTS.includes(profile.role);

  const { data, isLoading, error: fetchError } = useQuery({
    queryKey: ['contacts', profile?.organization_id, search, page, pageSize],
    queryFn: async () => {
      if (!profile?.organization_id) return { data: [], count: 0 };

      let query = supabase
        .from('contacts')
        .select('*', { count: 'exact' })
        .eq('organization_id', profile.organization_id)
        .order('created_at', { ascending: false });

      if (search) {
        query = query.or(
          `full_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`
        );
      }

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      query = query.range(from, to);

      const { data, count, error } = await query;
      
      if (error) {
        // Handle 403 permission error
        if (error.code === '42501' || error.message?.includes('permission') || error.message?.includes('policy')) {
          setPermissionError(t('errors.forbidden', 'Недостаточно прав'));
          return { data: [], count: 0 };
        }
        throw error;
      }

      setPermissionError(null);
      return { data: data as Contact[], count: count || 0 };
    },
    enabled: !!profile?.organization_id,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('contacts').delete().eq('id', id);
      if (error) {
        // Handle 403 permission error
        if (error.code === '42501' || error.message?.includes('permission') || error.message?.includes('policy')) {
          throw new Error(t('errors.forbidden', 'Недостаточно прав'));
        }
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      toast.success(t('common.success'));
      setDeletingContact(null);
    },
    onError: (error) => {
      toast.error(error.message);
      setDeletingContact(null);
    },
  });

  const columns: Column<Contact>[] = [
    {
      key: 'full_name',
      header: t('contacts.fullName'),
      cell: (row) => <span className="font-medium">{row.full_name || '—'}</span>,
    },
    {
      key: 'email',
      header: t('contacts.email'),
      cell: (row) => row.email || '—',
    },
    {
      key: 'phone',
      header: t('contacts.phone'),
      cell: (row) => row.phone || '—',
    },
    {
      key: 'notes',
      header: t('contacts.notes'),
      cell: (row) => (
        <span className="max-w-xs truncate block text-muted-foreground">
          {row.notes || '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: t('common.actions'),
      cell: (row) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setViewingContact(row)}
            title="Подробнее"
          >
            <Eye className="h-4 w-4" />
          </Button>
          {canManageContacts && (
            <>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setEditingContact(row);
                  setIsFormOpen(true);
                }}
                title={t('common.edit')}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setDeletingContact(row)}
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
    setEditingContact(null);
    queryClient.invalidateQueries({ queryKey: ['contacts'] });
  };

  const handleFormError = (error: Error) => {
    // Check if it's a permission error
    if (error.message?.includes('permission') || error.message?.includes('policy') || error.message?.includes('403')) {
      toast.error(t('errors.forbidden', 'Недостаточно прав'));
    } else {
      toast.error(error.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('contacts.title')}</h1>
        </div>
        {canManageContacts && (
          <Button
            onClick={() => {
              setEditingContact(null);
              setIsFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            {t('contacts.newContact')}
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
        emptyMessage={t('contacts.noContacts')}
      />

      {/* Create/Edit Modal */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingContact ? t('contacts.editContact') : t('contacts.newContact')}
            </DialogTitle>
          </DialogHeader>
          <ContactForm
            contact={editingContact}
            onSuccess={handleFormSuccess}
            onCancel={() => setIsFormOpen(false)}
            onError={handleFormError}
          />
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <ContactDetailDialog
        contact={viewingContact}
        open={!!viewingContact}
        onOpenChange={() => setViewingContact(null)}
      />

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deletingContact}
        onOpenChange={() => setDeletingContact(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('common.confirm')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('contacts.deleteConfirm')}
              {deletingContact?.full_name && (
                <span className="font-medium block mt-2">
                  {deletingContact.full_name}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingContact && deleteMutation.mutate(deletingContact.id)}
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
