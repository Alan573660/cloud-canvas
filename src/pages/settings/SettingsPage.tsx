import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { UsersTab } from './UsersTab';
import { FeaturesTab } from './FeaturesTab';
import { ChannelsTab } from './ChannelsTab';
import { BotSettingsTab } from './BotSettingsTab';

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();

  const canManage = profile?.role === 'owner' || profile?.role === 'admin';

  const { data: organization, isLoading } = useQuery({
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-success/10 text-success border-success/20';
      case 'suspended':
        return 'bg-destructive/10 text-destructive border-destructive/20';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  const getPlanColor = (plan: string) => {
    switch (plan) {
      case 'enterprise':
        return 'bg-primary/10 text-primary border-primary/20';
      case 'pro':
        return 'bg-accent/10 text-accent-foreground border-accent/20';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t('settings.title')}</h1>
        <p className="text-muted-foreground">{t('settings.description')}</p>
      </div>

      <Tabs defaultValue="organization">
        <TabsList className="flex-wrap">
          <TabsTrigger value="organization">{t('settings.organization')}</TabsTrigger>
          <TabsTrigger value="users">{t('settings.users')}</TabsTrigger>
          {canManage && <TabsTrigger value="features">{t('settings.features')}</TabsTrigger>}
          {canManage && <TabsTrigger value="channels">{t('settings.channels')}</TabsTrigger>}
          {canManage && <TabsTrigger value="bot">{t('settings.botSettings')}</TabsTrigger>}
        </TabsList>

        <TabsContent value="organization" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('settings.organization')}</CardTitle>
              <CardDescription>{t('settings.organizationDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-4">
                  <Skeleton className="h-6 w-48" />
                  <Skeleton className="h-6 w-64" />
                  <Skeleton className="h-6 w-32" />
                </div>
              ) : organization ? (
                <div className="grid gap-6 md:grid-cols-2">
                  <div className="space-y-1">
                    <span className="text-sm text-muted-foreground">{t('common.name')}</span>
                    <p className="text-lg font-semibold">{organization.name}</p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-sm text-muted-foreground">ID</span>
                    <p className="font-mono text-sm bg-muted px-2 py-1 rounded w-fit">
                      {organization.id}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-sm text-muted-foreground">{t('settings.plan')}</span>
                    <p>
                      <Badge variant="outline" className={getPlanColor(organization.plan)}>
                        {organization.plan.toUpperCase()}
                      </Badge>
                    </p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-sm text-muted-foreground">{t('common.status')}</span>
                    <p>
                      <Badge variant="outline" className={getStatusColor(organization.status)}>
                        {t(`settings.statuses.${organization.status}`)}
                      </Badge>
                    </p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-sm text-muted-foreground">{t('common.createdAt')}</span>
                    <p className="text-sm">
                      {format(new Date(organization.created_at), 'dd MMMM yyyy, HH:mm', {
                        locale: i18n.language === 'ru' ? ru : enUS,
                      })}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground text-center py-8">{t('common.noData')}</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="users" className="space-y-4">
          <UsersTab />
        </TabsContent>

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
