import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Loader2, X, FileEdit } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { Json } from '@/integrations/supabase/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

interface StagingRow {
  id: string;
  row_number: number;
  validation_status: string;
  data: Record<string, unknown>;
}

interface StagingRowEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  rowNumber: number;
}

// Quick edit fields for common product catalog fields
const QUICK_FIELDS = ['id', 'price_rub_m2', 'title', 'profile', 'thickness_mm', 'coating'];

export function StagingRowEditor({ open, onOpenChange, jobId, rowNumber }: StagingRowEditorProps) {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  const [row, setRow] = useState<StagingRow | null>(null);
  const [editedData, setEditedData] = useState<Record<string, unknown>>({});
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Fetch staging row when dialog opens
  const fetchRow = async () => {
    if (!profile?.organization_id || !open) return;
    
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('import_staging_rows')
        .select('id, row_number, data, validation_status')
        .eq('import_job_id', jobId)
        .eq('organization_id', profile.organization_id)
        .eq('row_number', rowNumber)
        .single();

      if (error) throw error;

      const stagingRow: StagingRow = {
        id: data.id,
        row_number: data.row_number,
        validation_status: data.validation_status,
        data: data.data as Record<string, unknown>,
      };

      setRow(stagingRow);
      setEditedData(stagingRow.data);
      setJsonText(JSON.stringify(stagingRow.data, null, 2));
      setJsonError(null);
    } catch (error) {
      console.error('Failed to fetch staging row:', error);
      toast.error(t('common.error'));
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch row when dialog opens
  useState(() => {
    if (open) {
      fetchRow();
    }
  });

  // Refetch when open changes
  useMemo(() => {
    if (open && profile?.organization_id) {
      fetchRow();
    }
  }, [open, jobId, rowNumber, profile?.organization_id]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!row || !profile?.organization_id) throw new Error('Invalid state');

      // If in JSON mode, parse JSON text
      let dataToSave = editedData;
      if (jsonMode) {
        try {
          dataToSave = JSON.parse(jsonText);
        } catch (e) {
          throw new Error(t('import.invalidJson', 'Некорректный JSON'));
        }
      }

      const { error } = await supabase
        .from('import_staging_rows')
        .update({
          data: dataToSave as Json,
          validation_status: 'VALID',
        })
        .eq('id', row.id)
        .eq('organization_id', profile.organization_id);

      if (error) throw error;

      // Optionally delete related errors for this row
      await supabase
        .from('import_errors')
        .delete()
        .eq('import_job_id', jobId)
        .eq('organization_id', profile.organization_id)
        .eq('row_number', rowNumber);

      return true;
    },
    onSuccess: () => {
      toast.success(t('import.rowSaved', 'Строка сохранена'));
      queryClient.invalidateQueries({ queryKey: ['import-errors'] });
      queryClient.invalidateQueries({ queryKey: ['import-preview'] });
      queryClient.invalidateQueries({ queryKey: ['import-jobs'] });
      onOpenChange(false);
    },
    onError: (error: unknown) => {
      console.error('Save error:', error);
      const err = error as { code?: string; message?: string };
      if (err.code === '42501' || err.message?.includes('policy')) {
        toast.error(t('common.permissionDenied', 'Недостаточно прав'));
      } else {
        toast.error(err.message || t('common.error'));
      }
    },
  });

  const handleFieldChange = (field: string, value: string) => {
    setEditedData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleJsonChange = (value: string) => {
    setJsonText(value);
    try {
      JSON.parse(value);
      setJsonError(null);
    } catch (e) {
      setJsonError(t('import.invalidJson', 'Некорректный JSON'));
    }
  };

  const toggleMode = () => {
    if (!jsonMode) {
      // Switching to JSON mode
      setJsonText(JSON.stringify(editedData, null, 2));
      setJsonError(null);
    } else {
      // Switching to form mode - parse JSON
      try {
        const parsed = JSON.parse(jsonText);
        setEditedData(parsed);
        setJsonError(null);
      } catch (e) {
        // Don't switch if JSON is invalid
        return;
      }
    }
    setJsonMode(!jsonMode);
  };

  // Get all keys from data for display
  const allKeys = useMemo(() => {
    if (!row) return [];
    return Object.keys(row.data);
  }, [row]);

  // Split into quick fields and other fields
  const quickFieldsAvailable = useMemo(() => {
    return QUICK_FIELDS.filter((f) => allKeys.includes(f));
  }, [allKeys]);

  const otherFields = useMemo(() => {
    return allKeys.filter((k) => !QUICK_FIELDS.includes(k));
  }, [allKeys]);

  const handleClose = () => {
    setRow(null);
    setEditedData({});
    setJsonText('');
    setJsonError(null);
    setJsonMode(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileEdit className="h-5 w-5" />
            {t('import.editRow', 'Редактирование строки')} #{rowNumber}
          </DialogTitle>
          <DialogDescription>
            {t('import.editRowDesc', 'Измените данные строки и сохраните для повторной валидации')}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : row ? (
          <div className="space-y-4">
            {/* Status badge */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{t('common.status')}:</span>
              <Badge
                variant={
                  row.validation_status === 'VALID'
                    ? 'default'
                    : row.validation_status === 'EXCLUDED'
                    ? 'secondary'
                    : 'destructive'
                }
              >
                {row.validation_status}
              </Badge>
            </div>

            {/* Mode toggle */}
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={toggleMode}>
                {jsonMode
                  ? t('import.formMode', 'Форма')
                  : t('import.jsonMode', 'JSON')}
              </Button>
            </div>

            {jsonMode ? (
              /* JSON editor */
              <div className="space-y-2">
                <Label>{t('import.jsonData', 'JSON данные')}</Label>
                <Textarea
                  value={jsonText}
                  onChange={(e) => handleJsonChange(e.target.value)}
                  className="font-mono text-xs min-h-[300px]"
                  placeholder="{}"
                />
                {jsonError && (
                  <p className="text-xs text-destructive">{jsonError}</p>
                )}
              </div>
            ) : (
              /* Form editor */
              <div className="space-y-4">
                {/* Quick fields */}
                {quickFieldsAvailable.length > 0 && (
                  <Card>
                    <CardHeader className="py-3 px-4">
                      <CardTitle className="text-sm font-medium">
                        {t('import.mainFields', 'Основные поля')}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 pt-0 space-y-3">
                      {quickFieldsAvailable.map((field) => (
                        <div key={field} className="grid grid-cols-3 gap-3 items-center">
                          <Label className="text-sm font-mono">{field}</Label>
                          <Input
                            className="col-span-2"
                            value={String(editedData[field] ?? '')}
                            onChange={(e) => handleFieldChange(field, e.target.value)}
                          />
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Other fields */}
                {otherFields.length > 0 && (
                  <Card>
                    <CardHeader className="py-3 px-4">
                      <CardTitle className="text-sm font-medium">
                        {t('import.otherFields', 'Остальные поля')}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 pt-0 space-y-3">
                      {otherFields.map((field) => (
                        <div key={field} className="grid grid-cols-3 gap-3 items-center">
                          <Label className="text-sm font-mono truncate" title={field}>
                            {field}
                          </Label>
                          <Input
                            className="col-span-2"
                            value={String(editedData[field] ?? '')}
                            onChange={(e) => handleFieldChange(field, e.target.value)}
                          />
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </div>
        ) : (
          <p className="text-center text-muted-foreground py-8">
            {t('import.rowNotFound', 'Строка не найдена')}
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleClose}>
            <X className="h-4 w-4 mr-2" />
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !row || (jsonMode && !!jsonError)}
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default StagingRowEditor;
