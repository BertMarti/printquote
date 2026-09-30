import { isMaterialId, MATERIAL_IDS, MATERIALS, type MaterialId } from './materials';
import { CUSTOM_PRINTER, getPrinter, matchesPrinter } from './printers';

export interface QuoteSettings {
  readonly material: MaterialId;
  /** Perfil de impresora elegido (`custom` = valores propios). Rellena caudal, potencia y cama. */
  readonly printerId: string;
  /** €/kg de cada material; se recuerda por separado. */
  readonly pricePerKg: Readonly<Record<MaterialId, number>>;
  /** Relleno en % (0–100). */
  readonly infillPercent: number;
  /** Nº de perímetros (paredes). */
  readonly perimeters: number;
  /** Ancho de línea en mm. */
  readonly lineWidth: number;
  /** Caudal volumétrico medio en mm³/s. */
  readonly flowRate: number;
  /** Sobrecarga fija por impresión en minutos (calentar, nivelar, purgar). */
  readonly overheadMinutes: number;
  /** Potencia media de la impresora en W. */
  readonly powerWatts: number;
  /** Precio de la electricidad en €/kWh. */
  readonly energyPrice: number;
  /** Margen sobre el coste en %. */
  readonly marginPercent: number;
  /** Nº de copias. */
  readonly copies: number;
  /** Cama de impresión en mm. */
  readonly bedX: number;
  readonly bedY: number;
  readonly bedZ: number;
}

export const DEFAULT_SETTINGS: QuoteSettings = {
  material: 'PLA',
  printerId: CUSTOM_PRINTER,
  pricePerKg: {
    PLA: MATERIALS.PLA.defaultPricePerKg,
    PETG: MATERIALS.PETG.defaultPricePerKg,
    ABS: MATERIALS.ABS.defaultPricePerKg,
    TPU: MATERIALS.TPU.defaultPricePerKg,
  },
  infillPercent: 20,
  perimeters: 2,
  lineWidth: 0.45,
  flowRate: 8,
  overheadMinutes: 5,
  powerWatts: 120,
  energyPrice: 0.15,
  marginPercent: 30,
  copies: 1,
  bedX: 220,
  bedY: 220,
  bedZ: 250,
};

type NumericKey = Exclude<keyof QuoteSettings, 'material' | 'printerId' | 'pricePerKg'>;

interface Limit {
  readonly min: number;
  readonly max: number;
  readonly integer?: boolean;
}

/** Rangos válidos de cada ajuste numérico. La interfaz y la carga desde localStorage los respetan. */
export const LIMITS: Readonly<Record<NumericKey | 'pricePerKg', Limit>> = {
  pricePerKg: { min: 0, max: 10000 },
  infillPercent: { min: 0, max: 100 },
  perimeters: { min: 0, max: 20, integer: true },
  lineWidth: { min: 0.1, max: 2 },
  flowRate: { min: 0.1, max: 200 },
  overheadMinutes: { min: 0, max: 600 },
  powerWatts: { min: 0, max: 5000 },
  energyPrice: { min: 0, max: 10 },
  marginPercent: { min: 0, max: 1000 },
  copies: { min: 1, max: 10000, integer: true },
  bedX: { min: 1, max: 5000 },
  bedY: { min: 1, max: 5000 },
  bedZ: { min: 1, max: 5000 },
};

export function clampToLimit(value: number, limit: Limit): number {
  const rounded = limit.integer ? Math.round(value) : value;
  return Math.min(limit.max, Math.max(limit.min, rounded));
}

/**
 * Convierte cualquier valor (p. ej. lo leído de localStorage) en ajustes válidos:
 * lo que falte o no sea válido toma el valor por defecto y lo numérico se limita a su rango.
 */
export function normalizeSettings(input: unknown): QuoteSettings {
  const source = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;

  const number = (key: NumericKey): number => {
    const raw = source[key];
    return typeof raw === 'number' && Number.isFinite(raw)
      ? clampToLimit(raw, LIMITS[key])
      : DEFAULT_SETTINGS[key];
  };

  const rawPrices = (typeof source.pricePerKg === 'object' && source.pricePerKg !== null
    ? source.pricePerKg
    : {}) as Record<string, unknown>;
  const pricePerKg = Object.fromEntries(
    MATERIAL_IDS.map((id) => {
      const raw = rawPrices[id];
      const value = typeof raw === 'number' && Number.isFinite(raw)
        ? clampToLimit(raw, LIMITS.pricePerKg)
        : DEFAULT_SETTINGS.pricePerKg[id];
      return [id, value];
    }),
  ) as Record<MaterialId, number>;

  const settings: QuoteSettings = {
    material: isMaterialId(source.material) ? source.material : DEFAULT_SETTINGS.material,
    printerId: typeof source.printerId === 'string' ? source.printerId : CUSTOM_PRINTER,
    pricePerKg,
    infillPercent: number('infillPercent'),
    perimeters: number('perimeters'),
    lineWidth: number('lineWidth'),
    flowRate: number('flowRate'),
    overheadMinutes: number('overheadMinutes'),
    powerWatts: number('powerWatts'),
    energyPrice: number('energyPrice'),
    marginPercent: number('marginPercent'),
    copies: number('copies'),
    bedX: number('bedX'),
    bedY: number('bedY'),
    bedZ: number('bedZ'),
  };

  // Un perfil solo vale si los valores siguen siendo los suyos: si alguien los cambió
  // (o el perfil ya no existe), pasa a «Personalizada».
  const printer = getPrinter(settings.printerId);
  return printer && matchesPrinter(settings, printer) ? settings : { ...settings, printerId: CUSTOM_PRINTER };
}
