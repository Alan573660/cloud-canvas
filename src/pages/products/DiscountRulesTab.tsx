import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { DataTable, Column } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
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
import { DiscountRuleDialog } from './DiscountRuleDialog';

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
  created_at: string;
}

export function DiscountRulesTab() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<DiscountRule | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingRule, setDeletingRule] = useState<DiscountRule | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['discount-rules', profile?.organization_id, search, page, pageSize],
    queryFn: async () => {
      if (!profile?.organization_id) return { data: [], count: 0 };

      let query = supabase
        .from('discount_rules')
        .select('*', { count: 'exact' })
        .eq('organization_id', profile.organization_id)
        .order('created_at', { ascending: false });

      if (search) {
        query = query.ilike('rule_name', `%${search}%`);
      }

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      query = query.range(from, to);

      const { data, count, error } = await query;
      if (error) throw error;

      return { data: data as DiscountRule[], count: count || 0 };
    },
    enabled: !!profile?.organization_id,
  });

  const deleteMutation = useMutation({
    mutationFn: async (ruleId: string) => {
      const { error } = await supabase
        .from('discount_rules')
        .delete()
        .eq('id', ruleId)
        .eq('organization_id', profile!.organization_id);

      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: t('common.success'), description: t('products.discountDeleted') });
      queryClient.invalidateQueries({ queryKey: ['discount-rules'] });
      setDeleteDialogOpen(false);
      setDeletingRule(null);
    },
    onError: (error) => {
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
    },
  });

  const handleEdit = (rule: DiscountRule) => {
    setEditingRule(rule);
    setDialogOpen(true);
  };

  const handleDelete = (rule: DiscountRule) => {
    setDeletingRule(rule);
    setDeleteDialogOpen(true);
  };

  const handleCreate = () => {
    setEditingRule(null);
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

  const columns: Column<DiscountRule>[] = [
    {
      key: 'rule_name',
      header: t('products.ruleName'),
      cell: (row) => <span className="font-medium">{row.rule_name}</span>,
    },
    {
      key: 'applies_to',
      header: t('products.appliesTo'),
      cell: (row) => (
        <Badge variant="outline">
          {t(`products.appliesOptions.${row.applies_to.toLowerCase()}`)}
        </Badge>
      ),
    },
    {
      key: 'discount_type',
      header: t('products.discountType'),
      cell: (row) => t(`products.discountTypes.${row.discount_type.toLowerCase()}`),
    },
    {
      key: 'discount_value',
      header: t('products.discountValue'),
      cell: (row) => (
        <span className="font-semibold text-green-600">
          -{formatDiscountValue(row.discount_type, row.discount_value)}
        </span>
      ),
    },
    {
      key: 'min_qty',
      header: t('products.minQty'),
      cell: (row) => row.min_qty,
    },
    {
      key: 'max_qty',
      header: t('products.maxQty'),
      cell: (row) => row.max_qty ?? '∞',
    },
    {
      key: 'is_active',
      header: t('products.isActive'),
      cell: (row) =>
        row.is_active ? (
          <Badge className="bg-green-100 text-green-800">
            <Check className="h-3 w-3 mr-1" />
            {t('common.yes')}
          </Badge>
        ) : (
          <Badge variant="secondary">
            <X className="h-3 w-3 mr-1" />
            {t('common.no')}
          </Badge>
        ),
    },
    {
      key: 'actions',
      header: t('common.actions'),
      cell: (row) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => handleEdit(row)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => handleDelete(row)}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">{t('products.discountRules')}</h2>
        <Button onClick={handleCreate}>
          <Plus className="h-4 w-4 mr-2" />
          {t('products.newDiscount')}
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data?.data || []}
        loading={isLoading}
        searchPlaceholder={t('common.search')}
        onSearch={setSearch}
        searchValue={search}
        page={page}
        pageSize={pageSize}
        totalCount={data?.count || 0}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        emptyMessage={t('products.noDiscounts')}
      />

      <DiscountRuleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        rule={editingRule}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('common.confirm')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('products.deleteDiscountConfirm', { name: deletingRule?.rule_name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingRule && deleteMutation.mutate(deletingRule.id)}
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
