import { roundCents } from './model';

/** IVA general en España; es el valor por defecto y se puede cambiar en «Datos del negocio». */
export const DEFAULT_VAT_PERCENT = 21;

export interface TaxedTotal {
  /** Base imponible: el total del presupuesto sin impuestos. */
  readonly base: number;
  readonly vatPercent: number;
  /** Cuota de IVA, redondeada a céntimos. */
  readonly vat: number;
  /** Base + IVA. */
  readonly total: number;
}

/**
 * Aplica el IVA a la base imponible. Como en una factura, la cuota se redondea a
 * céntimos y el total es la suma de las dos cifras ya redondeadas: lo que se ve suma.
 */
export function computeTax(base: number, vatPercent: number): TaxedTotal {
  const rate = Number.isFinite(vatPercent) ? Math.max(0, vatPercent) : 0;
  const roundedBase = roundCents(base);
  const vat = roundCents(roundedBase * (rate / 100));
  return { base: roundedBase, vatPercent: rate, vat, total: roundCents(roundedBase + vat) };
}
