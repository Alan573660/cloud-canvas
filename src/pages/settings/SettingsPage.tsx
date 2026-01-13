import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable, Column } from '@/components/ui/data-table';

interface OrgMember {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  created_at: string;
}

interface OrgFeature {
  id: string;
  feature_code: string;
  enabled: boolean;
}

export default function SettingsPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();

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

  const { data: members, isLoading: membersLoading } = useQuery({
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

  const { data: features } = useQuery({
    queryKey: ['org-features', profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return [];

      const { data, error } = await supabase
        .from('org_features')
        .select('*')
        .eq('organization_id', profile.organization_id);

      if (error) throw error;
      return data as OrgFeature[];
    },
    enabled: !!profile?.organization_id,
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

  const memberColumns: Column<OrgMember>[] = [
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
      key: 'role',
      header: t('settings.roles'),
      cell: (row) => (
        <Badge className={getRoleColor(row.role)}>
          {t(`settings.role.${row.role}`)}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t('settings.title')}</h1>
      </div>

      <Tabs defaultValue="organization">
        <TabsList>
          <TabsTrigger value="organization">{t('settings.organization')}</TabsTrigger>
          <TabsTrigger value="users">{t('settings.users')}</TabsTrigger>
          <TabsTrigger value="features">{t('settings.features')}</TabsTrigger>
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

        <TabsContent value="users" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('settings.users')}</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={memberColumns}
                data={members || []}
                loading={membersLoading}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="features" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('settings.features')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2">
                {features?.map((feature) => (
                  <div
                    key={feature.id}
                    className="flex items-center justify-between py-2 border-b last:border-0"
                  >
                    <span className="font-medium capitalize">
                      {feature.feature_code}
                    </span>
                    <Badge
                      className={
                        feature.enabled
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-800'
                      }
                    >
                      {feature.enabled ? t('common.yes') : t('common.no')}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
