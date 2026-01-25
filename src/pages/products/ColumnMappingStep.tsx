import { useTranslation } from 'react-i18next';
import { ArrowRight, Check, AlertCircle, Lightbulb, AlertTriangle } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// Required and optional target fields for product catalog import
export const REQUIRED_FIELDS = ['id', 'price_rub_m2'] as const;

// Standard optional fields that map directly to BQ/catalog
export const OPTIONAL_FIELDS = [
  'title',       // Name column
  'unit',        // Measure column (м², шт, м, упак)
  'notes',       // CategoryTree or CategoryName
  'cur',         // Currency column
] as const;

// Extended fields for roofing (second phase, not guaranteed in all imports)
export const EXTENDED_FIELDS = [
  'profile',
  'thickness_mm',
  'coating',
  'width_work_mm',
  'width_full_mm',
  'weight_kg_m2',
] as const;

export type TargetField = typeof REQUIRED_FIELDS[number] | typeof OPTIONAL_FIELDS[number] | typeof EXTENDED_FIELDS[number];

export interface ColumnMapping {
  [targetField: string]: string; // targetField -> sourceColumn
}

interface ColumnMappingStepProps {
  detectedColumns: string[];
  missingRequired: string[];
  suggestions: Record<string, string[]>;
  mapping: ColumnMapping;
  onMappingChange: (mapping: ColumnMapping) => void;
}

const FIELD_LABELS: Record<string, { ru: string; en: string; description: string }> = {
  id: { ru: 'ID / SKU', en: 'ID / SKU', description: 'Уникальный идентификатор товара' },
  price_rub_m2: { ru: 'Цена', en: 'Price', description: 'Цена товара (Price)' },
  title: { ru: 'Название', en: 'Title', description: 'Название товара (Name)' },
  unit: { ru: 'Единица измерения', en: 'Unit', description: 'м², шт, м, упак (Measure)' },
  notes: { ru: 'Категория/Заметки', en: 'Category/Notes', description: 'CategoryTree или CategoryName' },
  cur: { ru: 'Валюта', en: 'Currency', description: 'RUB, USD и т.д.' },
  profile: { ru: 'Профиль', en: 'Profile', description: 'Тип профиля (С8, С21, и т.д.)' },
  thickness_mm: { ru: 'Толщина (мм)', en: 'Thickness (mm)', description: 'Толщина металла в мм' },
  coating: { ru: 'Покрытие', en: 'Coating', description: 'Тип покрытия' },
  width_work_mm: { ru: 'Рабочая ширина (мм)', en: 'Work Width (mm)', description: 'Рабочая ширина листа' },
  width_full_mm: { ru: 'Полная ширина (мм)', en: 'Full Width (mm)', description: 'Полная ширина листа' },
  weight_kg_m2: { ru: 'Вес (кг/м²)', en: 'Weight (kg/m²)', description: 'Вес на квадратный метр' },
};

const SKIP_VALUE = '__skip__';
const NOT_SELECTED_VALUE = '__not_selected__';

