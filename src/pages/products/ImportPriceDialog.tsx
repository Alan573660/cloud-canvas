import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { Upload, FileSpreadsheet, AlertTriangle, Loader2, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from '@/hooks/use-toast';

interface ImportPriceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function ImportPriceDialog({ open, onOpenChange, onSuccess }: ImportPriceDialogProps) {
  const { t } = useTranslation();
  const { profile } = useAuth();

  const [file, setFile] = useState<File | null>(null);
  const [dryRun, setDryRun] = useState(false);
  const [archiveBeforeReplace, setArchiveBeforeReplace] = useState(true);

  const createJobMutation = useMutation({
    mutationFn: async () => {
      if (!profile?.organization_id || !file) throw new Error('Invalid state');

      // Create import job record
      const { data, error } = await supabase
        .from('import_jobs')
        .insert({
          organization_id: profile.organization_id,
          entity_type: 'PRODUCT_CATALOG',
          status: 'QUEUED',
          dry_run: dryRun,
          mode: 'REPLACE',
          source: 'ui',
          file_name: file.name,
          file_mime: file.type,
          file_size_bytes: file.size,
        })
        .select()
        .single();

      if (error) throw error;

      // TODO: Upload file to storage and call backend worker
      console.info('[ImportPriceDialog] Job created:', data.id);
      console.info('[ImportPriceDialog] TODO: Upload file to storage');
      console.info('[ImportPriceDialog] TODO: Call POST /api/import/run', {
        import_job_id: data.id,
        organization_id: profile.organization_id,
        format: file.type,
        mode: 'REPLACE',
        archive_before_replace: archiveBeforeReplace,
        dry_run: dryRun,
      });

      return data;
    },
    onSuccess: () => {
      toast({
        title: t('common.success'),
        description: t('catalog.importQueued', 'Импорт добавлен в очередь'),
      });
      onSuccess?.();
      onOpenChange(false);
      resetForm();
    },
    onError: (error) => {
      console.error('[ImportPriceDialog] Error:', error);
      toast({
        title: t('common.error'),
        description: t('catalog.importError', 'Не удалось создать задачу импорта'),
        variant: 'destructive',
      });
    },
  });

  const resetForm = () => {
    setFile(null);
    setDryRun(false);
    setArchiveBeforeReplace(true);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      setFile(droppedFile);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            {t('catalog.uploadPrice', 'Загрузить прайс')}
          </DialogTitle>
          <DialogDescription>
            {t('catalog.uploadPriceDesc', 'Загрузите файл прайс-листа для обновления каталога')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* File Drop Zone */}
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            className="border-2 border-dashed rounded-lg p-6 text-center hover:border-primary/50 transition-colors cursor-pointer"
            onClick={() => document.getElementById('file-input')?.click()}
          >
            <input
              id="file-input"
              type="file"
              accept=".csv,.xlsx,.xls,.jsonl,.parquet"
              onChange={handleFileChange}
              className="hidden"
            />
            {file ? (
              <div className="flex items-center justify-center gap-3">
                <FileSpreadsheet className="h-8 w-8 text-primary" />
                <div className="text-left">
                  <p className="font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
              </div>
            ) : (
              <>
                <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">{t('import.dragAndDrop')}</p>
                <div className="flex flex-wrap justify-center gap-1 mt-3">
                  <Badge variant="secondary" className="text-xs">CSV</Badge>
                  <Badge variant="secondary" className="text-xs">XLSX</Badge>
                  <Badge variant="secondary" className="text-xs">JSONL</Badge>
                  <Badge variant="secondary" className="text-xs">Parquet</Badge>
                </div>
              </>
            )}
          </div>

          {/* Options */}
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex items-center gap-2">
                <Label htmlFor="dry-run" className="cursor-pointer">
                  {t('import.dryRun')} ({t('catalog.testMode', 'Тестовый режим')})
                </Label>
              </div>
              <Switch
                id="dry-run"
                checked={dryRun}
                onCheckedChange={setDryRun}
              />
            </div>

            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex items-center gap-2">
                <Label htmlFor="archive" className="cursor-pointer">
                  {t('catalog.archiveBeforeReplace', 'Архивировать перед заменой')}
                </Label>
              </div>
              <Switch
                id="archive"
                checked={archiveBeforeReplace}
                onCheckedChange={setArchiveBeforeReplace}
              />
            </div>
          </div>

          {/* Warning */}
          <Card className="bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800">
            <CardContent className="p-3 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-amber-800 dark:text-amber-300">
                {t('catalog.importWarning', 'Backend Import Worker в разработке. Задача будет создана, но обработка произойдёт после интеграции с /api/import/run')}
              </p>
            </CardContent>
          </Card>

          {/* Info */}
          <Card className="bg-muted/30">
            <CardContent className="p-3 flex items-start gap-2">
              <Info className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <div className="text-xs text-muted-foreground">
                <p className="font-medium mb-1">{t('catalog.xlsxNote', 'Примечание по XLSX')}:</p>
                <p>{t('catalog.xlsxNoteDesc', 'XLSX будет конвертирован backend-ом в CSV/JSONL перед загрузкой в BigQuery.')}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => createJobMutation.mutate()}
            disabled={!file || createJobMutation.isPending}
          >
            {createJobMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Upload className="h-4 w-4 mr-2" />
            )}
            {t('catalog.startImport', 'Начать импорт')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
