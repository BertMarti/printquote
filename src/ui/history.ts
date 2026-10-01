import { getLang, getLocale, t } from '../i18n';
import { formatEuro } from '../quote/format';
import {
  addEntry,
  createEntry,
  HISTORY_MAX,
  historyToCsv,
  removeEntry,
  type HistoryEntry,
} from '../quote/history';
import type { Quote } from '../quote/model';
import type { QuoteSettings } from '../quote/settings';
import type { MeshStats } from '../stl/types';
import { loadHistory, saveHistory } from './storage';

/** Lo que el bloque necesita de la aplicación (así no depende de `app.ts`). */
export interface HistoryHost {
  /** La pieza cargada y su presupuesto, o `null` si no hay. */
  current(): { fileName: string; stats: MeshStats; quote: Quote; settings: QuoteSettings } | null;
  /** Aplica unos ajustes a la interfaz (y los guarda como los de trabajo). */
  applySettings(settings: QuoteSettings): void;
  announce(message: string): void;
  showNotice(title: string, message: string): void;
  download(blob: Blob, fileName: string): void;
}

const byId = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Falta el elemento #${id} en index.html`);
  return node as T;
};

/** Bloque «07 Presupuestos»: guardar, listar, reabrir, borrar y exportar a CSV. Todo en `localStorage`. */
export function setupHistory(host: HistoryHost): { render(): void; sync(): void } {
  const client = byId<HTMLInputElement>('in-client');
  const saveButton = byId<HTMLButtonElement>('history-save');
  const list = byId('history-list');
  const empty = byId('history-empty');
  const count = byId('history-count');
  const exportButton = byId<HTMLButtonElement>('history-export');
  const clearButton = byId<HTMLButtonElement>('history-clear');
  const cancelButton = byId<HTMLButtonElement>('history-cancel');

  let entries = loadHistory();
  let confirmingClear = false;

  const formatDate = (iso: string): string =>
    new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

  /** Fila de la lista. Todo el texto de la persona (pieza, cliente) entra con `textContent`, nunca como HTML. */
  function row(entry: HistoryEntry): HTMLLIElement {
    const item = document.createElement('li');
    item.className = 'history-item';
    const name = document.createElement('span');
    name.className = 'history-name';
    name.textContent = entry.fileName;
    const total = document.createElement('span');
    total.className = 'history-total num';
    total.textContent = formatEuro(entry.result.total);
    const head = document.createElement('div');
    head.className = 'history-head';
    head.append(name, total);

    const meta = document.createElement('p');
    meta.className = 'history-meta';
    meta.textContent = [formatDate(entry.savedAt), entry.client, entry.settings.material].filter((part) => part !== '').join(' · ');

    const label = { name: entry.fileName, date: formatDate(entry.savedAt) };
    const action = (kind: 'open' | 'delete'): HTMLButtonElement => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button button--small';
      button.dataset['action'] = kind;
      button.dataset['id'] = entry.id;
      button.textContent = t(`hist.${kind}`);
      button.setAttribute('aria-label', t(`hist.${kind}.label`, label));
      return button;
    };
    const buttons = document.createElement('div');
    buttons.className = 'history-buttons';
    buttons.append(action('open'), action('delete'));
    item.append(head, meta, buttons);
    return item;
  }

  /** Lo que depende de la pieza cargada: sin pieza no se puede guardar. */
  function sync(): void {
    saveButton.disabled = host.current() === null;
  }

  function render(): void {
    list.replaceChildren(...entries.map(row));
    empty.hidden = entries.length > 0;
    count.textContent = entries.length > 0 ? `(${entries.length})` : '';
    sync();
    exportButton.disabled = entries.length === 0;
    clearButton.disabled = entries.length === 0;
    clearButton.textContent = confirmingClear ? t('hist.clear.confirm', { n: entries.length }) : t('hist.clear');
    cancelButton.hidden = !confirmingClear;
  }

  const stopConfirming = (): void => {
    confirmingClear = false;
    render();
  };

  function save(): void {
    const current = host.current();
    if (!current) return;
    const entry = createEntry({ fileName: current.fileName, client: client.value, stats: current.stats, settings: current.settings, quote: current.quote });
    const { entries: next, dropped } = addEntry(entries, entry);
    if (!saveHistory(next)) {
      host.showNotice(t('hist.save.failed.title'), t('hist.save.failed'));
      return;
    }
    entries = next;
    confirmingClear = false;
    render();
    const params = { name: entry.fileName, total: formatEuro(entry.result.total), max: HISTORY_MAX };
    host.announce(t(dropped > 0 ? 'hist.saved.dropped' : 'hist.saved', params));
  }

  function open(entry: HistoryEntry): void {
    const hasPart = host.current() !== null;
    host.applySettings(entry.settings);
    client.value = entry.client;
    host.announce(t(hasPart ? 'hist.opened.part' : 'hist.opened', { name: entry.fileName, total: formatEuro(entry.result.total) }));
  }

  function remove(entry: HistoryEntry): void {
    const next = removeEntry(entries, entry.id);
    if (!saveHistory(next)) {
      host.showNotice(t('hist.save.failed.title'), t('hist.save.failed'));
      return;
    }
    entries = next;
    render();
    host.announce(t('hist.deleted', { name: entry.fileName }));
  }

  function exportCsv(): void {
    const today = new Date();
    const pad = (n: number): string => String(n).padStart(2, '0');
    const name = `presupuestos-${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}.csv`;
    host.download(new Blob([historyToCsv(entries, getLang())], { type: 'text/csv;charset=utf-8' }), name);
    host.announce(t('hist.export.done', { name }));
  }

  saveButton.addEventListener('click', save);
  client.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!saveButton.disabled) save();
    }
  });
  list.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-action]');
    const entry = entries.find((candidate) => candidate.id === button?.dataset['id']);
    if (!button || !entry) return;
    if (button.dataset['action'] === 'open') open(entry);
    else remove(entry);
  });
  exportButton.addEventListener('click', exportCsv);
  // Borrar todos pide confirmar con un segundo clic (sin `confirm()`, que bloquea y no se puede traducir ni probar).
  clearButton.addEventListener('click', () => {
    if (!confirmingClear) {
      confirmingClear = true;
      render();
      return;
    }
    if (!saveHistory([])) {
      host.showNotice(t('hist.save.failed.title'), t('hist.save.failed'));
      return;
    }
    entries = [];
    confirmingClear = false;
    render();
    host.announce(t('hist.cleared'));
  });
  cancelButton.addEventListener('click', stopConfirming);

  render();
  return { render, sync };
}
