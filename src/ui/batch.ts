import { t } from '../i18n';
import { BATCH_MAX, computeBatch, makePart, type BatchPart } from '../quote/batch';
import { formatDuration, formatEuro, formatNumber } from '../quote/format';
import { MATERIALS } from '../quote/materials';
import type { Quote } from '../quote/model';
import type { QuoteSettings } from '../quote/settings';
import type { MeshStats } from '../stl/types';
import { loadBatch, saveBatch } from './storage';

/** Lo que el bloque necesita de la aplicación (así no depende de `app.ts`). */
export interface BatchHost {
  /** La pieza cargada y su presupuesto, o `null` si no hay. */
  current(): { fileName: string; stats: MeshStats; quote: Quote; settings: QuoteSettings } | null;
  announce(message: string): void;
  /** El lote cambió (añadir, quitar, vaciar): quien dependa de él se refresca. */
  changed(): void;
}

const byId = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Falta el elemento #${id} en index.html`);
  return node as T;
};

/**
 * Bloque «06 Lote»: varias piezas en un mismo presupuesto. Cada línea es una instantánea (la pieza con los ajustes con
 * que se añadió) y el total lo suma `computeBatch`. Se guarda en `localStorage` (se recupera al recargar) y para conservarlo con nombre está el historial.
 */
export function setupBatch(host: BatchHost): { render(): void; sync(): void; parts(): readonly BatchPart[] } {
  const details = byId<HTMLDetailsElement>('batch-details');
  const addButton = byId<HTMLButtonElement>('batch-add');
  const list = byId('batch-list');
  const empty = byId('batch-empty');
  const summary = byId('batch-summary');
  const count = byId('batch-count');
  const clearButton = byId<HTMLButtonElement>('batch-clear');
  const cancelButton = byId<HTMLButtonElement>('batch-cancel');
  const out = (id: string, text: string): void => void (byId(`out-batch-${id}`).textContent = text);

  let parts: BatchPart[] = loadBatch();
  let confirmingClear = false;

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  /** Fila de la lista. El nombre del archivo lo pone la persona: entra con `textContent`, nunca como HTML. */
  function row(part: BatchPart): HTMLLIElement {
    const { quote, settings } = part;
    const item = el('li', 'history-item');
    const head = el('div', 'history-head');
    head.append(el('span', 'history-name', part.fileName), el('span', 'history-total num', formatEuro(quote.total)));
    const meta = el(
      'p',
      'history-meta',
      [
        MATERIALS[settings.material].name,
        `${formatNumber(part.stats.volume / 1000, 2)} cm³`,
        `${formatNumber(quote.totalWeightGrams, 1)} g`,
        formatDuration(quote.totalHours),
        quote.copies === 1 ? t('summary.copies.one') : t('batch.copies', { n: formatNumber(quote.copies, 0) }),
      ].join(' · '),
    );
    const remove = el('button', 'button button--small', t('batch.remove'));
    remove.type = 'button';
    remove.dataset['id'] = part.id;
    remove.setAttribute('aria-label', t('batch.remove.label', { name: part.fileName }));
    const buttons = el('div', 'history-buttons');
    buttons.append(remove);
    item.append(head, meta, buttons);
    return item;
  }

  /** Lo que depende de la pieza cargada: el botón de añadir (con su importe) y su disponibilidad. */
  function sync(): void {
    const current = host.current();
    const full = parts.length >= BATCH_MAX;
    addButton.disabled = current === null || full;
    addButton.textContent = full
      ? t('batch.full', { max: BATCH_MAX })
      : current
        ? t('batch.add.price', { price: formatEuro(current.quote.total) })
        : t('batch.add');
  }

  function render(): void {
    list.replaceChildren(...parts.map(row));
    empty.hidden = parts.length > 0;
    summary.hidden = parts.length === 0;
    count.textContent = parts.length > 0 ? `(${parts.length})` : '';
    if (parts.length > 0) {
      const totals = computeBatch(parts);
      out('parts', formatNumber(totals.parts, 0));
      out('copies', formatNumber(totals.copies, 0));
      out('weight', formatNumber(totals.weightGrams, 1));
      out('time', formatDuration(totals.hours));
      out('subtotal', formatNumber(totals.subtotal, 2));
      out('margin', formatNumber(totals.marginAmount, 2));
      out('total', formatNumber(totals.total, 2));
    }
    sync();
    clearButton.disabled = parts.length === 0;
    clearButton.textContent = confirmingClear ? t('batch.clear.confirm', { n: parts.length }) : t('batch.clear');
    cancelButton.hidden = !confirmingClear;
  }

  const focusAdd = (): void => (addButton.disabled ? details.querySelector('summary') : addButton)?.focus();
  const totalText = (): string => formatEuro(computeBatch(parts).total);

  function change(): void {
    saveBatch(parts);
    confirmingClear = false;
    render();
    host.changed();
  }

  addButton.addEventListener('click', () => {
    const current = host.current();
    if (!current || parts.length >= BATCH_MAX) return;
    const part = makePart(current.fileName, current.stats, current.settings);
    parts = [...parts, part];
    details.open = true;
    change();
    if (parts.length >= BATCH_MAX) {
      // «Añadir» queda desactivado: el foco pasa a «Copiar lote» (el siguiente paso natural) y se avisa de que está lleno.
      byId('batch-copy').focus();
      host.announce(t('batch.added.full', { name: part.fileName, max: BATCH_MAX, total: totalText() }));
      return;
    }
    host.announce(t('batch.added', { name: part.fileName, n: parts.length, total: totalText() }));
  });

  list.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-id]');
    const index = parts.findIndex((part) => part.id === button?.dataset['id']);
    const removed = parts[index];
    if (!button || !removed) return;
    parts = parts.filter((part) => part !== removed);
    change();
    // El foco no se pierde con el botón que desaparece: pasa al «Quitar» que ocupa su sitio o, sin más piezas, a «Añadir».
    const next = list.querySelectorAll<HTMLButtonElement>('button[data-id]')[Math.min(index, parts.length - 1)];
    if (next) next.focus();
    else focusAdd();
    host.announce(
      parts.length > 0
        ? t('batch.removed', { name: removed.fileName, n: parts.length, total: totalText() })
        : t('batch.removed.empty', { name: removed.fileName }),
    );
  });

  // Vaciar pide confirmar con un segundo clic (sin `confirm()`, que bloquea y no se puede traducir ni probar).
  clearButton.addEventListener('click', () => {
    if (!confirmingClear) {
      confirmingClear = true;
      render();
      return;
    }
    parts = [];
    change();
    focusAdd();
    host.announce(t('batch.cleared'));
  });
  cancelButton.addEventListener('click', () => {
    confirmingClear = false;
    render();
    clearButton.focus();
  });

  render();
  return { render, sync, parts: () => parts };
}
