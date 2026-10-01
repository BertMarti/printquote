import { getLocale, t } from '../i18n';
import type { BatchPart, BatchTotals } from '../quote/batch';
import { formatDuration, formatEuro, formatNumber } from '../quote/format';
import { MATERIALS } from '../quote/materials';
import type { Quote } from '../quote/model';
import type { QuoteSettings } from '../quote/settings';
import type { MeshFormat, MeshStats } from '../stl/types';
import { formatLabel } from './format-label';

export interface PrintSheetData {
  readonly fileName: string;
  readonly format: MeshFormat;
  readonly stats: MeshStats;
  readonly settings: QuoteSettings;
  readonly quote: Quote;
  readonly image: string | null;
}

type Row = readonly [label: string, value: string];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function table(caption: string, rows: readonly Row[], totalRow?: Row): HTMLTableElement {
  const t = el('table', 'ps-table');
  t.append(el('caption', undefined, caption));
  const body = el('tbody');
  const addRow = ([label, value]: Row, className?: string): void => {
    const tr = el('tr', className);
    const th = el('th', undefined, label);
    th.scope = 'row';
    tr.append(th, el('td', undefined, value));
    body.append(tr);
  };
  rows.forEach((row) => addRow(row));
  if (totalRow) addRow(totalRow, 'ps-total');
  t.append(body);
  return t;
}

/** Cabecera (marca y fecha) y título, comunes a la hoja de una pieza y a la de un lote. */
function sheetHeader(): HTMLElement[] {
  const date = new Intl.DateTimeFormat(getLocale(), { dateStyle: 'long' }).format(new Date());
  const head = el('header', 'ps-head');
  const meta = el('div', 'ps-meta');
  meta.append(el('div', undefined, date), el('div', undefined, 'bertmarti.github.io/printquote'));
  head.append(el('div', 'ps-brand', 'printquote'), meta);
  return [head, el('h1', 'ps-title', t('doc.title'))];
}

/**
 * Hoja de impresión de un lote: tabla de piezas (sin vista 3D: mostraría una sola de varias), desglose y total.
 * Reutiliza el contenedor, las clases `ps-*` y `table`; los importes son los de las líneas (`computeQuote`) y los totales, los de `computeBatch`.
 */
export function renderBatchSheet(container: HTMLElement, data: { parts: readonly BatchPart[]; totals: BatchTotals }): void {
  const { parts, totals } = data;
  const pieces = totals.parts === 1 ? t('hist.batch.meta.one') : t('hist.batch.meta', { n: formatNumber(totals.parts, 0) });
  const copies = totals.copies === 1 ? t('summary.copies.one') : t('batch.copies', { n: formatNumber(totals.copies, 0) });
  const info = el('p', 'ps-file', `${pieces} · ${copies}`);

  const list = el('table', 'ps-table ps-parts');
  list.append(el('caption', undefined, t('batch.list.label')));
  const headRow = el('tr');
  const columns = [t('doc.part'), t('doc.material'), t('doc.copies'), t('breakdown.weight'), t('breakdown.time'), t('doc.batchAmount')];
  for (const label of columns) {
    const th = el('th', undefined, label);
    th.scope = 'col';
    headRow.append(th);
  }
  const thead = el('thead');
  thead.append(headRow);
  const tbody = el('tbody');
  for (const { fileName, settings, quote } of parts) {
    const tr = el('tr');
    const name = el('th', undefined, fileName);
    name.scope = 'row';
    tr.append(
      name,
      ...[
        MATERIALS[settings.material].name,
        formatNumber(quote.copies, 0),
        `${formatNumber(quote.totalWeightGrams, 1)} g`,
        formatDuration(quote.totalHours),
        formatEuro(quote.total),
      ].map((text) => el('td', undefined, text)),
    );
    tbody.append(tr);
  }
  list.append(thead, tbody);

  const breakdown = table(
    t('doc.breakdown'),
    [
      [t('doc.weightTotal'), `${formatNumber(totals.weightGrams, 1)} g`],
      [t('doc.timeTotal'), formatDuration(totals.hours)],
      [t('doc.material'), formatEuro(totals.materialCost)],
      [t('doc.energy'), `${formatNumber(totals.energyKwh, 2)} kWh · ${formatEuro(totals.energyCost)}`],
      [t('doc.subtotal'), formatEuro(totals.subtotal)],
      [t('breakdown.margin'), formatEuro(totals.marginAmount)],
    ],
    [t('batch.total'), formatEuro(totals.total)],
  );

  container.replaceChildren(...sheetHeader(), info, list, breakdown, el('p', 'ps-note', t('doc.printNote')));
}

