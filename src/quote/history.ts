import { tIn, type Key, type Lang } from '../i18n';
import type { MeshStats } from '../stl/types';
import { BATCH_MAX, computeBatch, makePart, type BatchPart } from './batch';
import type { Quote } from './model';
import { getPrinter } from './printers';
import { normalizeSettings, type QuoteSettings } from './settings';

/** Presupuestos que se guardan como máximo: protege el espacio de `localStorage` (≈ 1,1 kB por pieza: ≈ 27 kB un lote de 50; el máximo real depende del espacio libre). */
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

/** Una pieza guardada, con los ajustes y el resultado del momento. Nunca lleva el archivo 3D ni su malla. */
export interface HistoryPart {
  readonly fileName: string;
  readonly volumeMm3: number;
  readonly size: { readonly x: number; readonly y: number; readonly z: number };
  readonly triangles: number;
  /** Área de superficie en mm²: con ella y el volumen `computeQuote` recalcula la línea al reabrir un lote. Las entradas de v0.6 no la traen. */
  readonly surfaceMm2?: number;
  readonly settings: QuoteSettings;
  readonly result: HistoryResult;
}

/**
 * Un presupuesto guardado (nunca lleva los datos del negocio). En un lote, `parts` trae cada pieza y los campos de
 * primer nivel son el agregado: nombres unidos, volumen y triángulos sumados, medidas máximas por eje, los ajustes de
 * la primera pieza y el resultado de todo el lote.
 */
