import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Eye, Check, X, AlertCircle, Package, ShoppingCart, Layers } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { DiscountRuleDialog } from './DiscountRuleDialog';
import { DiscountGroupViewDialog } from './DiscountGroupViewDialog';
import { DiscountRule, DiscountGroup, groupDiscountRules, ProductInfo } from './types/discount-group';

export function DiscountRulesTab() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<DiscountGroup | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [viewingGroup, setViewingGroup] = useState<DiscountGroup | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState<DiscountGroup | null>(null);

  // Fetch all discount rules
  const { data: rulesData, isLoading: rulesLoading } = useQuery({
    queryKey: ['discount-rules-all', profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return [];

      const { data, error } = await supabase
        .from('discount_rules')
        .select('*')
        .eq('organization_id', profile.organization_id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as DiscountRule[];
    },
    enabled: !!profile?.organization_id,
  });

  // Fetch products for mapping (only those referenced in rules)
  const productIds = useMemo(() => {
    if (!rulesData) return [];
    return [...new Set(rulesData.map(r => r.product_id).filter(Boolean))] as string[];
  }, [rulesData]);

  const { data: productsData, isLoading: productsLoading } = useQuery({
    queryKey: ['discount-products', profile?.organization_id, productIds],
    queryFn: async () => {
      if (!profile?.organization_id || productIds.length === 0) return [];

      const { data, error } = await supabase
        .from('product_catalog')
        .select('id, title, sku, profile, thickness_mm, coating, bq_key')
        .eq('organization_id', profile.organization_id)
        .in('id', productIds);

      if (error) throw error;
      return data as ProductInfo[];
    },
    enabled: !!profile?.organization_id && productIds.length > 0,
  });

  // Group rules into bundles
  const groups = useMemo(() => {
    if (!rulesData) return [];
    return groupDiscountRules(rulesData, productsData || []);
  }, [rulesData, productsData]);

  // Filter groups by search
  const filteredGroups = useMemo(() => {
    if (!search.trim()) return groups;
    const searchLower = search.toLowerCase();
    return groups.filter(g => 
      g.base_rule_name.toLowerCase().includes(searchLower) ||
      g.category_code?.toLowerCase().includes(searchLower) ||
      g.products.some(p => 
        p.title?.toLowerCase().includes(searchLower) ||
        p.sku?.toLowerCase().includes(searchLower)
      )
    );
  }, [groups, search]);

  // Delete mutation - deletes all rules in a group
  const deleteMutation = useMutation({
    mutationFn: async (group: DiscountGroup) => {
      const ruleIds = group.rules.map(r => r.id);
      
      const { error } = await supabase
        .from('discount_rules')
        .delete()
        .in('id', ruleIds)
        .eq('organization_id', profile!.organization_id);

      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: t('common.success'), description: t('products.discountGroups.groupDeleted') });
      queryClient.invalidateQueries({ queryKey: ['discount-rules-all'] });
      setDeleteDialogOpen(false);
      setDeletingGroup(null);
    },
    onError: (error) => {
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
    },
  });

  const handleView = (group: DiscountGroup) => {
    setViewingGroup(group);
    setViewDialogOpen(true);
  };

  const handleEdit = (group: DiscountGroup) => {
    setEditingGroup(group);
    setDialogOpen(true);
  };

  const handleDelete = (group: DiscountGroup) => {
    setDeletingGroup(group);
    setDeleteDialogOpen(true);
  };

  const handleCreate = () => {
    setEditingGroup(null);
    setDialogOpen(true);
  };

  const formatDiscountValue = (type: string, value: number) => {
    if (type === 'PERCENT') {
      return `${value}%`;
    }
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      maximumFractionDigits: 0,
    }).format(value);
  };

  const getTargetDisplay = (group: DiscountGroup) => {
    switch (group.applies_to) {
      case 'ALL':
        return (
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
            <span>{t('products.discountGroups.targetAllProducts')}</span>
          </div>
        );
      case 'CATEGORY':
        return (
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-muted-foreground" />
            <span>{t('products.discountGroups.profileLabel')}: {group.category_code}</span>
          </div>
        );
      case 'PRODUCT':
        const productCount = group.products.length;
        const firstProduct = group.products[0];
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2 cursor-help">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  <span className="truncate max-w-[200px]">
                    {productCount === 1 && firstProduct
                      ? (firstProduct.title || firstProduct.sku || 'Товар')
                      : t('products.discountGroups.productsCount', { count: productCount })}
                  </span>
                  {productCount > 1 && (
                    <Badge variant="secondary" className="text-xs">+{productCount - 1}</Badge>
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <div className="text-xs space-y-1">
                  {group.products.slice(0, 5).map(p => (
                    <div key={p.id} className="truncate">
                      {p.title || p.sku || p.bq_key}
                    </div>
                  ))}
                  {group.products.length > 5 && (
                    <div className="text-muted-foreground">
                      {t('products.discountGroups.andMore', { count: group.products.length - 5 })}
                    </div>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      default:
        return '—';
    }
  };

  const getRangeDisplay = (group: DiscountGroup) => {
    if (group.max_qty_range === null) {
      return `${t('products.discountForm.volumeFrom').toLowerCase()} ${group.min_qty_range} м² → ∞`;
    }
    return `${group.min_qty_range} – ${group.max_qty_range} м²`;
  };

  const getActiveDisplay = (group: DiscountGroup) => {
    if (group.is_active === true) {
      return (
        <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
          <Check className="h-3 w-3 mr-1" />
          {t('common.yes')}
        </Badge>
      );
    } else if (group.is_active === false) {
      return (
        <Badge variant="secondary">
          <X className="h-3 w-3 mr-1" />
          {t('common.no')}
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="border-yellow-500 text-yellow-600 dark:text-yellow-400">
        <AlertCircle className="h-3 w-3 mr-1" />
        {t('products.discountGroups.partial')}
      </Badge>
    );
  };

  const isLoading = rulesLoading || productsLoading;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 max-w-sm">
          <Input
            placeholder={t('common.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button onClick={handleCreate}>
          <Plus className="h-4 w-4 mr-2" />
          {t('products.newDiscount')}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : filteredGroups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Package className="h-12 w-12 mb-4 opacity-50" />
          <p>{t('products.noDiscounts')}</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('products.discountGroups.name')}</TableHead>
                <TableHead>{t('products.discountGroups.appliesTo')}</TableHead>
                <TableHead>{t('products.discountType')}</TableHead>
                <TableHead>{t('products.discountGroups.steps')}</TableHead>
                <TableHead>{t('products.discountGroups.range')}</TableHead>
                <TableHead>{t('products.discountGroups.active')}</TableHead>
                <TableHead className="text-right">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredGroups.map((group) => (
                <TableRow key={group.id}>
                  <TableCell className="font-medium">{group.base_rule_name}</TableCell>
                  <TableCell>{getTargetDisplay(group)}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {group.discount_type === 'PERCENT' ? '%' : '₽/м²'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {group.steps.length > 1 ? (
                      <Badge variant="secondary">
                        {t('products.discountGroups.stepsCount', { count: group.steps.length })}
                      </Badge>
                    ) : (
                      <span className="text-green-600 dark:text-green-400 font-medium">
                        -{formatDiscountValue(group.discount_type, group.steps[0]?.discount_value || 0)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {getRangeDisplay(group)}
                  </TableCell>
                  <TableCell>{getActiveDisplay(group)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" onClick={() => handleView(group)}>
                              <Eye className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t('products.discountGroups.view')}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>

                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" onClick={() => handleEdit(group)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t('common.edit')}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>

                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" onClick={() => handleDelete(group)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t('common.delete')}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <DiscountRuleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        group={editingGroup}
      />

      <DiscountGroupViewDialog
        open={viewDialogOpen}
        onOpenChange={setViewDialogOpen}
        group={viewingGroup}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('common.confirm')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('products.discountGroups.deleteConfirm', { 
                name: deletingGroup?.base_rule_name,
                count: deletingGroup?.rules.length || 0 
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingGroup && deleteMutation.mutate(deletingGroup)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
