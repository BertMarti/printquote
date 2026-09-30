import type { MeshStats } from '../stl/types';
import { formatDuration, formatEuro, formatNumber } from './format';
import { MATERIALS } from './materials';
import type { Quote } from './model';
import type { QuoteSettings } from './settings';

export interface QuoteTextInput {
  readonly fileName: string;
  readonly stats: MeshStats;
  readonly settings: QuoteSettings;
  readonly quote: Quote;
  readonly date?: Date;
}

/** Presupuesto en texto plano, listo para pegar en un correo o mensaje. */
export function buildQuoteText({ fileName, stats, settings, quote, date = new Date() }: QuoteTextInput): string {
  const material = MATERIALS[settings.material];
  const { size } = stats.bounds;
  const dateText = new Intl.DateTimeFormat('es-ES', { dateStyle: 'long' }).format(date);

  const row = (label: string, value: string): string => `${label.padEnd(28, ' ')}${value}`;
  const rule = '-'.repeat(44);

  const lines = [
    'PRESUPUESTO DE IMPRESIÓN 3D',
    `${fileName} · ${dateText}`,
    rule,
    'PIEZA',
    row('Dimensiones (X × Y × Z)', `${formatNumber(size.x, 1)} × ${formatNumber(size.y, 1)} × ${formatNumber(size.z, 1)} mm`),
    row('Volumen', `${formatNumber(stats.volume / 1000, 2)} cm³`),
    row('Superficie', `${formatNumber(stats.surfaceArea / 100, 2)} cm²`),
    rule,
    'AJUSTES',
    row('Material', `${material.name} · ${formatNumber(material.density, 2)} g/cm³ · ${formatEuro(settings.pricePerKg[settings.material])}/kg`),
    row('Relleno', `${formatNumber(settings.infillPercent, 0)} %`),
    row('Perímetros', `${formatNumber(settings.perimeters, 0)} × ${formatNumber(settings.lineWidth, 2)} mm`),
    row('Copias', formatNumber(quote.copies, 0)),
    rule,
    'DESGLOSE',
    row('Volumen impreso por copia', `${formatNumber(quote.printedVolume / 1000, 2)} cm³`),
    row('Peso total', `${formatNumber(quote.totalWeightGrams, 1)} g`),
    row('Tiempo total (estimación)', formatDuration(quote.totalHours)),
    row('Material', formatEuro(quote.materialCost)),
    row('Energía', `${formatEuro(quote.energyCost)} (${formatNumber(quote.energyKwh, 2)} kWh)`),
    row('Subtotal', formatEuro(quote.subtotal)),
    row(`Margen (${formatNumber(settings.marginPercent, 0)} %)`, formatEuro(quote.marginAmount)),
    rule,
    row('TOTAL', formatEuro(quote.total)),
  ];
  if (quote.copies > 1) {
    lines.push(row('Por copia', formatEuro(quote.totalPerCopy)));
  }
  lines.push('', 'El tiempo es una estimación. Calculado con printquote.');
  return lines.join('\n');
}
