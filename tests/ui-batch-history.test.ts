// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../src/i18n';
import { startApp } from '../src/ui/app';
import { loadHistory } from '../src/ui/storage';
import { binaryStl, cubeTriangles } from './helpers/mesh';

const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
const body = (html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, '');
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const button = (id: string): HTMLButtonElement => $<HTMLButtonElement>(id);
const rows = (): HTMLElement[] => Array.from($('history-list').children) as HTMLElement[];

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(check()).toBe(true);
}

function type(id: string, value: string): void {
  const input = $<HTMLInputElement>(id);
  input.value = value;
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new Event('change'));
}

describe('lote en el historial (interfaz)', () => {
  const created: Blob[] = [];
  const downloads: string[] = [];

  beforeEach(async () => {
    created.length = 0;
    downloads.length = 0;
    vi.stubGlobal('Worker', undefined);
    window.localStorage.clear();
    setLang('es');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: (blob: Blob) => (created.push(blob), 'blob:test'), revokeObjectURL: () => {} }));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
    const stl = binaryStl(cubeTriangles(20));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stl.slice(0))));
    document.body.innerHTML = body;
    startApp();
    $('sample-button').click();
    await until(() => $('out-total').textContent !== '—');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('«Guardar lote» solo se activa con piezas en el lote', () => {
    expect(button('history-save-batch').disabled).toBe(true);
    button('batch-add').click();
    expect(button('history-save-batch').disabled).toBe(false);
    $('batch-list').querySelector<HTMLButtonElement>('button[data-id]')?.click();
    expect(button('history-save-batch').disabled).toBe(true);
  });

  it('guarda el lote con su cliente: una fila con «Abrir», con «Lote de N piezas» y el total; se anuncia y persiste', async () => {
    type('in-copies', '3');
    button('batch-add').click();
    type('in-copies', '1');
    document.querySelector<HTMLInputElement>('input[name="material"][value="PETG"]')?.click();
    button('batch-add').click();
    type('in-client', 'Taller Ruiz');
    button('history-save-batch').click();

    expect(rows()).toHaveLength(1);
    const row = rows()[0] as HTMLElement;
    expect(row.querySelector('.history-meta')?.textContent).toContain('Taller Ruiz');
    expect(row.querySelector('.history-meta')?.textContent).toContain('Lote de 2 piezas');
    expect(row.querySelector('.history-total')?.textContent).toBe($('out-batch-total').textContent + ' €');
    expect(row.querySelector('button[data-action="open"]')?.getAttribute('aria-label')).toMatch(/^Abrir el presupuesto de lote de 2 piezas del /);
    expect(row.querySelector('button[data-action="delete"]')).not.toBeNull();
    expect(row.querySelector('button[data-action="delete"]')?.getAttribute('aria-label')).toMatch(/^Borrar el presupuesto de lote de 2 piezas del /);
    await until(() => /lote de 2 piezas/.test($('live-status').textContent ?? ''));

    const stored = loadHistory();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.parts).toHaveLength(2);
    expect(stored[0]?.parts?.[0]?.settings.copies).toBe(3);
    expect(stored[0]?.parts?.[1]?.settings.material).toBe('PETG');
    expect(stored[0]?.client).toBe('Taller Ruiz');
  });

  it('un lote guardado y una pieza suelta conviven; el lote se borra y el CSV lleva una fila por pieza', async () => {
    button('batch-add').click();
    button('batch-add').click();
    button('history-save-batch').click();
    button('history-save').click();
    expect(rows()).toHaveLength(2);
    expect(rows()[0]?.querySelector('button[data-action="open"]')).not.toBeNull(); // la pieza suelta, la más reciente
    expect(rows()[1]?.querySelector('button[data-action="open"]')).not.toBeNull(); // el lote también se abre

    button('history-export').click();
    const blob = created[0];
    if (!blob) throw new Error('no se creó el CSV');
    const csv = await blob.text();
    expect(csv.split('\r\n').filter((l) => l !== '')).toHaveLength(1 + 1 + 2); // cabecera, pieza suelta, 2 del lote

    rows()[1]?.querySelector<HTMLButtonElement>('button[data-action="delete"]')?.click();
    expect(rows()).toHaveLength(1);
    expect(loadHistory()).toHaveLength(1);
  });

  it('guardar el lote no vacía el lote ni cambia el enlace para compartir', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => {}) }, configurable: true });
    button('batch-add').click();
    button('history-save-batch').click();
    expect($('batch-list').children).toHaveLength(1);
    button('share-copy').click();
    const writeText = navigator.clipboard.writeText as ReturnType<typeof vi.fn>;
    await until(() => writeText.mock.calls.length > 0);
    expect(String((writeText.mock.calls[0] as unknown[])[0])).not.toMatch(/soporte|parts|batch|lote/i);
  });

  /** Guarda un lote de dos piezas distintas (3 copias de PLA y PETG) con cliente y devuelve su total y nombres. */
  function saveTwoPartBatch(): { total: string | null; names: (string | null | undefined)[] } {
    type('in-copies', '3');
    button('batch-add').click();
    type('in-copies', '1');
    document.querySelector<HTMLInputElement>('input[name="material"][value="PETG"]')?.click();
    button('batch-add').click();
    type('in-client', 'Taller Ruiz');
    button('history-save-batch').click();
    const items = Array.from($('batch-list').children);
    return { total: $('out-batch-total').textContent, names: items.map((item) => item.querySelector('.history-name')?.textContent) };
  }

  const emptyBatch = (): void => {
    button('batch-clear').click();
    button('batch-clear').click();
  };
  const reload = (): void => {
    document.body.innerHTML = body;
    startApp();
  };

  it('«Abrir» un lote guardado lo carga en el bloque 06 sin pieza 3D, con cliente y mismos importes', async () => {
    const saved = saveTwoPartBatch();
    emptyBatch();
    reload(); // sin pieza cargada
    expect(button('history-save').disabled).toBe(true);
    expect($<HTMLInputElement>('in-client').value).toBe('');

    rows()[0]?.querySelector<HTMLButtonElement>('button[data-action="open"]')?.click();
    const items = Array.from($('batch-list').children);
    expect(items).toHaveLength(2);
    expect($('out-batch-total').textContent).toBe(saved.total);
    expect(items.map((item) => item.querySelector('.history-name')?.textContent)).toEqual(saved.names);
    expect(items[0]?.querySelector('.history-meta')?.textContent).toMatch(/3 copias/);
    expect($<HTMLDetailsElement>('batch-details').open).toBe(true);
    expect($<HTMLInputElement>('in-client').value).toBe('Taller Ruiz');
    expect(button('batch-copy').disabled).toBe(false);
    expect(window.localStorage.getItem('printquote:lote:v1')).not.toBeNull();
    await until(() => /Lote de 2 piezas abierto/.test($('live-status').textContent ?? ''));
    // Las líneas reabiertas son editables como las demás: se quitan.
    $('batch-list').querySelector<HTMLButtonElement>('button[data-id]')?.click();
    expect($('batch-list').children).toHaveLength(1);
  });

  it('con un lote en curso, «Abrir» pide confirmar con un segundo clic antes de reemplazarlo', async () => {
    saveTwoPartBatch();
    button('batch-add').click(); // ahora hay 3 en el lote
    const open = (): HTMLButtonElement => rows()[0]?.querySelector('button[data-action="open"]') as HTMLButtonElement;
    open().click();
    expect($('batch-list').children).toHaveLength(3);
    expect(open().textContent).toBe('¿Reemplazar el lote?');
    expect(open().getAttribute('aria-label')).toMatch(/^Reemplazar el lote actual por lote de 2 piezas del /);
    expect(document.activeElement).toBe(open());
    open().click();
    expect($('batch-list').children).toHaveLength(2);
    expect(open().textContent).toBe('Abrir');
    await until(() => /Lote de 2 piezas abierto/.test($('live-status').textContent ?? ''));
  });

  it('la confirmación de «Abrir» se cancela al cambiar la lista (por ejemplo, guardar otra cosa)', () => {
    saveTwoPartBatch();
    button('batch-add').click();
    const open = (): HTMLButtonElement => rows()[0]?.querySelector('button[data-action="open"]') as HTMLButtonElement;
    open().click();
    expect(open().textContent).toBe('¿Reemplazar el lote?');
    button('history-save').click();
    expect(rows()[1]?.querySelector('button[data-action="open"]')?.textContent).toBe('Abrir');
  });

  it('un lote guardado con v0.6 (sin área) se sigue listando y borrando, pero no se abre', () => {
    saveTwoPartBatch();
    const entries = loadHistory().map((entry) => ({
      ...entry,
      surfaceMm2: undefined,
      parts: entry.parts?.map((piece) => ({ ...piece, surfaceMm2: undefined })),
    }));
    window.localStorage.setItem('printquote:historial:v1', JSON.stringify(entries));
    reload();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.querySelector('.history-meta')?.textContent).toContain('Lote de 2 piezas');
    expect(rows()[0]?.querySelector('button[data-action="open"]')).toBeNull();
    rows()[0]?.querySelector<HTMLButtonElement>('button[data-action="delete"]')?.click();
    expect(rows()).toHaveLength(0);
  });
});
