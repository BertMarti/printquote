// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEntry, HISTORY_MAX } from '../src/quote/history';
import { computeQuote } from '../src/quote/model';
import { DEFAULT_SETTINGS } from '../src/quote/settings';
import { computeStats } from '../src/stl/geometry';
import { startApp } from '../src/ui/app';
import { loadHistory } from '../src/ui/storage';
import { binaryStl, cubeTriangles, toPositions } from './helpers/mesh';

const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
const body = (html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, '');
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const STORAGE_KEY = 'printquote:historial:v1';
const stats = computeStats({ positions: toPositions(cubeTriangles(20)), triangleCount: 12, format: 'binary' });

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(check()).toBe(true);
}

function type(id: string, value: string): void {
  const input = $<HTMLInputElement>(id);
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

const rows = (): HTMLElement[] => Array.from($('history-list').children) as HTMLElement[];
const button = (id: string): HTMLButtonElement => $<HTMLButtonElement>(id);

describe('historial de presupuestos en la interfaz', () => {
  const created: Blob[] = [];
  const downloads: string[] = [];

  async function start(withPart = true): Promise<void> {
    document.body.innerHTML = body;
    startApp();
    if (withPart) {
      $('sample-button').click();
      await until(() => $('out-total').textContent !== '—');
    }
  }

  beforeEach(() => {
    created.length = 0;
    downloads.length = 0;
    vi.stubGlobal('Worker', undefined);
    window.localStorage.clear();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: (blob: Blob) => (created.push(blob), 'blob:test'), revokeObjectURL: () => {} }));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
    const stl = binaryStlOfCube();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stl.slice(0))));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('el bloque 08 es plegable, empieza plegado y vacío, y «Guardar» no se puede usar sin pieza', async () => {
    await start(false);
    const details = $<HTMLDetailsElement>('history-details');
    expect(details.tagName).toBe('DETAILS');
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')?.textContent).toMatch(/08\s*Presupuestos/);
    expect(button('history-save').disabled).toBe(true);
    expect(rows()).toHaveLength(0);
    expect($('history-empty').hidden).toBe(false);
    expect(button('history-export').disabled).toBe(true);
    expect(button('history-clear').disabled).toBe(true);
    expect(document.querySelector('label[for="in-client"]')).not.toBeNull();
  });

  it('guarda con cliente: aparece en la lista con pieza, total y cliente, y se anuncia', async () => {
    await start();
    expect(button('history-save').disabled).toBe(false);
    type('in-client', 'Ana Pérez');
    button('history-save').click();

    expect(rows()).toHaveLength(1);
    const text = rows()[0]?.textContent ?? '';
    expect(text).toContain('soporte-movil.stl');
    expect(text).toContain('Ana Pérez');
    expect(text.replace(/\u00a0/g, ' ')).toContain('0,10 €');
    expect($('history-count').textContent).toBe('(1)');
    expect($('history-empty').hidden).toBe(true);
    expect(button('history-export').disabled).toBe(false);
    await until(() => /Presupuesto guardado: soporte-movil\.stl, 0,10\s€/.test($('live-status').textContent ?? ''));

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]') as { client: string }[];
    expect(stored).toHaveLength(1);
    expect(stored[0]?.client).toBe('Ana Pérez');
  });

  it('guarda sin cliente, y lo guardado sigue ahí al recargar la página', async () => {
    await start();
    button('history-save').click();
    button('history-save').click();
    expect(rows()).toHaveLength(2);
    expect(rows()[0]?.textContent).not.toContain('·  ·');

    await start(false); // «recarga»
    expect(rows()).toHaveLength(2);
    expect($('history-count').textContent).toBe('(2)');
    expect(loadHistory()).toHaveLength(2);
  });

  it('abrir restaura material, impresora, relleno y copias, y el cliente, y lo anuncia', async () => {
    await start();
    document.querySelector<HTMLInputElement>('input[name="material"][value="PETG"]')?.click();
    const printer = $<HTMLSelectElement>('in-printer');
    printer.value = 'bambu-a1';
    printer.dispatchEvent(new Event('change'));
    type('in-infill', '35');
    type('in-copies', '3');
    type('in-client', 'Taller Sur');
    button('history-save').click();

    // Se cambia todo y se abre el guardado.
    document.querySelector<HTMLInputElement>('input[name="material"][value="ABS"]')?.click();
    printer.value = 'custom';
    printer.dispatchEvent(new Event('change'));
    type('in-infill', '10');
    type('in-copies', '1');
    type('in-client', 'otro');
    rows()[0]?.querySelector<HTMLButtonElement>('button[data-action="open"]')?.click();

    expect(document.querySelector<HTMLInputElement>('input[name="material"]:checked')?.value).toBe('PETG');
    expect($<HTMLSelectElement>('in-printer').value).toBe('bambu-a1');
    expect($<HTMLInputElement>('in-infill').value).toBe('35');
    expect($<HTMLInputElement>('in-copies').value).toBe('3');
    expect($<HTMLInputElement>('in-client').value).toBe('Taller Sur');
    await until(() => /Parámetros de «soporte-movil\.stl» restaurados y aplicados a la pieza cargada\. El total guardado era/.test($('live-status').textContent ?? ''));
  });

  it('sin pieza cargada, abrir avisa de que hay que arrastrar la pieza', async () => {
    await start();
    button('history-save').click();
    await start(false);
    rows()[0]?.querySelector<HTMLButtonElement>('button[data-action="open"]')?.click();
    await until(() => /Arrastra la pieza para recalcular; el total guardado era 0,10\s€/.test($('live-status').textContent ?? ''));
  });

  it('borra una entrada, y «Borrar todos» pide confirmación antes de borrar', async () => {
    await start();
    button('history-save').click();
    button('history-save').click();
    button('history-save').click();
    expect(rows()).toHaveLength(3);

    rows()[1]?.querySelector<HTMLButtonElement>('button[data-action="delete"]')?.click();
    expect(rows()).toHaveLength(2);
    expect(loadHistory()).toHaveLength(2);
    await until(() => /Presupuesto borrado: soporte-movil\.stl/.test($('live-status').textContent ?? ''));

    button('history-clear').click(); // primer paso: pide confirmar, no borra
    expect(rows()).toHaveLength(2);
    expect(button('history-clear').textContent).toBe('Confirmar: borrar los 2');
    expect($('history-cancel').hidden).toBe(false);
    button('history-cancel').click();
    expect(button('history-clear').textContent).toBe('Borrar todos');
    expect($('history-cancel').hidden).toBe(true);
    expect(rows()).toHaveLength(2);

    button('history-clear').click();
    button('history-clear').click(); // segundo paso: borra
    expect(rows()).toHaveLength(0);
    expect(loadHistory()).toEqual([]);
    expect($('history-empty').hidden).toBe(false);
    expect($('history-count').textContent).toBe('');
    await until(() => /Todos los presupuestos se han borrado/.test($('live-status').textContent ?? ''));
  });

  it('exporta un CSV con BOM, cabecera y una fila por presupuesto', async () => {
    await start();
    type('in-client', 'Ana; "la del taller"');
    button('history-save').click();
    button('history-export').click();

    expect(downloads).toHaveLength(1);
    expect(downloads[0]).toMatch(/^presupuestos-\d{4}-\d{2}-\d{2}\.csv$/);
    const blob = created[0];
    if (!blob) throw new Error('no se creó el archivo');
    expect(blob.type).toMatch(/text\/csv/);
    const text = await blob.text();
    expect(text.startsWith('\uFEFFFecha;Cliente;Pieza;')).toBe(true);
    const lines = text.slice(1).split('\r\n');
    expect(lines).toHaveLength(3); // cabecera, una fila y el final
    expect(lines[1]).toContain('"Ana; ""la del taller"""');
    expect(lines[1]).toContain(';soporte-movil.stl;');
  });

  it('el CSV sale en el idioma activo', async () => {
    await start();
    button('history-save').click();
    document.querySelector<HTMLButtonElement>('button[data-lang="en"]')?.click();
    button('history-export').click();
    const text = await (created[0] as Blob).text();
    expect(text.startsWith('\uFEFFDate,Client,Part,')).toBe(true);
    expect(text).toContain('Custom,');
    document.querySelector<HTMLButtonElement>('button[data-lang="es"]')?.click();
  });

  it('el texto de la pieza y del cliente nunca se interpreta como HTML', async () => {
    await start();
    type('in-client', '<img src=x onerror="window.__xss=1">');
    button('history-save').click();
    expect(rows()[0]?.querySelector('img')).toBeNull();
    expect(rows()[0]?.textContent).toContain('<img src=x onerror="window.__xss=1">');
  });

  it('si el navegador no deja guardar, avisa y no se pierde lo que había', async () => {
    await start();
    button('history-save').click();
    const set = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('lleno', 'QuotaExceededError');
    });
    try {
      button('history-save').click();
      expect(set).toHaveBeenCalled();
    } finally {
      set.mockRestore();
    }
    expect(rows()).toHaveLength(1);
    expect($('notice').hidden).toBe(false);
    expect($('notice').textContent).toMatch(/No se ha podido guardar/);
  });

  it(`con ${HISTORY_MAX} guardados, al guardar otro se descarta el más antiguo y se dice`, async () => {
    // Ya hay 100 guardados (en el almacenamiento, como si vinieran de otras sesiones).
    const seeded = Array.from({ length: HISTORY_MAX }, (_, i) =>
      createEntry({ fileName: `pieza-${i}.stl`, client: '', stats, settings: DEFAULT_SETTINGS, quote: computeQuote(stats, DEFAULT_SETTINGS), id: `seed-${i}` }),
    );
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    await start();
    expect(rows()).toHaveLength(HISTORY_MAX);
    type('in-client', 'el 101');
    button('history-save').click();
    expect(rows()).toHaveLength(HISTORY_MAX);
    expect(rows()[0]?.textContent).toContain('el 101');
    await until(() => /Se ha descartado el más antiguo: el máximo es 100/.test($('live-status').textContent ?? ''));
  });

  it('en inglés, los botones de cada fila llevan nombre accesible con la pieza y la fecha', async () => {
    await start();
    button('history-save').click();
    document.querySelector<HTMLButtonElement>('button[data-lang="en"]')?.click();
    const open = rows()[0]?.querySelector<HTMLButtonElement>('button[data-action="open"]');
    expect(open?.textContent).toBe('Open');
    expect(open?.getAttribute('aria-label')).toMatch(/^Open the quote for soporte-movil\.stl from /);
    expect(button('history-save').textContent).toBe('Save this quote');
    document.querySelector<HTMLButtonElement>('button[data-lang="es"]')?.click();
  });
});

function binaryStlOfCube(): ArrayBuffer {
  return binaryStl(cubeTriangles(20));
}
