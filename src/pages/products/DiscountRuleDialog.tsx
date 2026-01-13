import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

interface DiscountRule {
  id: string;
  rule_name: string;
  applies_to: string;
  discount_type: string;
  discount_value: number;
  min_qty: number;
  max_qty: number | null;
  is_active: boolean;
  product_id: string | null;
  category_code: string | null;
}

interface DiscountRuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule: DiscountRule | null;
}

const formSchema = z.object({
  rule_name: z.string().min(1, 'Required'),
  applies_to: z.string(),
  discount_type: z.string(),
  discount_value: z.coerce.number().min(0),
  min_qty: z.coerce.number().min(0),
  max_qty: z.coerce.number().nullable(),
  is_active: z.boolean(),
  category_code: z.string().nullable(),
});

type FormData = z.infer<typeof formSchema>;

export function DiscountRuleDialog({ open, onOpenChange, rule }: DiscountRuleDialogProps) {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      rule_name: '',
      applies_to: 'ALL',
      discount_type: 'PERCENT',
      discount_value: 0,
      min_qty: 0,
      max_qty: null,
      is_active: true,
      category_code: null,
    },
  });

  useEffect(() => {
    if (open) {
      if (rule) {
        form.reset({
          rule_name: rule.rule_name,
          applies_to: rule.applies_to,
          discount_type: rule.discount_type,
          discount_value: rule.discount_value,
          min_qty: rule.min_qty,
          max_qty: rule.max_qty,
          is_active: rule.is_active,
          category_code: rule.category_code,
        });
      } else {
        form.reset({
          rule_name: '',
          applies_to: 'ALL',
          discount_type: 'PERCENT',
          discount_value: 0,
          min_qty: 0,
          max_qty: null,
          is_active: true,
          category_code: null,
        });
      }
    }
  }, [open, rule, form]);

  const mutation = useMutation({
    mutationFn: async (data: FormData) => {
      if (!profile?.organization_id) throw new Error('No organization');

      const payload = {
        rule_name: data.rule_name,
        applies_to: data.applies_to,
        discount_type: data.discount_type,
        discount_value: data.discount_value,
        min_qty: data.min_qty,
        max_qty: data.max_qty || null,
        is_active: data.is_active,
        category_code: data.category_code || null,
        organization_id: profile.organization_id,
      };

      if (rule) {
        const { error } = await supabase
          .from('discount_rules')
          .update(payload)
          .eq('id', rule.id)
          .eq('organization_id', profile.organization_id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('discount_rules').insert([payload]);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({
        title: t('common.success'),
        description: rule ? t('products.discountUpdated') : t('products.discountCreated'),
      });
      queryClient.invalidateQueries({ queryKey: ['discount-rules'] });
      onOpenChange(false);
    },
    onError: (error) => {
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
    },
  });

  const onSubmit = (data: FormData) => {
    mutation.mutate(data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {rule ? t('products.editDiscount') : t('products.newDiscount')}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="rule_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('products.ruleName')}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder={t('products.ruleNamePlaceholder')} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="applies_to"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('products.appliesTo')}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="ALL">{t('products.appliesOptions.all')}</SelectItem>
                        <SelectItem value="PRODUCT">{t('products.appliesOptions.product')}</SelectItem>
                        <SelectItem value="CATEGORY">{t('products.appliesOptions.category')}</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="discount_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('products.discountType')}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="PERCENT">{t('products.discountTypes.percent')}</SelectItem>
                        <SelectItem value="FIXED">{t('products.discountTypes.fixed')}</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="discount_value"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('products.discountValue')}</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="min_qty"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('products.minQty')}</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="max_qty"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('products.maxQty')}</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        value={field.value ?? ''}
                        onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="category_code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('products.categoryCode')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      value={field.value ?? ''}
                      placeholder={t('products.categoryCodePlaceholder')}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="is_active"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-3">
                  <FormLabel className="text-base">{t('products.isActive')}</FormLabel>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {t('common.save')}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
