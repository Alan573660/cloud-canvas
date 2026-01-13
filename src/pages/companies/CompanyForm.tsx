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
import type { Json } from '@/integrations/supabase/types';

const companySchema = z.object({
  company_name: z.string().min(1, 'Обязательное поле'),
  inn: z.string().optional(),
  kpp: z.string().optional(),
  ogrn: z.string().optional(),
  legal_address: z.string().optional(),
  bank_name: z.string().optional(),
  bank_bik: z.string().optional(),
  bank_account: z.string().optional(),
  bank_corr_account: z.string().optional(),
});

type CompanyFormData = z.infer<typeof companySchema>;

interface Company {
  id: string;
  company_name: string;
  inn: string | null;
  kpp: string | null;
  ogrn: string | null;
  legal_address: string | null;
  bank_details_json: Json;
}

interface CompanyFormProps {
  company?: Company | null;
  onSuccess: () => void;
  onCancel: () => void;
  onError?: (error: Error) => void;
}

export function CompanyForm({ company, onSuccess, onCancel, onError }: CompanyFormProps) {
  const { t } = useTranslation();
  const { profile } = useAuth();

  // Parse bank_details_json if it exists
  const bankDetails = company?.bank_details_json as Record<string, string> | null;

  const form = useForm<CompanyFormData>({
    resolver: zodResolver(companySchema),
    defaultValues: {
      company_name: company?.company_name || '',
      inn: company?.inn || '',
      kpp: company?.kpp || '',
      ogrn: company?.ogrn || '',
      legal_address: company?.legal_address || '',
      bank_name: bankDetails?.bank_name || '',
      bank_bik: bankDetails?.bank_bik || '',
      bank_account: bankDetails?.bank_account || '',
      bank_corr_account: bankDetails?.bank_corr_account || '',
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: CompanyFormData) => {
      if (!profile?.organization_id) {
        throw new Error('No organization');
      }

      const bankDetailsJson: Json = {
        bank_name: data.bank_name || null,
        bank_bik: data.bank_bik || null,
        bank_account: data.bank_account || null,
        bank_corr_account: data.bank_corr_account || null,
      };

      const payload = {
        company_name: data.company_name,
        inn: data.inn || null,
        kpp: data.kpp || null,
        ogrn: data.ogrn || null,
        legal_address: data.legal_address || null,
        bank_details_json: bankDetailsJson,
        organization_id: profile.organization_id,
      };

      if (company) {
        // Update existing company
        const { error } = await supabase
          .from('buyer_companies')
          .update({
            company_name: payload.company_name,
            inn: payload.inn,
            kpp: payload.kpp,
            ogrn: payload.ogrn,
            legal_address: payload.legal_address,
            bank_details_json: payload.bank_details_json,
          })
          .eq('id', company.id)
          .eq('organization_id', profile.organization_id);

        if (error) {
          if (error.code === '42501' || error.message?.includes('permission') || error.message?.includes('policy')) {
            throw new Error(t('errors.forbidden', 'Недостаточно прав'));
          }
          throw error;
        }
      } else {
        // Create new company
        const { error } = await supabase
          .from('buyer_companies')
          .insert(payload);

        if (error) {
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
          name="company_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('companies.companyName')} *</FormLabel>
              <FormControl>
                <Input 
                  {...field} 
                  placeholder="ООО «Компания»"
                  disabled={mutation.isPending}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="inn"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('companies.inn')}</FormLabel>
                <FormControl>
                  <Input 
                    {...field} 
                    placeholder="1234567890"
                    disabled={mutation.isPending}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="kpp"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('companies.kpp')}</FormLabel>
                <FormControl>
                  <Input 
                    {...field} 
                    placeholder="123456789"
                    disabled={mutation.isPending}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="ogrn"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('companies.ogrn')}</FormLabel>
              <FormControl>
                <Input 
                  {...field} 
                  placeholder="1234567890123"
                  disabled={mutation.isPending}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="legal_address"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('companies.legalAddress')}</FormLabel>
              <FormControl>
                <Textarea 
                  {...field} 
                  placeholder="123456, г. Москва, ул. Примерная, д. 1"
                  rows={2}
                  disabled={mutation.isPending}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="border-t pt-4 mt-4">
          <h4 className="text-sm font-medium mb-3">{t('companies.bankDetails')}</h4>
          
          <div className="space-y-4">
            <FormField
              control={form.control}
              name="bank_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Наименование банка</FormLabel>
                  <FormControl>
                    <Input 
                      {...field} 
                      placeholder="ПАО Сбербанк"
                      disabled={mutation.isPending}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="bank_bik"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>БИК</FormLabel>
                  <FormControl>
                    <Input 
                      {...field} 
                      placeholder="044525225"
                      disabled={mutation.isPending}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="bank_account"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Расчётный счёт</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        placeholder="40702810..."
                        disabled={mutation.isPending}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="bank_corr_account"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Корр. счёт</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        placeholder="30101810..."
                        disabled={mutation.isPending}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>
        </div>

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
