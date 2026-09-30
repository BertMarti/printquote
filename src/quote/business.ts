import { DEFAULT_VAT_PERCENT } from './tax';

/** Datos del negocio que salen en el PDF. Se guardan solo en este navegador. */
export interface BusinessProfile {
  readonly name: string;
  /** NIF / CIF u otro identificador fiscal. */
  readonly taxId: string;
  /** Dirección; admite varias líneas. */
  readonly address: string;
  readonly phone: string;
  readonly email: string;
  readonly web: string;
  /** Logotipo como «data URL» PNG o JPEG (ya reducido), o null. Nunca sale del navegador. */
  readonly logo: string | null;
  /** Número del próximo presupuesto; sube solo tras descargar cada PDF. */
  readonly quoteNumber: string;
  /** Días de validez del presupuesto. */
  readonly validityDays: number;
  readonly vatPercent: number;
}

/** Longitudes máximas de los textos (el PDF es de una sola página). */
export const BUSINESS_MAX = {
  name: 80,
  taxId: 30,
  address: 200,
  phone: 30,
  email: 80,
  web: 80,
  quoteNumber: 30,
} as const;

export const BUSINESS_LIMITS = {
  validityDays: { min: 1, max: 365 },
  vatPercent: { min: 0, max: 100 },
} as const;

/** El logotipo guardado no puede pesar más que esto (localStorage tiene ~5 MB en total). */
export const MAX_LOGO_DATA_URL_CHARS = 600_000;

export const DEFAULT_VALIDITY_DAYS = 30;

/** Número de presupuesto inicial: «AAAA-001». */
export function firstQuoteNumber(date: Date = new Date()): string {
  return `${date.getFullYear()}-001`;
}

export const DEFAULT_BUSINESS: BusinessProfile = {
  name: '',
  taxId: '',
  address: '',
  phone: '',
  email: '',
  web: '',
  logo: null,
  quoteNumber: firstQuoteNumber(),
  validityDays: DEFAULT_VALIDITY_DAYS,
  vatPercent: DEFAULT_VAT_PERCENT,
};

const LOGO_DATA_URL = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/;

/** ¿Es un logotipo aceptable para guardar y para el PDF (PNG o JPEG en base64 y de tamaño razonable)? */
export function isValidLogo(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_LOGO_DATA_URL_CHARS && LOGO_DATA_URL.test(value);
}

/** Quita caracteres de control (salvo saltos de línea si `multiline`), recorta y limita la longitud. */
function cleanText(value: unknown, max: number, multiline = false): string {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const control = multiline ? /[\u0000-\u0009\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g;
  return value.replace(/\r\n?/g, '\n').replace(control, ' ').trim().slice(0, max);
}

function cleanNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/** Convierte cualquier valor (p. ej. lo leído de localStorage) en datos de negocio válidos. */
export function normalizeBusiness(input: unknown): BusinessProfile {
  const source = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const quoteNumber = cleanText(source.quoteNumber, BUSINESS_MAX.quoteNumber);
  return {
    name: cleanText(source.name, BUSINESS_MAX.name),
    taxId: cleanText(source.taxId, BUSINESS_MAX.taxId),
    address: cleanText(source.address, BUSINESS_MAX.address, true),
    phone: cleanText(source.phone, BUSINESS_MAX.phone),
    email: cleanText(source.email, BUSINESS_MAX.email),
    web: cleanText(source.web, BUSINESS_MAX.web),
    logo: isValidLogo(source.logo) ? source.logo : null,
    quoteNumber: quoteNumber === '' ? DEFAULT_BUSINESS.quoteNumber : quoteNumber,
    validityDays: Math.round(
      cleanNumber(source.validityDays, DEFAULT_VALIDITY_DAYS, BUSINESS_LIMITS.validityDays.min, BUSINESS_LIMITS.validityDays.max),
    ),
    // Dos decimales como mucho: es lo que se puede escribir y rotular sin que el PDF diga otro tipo que el aplicado.
    vatPercent:
      Math.round(cleanNumber(source.vatPercent, DEFAULT_VAT_PERCENT, BUSINESS_LIMITS.vatPercent.min, BUSINESS_LIMITS.vatPercent.max) * 100) / 100,
  };
}

/**
 * Número siguiente: suma 1 al último grupo de cifras y conserva los ceros a la izquierda
 * («2026-009» → «2026-010», «PQ7» → «PQ8»). Sin cifras, añade «-2».
 */
export function nextQuoteNumber(current: string): string {
  const match = /^(.*?)(\d+)(\D*)$/.exec(current);
  if (!match) return current === '' ? firstQuoteNumber() : `${current}-2`;
  const [, prefix = '', digits = '', suffix = ''] = match;
  const next = String(BigInt(digits) + 1n).padStart(digits.length, '0');
  return `${prefix}${next}${suffix}`;
}

/** Fecha hasta la que vale el presupuesto (`days` días después de `from`). */
export function validUntil(from: Date, days: number): Date {
  const date = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  date.setDate(date.getDate() + Math.max(0, Math.round(days)));
  return date;
}
