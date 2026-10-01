// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../src/i18n';
import { startApp } from '../src/ui/app';
import { fontResponse } from './helpers/fonts';
import { binaryStl, cubeTriangles } from './helpers/mesh';

const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
const body = (html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, '');
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const button = (id: string): HTMLButtonElement => $<HTMLButtonElement>(id);

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 600 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(check()).toBe(true);
}

function type(id: string, value: string): void {
  const input = $<HTMLInputElement>(id);
  input.value = value;
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new Event('change'));
}

describe('lote: copiar y PDF en la interfaz', () => {
  const created: Blob[] = [];
  const downloads: string[] = [];
  const written: string[] = [];

  beforeEach(async () => {
    created.length = 0;
    downloads.length = 0;
    written.length = 0;
    vi.stubGlobal('Worker', undefined);
    window.localStorage.clear();
    setLang('es');
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(async (text: string) => void written.push(text)) },
      configurable: true,
    });
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: (blob: Blob) => (created.push(blob), 'blob:test'), revokeObjectURL: () => {} }));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
    const stl = binaryStl(cubeTriangles(20));
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => fontResponse(url) ?? new Response(stl.slice(0))));
    document.body.innerHTML = body;
    startApp();
    $('sample-button').click();
    await until(() => $('out-total').textContent !== '—');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('«Copiar lote» y «PDF del lote» están desactivados con el lote vacío y se activan al añadir', () => {
    expect(button('batch-copy').disabled).toBe(true);
    expect(button('batch-pdf').disabled).toBe(true);
    button('batch-add').click();
    expect(button('batch-copy').disabled).toBe(false);
    expect(button('batch-pdf').disabled).toBe(false);
    $('batch-list').querySelector<HTMLButtonElement>('button[data-id]')?.click();
    expect(button('batch-copy').disabled).toBe(true);
    expect(button('batch-pdf').disabled).toBe(true);
  });

  it('«Copiar lote» copia el texto con todas las piezas y el total del lote, y lo anuncia', async () => {
    button('batch-add').click();
    type('in-copies', '3');
    document.querySelector<HTMLInputElement>('input[name="material"][value="PETG"]')?.click();
    button('batch-add').click();
    button('batch-copy').click();
    await until(() => written.length === 1);
    const text = written[0] ?? '';
    expect(text).toContain('PIEZA 1 DE 2');
    expect(text).toContain('PIEZA 2 DE 2');
    expect(text).toContain('PETG');
    expect(text).toContain('TOTAL DEL LOTE');
    expect(text.replace(/\s/g, ' ')).toContain($('out-batch-total').textContent ?? '??');
    await until(() => button('batch-copy').textContent === 'Copiado');
    await until(() => /Lote copiado/.test($('live-status').textContent ?? ''));
    // La pieza suelta sigue copiando solo la pieza.
    button('copy-button').click();
    await until(() => written.length === 2);
    expect(written[1]).not.toContain('TOTAL DEL LOTE');
  });

  it('«PDF del lote» descarga un PDF, sube el número y bloquea el otro botón mientras genera', async () => {
    type('in-biz-number', '2026-100');
    button('batch-add').click();
    button('batch-add').click();
    button('batch-pdf').click();
    expect(button('batch-pdf').textContent).toBe('Generando PDF…');
    expect(button('pdf-button').disabled).toBe(true);
    await until(() => downloads.length === 1);
    expect(downloads).toEqual(['presupuesto-2026-100.pdf']);
    const blob = created[0];
    if (!blob) throw new Error('no se creó ningún archivo');
    const pdf = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()));
    expect(pdf.getPageCount()).toBe(1);
    await until(() => !button('batch-pdf').disabled);
    expect(button('batch-pdf').textContent).toBe('PDF del lote');
    expect(button('pdf-button').disabled).toBe(false);
    expect($<HTMLInputElement>('in-biz-number').value).toBe('2026-101');
  });

  it('cambiar de idioma con el PDF del lote en curso conserva «Generando…» en su botón', async () => {
    button('batch-add').click();
    button('batch-pdf').click();
    expect(button('batch-pdf').textContent).toBe('Generando PDF…');
    document.querySelector<HTMLButtonElement>('button[data-lang="en"]')?.click();
    expect(button('batch-pdf').textContent).toBe('Creating PDF…');
    expect(button('pdf-button').textContent).toBe('Download PDF');
    await until(() => !button('batch-pdf').disabled);
    expect(button('batch-pdf').textContent).toBe('Batch PDF');
  });
});
