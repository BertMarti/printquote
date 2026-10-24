import { isMaterialId, type MaterialId } from './materials';
import { CUSTOM_PRINTER } from './printers';
import { clampToLimit, LIMITS, type QuoteSettings } from './settings';

/**
 * Perfiles propios que la persona guarda con nombre: su impresora (caudal, potencia, cama, ancho de línea,
 * perímetros y sobrecarga) y sus materiales (tipo y precio por kilo). Se guardan en `localStorage` con el
 * prefijo `printquote:` y, como el origen `bertmarti.github.io` lo comparten varias webs, todo lo leído se
 * valida campo a campo (`normalizePrinterPresets`, `normalizeMaterialPresets`) antes de usarlo.
 */

/** Cuántos perfiles de cada tipo se guardan como máximo. */
export const PRESETS_MAX = 20;
/** Longitud máxima del nombre de un perfil. */
export const PRESET_NAME_MAX = 40;

export interface PrinterPreset {
  readonly name: string;
  readonly flowRate: number;
  readonly powerWatts: number;
  readonly bedX: number;
  readonly bedY: number;
  readonly bedZ: number;
  readonly lineWidth: number;
  readonly perimeters: number;
  readonly overheadMinutes: number;
}

export interface MaterialPreset {
  readonly name: string;
  readonly material: MaterialId;
  readonly pricePerKg: number;
}

/** Campos numéricos de una impresora propia (todos tienen su rango en `LIMITS`). */
export const PRINTER_PRESET_KEYS = [
  'flowRate',
  'powerWatts',
  'bedX',
  'bedY',
  'bedZ',
  'lineWidth',
  'perimeters',
  'overheadMinutes',
] as const satisfies readonly (keyof PrinterPreset & keyof QuoteSettings)[];

/** Nombre limpio: sin caracteres de control, espacios contiguos unidos, recortado y con longitud máxima. Vacío si no vale. */
export function cleanPresetName(value: unknown): string {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, PRESET_NAME_MAX);
}

function finiteInRange(value: unknown, key: keyof typeof LIMITS): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? clampToLimit(value, LIMITS[key]) : null;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** Una impresora propia válida o `null` (si falta el nombre o algún número no es válido, se descarta entera). */
export function normalizePrinterPreset(input: unknown): PrinterPreset | null {
  const source = asRecord(input);
  if (!source) return null;
  const name = cleanPresetName(source.name);
  if (!name) return null;
  const values: Partial<Record<(typeof PRINTER_PRESET_KEYS)[number], number>> = {};
  for (const key of PRINTER_PRESET_KEYS) {
    const value = finiteInRange(source[key], key);
    if (value === null) return null;
    values[key] = value;
  }
  return { name, ...(values as Record<(typeof PRINTER_PRESET_KEYS)[number], number>) };
}

/** Un material propio válido o `null`. */
export function normalizeMaterialPreset(input: unknown): MaterialPreset | null {
  const source = asRecord(input);
  if (!source) return null;
  const name = cleanPresetName(source.name);
  const pricePerKg = finiteInRange(source.pricePerKg, 'pricePerKg');
  if (!name || !isMaterialId(source.material) || pricePerKg === null) return null;
  return { name, material: source.material, pricePerKg };
}

/** Lista válida: descarta lo roto y los nombres repetidos (gana el primero, sin distinguir mayúsculas) y corta en `PRESETS_MAX`. */
function normalizeList<T extends { readonly name: string }>(raw: unknown, normalize: (item: unknown) => T | null): T[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const list: T[] = [];
  for (const item of raw) {
    const preset = normalize(item);
    if (!preset) continue;
    const key = preset.name.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(preset);
    if (list.length === PRESETS_MAX) break;
  }
  return list;
}

export const normalizePrinterPresets = (raw: unknown): PrinterPreset[] => normalizeList(raw, normalizePrinterPreset);
export const normalizeMaterialPresets = (raw: unknown): MaterialPreset[] => normalizeList(raw, normalizeMaterialPreset);

/** Impresora propia a partir de los ajustes actuales. */
export function printerPresetFrom(settings: QuoteSettings, name: string): PrinterPreset | null {
  return normalizePrinterPreset({ ...pickPrinter(settings), name });
}

function pickPrinter(settings: QuoteSettings): Omit<PrinterPreset, 'name'> {
  return {
    flowRate: settings.flowRate,
    powerWatts: settings.powerWatts,
    bedX: settings.bedX,
    bedY: settings.bedY,
    bedZ: settings.bedZ,
    lineWidth: settings.lineWidth,
    perimeters: settings.perimeters,
    overheadMinutes: settings.overheadMinutes,
  };
}

/** Material propio a partir de los ajustes actuales (el material elegido y su precio). */
export function materialPresetFrom(settings: QuoteSettings, name: string): MaterialPreset | null {
  return normalizeMaterialPreset({ name, material: settings.material, pricePerKg: settings.pricePerKg[settings.material] });
}

/** Ajustes con la impresora propia aplicada. Pasan a «Personalizada» porque los valores ya no son los de un perfil precargado. */
export function applyPrinterPreset(settings: QuoteSettings, preset: PrinterPreset): QuoteSettings {
  const values = Object.fromEntries(PRINTER_PRESET_KEYS.map((key) => [key, preset[key]])) as Omit<PrinterPreset, 'name'>;
  return { ...settings, ...values, printerId: CUSTOM_PRINTER };
}

/** Ajustes con el material propio aplicado: cambia el material elegido y su precio por kilo. */
export function applyMaterialPreset(settings: QuoteSettings, preset: MaterialPreset): QuoteSettings {
  return {
    ...settings,
    material: preset.material,
    pricePerKg: { ...settings.pricePerKg, [preset.material]: preset.pricePerKg },
  };
}

/**
 * Añade o reemplaza (mismo nombre, sin distinguir mayúsculas) un perfil. El nuevo va primero.
 * Devuelve `null` si la lista está llena y el nombre es nuevo.
 */
export function upsertPreset<T extends { readonly name: string }>(list: readonly T[], preset: T): T[] | null {
  const key = preset.name.toLocaleLowerCase();
  const rest = list.filter((item) => item.name.toLocaleLowerCase() !== key);
  if (rest.length === list.length && list.length >= PRESETS_MAX) return null;
  return [preset, ...rest];
}

/** Quita el perfil con ese nombre. */
export function removePreset<T extends { readonly name: string }>(list: readonly T[], name: string): T[] {
  const key = name.toLocaleLowerCase();
  return list.filter((item) => item.name.toLocaleLowerCase() !== key);
}
