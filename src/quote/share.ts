import { isMaterialId, MATERIAL_IDS } from './materials';
import { isPrinterId } from './printers';
import { normalizeSettings, type QuoteSettings } from './settings';

/** Versión del formato del enlace (`v=1`). Una distinta se ignora entera. */
export const SHARE_VERSION = '1';
/** Un hash más largo se ignora entero: un enlace de printquote mide ~150 caracteres. */
export const SHARE_HASH_MAX = 1000;

/** Clave del enlace → ajuste numérico que lleva. */
const NUMERIC_KEYS = [
  ['infill', 'infillPercent'],
  ['per', 'perimeters'],
  ['lw', 'lineWidth'],
  ['flow', 'flowRate'],
  ['oh', 'overheadMinutes'],
  ['pw', 'powerWatts'],
  ['ep', 'energyPrice'],
  ['mg', 'marginPercent'],
  ['cp', 'copies'],
  ['bx', 'bedX'],
  ['by', 'bedY'],
  ['bz', 'bedZ'],
] as const;

/**
 * Parámetros del presupuesto en el hash de la URL (el hash no llega al servidor), con sintaxis de consulta:
 * `#v=1&mat=PETG&price=24&printer=bambu-a1&infill=15&per=3&…`. Lleva el precio del material elegido, no el
 * de los demás; y nunca el archivo 3D, el nombre de la pieza, el cliente ni los datos del negocio.
 */
export function settingsToHash(settings: QuoteSettings): string {
  const params = new URLSearchParams();
  params.set('v', SHARE_VERSION);
  params.set('mat', settings.material);
  params.set('price', String(settings.pricePerKg[settings.material]));
  params.set('printer', settings.printerId);
  for (const [key, field] of NUMERIC_KEYS) params.set(key, String(settings[field]));
  return `#${params.toString()}`;
}

/** Solo números decimales (nada de `0x10`, `Infinity` ni `NaN`, que `Number()` sí aceptaría). */
const DECIMAL = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

function readNumber(params: URLSearchParams, key: string): number | undefined {
  const raw = params.get(key);
  if (raw === null || !DECIMAL.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export interface ParsedHash {
  /** Ajustes del enlace, o `null` si no hay (o no se entienden). */
  readonly settings: QuoteSettings | null;
  /** `#ejemplo` o `#ejemplo&…`: pide cargar la pieza de ejemplo. */
  readonly example: boolean;
}

/**
 * Lee el hash de la URL. Nunca lanza: lo que no se entiende se ignora y lo que se sale de rango se acota
 * (con `normalizeSettings`, igual que los ajustes guardados). `base` son los ajustes de quien abre el enlace:
 * de ahí salen los precios de los materiales que el enlace no trae.
 */
export function parseHash(hash: string, base: QuoteSettings): ParsedHash {
  const none: ParsedHash = { settings: null, example: false };
  if (!hash.startsWith('#') || hash.length > SHARE_HASH_MAX) return none;
  const params = new URLSearchParams(hash.slice(1));
  const example = params.has('ejemplo');
  if (params.get('v') !== SHARE_VERSION) return { settings: null, example };

  const material = params.get('mat');
  const chosen = isMaterialId(material) ? material : undefined;
  const raw: Record<string, unknown> = {};
  for (const [key, field] of NUMERIC_KEYS) raw[field] = readNumber(params, key);
  const price = readNumber(params, 'price');
  const pricePerKg = Object.fromEntries(MATERIAL_IDS.map((id) => [id, base.pricePerKg[id]]));
  if (price !== undefined) pricePerKg[chosen ?? normalizeSettings({}).material] = price;
  const printer = params.get('printer');

  return {
    settings: normalizeSettings({ ...raw, material: chosen, pricePerKg, printerId: isPrinterId(printer) ? printer : undefined }),
    example,
  };
}