export interface HistoryEntry extends HistoryPart {
  readonly id: string;
  /** Fecha y hora (ISO 8601, UTC). */
  readonly savedAt: string;
  readonly client: string;
  readonly parts?: readonly HistoryPart[];
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

function toPart(fileName: string, stats: MeshStats, settings: QuoteSettings, quote: Quote): HistoryPart {
  return {
    fileName: fileName.slice(0, FILE_NAME_MAX),
    volumeMm3: stats.volume,
    size: { x: stats.bounds.size.x, y: stats.bounds.size.y, z: stats.bounds.size.z },
    triangles: stats.triangleCount,
    surfaceMm2: stats.surfaceArea,
    settings,
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

/** La línea de un lote tal como se guarda (lote persistido y entrada del historial). */
export const partToHistory = (part: BatchPart): HistoryPart => toPart(part.fileName, part.stats, part.settings, part.quote);

/**
 * Líneas de un lote a partir de lo guardado, o `null` si alguna pieza no trae el área (entradas de v0.6).
 * Cada línea se recalcula con `computeQuote` (vía `makePart`): no se copia ningún importe. Lo que no se guarda
 * (esquina de la caja, aristas abiertas, volumen con signo) toma valores neutros.
 */
export function batchFromParts(list: readonly HistoryPart[]): BatchPart[] | null {
  const parts: BatchPart[] = [];
  for (const saved of list) {
    if (saved.surfaceMm2 === undefined) return null;
    const { x, y, z } = saved.size;
    const zero = { x: 0, y: 0, z: 0 };
    const stats = {
      triangleCount: saved.triangles,
      volume: saved.volumeMm3,
      signedVolume: saved.volumeMm3,
      surfaceArea: saved.surfaceMm2,
      bounds: { min: zero, max: { x, y, z }, size: { x, y, z } },
      openEdges: 0,
    };
    parts.push(makePart(saved.fileName, stats, saved.settings));
  }
  return parts;
}

export function createEntry(input: NewEntryInput): HistoryEntry {
  return {
    id: input.id ?? newId(),
    savedAt: (input.now ?? new Date()).toISOString(),
    client: cleanClient(input.client),
    ...toPart(input.fileName, input.stats, input.settings, input.quote),
  };
}

export interface NewBatchEntryInput {
  readonly client: string;
  readonly parts: readonly BatchPart[];
  readonly now?: Date;
  readonly id?: string;
}

/** Entrada de un lote: cada pieza con sus ajustes y su resultado, y el agregado en el primer nivel (ver `HistoryEntry`). */
export function createBatchEntry(input: NewBatchEntryInput): HistoryEntry {
  const first = input.parts[0];
  if (!first) throw new Error('Un lote vacío no se guarda');
  const totals = computeBatch(input.parts);
  const max = (axis: 'x' | 'y' | 'z'): number => Math.max(...input.parts.map((part) => part.stats.bounds.size[axis]));
  return {
    id: input.id ?? newId(),
    savedAt: (input.now ?? new Date()).toISOString(),
    client: cleanClient(input.client),
    fileName: input.parts.map((part) => part.fileName).join(', ').slice(0, FILE_NAME_MAX),
    volumeMm3: input.parts.reduce((acc, part) => acc + part.stats.volume, 0),
    size: { x: max('x'), y: max('y'), z: max('z') },
    triangles: input.parts.reduce((acc, part) => acc + part.stats.triangleCount, 0),
    settings: first.settings,
    result: {
      weightGrams: totals.weightGrams,
      hours: totals.hours,
      materialCost: totals.materialCost,
      energyCost: totals.energyCost,
      marginAmount: totals.marginAmount,
      subtotal: totals.subtotal,
      total: totals.total,
    },
    parts: input.parts.map((part) => toPart(part.fileName, part.stats, part.settings, part.quote)),
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

/** Topes de lo que se acepta al leer (mm³, mm y triángulos): muy por encima de una pieza real, pero sin cifras que den «NaN» al calcular. */
const VOLUME_MAX = 1e11;
const AREA_MAX = 1e12;
const SIZE_MAX = 1e6;
const TRIANGLES_MAX = 1e9;
const inRange = (value: unknown, max: number): value is number => isFiniteNumber(value) && value >= 0 && value <= max;

const RESULT_FIELDS = ['weightGrams', 'hours', 'materialCost', 'energyCost', 'marginAmount', 'subtotal', 'total'] as const;

/** Una pieza válida o `null`. Lo que viene de `localStorage` se valida campo a campo. */
function normalizePart(raw: unknown): HistoryPart | null {
  if (!isObject(raw) || !isObject(raw['result']) || !isObject(raw['size'])) return null;
  const { fileName, volumeMm3, triangles } = raw;
  if (typeof fileName !== 'string') return null;
  if (!inRange(volumeMm3, VOLUME_MAX) || !inRange(triangles, TRIANGLES_MAX)) return null;

  const { x, y, z } = raw['size'];
  const result = raw['result'];
  if (!inRange(x, SIZE_MAX) || !inRange(y, SIZE_MAX) || !inRange(z, SIZE_MAX)) return null;
  if (!RESULT_FIELDS.every((key) => isFiniteNumber(result[key]))) return null;
  const surface = raw['surfaceMm2'];
  if (surface !== undefined && !inRange(surface, AREA_MAX)) return null;

  return {
    fileName: fileName.slice(0, FILE_NAME_MAX),
    volumeMm3,
    size: { x, y, z },
    triangles,
    ...(surface === undefined ? {} : { surfaceMm2: surface }),
    settings: normalizeSettings(raw['settings']),
    result: Object.fromEntries(RESULT_FIELDS.map((key) => [key, result[key]])) as unknown as HistoryResult,
  };
}

/** Una entrada válida o `null`. Un lote con una sola pieza rota (o vacío, o enorme) se descarta entero. */
function normalizeEntry(raw: unknown): HistoryEntry | null {
  const part = normalizePart(raw);
  if (!part || !isObject(raw)) return null;
  const { id, savedAt, client } = raw;
  if (typeof id !== 'string' || id === '' || id.length > 100) return null;
  if (typeof savedAt !== 'string' || Number.isNaN(Date.parse(savedAt))) return null;
  if (typeof client !== 'string') return null;
  const base = { id, savedAt, client: cleanClient(client), ...part };
  if (raw['parts'] === undefined) return base;

  const parts = normalizeParts(raw['parts']);
  return parts ? { ...base, parts } : null;
}

/** Las piezas de un lote (1 a `BATCH_MAX`), o `null` si falta alguna o hay una rota. */
function normalizeParts(list: unknown): HistoryPart[] | null {
  if (!Array.isArray(list) || list.length === 0 || list.length > BATCH_MAX) return null;
  const parts = list.map(normalizePart);
  return parts.every((item) => item !== null) ? parts : null;
}

/** El lote persistido: como el historial, pero cada pieza debe traer el área (es lo que permite recalcularla). */
export function normalizeBatchParts(list: unknown): HistoryPart[] | null {
  const parts = normalizeParts(list);
  return parts?.every((part) => part.surfaceMm2 !== undefined) ? parts : null;
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

  // Un lote da una fila por pieza (misma fecha y cliente): la columna «Total» de la hoja suma lo presupuestado.
  const rows = entries.flatMap((entry) =>
    (entry.parts ?? [entry]).map((piece) => {
      const { settings, result, size } = piece;
      return [
        localDate(entry.savedAt),
        text(entry.client),
        text(piece.fileName),
        decimal(piece.volumeMm3 / 1000, 2),
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
    }),
  );
  const header = COLUMNS.map((key) => text(tIn(lang, key))).join(separator);
  return `\uFEFF${[header, ...rows].join('\r\n')}\r\n`;
}
