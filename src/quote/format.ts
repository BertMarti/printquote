import { getLocale } from '../i18n';

/**
 * Valor listo para formatear: lo no finito pasa a 0 y lo que se mostraría como «-0,00»
 * (negativos que redondean a cero) también.
 */
function displayable(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.abs(value) < 0.5 * 10 ** -decimals ? 0 : value;
}

const numberFormats = new Map<string, Intl.NumberFormat>();

/** Número con el formato del idioma activo (es-ES: coma decimal; en-GB: punto) y un nº fijo de decimales. */
export function formatNumber(value: number, decimals = 2): string {
  const locale = getLocale();
  const key = `${locale}:${decimals}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    numberFormats.set(key, format);
  }
  return format.format(displayable(value, decimals));
}

const euroFormats = new Map<string, Intl.NumberFormat>();

/** Importe en euros con el formato del idioma activo, p. ej. «12,34 €» o «€12.34». */
export function formatEuro(value: number): string {
  const locale = getLocale();
  let format = euroFormats.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' });
    euroFormats.set(locale, format);
  }
  return format.format(displayable(value, 2));
}

/** Duración legible a partir de horas: «45 min», «2 h 05 min». */
export function formatDuration(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return '0 min';
  const totalMinutes = Math.round(hours * 60);
  if (totalMinutes < 1) return '< 1 min';
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} min`;
  return `${formatNumber(h, 0)} h ${String(m).padStart(2, '0')} min`;
}

/**
 * Lee un número escrito por una persona: acepta coma o punto decimal y espacios.
 * No acepta separadores de miles. Devuelve NaN si no es un número.
 */
export function parseDecimal(text: string): number {
  const cleaned = text.trim().replace(/\s+/g, '').replace(',', '.');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return Number.NaN;
  return Number(cleaned);
}