export function ColumnMappingStep({
  detectedColumns,
  missingRequired,
  suggestions,
  mapping,
  onMappingChange,
}: ColumnMappingStepProps) {
  const { t, i18n } = useTranslation();
  const isRu = i18n.language === 'ru';

  const handleFieldChange = (targetField: string, sourceColumn: string) => {
    const newMapping = { ...mapping };
    
    if (sourceColumn === SKIP_VALUE || sourceColumn === NOT_SELECTED_VALUE) {
      delete newMapping[targetField];
    } else {
      newMapping[targetField] = sourceColumn;
    }
    
    onMappingChange(newMapping);
  };

  const getFieldLabel = (field: string) => {
    const labels = FIELD_LABELS[field];
    return labels ? (isRu ? labels.ru : labels.en) : field;
  };

  const getFieldDescription = (field: string) => {
    return FIELD_LABELS[field]?.description || '';
  };

  const getSuggestions = (field: string): string[] => {
    return suggestions[field]?.slice(0, 5) || [];
  };

  const isFieldMapped = (field: string) => {
    return !!mapping[field];
  };

  const isRequiredField = (field: string) => {
    return REQUIRED_FIELDS.includes(field as typeof REQUIRED_FIELDS[number]);
  };

  const allRequiredMapped = REQUIRED_FIELDS.every((f) => isFieldMapped(f));
  const hasNoColumns = detectedColumns.length === 0;

  return (
    <div className="space-y-4">
      {/* No columns detected warning */}
      {hasNoColumns ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {t('import.noColumnsDetected', 'Не удалось распознать заголовки. Убедитесь, что первая строка файла содержит названия колонок.')}
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {/* Header with instructions */}
          <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <Lightbulb className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-blue-800 dark:text-blue-300">
                  <p className="font-medium mb-1">
                    {t('import.mappingRequired', 'Требуется сопоставление колонок')}
                  </p>
                  <p className="text-xs opacity-80">
                    {t('import.mappingDescription', 'Система не смогла автоматически определить все обязательные колонки. Укажите соответствие между колонками вашего файла и полями каталога.')}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Detected columns preview */}
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm font-medium">
                {t('import.foundColumns', 'Мы нашли {{count}} колонок', { count: detectedColumns.length })}
              </CardTitle>
              <CardDescription className="text-xs">
                {t('import.selectMappings', 'Выберите соответствия для полей каталога')}
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              <div className="flex flex-wrap gap-1.5">
                {detectedColumns.map((col) => (
                  <Badge 
                    key={col} 
                    variant="secondary" 
                    className="text-xs font-mono"
                  >
                    {col}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Required fields */}
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-destructive" />
                {t('import.requiredFields', 'Обязательные поля')}
              </CardTitle>
              <CardDescription className="text-xs">
                {t('import.requiredFieldsDesc', 'Эти поля обязательны для импорта')}
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0 space-y-3">
              {REQUIRED_FIELDS.map((field) => (
                <FieldMappingRow
                  key={field}
                  field={field}
                  label={getFieldLabel(field)}
                  description={getFieldDescription(field)}
                  detectedColumns={detectedColumns}
                  suggestions={getSuggestions(field)}
                  selectedColumn={mapping[field] || ''}
                  onChange={(col) => handleFieldChange(field, col)}
                  isRequired
                  isMapped={isFieldMapped(field)}
                  isMissing={!isFieldMapped(field)}
                />
              ))}
            </CardContent>
          </Card>

          {/* Optional fields - standard */}
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm font-medium">
                {t('import.optionalFields', 'Дополнительные поля')}
              </CardTitle>
              <CardDescription className="text-xs">
                {t('import.optionalFieldsDesc', 'Эти поля можно пропустить')}
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0 space-y-3">
              {OPTIONAL_FIELDS.map((field) => (
                <FieldMappingRow
                  key={field}
                  field={field}
                  label={getFieldLabel(field)}
                  description={getFieldDescription(field)}
                  detectedColumns={detectedColumns}
                  suggestions={getSuggestions(field)}
                  selectedColumn={mapping[field] || ''}
                  onChange={(col) => handleFieldChange(field, col)}
                  isRequired={false}
                  isMapped={isFieldMapped(field)}
                  isMissing={false}
                />
              ))}
            </CardContent>
          </Card>

          {/* Validation status */}
          {!allRequiredMapped && (
            <Alert variant="destructive" className="bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-800 dark:text-amber-300">
                {t('import.fillRequiredFields', 'Заполните все обязательные поля для продолжения')}
              </AlertDescription>
            </Alert>
          )}
        </>
      )}
    </div>
  );
}

interface FieldMappingRowProps {
  field: string;
  label: string;
  description: string;
  detectedColumns: string[];
  suggestions: string[];
  selectedColumn: string;
  onChange: (column: string) => void;
  isRequired: boolean;
  isMapped: boolean;
  isMissing: boolean;
}

function FieldMappingRow({
  field,
  label,
  description,
  detectedColumns,
  suggestions,
  selectedColumn,
  onChange,
  isRequired,
  isMapped,
  isMissing,
}: FieldMappingRowProps) {
  const { t } = useTranslation();
  const hasSuggestions = suggestions.length > 0;

  // For required fields, use NOT_SELECTED_VALUE; for optional, use SKIP_VALUE
  const emptyValue = isRequired ? NOT_SELECTED_VALUE : SKIP_VALUE;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3">
        {/* Target field */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Label className="text-sm font-medium">
              {label}
              {isRequired && <span className="text-destructive ml-0.5">*</span>}
            </Label>
            {isMapped && (
              <Check className="h-3.5 w-3.5 text-green-600" />
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate">{description}</p>
        </div>

        {/* Arrow */}
        <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />

        {/* Source column select */}
        <div className="w-48 flex-shrink-0">
          <Select
            value={selectedColumn || emptyValue}
            onValueChange={onChange}
          >
            <SelectTrigger 
              className={`h-9 text-sm ${isMissing && isRequired ? 'border-destructive ring-1 ring-destructive' : ''}`}
            >
              <SelectValue placeholder={t('import.selectColumn', 'Выберите колонку')} />
            </SelectTrigger>
            <SelectContent>
              {/* Not selected option for required fields */}
              {isRequired && (
                <SelectItem value={NOT_SELECTED_VALUE} className="text-muted-foreground">
                  {t('import.notSelected', '— не выбрано —')}
                </SelectItem>
              )}
              
              {/* Skip option for optional fields */}
              {!isRequired && (
                <SelectItem value={SKIP_VALUE} className="text-muted-foreground">
                  {t('import.skip', '— пропустить —')}
                </SelectItem>
              )}
              
              {/* Suggested columns first */}
              {hasSuggestions && (
                <>
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground border-b">
                    {t('import.suggested', 'Рекомендуемые')}
                  </div>
                  {suggestions.map((col) => (
                    <SelectItem key={`sug-${col}`} value={col} className="font-medium">
                      ⭐ {col}
                    </SelectItem>
                  ))}
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground border-t border-b">
                    {t('import.allColumns', 'Все колонки')}
                  </div>
                </>
              )}

              {/* All columns */}
              {detectedColumns.map((col) => (
                <SelectItem key={col} value={col}>
                  {col}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      
      {/* Required field error hint */}
      {isMissing && isRequired && (
        <p className="text-xs text-destructive pl-0">
          {t('import.requiredFieldMissing', 'Обязательное поле')}
        </p>
      )}
    </div>
  );
}

export default ColumnMappingStep;
