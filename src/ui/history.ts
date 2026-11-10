import { getLang, getLocale, t, type Key } from '../i18n';
import { isValidEmail, isValidPhone } from '../quote/contact';
import { computeBatch, type BatchPart } from '../quote/batch';
import { formatEuro } from '../quote/format';
import {
  addEntry,
  batchFromParts,
  partSurface,
  createBatchEntry,
  createEntry,
  countWithContact,
  HISTORY_MAX,
  historyToCsv,
  removeEntry,
  withoutContact,
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
  /** Las piezas del lote (vacío si no hay lote). */
  batch(): readonly BatchPart[];
  /** Sustituye el lote por estas líneas y lo muestra. */
  openBatch(parts: readonly BatchPart[]): void;
  /** Aplica unos ajustes a la interfaz (y los guarda como los de trabajo). */
  applySettings(settings: QuoteSettings): void;
  announce(message: string): void;
  showNotice(title: string, message: string): void;
  download(blob: Blob, fileName: string): void;
  contactSave(): boolean;
  setContactSave(value: boolean): void;
}

const byId = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Falta el elemento #${id} en index.html`);
  return node as T;
};

/** Bloque «08 Presupuestos»: guardar, listar, reabrir, borrar y exportar a CSV. Todo en `localStorage`. */
export function setupHistory(host: HistoryHost): { render(): void; sync(): void } {
  const client = byId<HTMLInputElement>('in-client');
  const email = byId<HTMLInputElement>('in-client-email');
  const phone = byId<HTMLInputElement>('in-client-phone');
  const saveContact = byId<HTMLInputElement>('in-contact-save');
  const emailError = byId('err-client-email');
  const purge = byId('contact-purge');
  const purgeText = byId('contact-purge-text');
  const purgeYes = byId<HTMLButtonElement>('contact-purge-yes');
  const purgeNo = byId<HTMLButtonElement>('contact-purge-no');
  const phoneError = byId('err-client-phone');
  const note = byId<HTMLTextAreaElement>('in-quote-notes');
  const saveButton = byId<HTMLButtonElement>('history-save');
  const saveBatchButton = byId<HTMLButtonElement>('history-save-batch');
  const list = byId('history-list');
  const empty = byId('history-empty');
  const count = byId('history-count');
  const exportButton = byId<HTMLButtonElement>('history-export');
  const clearButton = byId<HTMLButtonElement>('history-clear');
  const cancelButton = byId<HTMLButtonElement>('history-cancel');

  let entries = loadHistory();
  saveContact.checked = host.contactSave();
  let confirmingClear = false;
  /** Entrada de lote cuyo «Abrir» espera confirmación (hay un lote en curso que se reemplazaría). */
  let confirmingOpen: string | null = null;
  /** El lote que había al armar la confirmación: si cambia (quitar, vaciar, copias…), la confirmación caduca. */
  let armedBatch: readonly BatchPart[] = [];
  /** `render` reemplaza los botones: el `focusout` que eso provoque no debe cancelar nada. */
  let rendering = false;

  /** Un formateador por idioma: crear uno por fila costaba más que pintar la lista. */
  const dateFormats = new Map<string, Intl.DateTimeFormat>();
  const formatDate = (iso: string): string => {
    const locale = getLocale();
    let format = dateFormats.get(locale);
    if (!format) {
      format = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
      dateFormats.set(locale, format);
    }
    return format.format(new Date(iso));
  };

  const batchName = (n: number): string => t(n === 1 ? 'hist.batch.name.one' : 'hist.batch.name', { n });

  /** Rótulo y nombre accesible de «Abrir» / «Borrar» (con la confirmación de «Abrir» de un lote en curso). */
  function labelAction(button: HTMLButtonElement, kind: 'open' | 'delete', entry: HistoryEntry, confirming: boolean): void {
    const label = { name: entry.parts ? batchName(entry.parts.length) : entry.fileName, date: formatDate(entry.savedAt) };
    button.textContent = t(confirming ? 'hist.open.confirm' : `hist.${kind}`);
    button.setAttribute('aria-label', t(confirming ? 'hist.open.confirm.label' : `hist.${kind}.label`, label));
  }

  /** Cancela la confirmación de «Abrir» devolviendo su botón al rótulo normal, sin reconstruir la lista (no se pierde el clic). */
  function disarm(): void {
    const id = confirmingOpen;
    confirmingOpen = null;
    const entry = entries.find((candidate) => candidate.id === id);
    const button = id === null ? null : list.querySelector<HTMLButtonElement>(`button[data-action="open"][data-id="${CSS.escape(id)}"]`);
    if (entry && button) labelAction(button, 'open', entry, false);
  }

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
    const kind = entry.parts ? t(entry.parts.length === 1 ? 'hist.batch.meta.one' : 'hist.batch.meta', { n: entry.parts.length }) : entry.settings.material;
    meta.textContent = [formatDate(entry.savedAt), entry.client, kind].filter((part) => part !== '').join(' · ');

    const action = (kind: 'open' | 'delete'): HTMLButtonElement => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button button--small';
      button.dataset['action'] = kind;
      button.dataset['id'] = entry.id;
      labelAction(button, kind, entry, kind === 'open' && confirmingOpen === entry.id);
      return button;
    };
    const buttons = document.createElement('div');
    buttons.className = 'history-buttons';
    // Un lote se abre si se sabe el área de todas sus piezas: guardada o, en los de v0.6, deducida del resultado
    // (`recoverSurface`). Si no cuadra, se lista, se exporta y se borra, pero no se abre.
    const canOpen = !entry.parts || entry.parts.every((piece) => partSurface(piece) !== null);
    buttons.append(...(canOpen ? [action('open')] : []), action('delete'));
    item.append(head, meta, buttons);
    return item;
  }

  /** Lo que depende de la pieza cargada: sin pieza no se puede guardar. */
  function sync(): void {
    saveButton.disabled = host.current() === null;
    saveBatchButton.disabled = host.batch().length === 0;
    if (confirmingOpen !== null && host.batch() !== armedBatch) disarm();
  }

  function render(): void {
    recheckContact(); // también al cambiar de idioma: el aviso se vuelve a escribir en el nuevo
    if (!purge.hidden) syncPurge();
    rendering = true;
    list.replaceChildren(...entries.map(row));
    rendering = false;
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

  /** Guarda una entrada nueva (de una pieza o de un lote) y lo anuncia con `name`. */
  function store(entry: HistoryEntry, name: string): void {
    const { entries: next, dropped } = addEntry(entries, entry);
    if (!saveHistory(next)) {
      host.showNotice(t('hist.save.failed.title'), t('hist.save.failed'));
      return;
    }
    entries = next;
    confirmingClear = false;
    confirmingOpen = null;
    render();
    const params = { name, total: formatEuro(entry.result.total), max: HISTORY_MAX };
    host.announce(t(dropped > 0 ? 'hist.saved.dropped' : 'hist.saved', params));
  }

  function save(): void {
    const current = host.current();
    if (!current) return;
    const contact = saveContact.checked ? { email: email.value, phone: phone.value } : {};
    const entry = createEntry({ fileName: current.fileName, client: client.value, note: note.value, ...contact, stats: current.stats, settings: current.settings, quote: current.quote });
    store(entry, entry.fileName);
  }

  function saveBatch(): void {
    const parts = host.batch();
    if (parts.length === 0) return;
    const contact = saveContact.checked ? { email: email.value, phone: phone.value } : {};
    store(createBatchEntry({ client: client.value, note: note.value, ...contact, parts }), batchName(parts.length));
  }

  /** Reabre un lote en el bloque 06. Con un lote en curso hace falta un segundo clic: se perdería. */
  function openBatch(entry: HistoryEntry, lines: readonly BatchPart[]): void {
    if (host.batch().length > 0 && confirmingOpen !== entry.id) {
      confirmingOpen = entry.id;
      armedBatch = host.batch();
      render();
      list.querySelector<HTMLButtonElement>(`button[data-action="open"][data-id="${CSS.escape(entry.id)}"]`)?.focus();
      return;
    }
    confirmingOpen = null;
    host.openBatch(lines);
    client.value = entry.client;
    note.value = entry.note ?? '';
    email.value = entry.email ?? '';
    phone.value = entry.phone ?? '';
    render();
    // Las líneas se recalculan con el modelo actual: si el total ya no es el guardado, se dice.
    const total = computeBatch(lines).total;
    const moved = Math.abs(total - entry.result.total) >= 0.005;
    host.announce(
      [
        t(lines.length === 1 ? 'hist.opened.batch.one' : 'hist.opened.batch', { n: lines.length, total: formatEuro(total) }),
        moved ? t('hist.opened.batch.before', { before: formatEuro(entry.result.total) }) : '',
      ]
        .filter((text) => text !== '')
        .join(' '),
    );
  }

  function open(entry: HistoryEntry): void {
    const lines = entry.parts && batchFromParts(entry.parts);
    if (lines) return openBatch(entry, lines);
    const hasPart = host.current() !== null;
    host.applySettings(entry.settings);
    client.value = entry.client;
    note.value = entry.note ?? '';
    email.value = entry.email ?? '';
    phone.value = entry.phone ?? '';
    recheckContact();
    host.announce(t(hasPart ? 'hist.opened.part' : 'hist.opened', { name: entry.fileName, total: formatEuro(entry.result.total) }));
  }

  function remove(entry: HistoryEntry): void {
    const next = removeEntry(entries, entry.id);
    if (!saveHistory(next)) {
      host.showNotice(t('hist.save.failed.title'), t('hist.save.failed'));
      return;
    }
    entries = next;
    confirmingOpen = null;
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
  saveBatchButton.addEventListener('click', saveBatch);
  /** Pregunta (al desmarcar la casilla) si se quita el contacto de los presupuestos ya guardados; el texto, en el idioma activo. */
  function syncPurge(): void {
    const n = countWithContact(entries);
    if (saveContact.checked || n === 0) {
      purge.hidden = true;
      return;
    }
    purgeText.textContent = n === 1 ? t('hist.contactPurge.one') : t('hist.contactPurge', { n });
  }
  saveContact.addEventListener('change', () => {
    host.setContactSave(saveContact.checked);
    const ask = !saveContact.checked && countWithContact(entries) > 0;
    purge.hidden = !ask;
    syncPurge();
    if (ask) purgeYes.focus();
  });
  purgeYes.addEventListener('click', () => {
    const n = countWithContact(entries);
    const next = withoutContact(entries);
    if (!saveHistory(next)) {
      host.showNotice(t('hist.save.failed.title'), t('hist.save.failed'));
      return;
    }
    entries = next;
    purge.hidden = true;
    render();
    saveContact.focus();
    host.announce(n === 1 ? t('hist.contactPurged.one') : t('hist.contactPurged', { n }));
  });
  purgeNo.addEventListener('click', () => {
    purge.hidden = true;
    saveContact.focus();
  });
  const validate = (input: HTMLInputElement, error: HTMLElement, valid: (value: string) => boolean, key: Key): void => {
    if (input.value === '' || valid(input.value)) {
      input.removeAttribute('aria-invalid');
      error.textContent = '';
    } else {
      input.setAttribute('aria-invalid', 'true');
      error.textContent = t(key);
    }
  };
  let emailWarned = false;
  let phoneWarned = false;
  email.addEventListener('input', () => {
    if (emailWarned) validate(email, emailError, isValidEmail, 'hist.email.invalid');
  });
  phone.addEventListener('input', () => {
    if (phoneWarned) validate(phone, phoneError, isValidPhone, 'hist.phone.invalid');
  });
  const checkEmail = (): void => {
    emailWarned = true;
    validate(email, emailError, isValidEmail, 'hist.email.invalid');
  };
  const checkPhone = (): void => {
    phoneWarned = true;
    validate(phone, phoneError, isValidPhone, 'hist.phone.invalid');
  };
  /** Rehace los avisos que ya se mostraron (valores nuevos al abrir un presupuesto, otro idioma). Nunca bloquea nada. */
  function recheckContact(): void {
    if (emailWarned) validate(email, emailError, isValidEmail, 'hist.email.invalid');
    if (phoneWarned) validate(phone, phoneError, isValidPhone, 'hist.phone.invalid');
  }
  email.addEventListener('blur', checkEmail);
  email.addEventListener('change', checkEmail);
  phone.addEventListener('blur', checkPhone);
  phone.addEventListener('change', checkPhone);
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
  // Salir del botón de confirmación (Tab, clic fuera) la cancela.
  list.addEventListener('focusout', () => {
    if (!rendering) disarm();
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
    confirmingOpen = null;
    render();
    host.announce(t('hist.cleared'));
  });
  cancelButton.addEventListener('click', stopConfirming);

  render();
  return { render, sync };
}
