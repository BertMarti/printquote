import { getLang } from '../i18n';
import type { BusinessProfile } from '../quote/business';
import { validUntil } from '../quote/business';
import { formatDuration, formatEuro, formatNumber } from '../quote/format';
import { MATERIALS } from '../quote/materials';
import type { Quote } from '../quote/model';
import type { QuoteSettings } from '../quote/settings';
import { computeTax, type TaxedTotal } from '../quote/tax';
import type { MeshStats } from '../stl/types';
import { pdfLabels } from './labels';

/** Fila «etiqueta — valor» de una tabla del PDF. */
export type PdfRow = readonly [label: string, value: string];

/** Todos los textos fijos del PDF (se traducen junto con la interfaz). */
export interface PdfLabels {
  readonly title: string;
  readonly number: string;
  readonly date: string;
  readonly validUntil: string;
  readonly issuer: string;
  readonly taxId: string;
  readonly piece: string;
  readonly file: string;
  readonly dimensions: string;
  readonly volume: string;
  readonly material: string;
  readonly infill: string;
  readonly copies: string;
  readonly breakdown: string;
  readonly weight: string;
  readonly time: string;
  readonly timeEstimate: string;
  readonly materialCost: string;
  readonly energyCost: string;
  readonly subtotal: string;
  readonly margin: string;
  readonly perCopy: string;
  readonly taxBase: string;
  readonly vat: string;
  readonly totalWithVat: string;
  readonly noBusinessName: string;
  readonly noteEstimate: string;
  readonly noteValidity: string;
  readonly footer: string;
  readonly pdfTitle: string;
  readonly language: string;
  /** Configuración regional para las fechas largas («30 de septiembre de 2026»). */
  readonly dateLocale: string;
}

/** Contenido del PDF ya calculado y formateado; el dibujo se hace en `render.ts`. */
export interface QuoteDocument {
  readonly title: string;
  readonly businessName: string;
  readonly logo: string | null;
  /** Nº, fecha y validez. */
  readonly meta: readonly PdfRow[];
  readonly issuerTitle: string;
  /** Líneas del emisor (NIF, dirección, teléfono, correo, web). */
  readonly issuerLines: readonly string[];
  readonly pieceTitle: string;
  readonly pieceRows: readonly PdfRow[];
  readonly image: string | null;
  readonly breakdownTitle: string;
  readonly breakdownRows: readonly PdfRow[];
  /** Base imponible, IVA y total con IVA (la última fila es el total). */
  readonly totalRows: readonly PdfRow[];
  readonly tax: TaxedTotal;
  readonly notes: readonly string[];
  readonly footer: string;
  readonly metadata: { readonly title: string; readonly author: string; readonly language: string };
  readonly date: Date;
}

export interface QuoteDocumentInput {
  readonly business: BusinessProfile;
  readonly fileName: string;
  readonly stats: MeshStats;
  readonly settings: QuoteSettings;
  readonly quote: Quote;
  /** Vista 3D como «data URL» PNG, o null. */
  readonly image: string | null;
  readonly date?: Date;
  readonly labels?: PdfLabels;
}

/** Calcula y formatea todo lo que lleva el PDF. Función pura: mismos datos, mismo contenido. */
export function buildQuoteDocument(input: QuoteDocumentInput): QuoteDocument {
  const { business, fileName, stats, settings, quote, image } = input;
  const date = input.date ?? new Date();
  const labels = input.labels ?? pdfLabels(getLang());
  const material = MATERIALS[settings.material];
  const { size } = stats.bounds;
  const tax = computeTax(quote.total, business.vatPercent);
  const dateFormat = new Intl.DateTimeFormat(labels.dateLocale, { dateStyle: 'long' });

  const issuerLines: string[] = [];
  if (business.taxId) issuerLines.push(`${labels.taxId}: ${business.taxId}`);
  if (business.address) issuerLines.push(...business.address.split('\n').filter((line) => line.trim() !== ''));
  for (const line of [business.phone, business.email, business.web]) if (line) issuerLines.push(line);

  const breakdownRows: PdfRow[] = [
    [labels.copies, formatNumber(quote.copies, 0)],
    [labels.weight, `${formatNumber(quote.totalWeightGrams, 1)} g`],
    [`${labels.time} (${labels.timeEstimate})`, formatDuration(quote.totalHours)],
    [labels.materialCost, formatEuro(quote.materialCost)],
    [`${labels.energyCost} (${formatNumber(quote.energyKwh, 2)} kWh)`, formatEuro(quote.energyCost)],
    [labels.subtotal, formatEuro(quote.subtotal)],
    [`${labels.margin} (${formatNumber(settings.marginPercent, 0)} %)`, formatEuro(quote.marginAmount)],
  ];
  if (quote.copies > 1) breakdownRows.push([labels.perCopy, formatEuro(quote.totalPerCopy)]);

  const vatDecimals = tax.vatPercent % 1 === 0 ? 0 : Math.round(tax.vatPercent * 10) === tax.vatPercent * 10 ? 1 : 2;
  return {
    title: labels.title,
    businessName: business.name || labels.noBusinessName,
    logo: business.logo,
    meta: [
      [labels.number, business.quoteNumber],
      [labels.date, dateFormat.format(date)],
      [labels.validUntil, dateFormat.format(validUntil(date, business.validityDays))],
    ],
    issuerTitle: labels.issuer,
    issuerLines,
    pieceTitle: labels.piece,
    pieceRows: [
      [labels.file, fileName],
      [labels.dimensions, `${formatNumber(size.x, 1)} × ${formatNumber(size.y, 1)} × ${formatNumber(size.z, 1)} mm`],
      [labels.volume, `${formatNumber(stats.volume / 1000, 2)} cm³`],
      [labels.material, `${material.name} · ${formatEuro(settings.pricePerKg[settings.material])}/kg`],
      [labels.infill, `${formatNumber(settings.infillPercent, 0)} % · ${formatNumber(settings.perimeters, 0)} × ${formatNumber(settings.lineWidth, 2)} mm`],
    ],
    image,
    breakdownTitle: labels.breakdown,
    breakdownRows,
    totalRows: [
      [labels.taxBase, formatEuro(tax.base)],
      [`${labels.vat} (${formatNumber(tax.vatPercent, vatDecimals)} %)`, formatEuro(tax.vat)],
      [labels.totalWithVat, formatEuro(tax.total)],
    ],
    tax,
    notes: [labels.noteEstimate, labels.noteValidity],
    footer: labels.footer,
    metadata: { title: `${labels.pdfTitle} ${business.quoteNumber}`, author: business.name, language: labels.language },
    date,
  };
}
