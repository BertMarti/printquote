import { tIn, type Key, type Lang } from '../i18n';
import type { MeshStats } from '../stl/types';
import type { Quote } from './model';
import { getPrinter } from './printers';
import { normalizeSettings, type QuoteSettings } from './settings';

/** Presupuestos que se guardan como máximo: protege el espacio de `localStorage` (≈ 0,6 kB cada uno). */
export const HISTORY_MAX = 100;
export const CLIENT_MAX = 80;
const FILE_NAME_MAX = 200;

/** Resultado tal como salió al guardar: no se recalcula al abrirlo (la fórmula puede cambiar con las versiones). */
export interface HistoryResult {
  readonly weightGrams: number;
  readonly hours: number;
  readonly materialCost: number;
  readonly energyCost: number;
  readonly marginAmount: number;
  readonly subtotal: number;
  /** Total sin IVA (la base imponible). */
  readonly total: number;
}

/** Un presupuesto guardado. Nunca lleva el archivo 3D ni su malla, ni los datos del negocio. */
export interface HistoryEntry {
  readonly id: string;
  /** Fecha y hora (ISO 8601, UTC). */
  readonly savedAt: string;
  readonly fileName: string;
  readonly client: string;
  readonly volumeMm3: number;
  readonly size: { readonly x: number; readonly y: number; readonly z: number };
  readonly triangles: number;
  readonly settings: QuoteSettings;
  readonly result: HistoryResult;
}

export interface NewEntryInput {
  readonly fileName: string;
  readonly client: string;
  readonly stats: MeshStats;
  readonly settings: QuoteSettings;
  readonly quote: Quote;
  readonly now?: Date;
  readonly id?: string;
}

/** Cliente en una sola línea y de longitud acotada. */
function cleanClient(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, CLIENT_MAX);
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createEntry(input: NewEntryInput): HistoryEntry {
  const { stats, quote } = input;
  return {
    id: input.id ?? newId(),
    savedAt: (input.now ?? new Date()).toISOString(),
    fileName: input.fileName.slice(0, FILE_NAME_MAX),
    client: cleanClient(input.client),
    volumeMm3: stats.volume,
    size: { x: stats.bounds.size.x, y: stats.bounds.size.y, z: stats.bounds.size.z },
    triangles: stats.triangleCount,
    settings: input.settings,
    result: {
      weightGrams: quote.totalWeightGrams,
      hours: quote.totalHours,
      materialCost: quote.materialCost,
      energyCost: quote.energyCost,
      marginAmount: quote.marginAmount,
      subtotal: quote.subtotal,
      total: quote.total,
    },
  };
}

/** Añade al principio; con más de `HISTORY_MAX` descarta los más antiguos y dice cuántos. */
export function addEntry(list: readonly HistoryEntry[], entry: HistoryEntry): { entries: HistoryEntry[]; dropped: number } {
  const all = [entry, ...list];
  return { entries: all.slice(0, HISTORY_MAX), dropped: Math.max(0, all.length - HISTORY_MAX) };
}

export function removeEntry(list: readonly HistoryEntry[], id: string): HistoryEntry[] {
  return list.filter((entry) => entry.id !== id);
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const RESULT_FIELDS = ['weightGrams', 'hours', 'materialCost', 'energyCost', 'marginAmount', 'subtotal', 'total'] as const;

/** Una entrada válida o `null`. Lo que viene de `localStorage` se valida campo a campo. */
function normalizeEntry(raw: unknown): HistoryEntry | null {
  if (!isObject(raw) || !isObject(raw['result']) || !isObject(raw['size'])) return null;
  const { id, savedAt, fileName, client, volumeMm3, triangles } = raw;
  if (typeof id !== 'string' || id === '' || id.length > 100) return null;
  if (typeof savedAt !== 'string' || Number.isNaN(Date.parse(savedAt))) return null;
  if (typeof fileName !== 'string' || typeof client !== 'string') return null;
  if (!isFiniteNumber(volumeMm3) || !isFiniteNumber(triangles)) return null;

  const { x, y, z } = raw['size'];
  const result = raw['result'];
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return null;
  if (!RESULT_FIELDS.every((key) => isFiniteNumber(result[key]))) return null;

  return {
    id,
    savedAt,
    fileName: fileName.slice(0, FILE_NAME_MAX),
    client: cleanClient(client),
    volumeMm3,
    size: { x, y, z },
    triangles,
    settings: normalizeSettings(raw['settings']),
    result: Object.fromEntries(RESULT_FIELDS.map((key) => [key, result[key]])) as unknown as HistoryResult,
  };
}

/** Lista válida a partir de lo leído: descarta una a una las entradas rotas y las repetidas. */
export function normalizeHistory(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const entries: HistoryEntry[] = [];
  for (const item of raw) {
    const entry = normalizeEntry(item);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    entries.push(entry);
    if (entries.length === HISTORY_MAX) break;
  }
  return entries;
}

// ── CSV ──

const COLUMNS: readonly Key[] = [
  'csv.date', 'csv.client', 'csv.part', 'csv.volume', 'csv.x', 'csv.y', 'csv.z', 'csv.material', 'csv.printer',
  'csv.infill', 'csv.perimeters', 'csv.copies', 'csv.weight', 'csv.time', 'csv.materialCost', 'csv.energyCost',
  'csv.margin', 'csv.total',
];

const pad = (n: number): string => String(n).padStart(2, '0');

/** Fecha local legible y sin ambigüedad (AAAA-MM-DD HH:MM) en cualquier hoja de cálculo. */
function localDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * CSV con una fila por presupuesto, listo para abrir en una hoja de cálculo: UTF-8 con BOM, filas con CRLF y,
 * según el idioma, separador «;» y coma decimal (español: lo que abre bien Excel) o «,» y punto (inglés).
 * Los textos que una hoja de cálculo interpretaría como fórmula (empiezan por = + - @ tabulador o retorno)
 * llevan un apóstrofo delante (inyección CSV).
 */
export function historyToCsv(entries: readonly HistoryEntry[], lang: Lang): string {
  const es = lang === 'es';
  const separator = es ? ';' : ',';
  const text = (value: string): string => {
    const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return /[;,"\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
  };
  const decimal = (value: number, digits: number): string => {
    const fixed = value.toFixed(digits);
    return es ? fixed.replace('.', ',') : fixed;
  };
  /** Sin decimales si es entero (20), con uno si no (12,5). */
  const compact = (value: number): string => {
    const rounded = Number(value.toFixed(1));
    return decimal(rounded, Number.isInteger(rounded) ? 0 : 1);
  };

  const rows = entries.map((entry) => {
    const { settings, result, size } = entry;
    return [
      localDate(entry.savedAt),
      text(entry.client),
      text(entry.fileName),
      decimal(entry.volumeMm3 / 1000, 2),
      decimal(size.x, 1),
      decimal(size.y, 1),
      decimal(size.z, 1),
      text(settings.material),
      text(getPrinter(settings.printerId)?.name ?? tIn(lang, 'printer.custom')),
      compact(settings.infillPercent),
      String(settings.perimeters),
      String(settings.copies),
      decimal(result.weightGrams, 1),
      decimal(result.hours, 2),
      decimal(result.materialCost, 2),
      decimal(result.energyCost, 2),
      decimal(result.marginAmount, 2),
      decimal(result.total, 2),
    ].join(separator);
  });
  const header = COLUMNS.map((key) => text(tIn(lang, key))).join(separator);
  return `\uFEFF${[header, ...rows].join('\r\n')}\r\n`;
}
