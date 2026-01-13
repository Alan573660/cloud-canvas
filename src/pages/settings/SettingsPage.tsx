import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UsersTab } from './UsersTab';
import { FeaturesTab } from './FeaturesTab';
import { ChannelsTab } from './ChannelsTab';
import { BotSettingsTab } from './BotSettingsTab';

export default function SettingsPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();

  const canManage = profile?.role === 'owner' || profile?.role === 'admin';

  const { data: organization } = useQuery({
    queryKey: ['organization', profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return null;

      const { data, error } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', profile.organization_id)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!profile?.organization_id,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t('settings.title')}</h1>
      </div>

      <Tabs defaultValue="organization">
        <TabsList className="flex-wrap">
          <TabsTrigger value="organization">{t('settings.organization')}</TabsTrigger>
          {canManage && <TabsTrigger value="users">{t('settings.users')}</TabsTrigger>}
          {canManage && <TabsTrigger value="features">{t('settings.features')}</TabsTrigger>}
          {canManage && <TabsTrigger value="channels">{t('settings.channels')}</TabsTrigger>}
          {canManage && <TabsTrigger value="bot">{t('settings.botSettings')}</TabsTrigger>}
        </TabsList>

        <TabsContent value="organization" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('settings.organization')}</CardTitle>
              <CardDescription>
                {t('auth.organizationName')}: {organization?.name || '—'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <span className="text-sm text-muted-foreground">ID</span>
                  <p className="font-mono text-sm">{organization?.id}</p>
                </div>
                <div>
                  <span className="text-sm text-muted-foreground">Plan</span>
                  <p>
                    <Badge variant="outline">{organization?.plan}</Badge>
                  </p>
                </div>
                <div>
                  <span className="text-sm text-muted-foreground">{t('common.status')}</span>
                  <p>
                    <Badge
                      className={
                        organization?.status === 'active'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-800'
                      }
                    >
                      {organization?.status}
                    </Badge>
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {canManage && (
          <TabsContent value="users" className="space-y-4">
            <UsersTab />
          </TabsContent>
        )}

        {canManage && (
          <TabsContent value="features" className="space-y-4">
            <FeaturesTab />
          </TabsContent>
        )}

        {canManage && (
          <TabsContent value="channels" className="space-y-4">
            <ChannelsTab />
          </TabsContent>
        )}

        {canManage && (
          <TabsContent value="bot" className="space-y-4">
            <BotSettingsTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
