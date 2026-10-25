import { normalizeBusiness, type BusinessProfile } from './business';
import { normalizeMaterialPresets, normalizePrinterPresets, type MaterialPreset, type PrinterPreset } from './profiles';
import { normalizeSettings, type QuoteSettings } from './settings';

/**
 * Copia de seguridad de los ajustes en un archivo JSON: ajustes, perfiles propios (impresoras y materiales) y,
 * si se pide, los datos del negocio. No lleva presupuestos guardados, lote ni archivos 3D.
 *
 * Al importar, el archivo es **dato no fiable** (puede venir de cualquiera): se limita el tamaño antes de leerlo,
 * se exige la marca de printquote y la versión, y cada parte pasa por los mismos normalizadores que lo leído de
 * `localStorage` (rangos, longitudes, logotipo PNG/JPEG en base64 y nada de claves desconocidas).
 */

export const BACKUP_APP = 'printquote';
export const BACKUP_VERSION = 1;
/** Tamaño máximo del archivo que se acepta (1 MiB: cabe un logotipo de 600 000 caracteres y todo lo demás). */
export const BACKUP_MAX_BYTES = 1024 * 1024;

export interface BackupData {
  readonly settings: QuoteSettings | null;
  readonly printers: PrinterPreset[] | null;
  readonly materials: MaterialPreset[] | null;
  readonly business: BusinessProfile | null;
}

export type BackupError = 'backup.err.tooBig' | 'backup.err.json' | 'backup.err.notOurs' | 'backup.err.version' | 'backup.err.empty';

export type BackupResult =
  | { readonly ok: true; readonly data: BackupData; /** Perfiles descartados por no ser válidos. */ readonly dropped: number }
  | { readonly ok: false; readonly error: BackupError };

export interface BackupInput {
  readonly settings: QuoteSettings;
  readonly printers: readonly PrinterPreset[];
  readonly materials: readonly MaterialPreset[];
  /** `null` para no incluir los datos del negocio. */
  readonly business: BusinessProfile | null;
  readonly date?: Date;
}

/** Texto JSON del archivo de ajustes (con sangría, para que se pueda leer y retocar a mano). */
export function buildBackup(input: BackupInput): string {
  const data: Record<string, unknown> = {
    app: BACKUP_APP,
    v: BACKUP_VERSION,
    exportedAt: (input.date ?? new Date()).toISOString(),
    settings: input.settings,
    printers: input.printers,
    materials: input.materials,
  };
  if (input.business) data.business = input.business;
  return JSON.stringify(data, null, 2);
}

/** Nombre del archivo: `printquote-ajustes-AAAA-MM-DD.json`. */
export function backupFileName(date: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `printquote-ajustes-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** Lee y valida un archivo de ajustes. Nunca lanza: devuelve el error con su clave de texto. */
export function parseBackup(text: string): BackupResult {
  // Bytes en UTF-8 (un carácter puede ocupar hasta 3 por unidad UTF-16): solo se codifica si hace falta.
  if (text.length > BACKUP_MAX_BYTES) return { ok: false, error: 'backup.err.tooBig' };
  if (text.length * 3 > BACKUP_MAX_BYTES && new TextEncoder().encode(text).byteLength > BACKUP_MAX_BYTES) {
    return { ok: false, error: 'backup.err.tooBig' };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return { ok: false, error: 'backup.err.json' };
  }
  const source = asRecord(raw);
  if (!source || source.app !== BACKUP_APP) return { ok: false, error: 'backup.err.notOurs' };
  if (source.v !== BACKUP_VERSION) return { ok: false, error: 'backup.err.version' };

  const settings = asRecord(source.settings) ? normalizeSettings(source.settings) : null;
  const printers = Array.isArray(source.printers) ? normalizePrinterPresets(source.printers) : null;
  const materials = Array.isArray(source.materials) ? normalizeMaterialPresets(source.materials) : null;
  const business = asRecord(source.business) ? normalizeBusiness(source.business) : null;
  if (!settings && !printers && !materials && !business) return { ok: false, error: 'backup.err.empty' };

  const length = (value: unknown): number => (Array.isArray(value) ? value.length : 0);
  const dropped = length(source.printers) - (printers?.length ?? 0) + length(source.materials) - (materials?.length ?? 0);
  return { ok: true, data: { settings, printers, materials, business }, dropped: Math.max(0, dropped) };
}
