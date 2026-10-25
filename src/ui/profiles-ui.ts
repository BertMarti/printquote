import { t } from '../i18n';
import {
  applyMaterialPreset,
  applyPrinterPreset,
  cleanPresetName,
  materialPresetFrom,
  printerPresetFrom,
  removePreset,
  upsertPreset,
  type MaterialPreset,
  type PrinterPreset,
} from '../quote/profiles';
import type { QuoteSettings } from '../quote/settings';
import type { SavedProfiles } from './storage';

interface Host {
  settings(): QuoteSettings;
  apply(next: QuoteSettings): void;
  save(profiles: SavedProfiles): boolean;
  announce(message: string): void;
}

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export function setupProfiles(host: Host, initial: SavedProfiles): { render(): void } {
  let profiles = initial;
  const renderList = <T extends PrinterPreset | MaterialPreset>(kind: 'printer' | 'material', list: readonly T[]): void => {
    const root = byId<HTMLUListElement>(kind === 'printer' ? 'printer-presets' : 'material-presets');
    root.replaceChildren();
    for (const preset of list) {
      const item = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = preset.name;
      const apply = document.createElement('button');
      apply.type = 'button';
      apply.className = 'link-button';
      apply.textContent = t('profiles.apply');
      apply.setAttribute('aria-label', t('profiles.apply.label', { name: preset.name }));
      apply.addEventListener('click', () => {
        host.apply(kind === 'printer' ? applyPrinterPreset(host.settings(), preset as PrinterPreset) : applyMaterialPreset(host.settings(), preset as MaterialPreset));
        host.announce(t('profiles.applied', { name: preset.name }));
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'link-button';
      remove.textContent = t('profiles.remove');
      remove.setAttribute('aria-label', t('profiles.remove.label', { name: preset.name }));
      remove.addEventListener('click', () => {
        profiles = kind === 'printer' ? { ...profiles, printers: removePreset(profiles.printers, preset.name) } : { ...profiles, materials: removePreset(profiles.materials, preset.name) };
        if (!host.save(profiles)) byId(kind === 'printer' ? 'printer-preset-status' : 'material-preset-status').textContent = t('profiles.save.failed');
        render();
      });
      item.append(name, apply, remove);
      root.append(item);
    }
  };
  const save = (kind: 'printer' | 'material'): void => {
    const input = byId<HTMLInputElement>(kind === 'printer' ? 'printer-preset-name' : 'material-preset-name');
    const status = byId(kind === 'printer' ? 'printer-preset-status' : 'material-preset-status');
    const name = cleanPresetName(input.value);
    const preset = kind === 'printer' ? printerPresetFrom(host.settings(), name) : materialPresetFrom(host.settings(), name);
    if (!preset) { status.textContent = t('profiles.name.required'); return; }
    const next = kind === 'printer'
      ? upsertPreset(profiles.printers, preset as PrinterPreset)
      : upsertPreset(profiles.materials, preset as MaterialPreset);
    if (!next) { status.textContent = t('profiles.full'); return; }
    profiles = kind === 'printer' ? { ...profiles, printers: next as PrinterPreset[] } : { ...profiles, materials: next as MaterialPreset[] };
    if (!host.save(profiles)) { status.textContent = t('profiles.save.failed'); return; }
    input.value = '';
    status.textContent = '';
    render();
  };
  byId('printer-preset-save').addEventListener('click', () => save('printer'));
  byId('material-preset-save').addEventListener('click', () => save('material'));
  const render = (): void => { renderList('printer', profiles.printers); renderList('material', profiles.materials); };
  render();
  return { render };
}
