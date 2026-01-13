import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2, UserPlus, Crown, Shield, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable, Column } from '@/components/ui/data-table';
import { toast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<OrgMember | null>(null);

  // Invite form
  const [inviteUserId, setInviteUserId] = useState('');
  const [inviteRole, setInviteRole] = useState('operator');
  const [inviteFullName, setInviteFullName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');

  // Edit form
  const [editRole, setEditRole] = useState('');

  // Transfer form
  const [transferUserId, setTransferUserId] = useState('');

  const isOwner = profile?.role === 'owner';
  const isAdmin = profile?.role === 'admin';
  const canManage = isOwner || isAdmin;

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
      resetInviteForm();
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

  const transferMutation = useMutation({
    mutationFn: async () => {
      if (!profile?.organization_id) throw new Error('No org');

      const { error } = await supabase.rpc('rpc_transfer_org_ownership', {
        p_organization_id: profile.organization_id,
        p_new_owner_user_id: transferUserId.trim(),
      });

      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: t('common.success'), description: t('settings.ownershipTransferred') });
      queryClient.invalidateQueries({ queryKey: ['org-members'] });
      setTransferDialogOpen(false);
      setTransferUserId('');
      // Refresh profile to get new role
      window.location.reload();
    },
    onError: (error: Error) => {
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
    },
  });

  const resetInviteForm = () => {
    setInviteUserId('');
    setInviteRole('operator');
    setInviteFullName('');
    setInviteEmail('');
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'owner':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300';
      case 'admin':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
      case 'operator':
        return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
      case 'accountant':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'owner':
        return <Crown className="h-3 w-3 mr-1" />;
      case 'admin':
        return <Shield className="h-3 w-3 mr-1" />;
      default:
        return null;
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
      cell: (row) => row.full_name || <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'email',
      header: t('common.email'),
      cell: (row) => row.email || <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'user_id',
      header: 'User ID',
      cell: (row) => (
        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
          {row.user_id.slice(0, 8)}...
        </code>
      ),
    },
    {
      key: 'role',
      header: t('settings.roles'),
      cell: (row) => (
        <Badge className={getRoleColor(row.role)}>
          {getRoleIcon(row.role)}
          {t(`settings.role.${row.role}`)}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: t('common.actions'),
      cell: (row) => {
        const rowIsOwner = row.role === 'owner';
        const isSelf = row.user_id === profile?.user_id;
        const canEdit = !rowIsOwner && canManage;
        const canDelete = !rowIsOwner && !isSelf && canManage;

        if (!canManage) return <span className="text-muted-foreground">—</span>;

        return (
          <div className="flex gap-1">
            {canEdit && (
              <Button variant="ghost" size="icon" onClick={() => handleEdit(row)}>
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {canDelete && (
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
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-4">
          <div>
            <CardTitle>{t('settings.users')}</CardTitle>
            <CardDescription>{t('settings.usersDesc')}</CardDescription>
          </div>
          {canManage && (
            <div className="flex gap-2 flex-wrap">
              {isOwner && (
                <Button variant="outline" onClick={() => setTransferDialogOpen(true)}>
                  <Crown className="h-4 w-4 mr-2" />
                  {t('settings.transferOwnership')}
                </Button>
              )}
              <Button onClick={() => setInviteDialogOpen(true)}>
                <UserPlus className="h-4 w-4 mr-2" />
                {t('settings.inviteUser')}
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {members?.length === 0 && !isLoading ? (
            <p className="text-muted-foreground text-center py-8">{t('common.noData')}</p>
          ) : (
            <DataTable columns={columns} data={members || []} loading={isLoading} />
          )}
        </CardContent>
      </Card>

      {/* Invite Dialog */}
      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.inviteUser')}</DialogTitle>
            <DialogDescription>{t('settings.inviteDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{t('settings.inviteHint')}</AlertDescription>
            </Alert>
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
              <Button 
                onClick={() => inviteMutation.mutate()} 
                disabled={!inviteUserId.trim() || inviteMutation.isPending}
              >
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
              <Button 
                onClick={() => changeRoleMutation.mutate()}
                disabled={changeRoleMutation.isPending}
              >
                {t('common.save')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Transfer Ownership Dialog */}
      <Dialog open={transferDialogOpen} onOpenChange={setTransferDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.transferOwnership')}</DialogTitle>
            <DialogDescription>{t('settings.transferDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{t('settings.transferWarning')}</AlertDescription>
            </Alert>
            <div className="space-y-2">
              <Label>{t('settings.newOwnerUserId')}</Label>
              <Input
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={transferUserId}
                onChange={(e) => setTransferUserId(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setTransferDialogOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="destructive"
                onClick={() => transferMutation.mutate()}
                disabled={!transferUserId.trim() || transferMutation.isPending}
              >
                {t('settings.transferOwnership')}
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
              {t('settings.removeUserConfirm', { name: selectedMember?.full_name || selectedMember?.email || 'user' })}
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
