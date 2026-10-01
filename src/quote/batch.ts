import type { MeshStats } from '../stl/types';
import { computeQuote, roundCents, type Quote } from './model';
import type { QuoteSettings } from './settings';

/** Piezas que admite un lote: protege el PDF y el almacenamiento del historial. */
export const BATCH_MAX = 50;

/** Una línea del lote: la pieza con los ajustes y el presupuesto del momento de añadirla (instantánea). */
export interface BatchPart {
  readonly id: string;
  readonly fileName: string;
  readonly stats: MeshStats;
  readonly settings: QuoteSettings;
  readonly quote: Quote;
}

/** Totales del lote. Los importes son la suma de las líneas, que ya van redondeadas a céntimos. */
export interface BatchTotals {
  readonly parts: number;
  /** Copias de todas las piezas. */
  readonly copies: number;
  readonly weightGrams: number;
  readonly hours: number;
  readonly energyKwh: number;
  readonly materialCost: number;
  readonly energyCost: number;
  readonly subtotal: number;
  readonly marginAmount: number;
  /** Total sin IVA (la base imponible). */
  readonly total: number;
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** La línea usa `computeQuote`, el mismo modelo que una pieza suelta: el lote no tiene fórmula propia. */
export function makePart(fileName: string, stats: MeshStats, settings: QuoteSettings, id: string = newId()): BatchPart {
  return { id, fileName, stats, settings, quote: computeQuote(stats, settings) };
}

/** La misma línea con otras copias: se recalcula con `computeQuote` y los ajustes con que se añadió. */
export function withCopies(part: BatchPart, copies: number): BatchPart {
  return makePart(part.fileName, part.stats, { ...part.settings, copies }, part.id);
}

/** Suma las líneas como una factura: cada una ya está en céntimos, así que lo que se ve suma el total. */
export function computeBatch(parts: readonly BatchPart[]): BatchTotals {
  const sum = (pick: (quote: Quote) => number): number => parts.reduce((acc, part) => acc + pick(part.quote), 0);
  const money = (pick: (quote: Quote) => number): number => roundCents(sum(pick));
  return {
    parts: parts.length,
    copies: sum((q) => q.copies),
    weightGrams: sum((q) => q.totalWeightGrams),
    hours: sum((q) => q.totalHours),
    energyKwh: sum((q) => q.energyKwh),
    materialCost: money((q) => q.materialCost),
    energyCost: money((q) => q.energyCost),
    subtotal: money((q) => q.subtotal),
    marginAmount: money((q) => q.marginAmount),
    total: money((q) => q.total),
  };
}
