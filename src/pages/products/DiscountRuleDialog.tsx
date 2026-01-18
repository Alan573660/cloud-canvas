import { useEffect, useState, useMemo, useCallback } from 'react';
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
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { Loader2, Plus, Trash2, Package, Layers, ShoppingCart, X, Wand2, AlertCircle, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DiscountGroup } from './types/discount-group';

interface SteppedDiscount {
  id: string;
  minQty: string; // Keep as string for empty field support
  maxQty: string;
  value: string;
}

interface SelectedProduct {
  id: string;
  title: string | null;
  sku: string | null;
  profile: string | null;
  thickness_mm: number | null;
  bq_key: string | null;
}

export interface DiscountRuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: DiscountGroup | null; // Edit group mode, null = create new
}

// Normalize search query - replace Latin C with Cyrillic С and vice versa
function normalizeSearchQuery(query: string): string {
  const trimmed = query.trim().toLowerCase();
  // Create variants with both Latin C and Cyrillic С
  const withCyrillic = trimmed.replace(/c/gi, 'с');
  const withLatin = trimmed.replace(/с/gi, 'c');
  return trimmed;
}

// Get search variants for ILIKE
function getSearchVariants(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  
  const lower = trimmed.toLowerCase();
  const withCyrillic = lower.replace(/c/gi, 'с');
  const withLatin = lower.replace(/с/gi, 'c');
  
  const variants = new Set([lower, withCyrillic, withLatin]);
  return Array.from(variants);
}

// Form schema with proper validation
const formSchema = z.object({
  rule_name: z.string().min(1, 'Введите название'),
  target_type: z.enum(['ALL', 'PROFILE', 'PRODUCT']),
  profile_value: z.string().nullable(),
  discount_type: z.enum(['PERCENT', 'FIXED']),
  discount_value: z.string().refine(val => {
    if (!val) return true; // Allow empty for stepped
    const num = parseFloat(val);
    return !isNaN(num) && num >= 0;
  }, 'Значение должно быть >= 0'),
  min_qty: z.string().refine(val => {
    if (!val) return true;
    const num = parseInt(val);
    return !isNaN(num) && num >= 0;
  }, 'Введите число м²'),
  max_qty: z.string(),
  is_active: z.boolean(),
  is_stepped: z.boolean(),
});

type FormData = z.infer<typeof formSchema>;

