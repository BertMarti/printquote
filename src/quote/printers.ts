import type { QuoteSettings } from './settings';

/** Datos de partida de una impresora. Todos son orientativos (ver `note`). */
export interface PrinterProfile {
  readonly id: string;
  readonly name: string;
  /** Caudal volumétrico medio en mm³/s (uso normal, no el máximo del fabricante). */
  readonly flowRate: number;
  /** Potencia eléctrica media en W durante una impresión típica. */
  readonly powerWatts: number;
  /** Volumen de impresión en mm. */
  readonly bedX: number;
  readonly bedY: number;
  readonly bedZ: number;
  /** De dónde salen los valores y cuánto fiarse de ellos. */
  readonly note: string;
}

/** Identificador del perfil «Personalizada»: los valores los pone la persona usuaria. */
export const CUSTOM_PRINTER = 'custom';

const BED_NOTE = 'Volumen de impresión según la ficha técnica del fabricante.';
const ESTIMATE_NOTE =
  'Caudal y potencia son estimaciones para un uso normal con PLA, no valores medidos: calíbralos con tu laminador y tu vatímetro.';

/**
 * Perfiles precargados. Los valores de cama vienen de las fichas técnicas de cada
 * fabricante; caudal y potencia son estimaciones redondeadas (bastante por debajo del
 * máximo publicitario) y por eso la interfaz los rotula como orientativos.
 */
export const PRINTERS: readonly PrinterProfile[] = [
  {
    id: 'bambu-a1',
    name: 'Bambu Lab A1',
    flowRate: 12,
    powerWatts: 100,
    bedX: 256,
    bedY: 256,
    bedZ: 256,
    note: `${BED_NOTE} ${ESTIMATE_NOTE}`,
  },
  {
    id: 'bambu-p1s',
    name: 'Bambu Lab P1S',
    flowRate: 15,
    powerWatts: 110,
    bedX: 256,
    bedY: 256,
    bedZ: 256,
    note: `${BED_NOTE} Es una máquina cerrada y con cámara calefactada: la potencia real sube con ABS o ASA. ${ESTIMATE_NOTE}`,
  },
  {
    id: 'prusa-mk4',
    name: 'Prusa MK4',
    flowRate: 11,
    powerWatts: 100,
    bedX: 250,
    bedY: 210,
    bedZ: 220,
    note: `${BED_NOTE} ${ESTIMATE_NOTE}`,
  },
  {
    id: 'prusa-mini',
    name: 'Prusa MINI+',
    flowRate: 8,
    powerWatts: 70,
    bedX: 180,
    bedY: 180,
    bedZ: 180,
    note: `${BED_NOTE} ${ESTIMATE_NOTE}`,
  },
  {
    id: 'creality-ender3-v3',
    name: 'Creality Ender-3 V3',
    flowRate: 10,
    powerWatts: 120,
    bedX: 220,
    bedY: 220,
    bedZ: 250,
    note: `${BED_NOTE} Se usan las medidas de la Ender-3 V3 SE; otras variantes (KE, CoreXZ) tienen otra altura: comprueba tu modelo. ${ESTIMATE_NOTE}`,
  },
  {
    id: 'creality-k1',
    name: 'Creality K1',
    flowRate: 18,
    powerWatts: 130,
    bedX: 220,
    bedY: 220,
    bedZ: 250,
    note: `${BED_NOTE} Es una máquina cerrada de alta velocidad. ${ESTIMATE_NOTE}`,
  },
  {
    id: 'elegoo-neptune4',
    name: 'Elegoo Neptune 4',
    flowRate: 12,
    powerWatts: 110,
    bedX: 225,
    bedY: 225,
    bedZ: 265,
    note: `${BED_NOTE} ${ESTIMATE_NOTE}`,
  },
];

const BY_ID: ReadonlyMap<string, PrinterProfile> = new Map(PRINTERS.map((printer) => [printer.id, printer]));

export function getPrinter(id: string): PrinterProfile | undefined {
  return BY_ID.get(id);
}

/** ¿Es un identificador de perfil conocido? «Personalizada» no cuenta: no tiene datos. */
export function isPrinterId(value: unknown): value is string {
  return typeof value === 'string' && BY_ID.has(value);
}

/** Campos de los ajustes que rellena un perfil; editar cualquiera pasa a «Personalizada». */
export const PRINTER_FIELDS = ['flowRate', 'powerWatts', 'bedX', 'bedY', 'bedZ'] as const;
export type PrinterField = (typeof PRINTER_FIELDS)[number];

/**
 * Ajustes con el perfil aplicado: copia caudal, potencia y cama. Con «Personalizada» o un
 * identificador desconocido no cambia ningún valor (solo el identificador).
 */
export function applyPrinter(settings: QuoteSettings, id: string): QuoteSettings {
  const printer = getPrinter(id);
  if (!printer) return { ...settings, printerId: CUSTOM_PRINTER };
  return {
    ...settings,
    printerId: printer.id,
    flowRate: printer.flowRate,
    powerWatts: printer.powerWatts,
    bedX: printer.bedX,
    bedY: printer.bedY,
    bedZ: printer.bedZ,
  };
}

/** ¿Los valores de los ajustes coinciden con los del perfil? */
export function matchesPrinter(settings: QuoteSettings, printer: PrinterProfile): boolean {
  return PRINTER_FIELDS.every((field) => settings[field] === printer[field]);
}
