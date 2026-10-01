// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../src/i18n';
import { BATCH_MAX } from '../src/quote/batch';
import { startApp } from '../src/ui/app';
import { binaryStl, cubeTriangles } from './helpers/mesh';

const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
const body = (html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, '');
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const button = (id: string): HTMLButtonElement => $<HTMLButtonElement>(id);
const items = (): HTMLElement[] => Array.from($('batch-list').children) as HTMLElement[];
const removeButtons = (): HTMLButtonElement[] => Array.from($('batch-list').querySelectorAll<HTMLButtonElement>('button[data-id]'));
const euros = (text: string | null | undefined): number => Number((text ?? '').replace(/[^\d,]/g, '').replace(',', '.'));

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

describe('lote en la interfaz', () => {
  async function start(withPart = true): Promise<void> {
    document.body.innerHTML = body;
    startApp();
    if (withPart) {
      $('sample-button').click();
      await until(() => $('out-total').textContent !== '—');
    }
  }

  beforeEach(() => {
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

  it('el bloque 06 es plegable, empieza plegado y vacío, y «Añadir» no se puede usar sin pieza', async () => {
    await start(false);
    const details = $<HTMLDetailsElement>('batch-details');
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')?.textContent).toMatch(/06\s*Lote/);
    expect(button('batch-add').disabled).toBe(true);
    expect(items()).toHaveLength(0);
    expect($('batch-empty').hidden).toBe(false);
    expect($('batch-summary').hidden).toBe(true);
    expect(button('batch-clear').disabled).toBe(true);
    // Los bloques de después se renumeran.
    expect($('h-business').textContent).toMatch(/07/);
    expect($('h-history').textContent).toMatch(/08/);
  });

  it('con pieza, el botón muestra el importe; al añadir se abre el bloque y aparece la línea con su total', async () => {
    await start();
    expect(button('batch-add').disabled).toBe(false);
    expect(button('batch-add').textContent).toBe(`Añadir esta pieza · ${$('out-total').textContent}`);
    button('batch-add').click();
    expect($<HTMLDetailsElement>('batch-details').open).toBe(true);
    expect(items()).toHaveLength(1);
    expect(items()[0]?.textContent).toContain('soporte-movil.stl');
    expect(items()[0]?.querySelector('.history-total')?.textContent).toBe($('out-total').textContent);
    expect(euros($('out-batch-total').textContent)).toBe(euros($('out-total').textContent));
    expect($('batch-count').textContent).toBe('(1)');
    expect($('batch-summary').hidden).toBe(false);
  });

  it('cada línea conserva los ajustes con que se añadió y el total del lote suma las líneas', async () => {
    await start();
    button('batch-add').click();
    const first = items()[0]?.querySelector('.history-total')?.textContent;
    type('in-copies', '4');
    document.querySelector<HTMLInputElement>('input[name="material"][value="PETG"]')?.click();
    button('batch-add').click();
    expect(items()).toHaveLength(2);
    expect(items()[0]?.querySelector('.history-total')?.textContent).toBe(first); // la primera no cambia
    expect(items()[1]?.querySelector('.history-meta')?.textContent).toMatch(/PETG.*4 copias/);
    expect(items()[0]?.querySelector('.history-meta')?.textContent).toMatch(/PLA.*1 copia$/);
    const sum = items().reduce((acc, li) => acc + euros(li.querySelector('.history-total')?.textContent), 0);
    expect(euros($('out-batch-total').textContent)).toBeCloseTo(sum, 2);
    expect($('out-batch-copies').textContent).toBe('5');
  });

  it('quitar recalcula, mueve el foco y anuncia; sin piezas vuelve al estado vacío', async () => {
    await start();
    button('batch-add').click();
    type('in-copies', '3');
    button('batch-add').click();
    type('in-copies', '2');
    button('batch-add').click();
    expect(items()).toHaveLength(3);
    const before = $('out-batch-total').textContent;

    const middle = removeButtons()[1];
    expect(middle?.getAttribute('aria-label')).toBe('Quitar soporte-movil.stl del lote');
    middle?.click();
    expect(items()).toHaveLength(2);
    expect($('out-batch-total').textContent).not.toBe(before);
    expect(document.activeElement).toBe(removeButtons()[1]); // el «Quitar» que ocupa su sitio
    await until(() => /Quedan 2/.test($('live-status').textContent ?? ''));

    removeButtons()[1]?.click();
    expect(document.activeElement).toBe(removeButtons()[0]); // era el último: el anterior
    removeButtons()[0]?.click();
    expect(items()).toHaveLength(0);
    expect($('batch-empty').hidden).toBe(false);
    expect($('batch-summary').hidden).toBe(true);
    expect($('batch-count').textContent).toBe('');
    expect(document.activeElement).toBe(button('batch-add'));
    await until(() => /vacío/.test($('live-status').textContent ?? ''));
  });

  it('«Vaciar lote» pide un segundo clic y se puede cancelar', async () => {
    await start();
    button('batch-add').click();
    button('batch-add').click();
    button('batch-clear').click();
    expect(button('batch-clear').textContent).toBe('Confirmar: quitar las 2');
    expect(button('batch-cancel').hidden).toBe(false);
    button('batch-cancel').click();
    expect(items()).toHaveLength(2);
    expect(button('batch-cancel').hidden).toBe(true);
    button('batch-clear').click();
    button('batch-clear').click();
    expect(items()).toHaveLength(0);
    expect(button('batch-clear').textContent).toBe('Vaciar lote');
  });

  it('con 50 piezas el botón se desactiva', async () => {
    await start();
    for (let i = 0; i < BATCH_MAX; i++) button('batch-add').click();
    expect(items()).toHaveLength(BATCH_MAX);
    expect(button('batch-add').disabled).toBe(true);
    expect(button('batch-add').textContent).toBe('Lote lleno (50 piezas)');
    removeButtons()[0]?.click();
    expect(button('batch-add').disabled).toBe(false);
  });

  it('al añadir la pieza 50 se anuncia «Lote lleno» y el foco no se queda en el botón desactivado', async () => {
    await start();
    for (let i = 0; i < BATCH_MAX; i++) button('batch-add').click();
    expect(button('batch-add').disabled).toBe(true);
    await until(() => /Lote lleno/.test($('live-status').textContent ?? ''));
    expect(document.activeElement).toBe(button('batch-copy'));
  });

  it('el nombre del archivo nunca se interpreta como HTML', async () => {
    document.body.innerHTML = body;
    startApp();
    const evil = '<img src=x onerror=alert(1)>.stl';
    const file = new File([binaryStl(cubeTriangles(20))], evil);
    const input = $<HTMLInputElement>('file-input');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await until(() => $('out-total').textContent !== '—');
    button('batch-add').click();
    expect($('batch-list').querySelector('img')).toBeNull();
    expect(items()[0]?.querySelector('.history-name')?.textContent).toBe(evil);
  });

  it('el enlace para compartir lleva solo parámetros, con o sin lote', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await start();
    const copied = async (): Promise<string> => {
      writeText.mockClear();
      button('share-copy').click();
      await until(() => writeText.mock.calls.length > 0);
      return String((writeText.mock.calls[0] as unknown[])[0]);
    };
    const without = await copied();
    button('batch-add').click();
    expect(await copied()).toBe(without);
    expect(without).toContain('#v=1&');
    expect(without).not.toMatch(/soporte|parts|batch|lote/i);
  });
});
