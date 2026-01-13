import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';

interface OrgFeature {
  id: string;
  feature_code: string;
  enabled: boolean;
}

const FEATURE_LABELS: Record<string, { ru: string; en: string }> = {
  calls: { ru: 'Звонки', en: 'Calls' },
  email: { ru: 'Email', en: 'Email' },
  invoices: { ru: 'Счета', en: 'Invoices' },
  outbound: { ru: 'Исходящие кампании', en: 'Outbound Campaigns' },
  delivery: { ru: 'Доставка', en: 'Delivery' },
  parsing: { ru: 'Парсинг лидов', en: 'Lead Parsing' },
};

export function FeaturesTab() {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  const { data: features, isLoading } = useQuery({
    queryKey: ['org-features', profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return [];

      const { data, error } = await supabase
        .from('org_features')
        .select('*')
        .eq('organization_id', profile.organization_id)
        .order('feature_code');

      if (error) throw error;
      return data as OrgFeature[];
    },
    enabled: !!profile?.organization_id,
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase
        .from('org_features')
        .update({ enabled, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('organization_id', profile!.organization_id);

      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: t('common.success') });
      queryClient.invalidateQueries({ queryKey: ['org-features'] });
    },
    onError: (error: Error) => {
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
    },
  });

  const getFeatureLabel = (code: string) => {
    const labels = FEATURE_LABELS[code];
    if (!labels) return code;
    return i18n.language === 'ru' ? labels.ru : labels.en;
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.features')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.features')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {features?.map((feature) => (
            <div
              key={feature.id}
              className="flex items-center justify-between py-3 border-b last:border-0"
            >
              <Label htmlFor={feature.id} className="text-base cursor-pointer">
                {getFeatureLabel(feature.feature_code)}
              </Label>
              <Switch
                id={feature.id}
                checked={feature.enabled}
                onCheckedChange={(checked) =>
                  toggleMutation.mutate({ id: feature.id, enabled: checked })
                }
              />
            </div>
          ))}
          {features?.length === 0 && (
            <p className="text-muted-foreground text-center py-4">
              {t('common.noData')}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
