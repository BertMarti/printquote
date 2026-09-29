import { MATERIALS } from './materials';
import type { QuoteSettings } from './settings';

/** Datos geométricos de la pieza que necesita el presupuesto. */
export interface PartGeometry {
  /** Volumen en mm³. */
  readonly volume: number;
  /** Área de superficie en mm². */
  readonly surfaceArea: number;
}

/** Resultado por copia y total. Volúmenes en mm³, pesos en g, tiempos en h, dinero en €. */
export interface Quote {
  readonly shellVolume: number;
  readonly infillVolume: number;
  /** Volumen impreso por copia. */
  readonly printedVolume: number;
  /** Peso por copia en g. */
  readonly weightGrams: number;
  /** Tiempo estimado por copia en horas (incluye la sobrecarga fija). */
  readonly hoursPerCopy: number;
  readonly copies: number;
  /** Totales para todas las copias. */
  readonly totalWeightGrams: number;
  readonly totalHours: number;
  readonly energyKwh: number;
  readonly materialCost: number;
  readonly energyCost: number;
  /** Coste (material + energía) antes de margen. */
  readonly subtotal: number;
  readonly marginAmount: number;
  readonly total: number;
  readonly totalPerCopy: number;
}

/** Grosor de pared en mm: perímetros × ancho de línea. */
export function wallThickness(settings: Pick<QuoteSettings, 'perimeters' | 'lineWidth'>): number {
  return Math.max(0, settings.perimeters) * Math.max(0, settings.lineWidth);
}

/**
 * Volumen impreso por copia (mm³). Modelo simplificado:
 * - cáscara ≈ área × grosor de pared, sin superar el volumen de la pieza;
 * - relleno = relleno% × (volumen − cáscara);
 * - impreso = cáscara + relleno.
 */
export function printedVolume(
  part: PartGeometry,
  settings: Pick<QuoteSettings, 'perimeters' | 'lineWidth' | 'infillPercent'>,
): { shell: number; infill: number; total: number } {
  const volume = Math.max(0, part.volume);
  const shell = Math.min(volume, Math.max(0, part.surfaceArea) * wallThickness(settings));
  const infillRatio = Math.min(100, Math.max(0, settings.infillPercent)) / 100;
  const infill = infillRatio * (volume - shell);
  return { shell, infill, total: shell + infill };
}

/** Presupuesto completo. Función pura: mismos datos, mismo resultado. */
export function computeQuote(part: PartGeometry, settings: QuoteSettings): Quote {
  const material = MATERIALS[settings.material];
  const pricePerKg = settings.pricePerKg[settings.material];
  const copies = Math.max(1, Math.round(settings.copies));

  const { shell, infill, total: printed } = printedVolume(part, settings);

  // mm³ → cm³ (÷1000) × g/cm³ = g
  const weightGrams = (printed / 1000) * material.density;

  // Tiempo = volumen / caudal + sobrecarga fija (por copia: cada copia es una impresión).
  const printSeconds = settings.flowRate > 0 ? printed / settings.flowRate : 0;
  const hoursPerCopy = (printSeconds + settings.overheadMinutes * 60) / 3600;

  const totalWeightGrams = weightGrams * copies;
  const totalHours = hoursPerCopy * copies;
  const energyKwh = (settings.powerWatts * totalHours) / 1000;

  const materialCost = (totalWeightGrams / 1000) * pricePerKg;
  const energyCost = energyKwh * settings.energyPrice;
  const subtotal = materialCost + energyCost;
  const marginAmount = subtotal * (settings.marginPercent / 100);
  const total = subtotal + marginAmount;

  return {
    shellVolume: shell,
    infillVolume: infill,
    printedVolume: printed,
    weightGrams,
    hoursPerCopy,
    copies,
    totalWeightGrams,
    totalHours,
    energyKwh,
    materialCost,
    energyCost,
    subtotal,
    marginAmount,
    total,
    totalPerCopy: total / copies,
  };
}
