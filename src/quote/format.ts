const LOCALE = 'es-ES';

const numberFormats = new Map<number, Intl.NumberFormat>();

/** Número con formato es-ES (coma decimal) y un nº fijo de decimales. */
export function formatNumber(value: number, decimals = 2): string {
  let format = numberFormats.get(decimals);
  if (!format) {
    format = new Intl.NumberFormat(LOCALE, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    numberFormats.set(decimals, format);
  }
  return format.format(Number.isFinite(value) ? value : 0);
}

const euroFormat = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'EUR' });

/** Importe en euros con formato es-ES, p. ej. «12,34 €». */
export function formatEuro(value: number): string {
  return euroFormat.format(Number.isFinite(value) ? value : 0);
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
