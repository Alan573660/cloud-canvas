import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, Bot, Code } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import type { Json } from '@/integrations/supabase/types';

interface BotSettings {
  id: string;
  language_default: string;
  timezone: string;
  greeting_text: string | null;
  manager_handoff_policy: string;
  pricing_mode: string;
  settings_json: Json;
}

const formSchema = z.object({
  language_default: z.string(),
  timezone: z.string(),
  greeting_text: z.string().nullable(),
  manager_handoff_policy: z.string(),
  pricing_mode: z.string(),
});

type FormValues = z.infer<typeof formSchema>;

const TIMEZONES = [
  'Europe/Moscow',
  'Europe/Kaliningrad',
  'Europe/Samara',
  'Asia/Yekaterinburg',
  'Asia/Omsk',
  'Asia/Krasnoyarsk',
  'Asia/Irkutsk',
  'Asia/Yakutsk',
  'Asia/Vladivostok',
  'Asia/Magadan',
  'Asia/Kamchatka',
];

const HANDOFF_POLICIES = ['AUTO', 'ALWAYS', 'NEVER'];
const PRICING_MODES = ['RULES', 'CATALOG', 'MANUAL'];

export function BotSettingsTab() {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  const [jsonDialogOpen, setJsonDialogOpen] = useState(false);
  const [settingsJson, setSettingsJson] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);

  const canEdit = profile?.role === 'owner' || profile?.role === 'admin';

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      language_default: 'ru',
      timezone: 'Europe/Moscow',
      greeting_text: '',
      manager_handoff_policy: 'AUTO',
      pricing_mode: 'RULES',
    },
  });

  const { data: settings, isLoading } = useQuery({
    queryKey: ['bot-settings', profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return null;

      const { data, error } = await supabase
        .from('bot_settings')
        .select('*')
        .eq('organization_id', profile.organization_id)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return data as BotSettings | null;
    },
    enabled: !!profile?.organization_id,
  });

  useEffect(() => {
    if (settings) {
      form.reset({
        language_default: settings.language_default,
        timezone: settings.timezone,
        greeting_text: settings.greeting_text || '',
        manager_handoff_policy: settings.manager_handoff_policy,
        pricing_mode: settings.pricing_mode,
      });
      setSettingsJson(JSON.stringify(settings.settings_json, null, 2));
    }
  }, [settings, form]);

  const saveMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!profile?.organization_id) throw new Error('No org');

      const payload = {
        ...values,
        greeting_text: values.greeting_text || null,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('bot_settings')
        .update(payload)
        .eq('organization_id', profile.organization_id);

      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: t('common.success') });
      queryClient.invalidateQueries({ queryKey: ['bot-settings'] });
    },
    onError: (error: Error) => {
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
    },
  });

  const jsonMutation = useMutation({
    mutationFn: async (json: Json) => {
      if (!profile?.organization_id) throw new Error('No org');

      // Use settings-merge Edge Function for safe deep merge
      // instead of raw .update() which overwrites entire settings_json
      const { invokeEdge } = await import('@/lib/api-client');
      const result = await invokeEdge<{ ok: boolean; error?: string }>('settings-merge', {
        organization_id: profile.organization_id,
        patch: json as Record<string, unknown>,
      });

      if (!result.ok) throw new Error(result.error || 'Settings merge failed');
    },
    onSuccess: () => {
      toast({ title: t('common.success') });
      queryClient.invalidateQueries({ queryKey: ['bot-settings'] });
      setJsonDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
    },
  });

  const getHandoffLabel = (policy: string) => {
    const labels: Record<string, { ru: string; en: string }> = {
      AUTO: { ru: 'Автоматически', en: 'Automatic' },
      ALWAYS: { ru: 'Всегда переводить', en: 'Always handoff' },
      NEVER: { ru: 'Никогда', en: 'Never' },
    };
    const label = labels[policy];
    return label ? (i18n.language === 'ru' ? label.ru : label.en) : policy;
  };

  const getPricingLabel = (mode: string) => {
    const labels: Record<string, { ru: string; en: string }> = {
      RULES: { ru: 'По правилам скидок', en: 'By discount rules' },
      CATALOG: { ru: 'Из каталога', en: 'From catalog' },
      MANUAL: { ru: 'Ручной ввод', en: 'Manual input' },
    };
    const label = labels[mode];
    return label ? (i18n.language === 'ru' ? label.ru : label.en) : mode;
  };

  const handleSaveJson = () => {
    try {
      const parsed = JSON.parse(settingsJson);
      setJsonError(null);
      jsonMutation.mutate(parsed);
    } catch {
      setJsonError(t('settings.invalidJson'));
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.botSettings')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (!settings) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.botSettings')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">{t('common.noData')}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5" />
              {t('settings.botSettings')}
            </CardTitle>
            <CardDescription>{t('settings.botSettingsDesc')}</CardDescription>
          </div>
          {canEdit && (
            <Button variant="outline" onClick={() => setJsonDialogOpen(true)}>
              <Code className="h-4 w-4 mr-2" />
              {t('settings.editSettingsJson')}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))} className="space-y-4">
              <FormField
                control={form.control}
                name="language_default"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('settings.defaultLanguage')}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value} disabled={!canEdit}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="ru">Русский</SelectItem>
                        <SelectItem value="en">English</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="timezone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('settings.timezone')}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value} disabled={!canEdit}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {TIMEZONES.map((tz) => (
                          <SelectItem key={tz} value={tz}>
                            {tz}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="greeting_text"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('settings.greetingText')}</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={3}
                        disabled={!canEdit}
                        {...field}
                        value={field.value || ''}
                      />
                    </FormControl>
                    <FormDescription>
                      {t('settings.greetingHint')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="manager_handoff_policy"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('settings.handoffPolicy')}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value} disabled={!canEdit}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {HANDOFF_POLICIES.map((policy) => (
                          <SelectItem key={policy} value={policy}>
                            {getHandoffLabel(policy)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="pricing_mode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('settings.pricingMode')}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value} disabled={!canEdit}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PRICING_MODES.map((mode) => (
                          <SelectItem key={mode} value={mode}>
                            {getPricingLabel(mode)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {canEdit && (
                <div className="flex justify-end pt-4">
                  <Button type="submit" disabled={saveMutation.isPending}>
                    {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    {t('common.save')}
                  </Button>
                </div>
              )}
            </form>
          </Form>
        </CardContent>
      </Card>

      {/* Settings JSON Dialog */}
      <Dialog open={jsonDialogOpen} onOpenChange={setJsonDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('settings.editSettingsJson')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Textarea
              className="font-mono text-sm min-h-[300px]"
              value={settingsJson}
              onChange={(e) => {
                setSettingsJson(e.target.value);
                setJsonError(null);
              }}
              placeholder="{}"
            />
            {jsonError && (
              <p className="text-sm text-destructive">{jsonError}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setJsonDialogOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={handleSaveJson} disabled={jsonMutation.isPending}>
                {t('common.save')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
