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

  it('guarda el lote con su cliente: una fila sin «Abrir», con «Lote de N piezas» y el total; se anuncia y persiste', async () => {
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
    expect(row.querySelector('button[data-action="open"]')).toBeNull();
    expect(row.querySelector('button[data-action="delete"]')).not.toBeNull();
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
    expect(rows()[1]?.querySelector('button[data-action="open"]')).toBeNull(); // el lote

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
});
