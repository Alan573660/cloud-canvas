import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  FormDescription,
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { Loader2, Plus, Trash2, Package, Layers, ShoppingCart } from 'lucide-react';
import { cn } from '@/lib/utils';

// Types
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

interface SteppedDiscount {
  id: string;
  minQty: number;
  maxQty: number | null;
  value: number;
}

// Form schema
const formSchema = z.object({
  rule_name: z.string().min(1, 'Введите название'),
  target_type: z.enum(['ALL', 'PROFILE', 'PRODUCT']),
  profile_value: z.string().nullable(),
  product_id: z.string().nullable(),
  discount_type: z.enum(['PERCENT', 'FIXED']),
  discount_value: z.coerce.number().min(0, 'Значение должно быть >= 0'),
  min_qty: z.coerce.number().min(0, 'Значение должно быть >= 0'),
  max_qty: z.coerce.number().nullable(),
  is_active: z.boolean(),
  is_stepped: z.boolean(),
});

type FormData = z.infer<typeof formSchema>;

export function DiscountRuleDialog({ open, onOpenChange, rule }: DiscountRuleDialogProps) {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  const [steppedDiscounts, setSteppedDiscounts] = useState<SteppedDiscount[]>([]);
  const [productSearch, setProductSearch] = useState('');

  // Fetch unique profiles for dropdown
  const { data: profiles } = useQuery({
    queryKey: ['product-profiles', profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return [];
      const { data, error } = await supabase
        .from('product_catalog')
        .select('profile')
        .eq('organization_id', profile.organization_id)
        .eq('is_active', true)
        .not('profile', 'is', null);
      if (error) throw error;
      const unique = [...new Set(data.map(d => d.profile).filter(Boolean))];
      return unique.sort();
    },
    enabled: !!profile?.organization_id && open,
  });

  // Fetch products for autocomplete
  const { data: products } = useQuery({
    queryKey: ['products-autocomplete', profile?.organization_id, productSearch],
    queryFn: async () => {
      if (!profile?.organization_id) return [];
      let query = supabase
        .from('product_catalog')
        .select('id, title, sku, profile')
        .eq('organization_id', profile.organization_id)
        .eq('is_active', true)
        .limit(20);
      
      if (productSearch) {
        query = query.or(`title.ilike.%${productSearch}%,sku.ilike.%${productSearch}%`);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: !!profile?.organization_id && open,
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      rule_name: '',
      target_type: 'ALL',
      profile_value: null,
      product_id: null,
      discount_type: 'PERCENT',
      discount_value: 5,
      min_qty: 100,
      max_qty: null,
      is_active: true,
      is_stepped: false,
    },
  });

  const targetType = form.watch('target_type');
  const discountType = form.watch('discount_type');
  const isStepped = form.watch('is_stepped');
  const discountValue = form.watch('discount_value');
  const minQty = form.watch('min_qty');
  const maxQty = form.watch('max_qty');

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      if (rule) {
        // Determine target_type from existing rule
        let targetType: 'ALL' | 'PROFILE' | 'PRODUCT' = 'ALL';
        if (rule.product_id) targetType = 'PRODUCT';
        else if (rule.category_code) targetType = 'PROFILE';

        form.reset({
          rule_name: rule.rule_name,
          target_type: targetType,
          profile_value: rule.category_code,
          product_id: rule.product_id,
          discount_type: rule.discount_type as 'PERCENT' | 'FIXED',
          discount_value: rule.discount_value,
          min_qty: rule.min_qty,
          max_qty: rule.max_qty,
          is_active: rule.is_active,
          is_stepped: false,
        });
        setSteppedDiscounts([]);
      } else {
        form.reset({
          rule_name: '',
          target_type: 'ALL',
          profile_value: null,
          product_id: null,
          discount_type: 'PERCENT',
          discount_value: 5,
          min_qty: 100,
          max_qty: null,
          is_active: true,
          is_stepped: false,
        });
        setSteppedDiscounts([]);
      }
      setProductSearch('');
    }
  }, [open, rule, form]);

  // Mutation for saving
  const mutation = useMutation({
    mutationFn: async (data: FormData) => {
      if (!profile?.organization_id) throw new Error('No organization');

      // Determine applies_to and related fields
      let applies_to = 'ALL';
      let category_code: string | null = null;
      let product_id: string | null = null;

      if (data.target_type === 'PROFILE') {
        applies_to = 'CATEGORY';
        category_code = data.profile_value;
      } else if (data.target_type === 'PRODUCT') {
        applies_to = 'PRODUCT';
        product_id = data.product_id;
      }

      if (data.is_stepped && steppedDiscounts.length > 0) {
        // Create multiple rules for stepped discounts
        const rules = steppedDiscounts.map((step, index) => ({
          rule_name: `${data.rule_name} (${t('products.discountForm.step')} ${index + 1})`,
          applies_to,
          discount_type: data.discount_type,
          discount_value: step.value,
          min_qty: step.minQty,
          max_qty: step.maxQty,
          is_active: data.is_active,
          category_code,
          product_id,
          organization_id: profile.organization_id,
        }));

        const { error } = await supabase.from('discount_rules').insert(rules);
        if (error) throw error;
      } else {
        // Single rule
        const payload = {
          rule_name: data.rule_name,
          applies_to,
          discount_type: data.discount_type,
          discount_value: data.discount_value,
          min_qty: data.min_qty,
          max_qty: data.max_qty || null,
          is_active: data.is_active,
          category_code,
          product_id,
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
      console.error('Discount rule error:', error);
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
    },
  });

  const onSubmit = (data: FormData) => {
    // Validate stepped discounts
    if (data.is_stepped) {
      if (steppedDiscounts.length === 0) {
        toast({ 
          title: t('common.error'), 
          description: t('products.discountForm.addAtLeastOneStep'), 
          variant: 'destructive' 
        });
        return;
      }
      // Check for overlaps
      const sorted = [...steppedDiscounts].sort((a, b) => a.minQty - b.minQty);
      for (let i = 0; i < sorted.length - 1; i++) {
        const current = sorted[i];
        const next = sorted[i + 1];
        if (current.maxQty === null || current.maxQty >= next.minQty) {
          toast({ 
            title: t('common.error'), 
            description: t('products.discountForm.stepsOverlap'), 
            variant: 'destructive' 
          });
          return;
        }
      }
    }
    mutation.mutate(data);
  };

  // Add stepped discount
  const addStep = () => {
    const lastStep = steppedDiscounts[steppedDiscounts.length - 1];
    const newMin = lastStep ? (lastStep.maxQty || lastStep.minQty) + 1 : 100;
    setSteppedDiscounts([
      ...steppedDiscounts,
      { id: crypto.randomUUID(), minQty: newMin, maxQty: null, value: 5 }
    ]);
  };

  const updateStep = (id: string, field: keyof SteppedDiscount, value: number | null) => {
    setSteppedDiscounts(prev => 
      prev.map(step => step.id === id ? { ...step, [field]: value } : step)
    );
  };

  const removeStep = (id: string) => {
    setSteppedDiscounts(prev => prev.filter(step => step.id !== id));
  };

  // Generate human-readable preview
  const getDiscountPreview = () => {
    if (isStepped && steppedDiscounts.length > 0) {
      return steppedDiscounts.map(step => {
        const valueStr = discountType === 'PERCENT' ? `${step.value}%` : `${step.value} ₽/м²`;
        const rangeStr = step.maxQty 
          ? t('products.discountForm.previewRange', { min: step.minQty, max: step.maxQty })
          : t('products.discountForm.previewFrom', { min: step.minQty });
        return t('products.discountForm.previewDiscount', { value: valueStr, range: rangeStr });
      });
    }
    
    const valueStr = discountType === 'PERCENT' ? `${discountValue}%` : `${discountValue} ₽/м²`;
    const rangeStr = maxQty 
      ? t('products.discountForm.previewRange', { min: minQty, max: maxQty })
      : t('products.discountForm.previewFrom', { min: minQty });
    return [t('products.discountForm.previewDiscount', { value: valueStr, range: rangeStr })];
  };

  const selectedProduct = products?.find(p => p.id === form.watch('product_id'));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {rule ? t('products.editDiscount') : t('products.newDiscount')}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Rule Name */}
            <FormField
              control={form.control}
              name="rule_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('products.discountForm.name')}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder={t('products.discountForm.namePlaceholder')} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Section 1: Target */}
            <div className="space-y-4 rounded-lg border p-4">
              <h3 className="font-medium">{t('products.discountForm.targetSection')}</h3>
              
              <FormField
                control={form.control}
                name="target_type"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        value={field.value}
                        className="grid grid-cols-1 sm:grid-cols-3 gap-3"
                      >
                        <Label
                          htmlFor="target-all"
                          className={cn(
                            "flex items-center gap-3 rounded-lg border p-4 cursor-pointer transition-colors",
                            field.value === 'ALL' ? "border-primary bg-primary/5" : "hover:bg-muted"
                          )}
                        >
                          <RadioGroupItem value="ALL" id="target-all" />
                          <ShoppingCart className="h-5 w-5 text-muted-foreground" />
                          <span>{t('products.discountForm.targetAll')}</span>
                        </Label>

                        <Label
                          htmlFor="target-profile"
                          className={cn(
                            "flex items-center gap-3 rounded-lg border p-4 cursor-pointer transition-colors",
                            field.value === 'PROFILE' ? "border-primary bg-primary/5" : "hover:bg-muted"
                          )}
                        >
                          <RadioGroupItem value="PROFILE" id="target-profile" />
                          <Layers className="h-5 w-5 text-muted-foreground" />
                          <span>{t('products.discountForm.targetProfile')}</span>
                        </Label>

                        <Label
                          htmlFor="target-product"
                          className={cn(
                            "flex items-center gap-3 rounded-lg border p-4 cursor-pointer transition-colors",
                            field.value === 'PRODUCT' ? "border-primary bg-primary/5" : "hover:bg-muted"
                          )}
                        >
                          <RadioGroupItem value="PRODUCT" id="target-product" />
                          <Package className="h-5 w-5 text-muted-foreground" />
                          <span>{t('products.discountForm.targetProduct')}</span>
                        </Label>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Profile selector */}
              {targetType === 'PROFILE' && (
                <FormField
                  control={form.control}
                  name="profile_value"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('products.profile')}</FormLabel>
                      <Select 
                        onValueChange={field.onChange} 
                        value={field.value || undefined}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={t('products.discountForm.selectProfile')} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {profiles?.map(p => (
                            <SelectItem key={p} value={p!}>
                              {p}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {/* Product selector */}
              {targetType === 'PRODUCT' && (
                <FormField
                  control={form.control}
                  name="product_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('products.discountForm.selectProductLabel')}</FormLabel>
                      <div className="space-y-2">
                        <Input
                          placeholder={t('products.discountForm.searchProduct')}
                          value={productSearch}
                          onChange={(e) => setProductSearch(e.target.value)}
                        />
                        {selectedProduct && (
                          <div className="flex items-center gap-2 p-2 bg-primary/10 rounded-md">
                            <Package className="h-4 w-4" />
                            <span className="font-medium">{selectedProduct.title}</span>
                            {selectedProduct.sku && (
                              <span className="text-xs text-muted-foreground">({selectedProduct.sku})</span>
                            )}
                            <Button 
                              type="button" 
                              variant="ghost" 
                              size="sm"
                              onClick={() => field.onChange(null)}
                              className="ml-auto h-6 w-6 p-0"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        )}
                        {!selectedProduct && products && products.length > 0 && (
                          <div className="border rounded-md max-h-40 overflow-y-auto">
                            {products.map(product => (
                              <button
                                key={product.id}
                                type="button"
                                onClick={() => {
                                  field.onChange(product.id);
                                  setProductSearch('');
                                }}
                                className="w-full flex items-center gap-2 p-2 text-left hover:bg-muted transition-colors border-b last:border-b-0"
                              >
                                <Package className="h-4 w-4 text-muted-foreground" />
                                <span className="font-medium truncate">{product.title}</span>
                                {product.sku && (
                                  <span className="text-xs text-muted-foreground">({product.sku})</span>
                                )}
                                {product.profile && (
                                  <span className="text-xs text-muted-foreground ml-auto">{product.profile}</span>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>

            {/* Section 2: Discount Type and Value */}
            <div className="space-y-4 rounded-lg border p-4">
              <h3 className="font-medium">{t('products.discountForm.typeSection')}</h3>
              
              <div className="grid grid-cols-2 gap-4">
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
                          <SelectItem value="PERCENT">{t('products.discountForm.typePercent')}</SelectItem>
                          <SelectItem value="FIXED">{t('products.discountForm.typeFixed')}</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {!isStepped && (
                  <FormField
                    control={form.control}
                    name="discount_value"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t('products.discountValue')} ({discountType === 'PERCENT' ? '%' : '₽/м²'})
                        </FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" min="0" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>
            </div>

            {/* Section 3: Volume Range */}
            {!isStepped && (
              <div className="space-y-4 rounded-lg border p-4">
                <h3 className="font-medium">{t('products.discountForm.volumeSection')}</h3>
                <FormDescription>{t('products.discountForm.volumeHint')}</FormDescription>
                
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="min_qty"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('products.discountForm.volumeFrom')}</FormLabel>
                        <FormControl>
                          <Input type="number" min="0" {...field} />
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
                        <FormLabel>{t('products.discountForm.volumeTo')}</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min="0"
                            placeholder={t('products.discountForm.volumeNoLimit')}
                            value={field.value ?? ''}
                            onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            )}

            {/* Section 4: Stepped Discount */}
            <div className="space-y-4 rounded-lg border p-4">
              <FormField
                control={form.control}
                name="is_stepped"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-3">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={!!rule}
                      />
                    </FormControl>
                    <FormLabel className="!mt-0 cursor-pointer">
                      {t('products.discountForm.steppedDiscount')}
                    </FormLabel>
                  </FormItem>
                )}
              />

              {isStepped && (
                <div className="space-y-3">
                  <FormDescription>
                    {t('products.discountForm.steppedHint')}
                  </FormDescription>

                  {steppedDiscounts.length > 0 && (
                    <div className="border rounded-md overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-muted">
                          <tr>
                            <th className="p-2 text-left font-medium">{t('products.discountForm.stepFrom')}</th>
                            <th className="p-2 text-left font-medium">{t('products.discountForm.stepTo')}</th>
                            <th className="p-2 text-left font-medium">
                              {t('products.discountValue')} ({discountType === 'PERCENT' ? '%' : '₽/м²'})
                            </th>
                            <th className="p-2 w-10"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {steppedDiscounts.map((step) => (
                            <tr key={step.id} className="border-t">
                              <td className="p-2">
                                <Input
                                  type="number"
                                  min="0"
                                  value={step.minQty}
                                  onChange={(e) => updateStep(step.id, 'minQty', Number(e.target.value))}
                                  className="h-8"
                                />
                              </td>
                              <td className="p-2">
                                <Input
                                  type="number"
                                  min="0"
                                  placeholder="∞"
                                  value={step.maxQty ?? ''}
                                  onChange={(e) => updateStep(step.id, 'maxQty', e.target.value ? Number(e.target.value) : null)}
                                  className="h-8"
                                />
                              </td>
                              <td className="p-2">
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={step.value}
                                  onChange={(e) => updateStep(step.id, 'value', Number(e.target.value))}
                                  className="h-8"
                                />
                              </td>
                              <td className="p-2">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => removeStep(step.id)}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <Button type="button" variant="outline" onClick={addStep} className="w-full">
                    <Plus className="h-4 w-4 mr-2" />
                    {t('products.discountForm.addStep')}
                  </Button>
                </div>
              )}
            </div>

            {/* Active Toggle */}
            <FormField
              control={form.control}
              name="is_active"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-4">
                  <FormLabel className="text-base">{t('products.isActive')}</FormLabel>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />

            {/* Preview */}
            <div className="rounded-lg bg-muted/50 p-4 space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">{t('products.discountForm.preview')}</h4>
              <div className="space-y-1">
                {getDiscountPreview().map((text, i) => (
                  <p key={i} className="text-sm font-medium">
                    {text}
                  </p>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
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
