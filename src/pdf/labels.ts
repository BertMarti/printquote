import { getLocale, tIn, type Lang } from '../i18n';
import type { PdfLabels } from './document';

/** Textos fijos del PDF en un idioma (los de `i18n/*.ts`, claves `pdf.*`). */
export function pdfLabels(lang: Lang): PdfLabels {
  const t = (key: Parameters<typeof tIn>[1]): string => tIn(lang, key);
  return {
    title: t('pdf.title'),
    number: t('pdf.number'),
    date: t('pdf.date'),
    validUntil: t('pdf.validUntil'),
    issuer: t('pdf.issuer'),
    taxId: t('pdf.taxId'),
    piece: t('pdf.piece'),
    file: t('pdf.file'),
    dimensions: t('pdf.dimensions'),
    volume: t('pdf.volume'),
    material: t('pdf.material'),
    infill: t('pdf.infill'),
    copies: t('pdf.copies'),
    breakdown: t('pdf.breakdown'),
    weight: t('pdf.weight'),
    time: t('pdf.time'),
    timeEstimate: t('pdf.timeEstimate'),
    materialCost: t('pdf.materialCost'),
    energyCost: t('pdf.energyCost'),
    subtotal: t('pdf.subtotal'),
    margin: t('pdf.margin'),
    perCopy: t('pdf.perCopy'),
    taxBase: t('pdf.taxBase'),
    vat: t('pdf.vat'),
    totalWithVat: t('pdf.totalWithVat'),
    noBusinessName: t('pdf.noBusinessName'),
    noteEstimate: t('pdf.noteEstimate'),
    noteValidity: t('pdf.noteValidity'),
    parts: t('pdf.parts'),
    copiesShort: t('pdf.copiesShort'),
    weightShort: t('pdf.weightShort'),
    timeShort: t('pdf.timeShort'),
    amount: t('pdf.amount'),
    pageOf: t('pdf.pageOf'),
    footer: t('pdf.footer'),
    pdfTitle: t('pdf.documentTitle'),
    language: getLocale(lang),
    dateLocale: getLocale(lang),
  };
}
