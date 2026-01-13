import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, UserPlus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable, Column } from '@/components/ui/data-table';
import { toast } from '@/hooks/use-toast';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface OrgMember {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  created_at: string;
}

export function UsersTab() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<OrgMember | null>(null);

  // Invite form
  const [inviteUserId, setInviteUserId] = useState('');
  const [inviteRole, setInviteRole] = useState('operator');
  const [inviteFullName, setInviteFullName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');

  // Edit form
  const [editRole, setEditRole] = useState('');

  const isOwner = profile?.role === 'owner';

  const { data: members, isLoading } = useQuery({
    queryKey: ['org-members', profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return [];

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('organization_id', profile.organization_id)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return data as OrgMember[];
    },
    enabled: !!profile?.organization_id,
  });

  const inviteMutation = useMutation({
    mutationFn: async () => {
      if (!profile?.organization_id) throw new Error('No org');

      const { error } = await supabase.rpc('rpc_invite_user_to_org', {
        p_organization_id: profile.organization_id,
        p_user_id: inviteUserId.trim(),
        p_role: inviteRole,
        p_full_name: inviteFullName || null,
        p_email: inviteEmail || null,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: t('common.success'), description: t('settings.userInvited') });
      queryClient.invalidateQueries({ queryKey: ['org-members'] });
      setInviteDialogOpen(false);
      setInviteUserId('');
      setInviteRole('operator');
      setInviteFullName('');
      setInviteEmail('');
    },
    onError: (error: Error) => {
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
    },
  });

  const changeRoleMutation = useMutation({
    mutationFn: async () => {
      if (!profile?.organization_id || !selectedMember) throw new Error('No data');

      const { error } = await supabase.rpc('rpc_change_user_role', {
        p_organization_id: profile.organization_id,
        p_user_id: selectedMember.user_id,
        p_new_role: editRole,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: t('common.success'), description: t('settings.roleChanged') });
      queryClient.invalidateQueries({ queryKey: ['org-members'] });
      setEditDialogOpen(false);
      setSelectedMember(null);
    },
    onError: (error: Error) => {
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async () => {
      if (!profile?.organization_id || !selectedMember) throw new Error('No data');

      const { error } = await supabase.rpc('rpc_remove_user_from_org', {
        p_organization_id: profile.organization_id,
        p_user_id: selectedMember.user_id,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: t('common.success'), description: t('settings.userRemoved') });
      queryClient.invalidateQueries({ queryKey: ['org-members'] });
      setDeleteDialogOpen(false);
      setSelectedMember(null);
    },
    onError: (error: Error) => {
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
    },
  });

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'owner':
        return 'bg-purple-100 text-purple-800';
      case 'admin':
        return 'bg-blue-100 text-blue-800';
      case 'operator':
        return 'bg-green-100 text-green-800';
      case 'accountant':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const handleEdit = (member: OrgMember) => {
    setSelectedMember(member);
    setEditRole(member.role);
    setEditDialogOpen(true);
  };

  const handleDelete = (member: OrgMember) => {
    setSelectedMember(member);
    setDeleteDialogOpen(true);
  };

  const columns: Column<OrgMember>[] = [
    {
      key: 'full_name',
      header: t('auth.fullName'),
      cell: (row) => row.full_name || '—',
    },
    {
      key: 'email',
      header: t('common.email'),
      cell: (row) => row.email || '—',
    },
    {
      key: 'user_id',
      header: 'User ID',
      cell: (row) => <span className="font-mono text-xs">{row.user_id.slice(0, 8)}...</span>,
    },
    {
      key: 'role',
      header: t('settings.roles'),
      cell: (row) => (
        <Badge className={getRoleColor(row.role)}>
          {t(`settings.role.${row.role}`)}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: t('common.actions'),
      cell: (row) => {
        const canEdit = row.role !== 'owner' && (isOwner || profile?.role === 'admin');
        const canDelete = row.role !== 'owner' && row.user_id !== profile?.user_id;

        return (
          <div className="flex gap-1">
            {canEdit && (
              <Button variant="ghost" size="icon" onClick={() => handleEdit(row)}>
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {canDelete && canEdit && (
              <Button variant="ghost" size="icon" onClick={() => handleDelete(row)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t('settings.users')}</CardTitle>
          <Button onClick={() => setInviteDialogOpen(true)}>
            <UserPlus className="h-4 w-4 mr-2" />
            {t('settings.inviteUser')}
          </Button>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={members || []} loading={isLoading} />
        </CardContent>
      </Card>

      {/* Invite Dialog */}
      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.inviteUser')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t('settings.inviteHint')}
            </p>
            <div className="space-y-2">
              <Label>User ID (UUID)</Label>
              <Input
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={inviteUserId}
                onChange={(e) => setInviteUserId(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('settings.roles')}</Label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">{t('settings.role.admin')}</SelectItem>
                  <SelectItem value="operator">{t('settings.role.operator')}</SelectItem>
                  <SelectItem value="accountant">{t('settings.role.accountant')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('auth.fullName')} ({t('common.notes').toLowerCase()})</Label>
              <Input
                value={inviteFullName}
                onChange={(e) => setInviteFullName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('common.email')} ({t('common.notes').toLowerCase()})</Label>
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setInviteDialogOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={() => inviteMutation.mutate()} disabled={!inviteUserId.trim()}>
                {t('common.add')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Role Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.changeRole')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {selectedMember?.full_name || selectedMember?.email || selectedMember?.user_id}
            </p>
            <div className="space-y-2">
              <Label>{t('settings.roles')}</Label>
              <Select value={editRole} onValueChange={setEditRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">{t('settings.role.admin')}</SelectItem>
                  <SelectItem value="operator">{t('settings.role.operator')}</SelectItem>
                  <SelectItem value="accountant">{t('settings.role.accountant')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={() => changeRoleMutation.mutate()}>
                {t('common.save')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('common.confirm')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings.removeUserConfirm', { name: selectedMember?.full_name || selectedMember?.email })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => removeMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
