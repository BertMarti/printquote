import { formatDuration, formatEuro, formatNumber } from '../quote/format';
import { MATERIALS } from '../quote/materials';
import type { Quote } from '../quote/model';
import type { QuoteSettings } from '../quote/settings';
import type { MeshStats, StlFormat } from '../stl/types';

export interface PrintSheetData {
  readonly fileName: string;
  readonly format: StlFormat;
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

/** Rellena la hoja de impresión. Se construye con nodos DOM (nunca innerHTML) porque el nombre del archivo lo pone la persona usuaria. */
export function renderPrintSheet(container: HTMLElement, data: PrintSheetData): void {
  const { fileName, format, stats, settings, quote, image } = data;
  const material = MATERIALS[settings.material];
  const size = stats.bounds.size;
  const date = new Intl.DateTimeFormat('es-ES', { dateStyle: 'long' }).format(new Date());

  const head = el('header', 'ps-head');
  const meta = el('div', 'ps-meta');
  meta.append(el('div', undefined, date), el('div', undefined, 'bertmarti.github.io/printquote'));
  head.append(el('div', 'ps-brand', 'printquote'), meta);

  const title = el('h1', 'ps-title', 'Presupuesto de impresión 3D');
  const file = el(
    'p',
    'ps-file',
    `${fileName} · STL ${format === 'binary' ? 'binario' : 'ASCII'} · ${formatNumber(stats.triangleCount, 0)} triángulos`,
  );

  const nodes: HTMLElement[] = [head, title, file];

  if (image) {
    const figure = el('figure', 'ps-figure');
    const img = el('img');
    img.src = image;
    img.alt = `Vista 3D de ${fileName}`;
    figure.append(img);
    nodes.push(figure);
  }

  const grid = el('div', 'ps-grid');
  grid.append(
    table('Pieza', [
      ['Dimensiones (X × Y × Z)', `${formatNumber(size.x, 1)} × ${formatNumber(size.y, 1)} × ${formatNumber(size.z, 1)} mm`],
      ['Volumen', `${formatNumber(stats.volume / 1000, 2)} cm³`],
      ['Superficie', `${formatNumber(stats.surfaceArea / 100, 2)} cm²`],
      ['Volumen impreso por copia', `${formatNumber(quote.printedVolume / 1000, 2)} cm³`],
      ['Peso por copia', `${formatNumber(quote.weightGrams, 1)} g`],
    ]),
    table('Ajustes', [
      ['Material', `${material.name} · ${formatNumber(material.density, 2)} g/cm³`],
      ['Precio del material', `${formatEuro(settings.pricePerKg[settings.material])}/kg`],
      ['Relleno · perímetros', `${formatNumber(settings.infillPercent, 0)} % · ${formatNumber(settings.perimeters, 0)} × ${formatNumber(settings.lineWidth, 2)} mm`],
      ['Caudal volumétrico', `${formatNumber(settings.flowRate, 1)} mm³/s`],
      ['Potencia · electricidad', `${formatNumber(settings.powerWatts, 0)} W · ${formatNumber(settings.energyPrice, 3)} €/kWh`],
    ]),
  );
  nodes.push(grid);

  const breakdown: Row[] = [
    ['Copias', formatNumber(quote.copies, 0)],
    ['Peso total', `${formatNumber(quote.totalWeightGrams, 1)} g`],
    ['Tiempo total (estimación)', formatDuration(quote.totalHours)],
    ['Material', formatEuro(quote.materialCost)],
    ['Energía', `${formatNumber(quote.energyKwh, 2)} kWh · ${formatEuro(quote.energyCost)}`],
    ['Subtotal', formatEuro(quote.subtotal)],
    [`Margen (${formatNumber(settings.marginPercent, 0)} %)`, formatEuro(quote.marginAmount)],
  ];
  if (quote.copies > 1) breakdown.push(['Precio por copia', formatEuro(quote.totalPerCopy)]);
  nodes.push(table('Desglose', breakdown, ['Total', formatEuro(quote.total)]));

  nodes.push(
    el(
      'p',
      'ps-note',
      'El tiempo de impresión es una estimación basada en un caudal volumétrico medio; el laminador dará la cifra real. ' +
        'El archivo se ha procesado en el navegador y no se ha enviado a ningún servidor.',
    ),
  );

  container.replaceChildren(...nodes);
}