/** Rellena la hoja de impresión. Se construye con nodos DOM (nunca innerHTML) porque el nombre del archivo lo pone la persona usuaria. */
export function renderPrintSheet(container: HTMLElement, data: PrintSheetData): void {
  const { fileName, format, stats, settings, quote, image } = data;
  const material = MATERIALS[settings.material];
  const size = stats.bounds.size;

  const [head, title] = sheetHeader() as [HTMLElement, HTMLElement];
  const file = el(
    'p',
    'ps-file',
    t('doc.fileInfo', { name: fileName, format: formatLabel(format), n: formatNumber(stats.triangleCount, 0) }),
  );

  const nodes: HTMLElement[] = [head, title, file];

  if (image) {
    const figure = el('figure', 'ps-figure');
    const img = el('img');
    img.src = image;
    img.alt = t('doc.view3d', { name: fileName });
    figure.append(img);
    nodes.push(figure);
  }

  const grid = el('div', 'ps-grid');
  grid.append(
    table(t('doc.part'), [
      [t('doc.dimensions'), `${formatNumber(size.x, 1)} × ${formatNumber(size.y, 1)} × ${formatNumber(size.z, 1)} mm`],
      [t('doc.volume'), `${formatNumber(stats.volume / 1000, 2)} cm³`],
      [t('doc.area'), `${formatNumber(stats.surfaceArea / 100, 2)} cm²`],
      [t('doc.printedVolume'), `${formatNumber(quote.printedVolume / 1000, 2)} cm³`],
      [t('doc.weightPerCopy'), `${formatNumber(quote.weightGrams, 1)} g`],
    ]),
    table(t('doc.settings'), [
      [t('doc.material'), `${material.name} · ${formatNumber(material.density, 2)} g/cm³`],
      [t('doc.materialPrice'), `${formatEuro(settings.pricePerKg[settings.material])}/kg`],
      [t('doc.infillPerimeters'), `${formatNumber(settings.infillPercent, 0)} % · ${formatNumber(settings.perimeters, 0)} × ${formatNumber(settings.lineWidth, 2)} mm`],
      [t('doc.flow'), `${formatNumber(settings.flowRate, 1)} mm³/s`],
      [t('doc.powerEnergy'), `${formatNumber(settings.powerWatts, 0)} W · ${formatNumber(settings.energyPrice, 3)} €/kWh`],
    ]),
  );
  nodes.push(grid);

  const breakdown: Row[] = [
    [t('doc.copies'), formatNumber(quote.copies, 0)],
    [t('doc.weightTotal'), `${formatNumber(quote.totalWeightGrams, 1)} g`],
    [t('doc.timeTotal'), formatDuration(quote.totalHours)],
    [t('doc.material'), formatEuro(quote.materialCost)],
    [t('doc.energy'), `${formatNumber(quote.energyKwh, 2)} kWh · ${formatEuro(quote.energyCost)}`],
    [t('doc.subtotal'), formatEuro(quote.subtotal)],
    [t('doc.margin', { pct: formatNumber(settings.marginPercent, 0) }), formatEuro(quote.marginAmount)],
  ];
  if (quote.copies > 1) breakdown.push([t('doc.perCopyPrice'), formatEuro(quote.totalPerCopy)]);
  nodes.push(table(t('doc.breakdown'), breakdown, [t('doc.total'), formatEuro(quote.total)]));

  nodes.push(el('p', 'ps-note', t('doc.printNote')));

  container.replaceChildren(...nodes);
}
