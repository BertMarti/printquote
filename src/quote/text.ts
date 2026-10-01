import { getLocale, t } from '../i18n';
import type { MeshStats } from '../stl/types';
import type { BatchPart, BatchTotals } from './batch';
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

const row = (label: string, value: string): string => `${label.padEnd(28, ' ')}${value}`;
const rule = '-'.repeat(44);

/** Presupuesto en texto plano (en el idioma activo), listo para pegar en un correo o mensaje. */
export function buildQuoteText({ fileName, stats, settings, quote, date = new Date() }: QuoteTextInput): string {
  const material = MATERIALS[settings.material];
  const { size } = stats.bounds;
  const dateText = new Intl.DateTimeFormat(getLocale(), { dateStyle: 'long' }).format(date);

  const lines = [
    t('doc.copyTitle'),
    `${fileName} · ${dateText}`,
    rule,
    t('doc.copyPartUpper'),
    row(t('doc.dimensions'), `${formatNumber(size.x, 1)} × ${formatNumber(size.y, 1)} × ${formatNumber(size.z, 1)} mm`),
    row(t('doc.volume'), `${formatNumber(stats.volume / 1000, 2)} cm³`),
    row(t('doc.area'), `${formatNumber(stats.surfaceArea / 100, 2)} cm²`),
    rule,
    t('doc.copySettingsUpper'),
    row(t('doc.material'), `${material.name} · ${formatNumber(material.density, 2)} g/cm³ · ${formatEuro(settings.pricePerKg[settings.material])}/kg`),
    row(t('doc.infill'), `${formatNumber(settings.infillPercent, 0)} %`),
    row(t('doc.perimeters'), `${formatNumber(settings.perimeters, 0)} × ${formatNumber(settings.lineWidth, 2)} mm`),
    row(t('doc.copies'), formatNumber(quote.copies, 0)),
    rule,
    t('doc.copyBreakdownUpper'),
    row(t('doc.printedVolume'), `${formatNumber(quote.printedVolume / 1000, 2)} cm³`),
    row(t('doc.weightTotal'), `${formatNumber(quote.totalWeightGrams, 1)} g`),
    row(t('doc.timeTotal'), formatDuration(quote.totalHours)),
    row(t('doc.material'), formatEuro(quote.materialCost)),
    row(t('doc.energy'), `${formatEuro(quote.energyCost)} (${formatNumber(quote.energyKwh, 2)} kWh)`),
    row(t('doc.subtotal'), formatEuro(quote.subtotal)),
    row(t('doc.margin', { pct: formatNumber(settings.marginPercent, 0) }), formatEuro(quote.marginAmount)),
    rule,
    row(t('doc.totalUpper'), formatEuro(quote.total)),
  ];
  if (quote.copies > 1) {
    lines.push(row(t('doc.perCopy'), formatEuro(quote.totalPerCopy)));
  }
  lines.push('', t('doc.copyFooter'));
  return lines.join('\n');
}

export interface BatchTextInput {
  readonly parts: readonly BatchPart[];
  readonly totals: BatchTotals;
  readonly date?: Date;
}

/** Presupuesto de un lote en texto plano: una sección por pieza (con su importe) y el desglose y el total del lote. */
export function buildBatchText({ parts, totals, date = new Date() }: BatchTextInput): string {
  const dateText = new Intl.DateTimeFormat(getLocale(), { dateStyle: 'long' }).format(date);
  const lines = [t('doc.copyTitle'), dateText, rule];
  parts.forEach(({ fileName, stats, settings, quote }, i) => {
    const material = MATERIALS[settings.material];
    const { size } = stats.bounds;
    lines.push(
      t('doc.batchPartUpper', { i: i + 1, n: parts.length }),
      fileName,
      row(t('doc.dimensions'), `${formatNumber(size.x, 1)} × ${formatNumber(size.y, 1)} × ${formatNumber(size.z, 1)} mm`),
      row(t('doc.volume'), `${formatNumber(stats.volume / 1000, 2)} cm³`),
      row(t('doc.material'), `${material.name} · ${formatEuro(settings.pricePerKg[settings.material])}/kg`),
      row(t('doc.infill'), `${formatNumber(settings.infillPercent, 0)} % · ${formatNumber(settings.perimeters, 0)} × ${formatNumber(settings.lineWidth, 2)} mm`),
      row(t('doc.copies'), formatNumber(quote.copies, 0)),
      row(t('doc.weightTotal'), `${formatNumber(quote.totalWeightGrams, 1)} g`),
      row(t('doc.timeTotal'), formatDuration(quote.totalHours)),
      row(t('doc.batchAmount'), formatEuro(quote.total)),
      rule,
    );
  });
  lines.push(
    t('doc.copyBreakdownUpper'),
    row(t('batch.sum.parts'), formatNumber(totals.parts, 0)),
    row(t('batch.sum.copies'), formatNumber(totals.copies, 0)),
    row(t('doc.weightTotal'), `${formatNumber(totals.weightGrams, 1)} g`),
    row(t('doc.timeTotal'), formatDuration(totals.hours)),
    row(t('doc.material'), formatEuro(totals.materialCost)),
    row(t('doc.energy'), `${formatEuro(totals.energyCost)} (${formatNumber(totals.energyKwh, 2)} kWh)`),
    row(t('doc.subtotal'), formatEuro(totals.subtotal)),
    row(t('breakdown.margin'), formatEuro(totals.marginAmount)),
    rule,
    row(t('doc.batchTotalUpper'), formatEuro(totals.total)),
    '',
    t('doc.copyFooter'),
  );
  return lines.join('\n');
}
