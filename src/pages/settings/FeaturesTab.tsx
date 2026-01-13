import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Settings2, Code } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Json } from '@/integrations/supabase/types';

interface OrgFeature {
  id: string;
  feature_code: string;
  enabled: boolean;
  config: Json;
}

const FEATURE_LABELS: Record<string, { ru: string; en: string; desc_ru: string; desc_en: string }> = {
  calls: { 
    ru: 'Звонки', 
    en: 'Calls',
    desc_ru: 'Входящие и исходящие звонки через AI',
    desc_en: 'Inbound and outbound AI calls'
  },
  email: { 
    ru: 'Email', 
    en: 'Email',
    desc_ru: 'Обработка входящих писем и отправка',
    desc_en: 'Email processing and sending'
  },
  invoices: { 
    ru: 'Счета', 
    en: 'Invoices',
    desc_ru: 'Генерация и отправка счетов',
    desc_en: 'Invoice generation and sending'
  },
  outbound: { 
    ru: 'Исходящие кампании', 
    en: 'Outbound Campaigns',
    desc_ru: 'Массовые звонки и рассылки',
    desc_en: 'Mass calls and mailings'
  },
  delivery: { 
    ru: 'Доставка', 
    en: 'Delivery',
    desc_ru: 'Расчёт стоимости доставки',
    desc_en: 'Delivery cost calculation'
  },
  parsing: { 
    ru: 'Парсинг лидов', 
    en: 'Lead Parsing',
    desc_ru: 'Автоматический сбор контактов',
    desc_en: 'Automatic contact collection'
  },
};

export function FeaturesTab() {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [selectedFeature, setSelectedFeature] = useState<OrgFeature | null>(null);
  const [configJson, setConfigJson] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);

  const canEdit = profile?.role === 'owner' || profile?.role === 'admin';

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

  const configMutation = useMutation({
    mutationFn: async ({ id, config }: { id: string; config: Json }) => {
      const { error } = await supabase
        .from('org_features')
        .update({ config, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('organization_id', profile!.organization_id);

      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: t('common.success') });
      queryClient.invalidateQueries({ queryKey: ['org-features'] });
      setConfigDialogOpen(false);
      setSelectedFeature(null);
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

  const getFeatureDesc = (code: string) => {
    const labels = FEATURE_LABELS[code];
    if (!labels) return '';
    return i18n.language === 'ru' ? labels.desc_ru : labels.desc_en;
  };

  const handleOpenConfig = (feature: OrgFeature) => {
    setSelectedFeature(feature);
    setConfigJson(JSON.stringify(feature.config, null, 2));
    setJsonError(null);
    setConfigDialogOpen(true);
  };

  const handleSaveConfig = () => {
    if (!selectedFeature) return;
    
    try {
      const parsed = JSON.parse(configJson);
      setJsonError(null);
      configMutation.mutate({ id: selectedFeature.id, config: parsed });
    } catch {
      setJsonError(t('settings.invalidJson'));
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.features')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            {t('settings.features')}
          </CardTitle>
          <CardDescription>{t('settings.featuresDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {features?.map((feature) => (
              <div
                key={feature.id}
                className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className="flex-1">
                  <Label htmlFor={feature.id} className="text-base font-medium cursor-pointer">
                    {getFeatureLabel(feature.feature_code)}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {getFeatureDesc(feature.feature_code)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleOpenConfig(feature)}
                      title={t('settings.editConfig')}
                    >
                      <Code className="h-4 w-4" />
                    </Button>
                  )}
                  <Switch
                    id={feature.id}
                    checked={feature.enabled}
                    disabled={!canEdit}
                    onCheckedChange={(checked) =>
                      toggleMutation.mutate({ id: feature.id, enabled: checked })
                    }
                  />
                </div>
              </div>
            ))}
            {features?.length === 0 && (
              <p className="text-muted-foreground text-center py-8">
                {t('common.noData')}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Config JSON Dialog */}
      <Dialog open={configDialogOpen} onOpenChange={setConfigDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t('settings.editConfig')}: {selectedFeature && getFeatureLabel(selectedFeature.feature_code)}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Textarea
              className="font-mono text-sm min-h-[200px]"
              value={configJson}
              onChange={(e) => {
                setConfigJson(e.target.value);
                setJsonError(null);
              }}
              placeholder="{}"
            />
            {jsonError && (
              <p className="text-sm text-destructive">{jsonError}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfigDialogOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={handleSaveConfig} disabled={configMutation.isPending}>
                {t('common.save')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
