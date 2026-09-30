// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { firstQuoteNumber } from '../src/quote/business';
import { startApp } from '../src/ui/app';
import { loadBusiness } from '../src/ui/storage';
import { binaryStl, cubeTriangles } from './helpers/mesh';

const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
const body = (html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, '');
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(check()).toBe(true);
}

function type(id: string, value: string): void {
  const input = $<HTMLInputElement | HTMLTextAreaElement>(id);
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('datos del negocio y PDF en la interfaz', () => {
  const created: Blob[] = [];
  const downloads: string[] = [];

  beforeEach(() => {
    created.length = 0;
    downloads.length = 0;
    vi.stubGlobal('Worker', undefined);
    window.localStorage.clear();
    document.body.innerHTML = body;
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: (blob: Blob) => {
        created.push(blob);
        return 'blob:test';
      },
      revokeObjectURL: () => {},
    }));
    // happy-dom intentaría navegar a la URL blob: solo se anota la descarga.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
    const stl = binaryStl(cubeTriangles(20));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stl.slice(0))));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('el formulario «Datos del negocio» es plegable y empieza plegado', () => {
    startApp();
    const details = $<HTMLDetailsElement>('business-details');
    expect(details.tagName).toBe('DETAILS');
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')?.textContent).toMatch(/Datos del negocio/);
    // Cada campo tiene su etiqueta.
    for (const id of ['in-biz-name', 'in-biz-taxid', 'in-biz-address', 'in-biz-phone', 'in-biz-email', 'in-biz-web', 'in-biz-logo', 'in-biz-number', 'in-biz-validity', 'in-biz-vat']) {
      expect(document.querySelector(`label[for="${id}"]`), id).not.toBeNull();
    }
  });

  it('arranca con IVA 21 %, 30 días de validez y el número AAAA-001', () => {
    startApp();
    expect($<HTMLInputElement>('in-biz-vat').value).toBe('21');
    expect($<HTMLInputElement>('in-biz-validity').value).toBe('30');
    expect($<HTMLInputElement>('in-biz-number').value).toBe(firstQuoteNumber());
  });

  it('lo que se escribe se guarda en localStorage y se recupera al recargar', () => {
    startApp();
    type('in-biz-name', 'Taller 3D');
    type('in-biz-address', 'Calle Mayor 1\n28001 Madrid');
    type('in-biz-email', 'hola@example.com');
    type('in-biz-vat', '10');
    type('in-biz-validity', '15');
    expect(loadBusiness()).toMatchObject({
      name: 'Taller 3D',
      address: 'Calle Mayor 1\n28001 Madrid',
      email: 'hola@example.com',
      vatPercent: 10,
      validityDays: 15,
    });
    document.body.innerHTML = body;
    startApp();
    expect($<HTMLInputElement>('in-biz-name').value).toBe('Taller 3D');
    expect($<HTMLTextAreaElement>('in-biz-address').value).toBe('Calle Mayor 1\n28001 Madrid');
    expect($<HTMLInputElement>('in-biz-vat').value).toBe('10');
    expect($<HTMLInputElement>('in-biz-validity').value).toBe('15');
  });

  it('un IVA fuera de rango muestra el error y no se guarda', () => {
    startApp();
    type('in-biz-vat', '150');
    expect($('err-vat').textContent).toMatch(/entre 0 y 100/);
    expect(loadBusiness().vatPercent).toBe(21);
  });

  it('«Borrar los datos del negocio» lo deja todo como al principio', () => {
    startApp();
    type('in-biz-name', 'Taller 3D');
    $('reset-business').click();
    expect($<HTMLInputElement>('in-biz-name').value).toBe('');
    expect(window.localStorage.getItem('printquote:negocio:v1')).toBeNull();
  });

  it('el botón de PDF está desactivado sin pieza y descarga un PDF con el número del presupuesto', async () => {
    startApp();
    const button = $<HTMLButtonElement>('pdf-button');
    expect(button.disabled).toBe(true);
    type('in-biz-name', 'Taller 3D');
    type('in-biz-number', '2026-041');

    $('sample-button').click();
    await until(() => $('out-total').textContent !== '—');
    expect(button.disabled).toBe(false);

    button.click();
    await until(() => downloads.length === 1);
    expect(downloads).toEqual(['presupuesto-2026-041.pdf']);
    const blob = created[0];
    if (!blob) throw new Error('no se creó ningún archivo');
    expect(blob.type).toBe('application/pdf');
    expect(new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()).slice(0, 5))).toBe('%PDF-');

    // El botón vuelve a su estado y el número sube para el siguiente presupuesto.
    await until(() => !button.disabled);
    expect(button.textContent).toBe('Descargar PDF');
    expect($<HTMLInputElement>('in-biz-number').value).toBe('2026-042');
    expect(loadBusiness().quoteNumber).toBe('2026-042');
    await until(() => /PDF descargado/.test($('live-status').textContent ?? ''));
  });
});