export function DiscountRuleDialog({ open, onOpenChange, group }: DiscountRuleDialogProps) {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  const [steppedDiscounts, setSteppedDiscounts] = useState<SteppedDiscount[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [selectedProducts, setSelectedProducts] = useState<SelectedProduct[]>([]);
  const [showMoreProducts, setShowMoreProducts] = useState(false);
  const [stepErrors, setStepErrors] = useState<Record<string, string>>({});

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

  // Fetch products with improved search
  const { data: productsData, isFetching: isSearching } = useQuery({
    queryKey: ['products-autocomplete', profile?.organization_id, productSearch],
    queryFn: async () => {
      if (!profile?.organization_id) return { products: [], hasMore: false };
      
      const limit = showMoreProducts ? 40 : 20;
      let query = supabase
        .from('product_catalog')
        .select('id, title, sku, profile, thickness_mm, bq_key')
        .eq('organization_id', profile.organization_id)
        .eq('is_active', true)
        .limit(limit + 1); // Fetch one more to check if there's more
      
      if (productSearch.trim()) {
        // Build OR filter for all search variants
        const variants = getSearchVariants(productSearch);
        const orClauses = variants.flatMap(v => [
          `title.ilike.%${v}%`,
          `sku.ilike.%${v}%`,
          `bq_key.ilike.%${v}%`,
          `profile.ilike.%${v}%`
        ]);
        query = query.or(orClauses.join(','));
      }
      
      const { data, error } = await query;
      if (error) throw error;
      
      const hasMore = (data?.length || 0) > limit;
      const products = (data || []).slice(0, limit);
      
      return { products, hasMore };
    },
    enabled: !!profile?.organization_id && open,
  });

  const products = productsData?.products || [];
  const hasMoreProducts = productsData?.hasMore || false;

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      rule_name: '',
      target_type: 'ALL',
      profile_value: null,
      discount_type: 'PERCENT',
      discount_value: '',
      min_qty: '',
      max_qty: '',
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

  // Validate min < max for main form
  const volumeError = useMemo(() => {
    if (!minQty || !maxQty) return null;
    const min = parseInt(minQty);
    const max = parseInt(maxQty);
    if (!isNaN(min) && !isNaN(max) && min >= max) {
      return t('products.discountForm.minMustBeLessThanMax', 'От должно быть меньше До');
    }
    return null;
  }, [minQty, maxQty, t]);

  // Validate percent range
  const percentError = useMemo(() => {
    if (discountType !== 'PERCENT' || !discountValue) return null;
    const val = parseFloat(discountValue);
    if (!isNaN(val) && (val < 0 || val > 100)) {
      return t('products.discountForm.percentRange', 'Процент 0..100');
    }
    return null;
  }, [discountType, discountValue, t]);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      if (group) {
        // Editing a group - pre-fill form from group data
        let targetType: 'ALL' | 'PROFILE' | 'PRODUCT' = 'ALL';
        if (group.applies_to === 'PRODUCT') targetType = 'PRODUCT';
        else if (group.applies_to === 'CATEGORY') targetType = 'PROFILE';

        // Convert group steps to stepped discounts format
        const hasMultipleSteps = group.steps.length > 1;
        
        form.reset({
          rule_name: group.base_rule_name,
          target_type: targetType,
          profile_value: group.category_code,
          discount_type: group.discount_type as 'PERCENT' | 'FIXED',
          discount_value: hasMultipleSteps ? '' : (group.steps[0]?.discount_value?.toString() || ''),
          min_qty: hasMultipleSteps ? '' : (group.steps[0]?.min_qty?.toString() || ''),
          max_qty: hasMultipleSteps ? '' : (group.steps[0]?.max_qty?.toString() || ''),
          is_active: group.is_active === true,
          is_stepped: hasMultipleSteps,
        });

        // Set stepped discounts if applicable
        if (hasMultipleSteps) {
          setSteppedDiscounts(group.steps.map(step => ({
            id: step.id,
            minQty: step.min_qty.toString(),
            maxQty: step.max_qty?.toString() || '',
            value: step.discount_value.toString(),
          })));
        } else {
          setSteppedDiscounts([]);
        }

        // Set selected products if PRODUCT type
        if (group.applies_to === 'PRODUCT' && group.products.length > 0) {
          setSelectedProducts(group.products.map(p => ({
            id: p.id,
            title: p.title,
            sku: p.sku,
            profile: p.profile,
            thickness_mm: p.thickness_mm,
            bq_key: p.bq_key,
          })));
        } else {
          setSelectedProducts([]);
        }
      } else {
        form.reset({
          rule_name: '',
          target_type: 'ALL',
          profile_value: null,
          discount_type: 'PERCENT',
          discount_value: '',
          min_qty: '',
          max_qty: '',
          is_active: true,
          is_stepped: false,
        });
        setSteppedDiscounts([]);
        setSelectedProducts([]);
      }
      setProductSearch('');
      setShowMoreProducts(false);
      setStepErrors({});
    }
  }, [open, group, form]);

  // Mutation for saving
  const mutation = useMutation({
    mutationFn: async (data: FormData) => {
      if (!profile?.organization_id) throw new Error('No organization');

      let applies_to = 'ALL';
      let category_code: string | null = null;

      if (data.target_type === 'PROFILE') {
        applies_to = 'CATEGORY';
        category_code = data.profile_value;
      } else if (data.target_type === 'PRODUCT') {
        applies_to = 'PRODUCT';
      }

      if (data.is_stepped && steppedDiscounts.length > 0) {
        // If editing a group, delete all existing rules first
        if (group) {
          const ruleIdsToDelete = group.rules.map(r => r.id);
          const { error: deleteError } = await supabase
            .from('discount_rules')
            .delete()
            .in('id', ruleIdsToDelete)
            .eq('organization_id', profile.organization_id);
          if (deleteError) throw deleteError;
        }

        // Create rules for stepped discounts
        const productIds = selectedProducts.length > 0 ? selectedProducts.map(p => p.id) : [null];
        
        const rules = steppedDiscounts.flatMap((step, stepIndex) => 
          productIds.map(productId => ({
            rule_name: `${data.rule_name} (${t('products.discountForm.step')} ${stepIndex + 1})`,
            applies_to,
            discount_type: data.discount_type,
            discount_value: parseFloat(step.value) || 0,
            min_qty: parseInt(step.minQty) || 0,
            max_qty: step.maxQty ? parseInt(step.maxQty) : null,
            is_active: data.is_active,
            category_code,
            product_id: productId,
            organization_id: profile.organization_id,
          }))
        );

        const { error } = await supabase.from('discount_rules').insert(rules);
        if (error) throw error;
      } else if (data.target_type === 'PRODUCT' && selectedProducts.length > 0) {
        // If editing a group, delete all existing rules first
        if (group) {
          const ruleIdsToDelete = group.rules.map(r => r.id);
          const { error: deleteError } = await supabase
            .from('discount_rules')
            .delete()
            .in('id', ruleIdsToDelete)
            .eq('organization_id', profile.organization_id);
          if (deleteError) throw deleteError;
        }

        // Multi-select products - create one rule per product
        const rules = selectedProducts.map(product => ({
          rule_name: data.rule_name,
          applies_to: 'PRODUCT',
          discount_type: data.discount_type,
          discount_value: parseFloat(data.discount_value) || 0,
          min_qty: parseInt(data.min_qty) || 0,
          max_qty: data.max_qty ? parseInt(data.max_qty) : null,
          is_active: data.is_active,
          category_code: null,
          product_id: product.id,
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
          discount_value: parseFloat(data.discount_value) || 0,
          min_qty: parseInt(data.min_qty) || 0,
          max_qty: data.max_qty ? parseInt(data.max_qty) : null,
          is_active: data.is_active,
          category_code,
          product_id: selectedProducts[0]?.id || null,
          organization_id: profile.organization_id,
        };

        if (group) {
          // Editing a group: delete all existing rules in the group, then insert new ones
          const ruleIdsToDelete = group.rules.map(r => r.id);
          
          const { error: deleteError } = await supabase
            .from('discount_rules')
            .delete()
            .in('id', ruleIdsToDelete)
            .eq('organization_id', profile.organization_id);
          if (deleteError) throw deleteError;
          
          // Insert the new single rule
          const { error: insertError } = await supabase.from('discount_rules').insert([payload]);
          if (insertError) throw insertError;
        } else {
          const { error } = await supabase.from('discount_rules').insert([payload]);
          if (error) throw error;
        }
      }
    },
    onSuccess: () => {
      toast({
        title: t('common.success'),
        description: group ? t('products.discountUpdated') : t('products.discountCreated'),
      });
      queryClient.invalidateQueries({ queryKey: ['discount-rules-all'] });
      onOpenChange(false);
    },
    onError: (error) => {
      console.error('Discount rule error:', error);
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
    },
  });

  // Validate stepped discounts
  const validateSteps = useCallback(() => {
    const errors: Record<string, string> = {};
    const sorted = [...steppedDiscounts].sort((a, b) => 
      (parseInt(a.minQty) || 0) - (parseInt(b.minQty) || 0)
    );

    for (let i = 0; i < sorted.length; i++) {
      const step = sorted[i];
      const minVal = parseInt(step.minQty);
      const maxVal = step.maxQty ? parseInt(step.maxQty) : null;

      // Check min is valid
      if (!step.minQty || isNaN(minVal)) {
        errors[`${step.id}-min`] = t('products.discountForm.enterNumber', 'Введите число м²');
      }

      // Check min < max
      if (maxVal !== null && !isNaN(minVal) && minVal >= maxVal) {
        errors[`${step.id}-max`] = t('products.discountForm.minMustBeLessThanMax');
      }

      // Check value
      if (!step.value) {
        errors[`${step.id}-value`] = t('products.discountForm.enterValue', 'Введите значение');
      } else if (discountType === 'PERCENT') {
        const val = parseFloat(step.value);
        if (val < 0 || val > 100) {
          errors[`${step.id}-value`] = t('products.discountForm.percentRange');
        }
      }

      // Check overlaps with next step
      if (i < sorted.length - 1) {
        const nextStep = sorted[i + 1];
        const nextMin = parseInt(nextStep.minQty) || 0;
        
        if (maxVal === null) {
          errors[`${step.id}-max`] = t('products.discountForm.lastStepUnlimited', 'Только последняя ступень может быть без ограничения');
        } else if (maxVal >= nextMin) {
          errors[`${step.id}-max`] = t('products.discountForm.stepsOverlap', 'Диапазоны пересекаются');
        }
      }
    }

    setStepErrors(errors);
    return Object.keys(errors).length === 0;
  }, [steppedDiscounts, discountType, t]);

  const onSubmit = (data: FormData) => {
    // Validate additional errors
    if (volumeError || percentError) {
      toast({ title: t('common.error'), description: volumeError || percentError, variant: 'destructive' });
      return;
    }

    // Validate product selection
    if (data.target_type === 'PRODUCT' && selectedProducts.length === 0) {
      toast({ title: t('common.error'), description: t('products.discountForm.selectProduct', 'Выберите товар'), variant: 'destructive' });
      return;
    }

    // Validate stepped discounts
    if (data.is_stepped) {
      if (steppedDiscounts.length === 0) {
        toast({ title: t('common.error'), description: t('products.discountForm.addAtLeastOneStep'), variant: 'destructive' });
        return;
      }
      if (!validateSteps()) {
        toast({ title: t('common.error'), description: t('products.discountForm.fixStepErrors', 'Исправьте ошибки в ступенях'), variant: 'destructive' });
        return;
      }
    }
    
    mutation.mutate(data);
  };

  // Add stepped discount with smart auto-fill
  const addStep = () => {
    const lastStep = steppedDiscounts[steppedDiscounts.length - 1];
    
    // Prevent adding if last step has no max (unlimited)
    if (lastStep && !lastStep.maxQty) {
      toast({ 
        title: t('common.info', 'Информация'), 
        description: t('products.discountForm.cantAddAfterUnlimited', 'Нельзя добавить ступень после ступени без ограничения'),
        variant: 'default' 
      });
      return;
    }
    
    // Auto-fill min from previous max + 1
    const newMin = lastStep && lastStep.maxQty ? (parseInt(lastStep.maxQty) + 1).toString() : '';
    
    setSteppedDiscounts([
      ...steppedDiscounts,
      { id: crypto.randomUUID(), minQty: newMin, maxQty: '', value: '' }
    ]);
  };

  // Auto-fill ranges for stepped discounts
  const autoFillRanges = () => {
    if (steppedDiscounts.length < 2) return;

    const sorted = [...steppedDiscounts].sort((a, b) => 
      (parseInt(a.minQty) || 0) - (parseInt(b.minQty) || 0)
    );

    const updated = sorted.map((step, i) => {
      if (i < sorted.length - 1) {
        const nextMin = parseInt(sorted[i + 1].minQty);
        if (!isNaN(nextMin) && nextMin > 0) {
          return { ...step, maxQty: (nextMin - 1).toString() };
        }
      }
      return step;
    });

    setSteppedDiscounts(updated);
    toast({ title: t('common.success'), description: t('products.discountForm.rangesAutoFilled', 'Диапазоны заполнены') });
  };

  const updateStep = (id: string, field: keyof SteppedDiscount, value: string) => {
    setSteppedDiscounts(prev => 
      prev.map(step => step.id === id ? { ...step, [field]: value } : step)
    );
    // Clear error for this field
    setStepErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors[`${id}-${field === 'minQty' ? 'min' : field === 'maxQty' ? 'max' : 'value'}`];
      return newErrors;
    });
  };

  const removeStep = (id: string) => {
    setSteppedDiscounts(prev => prev.filter(step => step.id !== id));
  };

  // Add product to selection
  const addProduct = (product: typeof products[0]) => {
    if (!selectedProducts.find(p => p.id === product.id)) {
      setSelectedProducts([...selectedProducts, product]);
    }
    setProductSearch('');
  };

  // Remove product from selection
  const removeProduct = (productId: string) => {
    setSelectedProducts(prev => prev.filter(p => p.id !== productId));
  };

  // Filter out already selected products
  const availableProducts = products.filter(p => !selectedProducts.find(sp => sp.id === p.id));

  // Generate human-readable preview
  const getDiscountPreview = () => {
    const previews: string[] = [];
    
    if (isStepped && steppedDiscounts.length > 0) {
      steppedDiscounts.forEach(step => {
        const valueStr = discountType === 'PERCENT' ? `${step.value || 0}%` : `${step.value || 0} ₽/м²`;
        const rangeStr = step.maxQty 
          ? t('products.discountForm.previewRange', { min: step.minQty || 0, max: step.maxQty })
          : t('products.discountForm.previewFrom', { min: step.minQty || 0 });
        previews.push(t('products.discountForm.previewDiscount', { value: valueStr, range: rangeStr }));
      });
    } else {
      const valueStr = discountType === 'PERCENT' ? `${discountValue || 0}%` : `${discountValue || 0} ₽/м²`;
      const rangeStr = maxQty 
        ? t('products.discountForm.previewRange', { min: minQty || 0, max: maxQty })
        : t('products.discountForm.previewFrom', { min: minQty || 0 });
      previews.push(t('products.discountForm.previewDiscount', { value: valueStr, range: rangeStr }));
    }

    return previews;
  };

  // Calculate how many rules will be created
  const rulesCount = useMemo(() => {
    if (targetType === 'PRODUCT' && selectedProducts.length > 1) {
      if (isStepped && steppedDiscounts.length > 0) {
        return selectedProducts.length * steppedDiscounts.length;
      }
      return selectedProducts.length;
    }
    if (isStepped && steppedDiscounts.length > 0) {
      return steppedDiscounts.length;
    }
    return 1;
  }, [targetType, selectedProducts.length, isStepped, steppedDiscounts.length]);

  // Handle integer-only input
  const handleIntegerInput = (e: React.ChangeEvent<HTMLInputElement>, onChange: (value: string) => void) => {
    let value = e.target.value;
    // Remove leading zeros (except for empty or just "0")
    if (value.length > 1 && value.startsWith('0')) {
      value = value.replace(/^0+/, '');
    }
    // Only allow digits
    value = value.replace(/[^0-9]/g, '');
    onChange(value);
  };

  // Handle decimal input for percentages/fixed
  const handleDecimalInput = (e: React.ChangeEvent<HTMLInputElement>, onChange: (value: string) => void) => {
    let value = e.target.value;
    // Allow digits and one decimal point
    value = value.replace(/[^0-9.]/g, '');
    // Only allow one decimal point
    const parts = value.split('.');
    if (parts.length > 2) {
      value = parts[0] + '.' + parts.slice(1).join('');
    }
    onChange(value);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {group ? t('products.editDiscount') : t('products.newDiscount')}
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
                        onValueChange={(value) => {
                          field.onChange(value);
                          if (value !== 'PRODUCT') {
                            setSelectedProducts([]);
                          }
                        }}
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

              {/* Product selector - multi-select */}
              {targetType === 'PRODUCT' && (
                <div className="space-y-3">
                  <FormLabel>{t('products.discountForm.selectProductLabel')}</FormLabel>
                  
                  {/* Selected products chips */}
                  {selectedProducts.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {selectedProducts.map(product => (
                        <Badge key={product.id} variant="secondary" className="flex items-center gap-1 px-2 py-1">
                          <Package className="h-3 w-3" />
                          <span className="max-w-[150px] truncate">{product.title || product.sku}</span>
                          {product.sku && product.title && (
                            <span className="text-xs text-muted-foreground">({product.sku})</span>
                          )}
                          <button
                            type="button"
                            onClick={() => removeProduct(product.id)}
                            className="ml-1 hover:bg-muted rounded p-0.5"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* Search input */}
                  <div className="relative">
                    <Input
                      placeholder={t('products.discountForm.searchProductPlaceholder', 'Поиск по названию, SKU, профилю...')}
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                    />
                    {isSearching && (
                      <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                  </div>

                  {/* Product list */}
                  {productSearch && availableProducts.length > 0 && (
                    <div className="border rounded-md max-h-60 overflow-y-auto">
                      {availableProducts.map(product => (
                        <button
                          key={product.id}
                          type="button"
                          onClick={() => addProduct(product)}
                          className="w-full flex items-start gap-2 p-3 text-left hover:bg-muted transition-colors border-b last:border-b-0"
                        >
                          <Package className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{product.title}</div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              {(product.sku || product.bq_key) && (
                                <span>{product.sku || product.bq_key}</span>
                              )}
                              {product.profile && (
                                <span>• {product.profile}</span>
                              )}
                              {product.thickness_mm && (
                                <span>• {product.thickness_mm} мм</span>
                              )}
                            </div>
                          </div>
                        </button>
                      ))}
                      
                      {hasMoreProducts && !showMoreProducts && (
                        <button
                          type="button"
                          onClick={() => setShowMoreProducts(true)}
                          className="w-full flex items-center justify-center gap-2 p-2 text-sm text-primary hover:bg-muted"
                        >
                          <ChevronDown className="h-4 w-4" />
                          {t('products.discountForm.showMore', 'Показать ещё')}
                        </button>
                      )}
                    </div>
                  )}

                  {productSearch && availableProducts.length === 0 && !isSearching && (
                    <p className="text-sm text-muted-foreground py-2">
                      {t('products.discountForm.noProductsFound', 'Товары не найдены')}
                    </p>
                  )}

                  {/* Info about multiple rules */}
                  {selectedProducts.length > 1 && (
                    <div className="flex items-center gap-2 p-2 bg-blue-50 dark:bg-blue-950/20 rounded text-xs text-blue-700 dark:text-blue-400">
                      <AlertCircle className="h-3 w-3 flex-shrink-0" />
                      <span>
                        {t('products.discountForm.multipleRulesInfo', 'Будет создано {{count}} правил (по одному на товар)', { count: selectedProducts.length })}
                      </span>
                    </div>
                  )}
                </div>
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
                          <Input
                            type="text"
                            inputMode="decimal"
                            placeholder={discountType === 'PERCENT' ? t('products.discountForm.examplePercent', 'Например: 5') : t('products.discountForm.exampleFixed', 'Например: 100')}
                            value={field.value}
                            onChange={(e) => handleDecimalInput(e, field.onChange)}
                          />
                        </FormControl>
                        {percentError && <p className="text-sm text-destructive">{percentError}</p>}
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
                          <Input
                            type="text"
                            inputMode="numeric"
                            placeholder={t('products.discountForm.exampleM2', 'Например: 100')}
                            value={field.value}
                            onChange={(e) => handleIntegerInput(e, field.onChange)}
                          />
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
                            type="text"
                            inputMode="numeric"
                            placeholder={t('products.discountForm.volumeNoLimit')}
                            value={field.value}
                            onChange={(e) => handleIntegerInput(e, field.onChange)}
                          />
                        </FormControl>
                        {volumeError && <p className="text-sm text-destructive">{volumeError}</p>}
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
                        disabled={!!group}
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
                    <>
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
                            {steppedDiscounts.map((step, index) => (
                              <tr key={step.id} className="border-t">
                                <td className="p-2">
                                  <Input
                                    type="text"
                                    inputMode="numeric"
                                    placeholder={t('products.discountForm.exampleM2', 'Например: 100')}
                                    value={step.minQty}
                                    onChange={(e) => handleIntegerInput(e, (v) => updateStep(step.id, 'minQty', v))}
                                    className={cn("h-8", stepErrors[`${step.id}-min`] && "border-destructive")}
                                  />
                                  {stepErrors[`${step.id}-min`] && (
                                    <p className="text-xs text-destructive mt-1">{stepErrors[`${step.id}-min`]}</p>
                                  )}
                                </td>
                                <td className="p-2">
                                  <Input
                                    type="text"
                                    inputMode="numeric"
                                    placeholder={index === steppedDiscounts.length - 1 ? '∞' : t('products.discountForm.exampleM2', 'Например: 100')}
                                    value={step.maxQty}
                                    onChange={(e) => handleIntegerInput(e, (v) => updateStep(step.id, 'maxQty', v))}
                                    className={cn("h-8", stepErrors[`${step.id}-max`] && "border-destructive")}
                                  />
                                  {stepErrors[`${step.id}-max`] && (
                                    <p className="text-xs text-destructive mt-1">{stepErrors[`${step.id}-max`]}</p>
                                  )}
                                </td>
                                <td className="p-2">
                                  <Input
                                    type="text"
                                    inputMode="decimal"
                                    placeholder={discountType === 'PERCENT' ? t('products.discountForm.examplePercent', 'Например: 5') : t('products.discountForm.exampleFixed', 'Например: 100')}
                                    value={step.value}
                                    onChange={(e) => handleDecimalInput(e, (v) => updateStep(step.id, 'value', v))}
                                    className={cn("h-8", stepErrors[`${step.id}-value`] && "border-destructive")}
                                  />
                                  {stepErrors[`${step.id}-value`] && (
                                    <p className="text-xs text-destructive mt-1">{stepErrors[`${step.id}-value`]}</p>
                                  )}
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

                      {steppedDiscounts.length >= 2 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={autoFillRanges}
                          className="gap-2"
                        >
                          <Wand2 className="h-4 w-4" />
                          {t('products.discountForm.autoFillRanges', 'Автозаполнить диапазоны')}
                        </Button>
                      )}
                    </>
                  )}

                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={addStep} 
                    className="w-full"
                    disabled={steppedDiscounts.length > 0 && !steppedDiscounts[steppedDiscounts.length - 1].maxQty}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    {t('products.discountForm.addStep')}
                  </Button>
                  
                  {steppedDiscounts.length > 0 && !steppedDiscounts[steppedDiscounts.length - 1].maxQty && (
                    <p className="text-xs text-muted-foreground">
                      {t('products.discountForm.cantAddAfterUnlimitedHint', 'Заполните поле "До" в последней ступени, чтобы добавить следующую')}
                    </p>
                  )}
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
              {rulesCount > 1 && (
                <p className="text-xs text-muted-foreground mt-2">
                  {t('products.discountForm.willCreateRules', 'Будет создано правил: {{count}}', { count: rulesCount })}
                </p>
              )}
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
