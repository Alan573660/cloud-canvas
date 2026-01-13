import { useTranslation } from 'react-i18next';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { toast } from '@/hooks/use-toast';

const formSchema = z.object({
  from_account_id: z.string().min(1, 'Required'),
  to_email: z.string().email('Invalid email'),
  subject: z.string().min(1, 'Required'),
  body_text: z.string().min(1, 'Required'),
  lead_id: z.string().optional(),
  thread_id: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface QueueEmailFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export default function QueueEmailForm({ onSuccess, onCancel }: QueueEmailFormProps) {
  const { t } = useTranslation();
  const { profile } = useAuth();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      from_account_id: '',
      to_email: '',
      subject: '',
      body_text: '',
      lead_id: '',
      thread_id: '',
    },
  });

  // Fetch email accounts
  const { data: accounts } = useQuery({
    queryKey: ['email-accounts', profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return [];

      const { data, error } = await supabase
        .from('email_accounts')
        .select('id, email_address, status')
        .eq('organization_id', profile.organization_id)
        .eq('status', 'active');

      if (error) throw error;
      return data;
    },
    enabled: !!profile?.organization_id,
  });

  // Fetch leads for optional linking
  const { data: leads } = useQuery({
    queryKey: ['leads-select', profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return [];

      const { data, error } = await supabase
        .from('leads')
        .select('id, title, subject')
        .eq('organization_id', profile.organization_id)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      return data;
    },
    enabled: !!profile?.organization_id,
  });

  // Fetch threads for optional linking
  const { data: threads } = useQuery({
    queryKey: ['threads-select', profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return [];

      const { data, error } = await supabase
        .from('email_threads')
        .select('id, subject, counterparty_email')
        .eq('organization_id', profile.organization_id)
        .order('last_message_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      return data;
    },
    enabled: !!profile?.organization_id,
  });

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!profile?.organization_id) throw new Error('No organization');

      const { data, error } = await supabase.rpc('rpc_queue_outbound_email', {
        p_organization_id: profile.organization_id,
        p_from_account_id: values.from_account_id,
        p_to_email: values.to_email,
        p_subject: values.subject,
        p_body_text: values.body_text,
        p_lead_id: values.lead_id || null,
        p_thread_id: values.thread_id || null,
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({ title: t('common.success') });
      onSuccess();
    },
    onError: (error: Error) => {
      if (error.message.includes('Not allowed')) {
        toast({ title: t('errors.forbidden'), variant: 'destructive' });
      } else {
        toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
      }
    },
  });

  const onSubmit = (values: FormValues) => {
    mutation.mutate(values);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="from_account_id"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('email.from')}</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder={t('common.filter')} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {accounts?.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.email_address}
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
          name="to_email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('email.to')}</FormLabel>
              <FormControl>
                <Input type="email" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="subject"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('email.subject')}</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="body_text"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('email.body')}</FormLabel>
              <FormControl>
                <Textarea rows={8} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="lead_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('leads.title')} (optional)</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="">—</SelectItem>
                    {leads?.map((lead) => (
                      <SelectItem key={lead.id} value={lead.id}>
                        {lead.title || lead.subject || lead.id.slice(0, 8)}
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
            name="thread_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('email.threads')} (optional)</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="">—</SelectItem>
                    {threads?.map((thread) => (
                      <SelectItem key={thread.id} value={thread.id}>
                        {thread.subject || thread.counterparty_email || thread.id.slice(0, 8)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t('email.send')}
          </Button>
        </div>
      </form>
    </Form>
  );
}
