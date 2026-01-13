import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';
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
import { Switch } from '@/components/ui/switch';

interface OrgChannel {
  id: string;
  channel_type: string;
  channel_value: string;
  is_active: boolean;
  created_at: string;
}

const CHANNEL_TYPES = ['phone', 'email', 'whatsapp', 'telegram'];

export function ChannelsTab() {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<OrgChannel | null>(null);

  // Form
  const [channelType, setChannelType] = useState('phone');
  const [channelValue, setChannelValue] = useState('');
  const [isActive, setIsActive] = useState(true);

  const { data: channels, isLoading } = useQuery({
    queryKey: ['org-channels', profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return [];

      const { data, error } = await supabase
        .from('org_channels')
        .select('*')
        .eq('organization_id', profile.organization_id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as OrgChannel[];
    },
    enabled: !!profile?.organization_id,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!profile?.organization_id) throw new Error('No org');

      const payload = {
        organization_id: profile.organization_id,
        channel_type: channelType,
        channel_value: channelValue.trim(),
        is_active: isActive,
      };

      if (selectedChannel) {
        const { error } = await supabase
          .from('org_channels')
          .update(payload)
          .eq('id', selectedChannel.id)
          .eq('organization_id', profile.organization_id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('org_channels').insert([payload]);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({ title: t('common.success') });
      queryClient.invalidateQueries({ queryKey: ['org-channels'] });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!profile?.organization_id || !selectedChannel) throw new Error('No data');

      const { error } = await supabase
        .from('org_channels')
        .delete()
        .eq('id', selectedChannel.id)
        .eq('organization_id', profile.organization_id);

      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: t('common.success') });
      queryClient.invalidateQueries({ queryKey: ['org-channels'] });
      setDeleteDialogOpen(false);
      setSelectedChannel(null);
    },
    onError: (error: Error) => {
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
    },
  });

  const closeDialog = () => {
    setDialogOpen(false);
    setSelectedChannel(null);
    setChannelType('phone');
    setChannelValue('');
    setIsActive(true);
  };

  const handleCreate = () => {
    setSelectedChannel(null);
    setChannelType('phone');
    setChannelValue('');
    setIsActive(true);
    setDialogOpen(true);
  };

  const handleEdit = (channel: OrgChannel) => {
    setSelectedChannel(channel);
    setChannelType(channel.channel_type);
    setChannelValue(channel.channel_value);
    setIsActive(channel.is_active);
    setDialogOpen(true);
  };

  const handleDelete = (channel: OrgChannel) => {
    setSelectedChannel(channel);
    setDeleteDialogOpen(true);
  };

  const getChannelLabel = (type: string) => {
    const labels: Record<string, { ru: string; en: string }> = {
      phone: { ru: 'Телефон', en: 'Phone' },
      email: { ru: 'Email', en: 'Email' },
      whatsapp: { ru: 'WhatsApp', en: 'WhatsApp' },
      telegram: { ru: 'Telegram', en: 'Telegram' },
    };
    const label = labels[type];
    return label ? (i18n.language === 'ru' ? label.ru : label.en) : type;
  };

  const columns: Column<OrgChannel>[] = [
    {
      key: 'channel_type',
      header: t('settings.channelType'),
      cell: (row) => <Badge variant="outline">{getChannelLabel(row.channel_type)}</Badge>,
    },
    {
      key: 'channel_value',
      header: t('settings.channelValue'),
      cell: (row) => row.channel_value,
    },
    {
      key: 'is_active',
      header: t('products.isActive'),
      cell: (row) =>
        row.is_active ? (
          <Badge className="bg-green-100 text-green-800">
            <Check className="h-3 w-3 mr-1" />
            {t('common.yes')}
          </Badge>
        ) : (
          <Badge variant="secondary">
            <X className="h-3 w-3 mr-1" />
            {t('common.no')}
          </Badge>
        ),
    },
    {
      key: 'actions',
      header: t('common.actions'),
      cell: (row) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={() => handleEdit(row)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => handleDelete(row)}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t('settings.channels')}</CardTitle>
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-2" />
            {t('common.add')}
          </Button>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={channels || []} loading={isLoading} />
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedChannel ? t('settings.editChannel') : t('settings.newChannel')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('settings.channelType')}</Label>
              <Select value={channelType} onValueChange={setChannelType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHANNEL_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {getChannelLabel(type)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('settings.channelValue')}</Label>
              <Input
                value={channelValue}
                onChange={(e) => setChannelValue(e.target.value)}
                placeholder={
                  channelType === 'phone'
                    ? '+7 999 123 45 67'
                    : channelType === 'email'
                    ? 'sales@company.com'
                    : channelType === 'telegram'
                    ? '@username'
                    : '+79991234567'
                }
              />
            </div>
            <div className="flex items-center justify-between py-2">
              <Label>{t('products.isActive')}</Label>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={closeDialog}>
                {t('common.cancel')}
              </Button>
              <Button onClick={() => saveMutation.mutate()} disabled={!channelValue.trim()}>
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
              {t('settings.deleteChannelConfirm')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
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
