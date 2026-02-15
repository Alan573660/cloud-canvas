/**
 * ConfirmedSettingsEditor — panels to edit normalization settings
 * that get saved to bot_settings.settings_json.pricing via settings-merge.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Plus, Trash2 } from 'lucide-react';
import type { ConfirmedSettings } from '@/hooks/use-normalization';

interface ConfirmedSettingsEditorProps {
  onSave: (settings: ConfirmedSettings) => Promise<boolean>;
  saving: boolean;
}

// ─── Generic key-value editor row ────────────────────────────

function KVRow({ k, v, onChangeKey, onChangeValue, onRemove }: {
  k: string; v: string;
  onChangeKey: (val: string) => void;
  onChangeValue: (val: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input value={k} onChange={e => onChangeKey(e.target.value)} className="h-7 text-xs flex-1" placeholder="Токен" />
      <span className="text-muted-foreground text-xs">→</span>
      <Input value={v} onChange={e => onChangeValue(e.target.value)} className="h-7 text-xs flex-1" placeholder="Значение" />
      <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={onRemove}>
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}

// ─── Widths editor ────────────────────────────────────────────

function WidthsEditor({ value, onChange }: {
  value: Record<string, { work_mm: number; full_mm: number }>;
  onChange: (v: Record<string, { work_mm: number; full_mm: number }>) => void;
}) {
  const entries = Object.entries(value);

  const addRow = () => onChange({ ...value, '': { work_mm: 0, full_mm: 0 } });
  const removeRow = (key: string) => {
    const next = { ...value };
    delete next[key];
    onChange(next);
  };
  const updateRow = (oldKey: string, newKey: string, dims: { work_mm: number; full_mm: number }) => {
    const next = { ...value };
    if (oldKey !== newKey) delete next[oldKey];
    next[newKey] = dims;
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium">pricing.widths_selected</Label>
        <Button size="sm" variant="outline" className="h-6 text-xs" onClick={addRow}><Plus className="h-3 w-3 mr-1" />Добавить</Button>
      </div>
      {entries.length === 0 && <p className="text-xs text-muted-foreground">Нет записей</p>}
      {entries.map(([profile, dims], i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={profile}
            onChange={e => updateRow(profile, e.target.value, dims)}
            className="h-7 text-xs w-24"
            placeholder="Профиль"
          />
          <Label className="text-xs shrink-0">work:</Label>
          <Input
            type="number"
            value={dims.work_mm || ''}
            onChange={e => updateRow(profile, profile, { ...dims, work_mm: Number(e.target.value) })}
            className="h-7 text-xs w-20"
          />
          <Label className="text-xs shrink-0">full:</Label>
          <Input
            type="number"
            value={dims.full_mm || ''}
            onChange={e => updateRow(profile, profile, { ...dims, full_mm: Number(e.target.value) })}
            className="h-7 text-xs w-20"
          />
          <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => removeRow(profile)}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────

export function ConfirmedSettingsEditor({ onSave, saving }: ConfirmedSettingsEditorProps) {
  const { t } = useTranslation();

  const [widths, setWidths] = useState<Record<string, { work_mm: number; full_mm: number }>>({});
  const [profileAliases, setProfileAliases] = useState<Array<[string, string]>>([]);
  const [coatings, setCoatings] = useState<Array<[string, string]>>([]);
  const [ralAliases, setRalAliases] = useState<Array<[string, string]>>([]);
  const [decorAliases, setDecorAliases] = useState<Array<[string, string]>>([]);

  const handleSave = async () => {
    const settings: ConfirmedSettings = {};

    // Only include non-empty sections
    if (Object.keys(widths).length > 0) {
      settings.widths_selected = widths;
    }

    const pAliases = Object.fromEntries(profileAliases.filter(([k, v]) => k && v));
    if (Object.keys(pAliases).length > 0) {
      settings.profile_aliases = pAliases;
    }

    const cMap = Object.fromEntries(coatings.filter(([k, v]) => k && v));
    if (Object.keys(cMap).length > 0) {
      settings.coatings = cMap;
    }

    const rAliases = Object.fromEntries(ralAliases.filter(([k, v]) => k && v));
    const dAliases = Object.fromEntries(
      decorAliases.filter(([k, v]) => k && v).map(([k, v]) => [k, { kind: 'DECOR', label: v }])
    );
    if (Object.keys(rAliases).length > 0 || Object.keys(dAliases).length > 0) {
      settings.colors = {};
      if (Object.keys(rAliases).length > 0) settings.colors.ral_aliases = rAliases;
      if (Object.keys(dAliases).length > 0) settings.colors.decor_aliases = dAliases;
    }

    if (Object.keys(settings).length === 0) {
      return; // nothing to save
    }

    await onSave(settings);
  };

  const addPair = (setter: React.Dispatch<React.SetStateAction<Array<[string, string]>>>) => {
    setter(prev => [...prev, ['', '']]);
  };

  const updatePair = (
    setter: React.Dispatch<React.SetStateAction<Array<[string, string]>>>,
    index: number,
    pos: 0 | 1,
    val: string
  ) => {
    setter(prev => prev.map((pair, i) => {
      if (i !== index) return pair;
      const next: [string, string] = [...pair];
      next[pos] = val;
      return next;
    }));
  };

  const removePair = (
    setter: React.Dispatch<React.SetStateAction<Array<[string, string]>>>,
    index: number
  ) => {
    setter(prev => prev.filter((_, i) => i !== index));
  };

  const entryCount = Object.keys(widths).length + profileAliases.length + coatings.length + ralAliases.length + decorAliases.length;

  return (
    <div className="space-y-3">
      <Tabs defaultValue="widths" className="w-full">
        <TabsList className="h-8">
          <TabsTrigger value="widths" className="text-xs">
            Ширины {Object.keys(widths).length > 0 && <Badge variant="secondary" className="ml-1 text-[10px] h-4">{Object.keys(widths).length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="profiles" className="text-xs">
            Профили {profileAliases.length > 0 && <Badge variant="secondary" className="ml-1 text-[10px] h-4">{profileAliases.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="coatings" className="text-xs">
            Покрытия {coatings.length > 0 && <Badge variant="secondary" className="ml-1 text-[10px] h-4">{coatings.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="colors" className="text-xs">
            Цвета {(ralAliases.length + decorAliases.length) > 0 && <Badge variant="secondary" className="ml-1 text-[10px] h-4">{ralAliases.length + decorAliases.length}</Badge>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="widths" className="mt-2">
          <WidthsEditor value={widths} onChange={setWidths} />
        </TabsContent>

        <TabsContent value="profiles" className="mt-2 space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium">pricing.profile_aliases</Label>
            <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => addPair(setProfileAliases)}><Plus className="h-3 w-3 mr-1" />Добавить</Button>
          </div>
          {profileAliases.length === 0 && <p className="text-xs text-muted-foreground">Нет записей. Пример: монтеррей → MONTERREY</p>}
          {profileAliases.map(([k, v], i) => (
            <KVRow key={i} k={k} v={v}
              onChangeKey={val => updatePair(setProfileAliases, i, 0, val)}
              onChangeValue={val => updatePair(setProfileAliases, i, 1, val)}
              onRemove={() => removePair(setProfileAliases, i)}
            />
          ))}
        </TabsContent>

        <TabsContent value="coatings" className="mt-2 space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium">pricing.coatings</Label>
            <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => addPair(setCoatings)}><Plus className="h-3 w-3 mr-1" />Добавить</Button>
          </div>
          {coatings.length === 0 && <p className="text-xs text-muted-foreground">Нет записей. Пример: vikingmp → VIKING_MP</p>}
          {coatings.map(([k, v], i) => (
            <KVRow key={i} k={k} v={v}
              onChangeKey={val => updatePair(setCoatings, i, 0, val)}
              onChangeValue={val => updatePair(setCoatings, i, 1, val)}
              onRemove={() => removePair(setCoatings, i)}
            />
          ))}
        </TabsContent>

        <TabsContent value="colors" className="mt-2 space-y-3">
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs font-medium">pricing.colors.ral_aliases</Label>
              <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => addPair(setRalAliases)}><Plus className="h-3 w-3 mr-1" />RAL</Button>
            </div>
            {ralAliases.length === 0 && <p className="text-xs text-muted-foreground">Пример: ral 3005 → 3005</p>}
            {ralAliases.map(([k, v], i) => (
              <KVRow key={i} k={k} v={v}
                onChangeKey={val => updatePair(setRalAliases, i, 0, val)}
                onChangeValue={val => updatePair(setRalAliases, i, 1, val)}
                onRemove={() => removePair(setRalAliases, i)}
              />
            ))}
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs font-medium">pricing.colors.decor_aliases</Label>
              <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => addPair(setDecorAliases)}><Plus className="h-3 w-3 mr-1" />Декор</Button>
            </div>
            {decorAliases.length === 0 && <p className="text-xs text-muted-foreground">Пример: copper → COPPER</p>}
            {decorAliases.map(([k, v], i) => (
              <KVRow key={i} k={k} v={v}
                onChangeKey={val => updatePair(setDecorAliases, i, 0, val)}
                onChangeValue={val => updatePair(setDecorAliases, i, 1, val)}
                onRemove={() => removePair(setDecorAliases, i)}
              />
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <Button size="sm" onClick={handleSave} disabled={saving || entryCount === 0} className="w-full">
        {saving ? 'Сохранение...' : `Сохранить (${entryCount} записей)`}
      </Button>
    </div>
  );
}
