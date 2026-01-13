import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { toast } from 'sonner';

const contactSchema = z.object({
  full_name: z.string().min(1, 'Обязательное поле'),
  email: z.string().email('Неверный email').optional().or(z.literal('')),
  phone: z.string().optional(),
  notes: z.string().optional(),
});

type ContactFormData = z.infer<typeof contactSchema>;

interface Contact {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
}

interface ContactFormProps {
  contact?: Contact | null;
  onSuccess: () => void;
  onCancel: () => void;
  onError?: (error: Error) => void;
}

export function ContactForm({ contact, onSuccess, onCancel, onError }: ContactFormProps) {
  const { t } = useTranslation();
  const { profile } = useAuth();

  const form = useForm<ContactFormData>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      full_name: contact?.full_name || '',
      email: contact?.email || '',
      phone: contact?.phone || '',
      notes: contact?.notes || '',
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: ContactFormData) => {
      if (!profile?.organization_id) {
        throw new Error('No organization');
      }

      // Always set organization_id from profile
      const payload = {
        full_name: data.full_name || null,
        email: data.email || null,
        phone: data.phone || null,
        notes: data.notes || null,
        organization_id: profile.organization_id,
      };

      if (contact) {
        // Update existing contact
        const { error } = await supabase
          .from('contacts')
          .update({
            full_name: payload.full_name,
            email: payload.email,
            phone: payload.phone,
            notes: payload.notes,
          })
          .eq('id', contact.id)
          .eq('organization_id', profile.organization_id); // Extra safety

        if (error) {
          // Handle 403/permission errors
          if (error.code === '42501' || error.message?.includes('permission') || error.message?.includes('policy')) {
            throw new Error(t('errors.forbidden', 'Недостаточно прав'));
          }
          throw error;
        }
      } else {
        // Create new contact
        const { error } = await supabase
          .from('contacts')
          .insert(payload);

        if (error) {
          // Handle 403/permission errors
          if (error.code === '42501' || error.message?.includes('permission') || error.message?.includes('policy')) {
            throw new Error(t('errors.forbidden', 'Недостаточно прав'));
          }
          throw error;
        }
      }
    },
    onSuccess: () => {
      toast.success(t('common.success'));
      onSuccess();
    },
    onError: (error: Error) => {
      if (onError) {
        onError(error);
      } else {
        toast.error(error.message);
      }
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
        <FormField
          control={form.control}
          name="full_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('contacts.fullName')} *</FormLabel>
              <FormControl>
                <Input 
                  {...field} 
                  placeholder="Иванов Иван Иванович"
                  disabled={mutation.isPending}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('contacts.email')}</FormLabel>
              <FormControl>
                <Input 
                  type="email" 
                  {...field} 
                  placeholder="email@example.com"
                  disabled={mutation.isPending}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('contacts.phone')}</FormLabel>
              <FormControl>
                <Input 
                  {...field} 
                  placeholder="+7 (999) 123-45-67"
                  disabled={mutation.isPending}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('contacts.notes')}</FormLabel>
              <FormControl>
                <Textarea 
                  {...field} 
                  placeholder="Дополнительная информация..."
                  rows={3}
                  disabled={mutation.isPending}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2 pt-4">
          <Button 
            type="button" 
            variant="outline" 
            onClick={onCancel}
            disabled={mutation.isPending}
          >
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('common.loading')}
              </>
            ) : (
              t('common.save')
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
