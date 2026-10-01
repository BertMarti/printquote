// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../src/i18n';
import { startApp } from '../src/ui/app';
import { binaryStl, cubeTriangles } from './helpers/mesh';

const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
const body = (html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, '');
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const button = (id: string): HTMLButtonElement => $<HTMLButtonElement>(id);

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

describe('imprimir el lote', () => {
  const print = vi.fn();

  async function start(withPart = true): Promise<void> {
    document.body.innerHTML = body;
    startApp();
    if (withPart) {
      $('sample-button').click();
      await until(() => $('out-total').textContent !== '—');
    }
  }

  /** Dos piezas distintas en el lote (3 copias de PLA y 1 de PETG). */
  function addTwo(): void {
    type('in-copies', '3');
    button('batch-add').click();
    type('in-copies', '1');
    document.querySelector<HTMLInputElement>('input[name="material"][value="PETG"]')?.click();
    button('batch-add').click();
  }

  beforeEach(() => {
    print.mockClear();
    window.print = print;
    vi.stubGlobal('Worker', undefined);
    window.localStorage.clear();
    setLang('es');
    const stl = binaryStl(cubeTriangles(20));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stl.slice(0))));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('con un lote no vacío, «Imprimir» imprime el lote: tabla de piezas, desglose y total, sin vista 3D', async () => {
    await start();
    addTwo();
    expect(button('print-button').textContent).toBe('Imprimir lote');
    button('print-button').click();
    expect(print).toHaveBeenCalledTimes(1);

    const sheet = $('print-sheet');
    const rows = Array.from(sheet.querySelectorAll('.ps-parts tbody tr'));
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('soporte-movil.stl');
    expect(rows[0]?.textContent).toContain('PLA');
    expect(rows[1]?.textContent).toContain('PETG');
    const copies = rows.map((tr) => tr.children[2]?.textContent);
    expect(copies).toEqual(['3', '1']);
    // Cada importe es el de su línea en la lista; el total, el del bloque 06.
    const amounts = rows.map((tr) => tr.lastElementChild?.textContent);
    const listed = Array.from($('batch-list').children).map((li) => li.querySelector('.history-total')?.textContent);
    expect(amounts).toEqual(listed);
    expect(sheet.querySelector('.ps-total')?.textContent?.replace(/\s/g, ' ')).toContain(`${$('out-batch-total').textContent} €`);
    expect(sheet.textContent).toContain('Total del lote');
    expect(sheet.querySelector('img')).toBeNull();
    // Cada columna tiene su cabecera.
    expect(Array.from(sheet.querySelectorAll('.ps-parts thead th')).map((th) => th.getAttribute('scope'))).toEqual(Array(6).fill('col'));
  });

  it('sin lote, «Imprimir» sigue imprimiendo la pieza (desglose de una pieza, no el del lote)', async () => {
    await start();
    expect(button('print-button').textContent).toBe('Imprimir');
    button('print-button').click();
    expect(print).toHaveBeenCalledTimes(1);
    expect($('print-sheet').querySelector('.ps-parts')).toBeNull();
    expect($('print-sheet').textContent).toContain('Desglose');
    // Quitar la última pieza del lote vuelve a la hoja de la pieza.
    button('batch-add').click();
    expect(button('print-button').textContent).toBe('Imprimir lote');
    $('batch-list').querySelector<HTMLButtonElement>('button[data-id]')?.click();
    expect(button('print-button').textContent).toBe('Imprimir');
  });

  it('un lote reabierto o recuperado se imprime sin pieza 3D cargada', async () => {
    await start();
    addTwo();
    await start(false); // «recargar»: el lote vuelve, la pieza no
    expect(button('copy-button').disabled).toBe(true);
    expect(button('print-button').disabled).toBe(false);
    expect(button('print-button').textContent).toBe('Imprimir lote');
    button('print-button').click();
    expect($('print-sheet').querySelectorAll('.ps-parts tbody tr')).toHaveLength(2);
  });

  it('sin pieza y sin lote, «Imprimir» sigue desactivado', async () => {
    await start(false);
    expect(button('print-button').disabled).toBe(true);
  });

  it('Ctrl+P (beforeprint) también imprime el lote', async () => {
    await start();
    addTwo();
    window.dispatchEvent(new Event('beforeprint'));
    expect($('print-sheet').querySelectorAll('.ps-parts tbody tr')).toHaveLength(2);
  });

  it('el nombre del archivo nunca se interpreta como HTML', async () => {
    document.body.innerHTML = body;
    startApp();
    const evil = '<img src=x onerror=alert(1)>.stl';
    const input = $<HTMLInputElement>('file-input');
    Object.defineProperty(input, 'files', { value: [new File([binaryStl(cubeTriangles(20))], evil)], configurable: true });
    input.dispatchEvent(new Event('change'));
    await until(() => $('out-total').textContent !== '—');
    button('batch-add').click();
    button('print-button').click();
    expect($('print-sheet').querySelector('img')).toBeNull();
    expect($('print-sheet').querySelector('.ps-parts tbody th')?.textContent).toBe(evil);
  });

  it('en inglés el botón y la hoja salen en inglés', async () => {
    await start();
    addTwo();
    document.querySelector<HTMLButtonElement>('button[data-lang="en"]')?.click();
    expect(button('print-button').textContent).toBe('Print batch');
    button('print-button').click();
    expect($('print-sheet').textContent).toContain('Batch total');
    expect($('print-sheet').textContent).not.toContain('Total del lote');
  });
});
