// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settingsToHash } from '../src/quote/share';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/quote/settings';
import { startApp } from '../src/ui/app';
import { loadSettings, saveSettings } from '../src/ui/storage';
import { binaryStl, cubeTriangles } from './helpers/mesh';

const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
const body = (html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, '');
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const SETTINGS_KEY = 'printquote:ajustes:v1';
const LINK = '#v=1&mat=PETG&price=27.5&printer=bambu-a1&infill=15&per=3&lw=0.4&flow=12&oh=8&pw=100&ep=0.22&mg=45&cp=4&bx=256&by=256&bz=256';

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(check()).toBe(true);
}

const checkedMaterial = (): string | undefined => document.querySelector<HTMLInputElement>('input[name="material"]:checked')?.value;

describe('enlace con los parámetros', () => {
  let written: string[];

  function start(hash = ''): void {
    window.location.hash = hash;
    document.body.innerHTML = body;
    startApp();
  }

  beforeEach(() => {
    written = [];
    vi.stubGlobal('Worker', undefined);
    window.localStorage.clear();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(async (text: string) => void written.push(text)) },
      configurable: true,
    });
    const stl = binaryStl(cubeTriangles(20));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stl.slice(0))));
  });

  afterEach(() => {
    window.location.hash = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('al abrir un enlace se aplican material, impresora, relleno, copias y el resto, sin pieza', async () => {
    start(LINK);
    expect(checkedMaterial()).toBe('PETG');
    expect($<HTMLSelectElement>('in-printer').value).toBe('bambu-a1');
    expect($<HTMLInputElement>('in-infill').value).toBe('15');
    expect($<HTMLInputElement>('in-perimeters').value).toBe('3');
    expect($<HTMLInputElement>('in-copies').value).toBe('4');
    expect($<HTMLInputElement>('in-margin').value).toBe('45');
    expect($<HTMLInputElement>('in-bedx').value).toBe('256');
    expect($<HTMLInputElement>('in-price').value).toBe('27,5');
    // Sin pieza: el estado dice qué hacer, y se anuncia.
    expect($('out-summary').textContent).toBe('Parámetros del enlace aplicados. Arrastra tu pieza para calcular el presupuesto.');
    await until(() => /Parámetros del enlace aplicados\. Arrastra tu pieza/.test($('live-status').textContent ?? ''));
    expect($('out-total').textContent).toBe('—');
  });

  it('no escribe en el navegador de quien abre el enlace: sus ajustes guardados siguen intactos', () => {
    const mine = normalizeSettings({ ...DEFAULT_SETTINGS, material: 'ABS', marginPercent: 12, pricePerKg: { ...DEFAULT_SETTINGS.pricePerKg, ABS: 99 } });
    saveSettings(mine);
    const before = window.localStorage.getItem(SETTINGS_KEY);
    start(LINK);
    expect(checkedMaterial()).toBe('PETG');
    expect(window.localStorage.getItem(SETTINGS_KEY)).toBe(before);
    expect(loadSettings()).toEqual(mine);
  });

  it('sus precios de los otros materiales siguen siendo los suyos', () => {
    saveSettings(normalizeSettings({ ...DEFAULT_SETTINGS, pricePerKg: { ...DEFAULT_SETTINGS.pricePerKg, ABS: 99 } }));
    start(LINK);
    document.querySelector<HTMLInputElement>('input[name="material"][value="ABS"]')?.click();
    expect($<HTMLInputElement>('in-price').value).toBe('99');
  });

  it('con el enlace, al cargar la pieza se calcula con los parámetros del enlace', async () => {
    start(LINK);
    $('sample-button').click();
    await until(() => $('out-total').textContent !== '—');
    expect($('out-summary').textContent).toMatch(/4 copias/);
    expect($('out-summary').textContent).toMatch(/PETG 15 %/);
  });

  it('si ya hay pieza cargada, aplicar el enlace recalcula con ella y lo dice', async () => {
    start();
    $('sample-button').click();
    await until(() => $('out-total').textContent !== '—');
    window.location.hash = LINK;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(checkedMaterial()).toBe('PETG');
    expect($('out-summary').textContent).toMatch(/4 copias/);
    await until(() => /Parámetros del enlace aplicados a la pieza cargada/.test($('live-status').textContent ?? ''));
  });

  it('«Copiar enlace» copia un enlace con los ajustes actuales y nada más', async () => {
    start();
    document.querySelector<HTMLInputElement>('input[name="material"][value="TPU"]')?.click();
    $('share-copy').click();
    await until(() => written.length === 1);
    const url = new URL(written[0] ?? '');
    expect(url.origin + url.pathname).toBe(window.location.origin + window.location.pathname);
    expect(url.hash).toBe(settingsToHash(loadSettings()));
    expect(url.hash).toMatch(/^#v=1&mat=TPU&price=35&/);
    expect(url.search).toBe('');
    await until(() => /Enlace copiado/.test($('live-status').textContent ?? ''));
    expect($('share-copy').textContent).toBe('Enlace copiado');
  });

  it('el enlace copiado, abierto en otro navegador, da la misma configuración (ida y vuelta)', async () => {
    start(LINK);
    $('share-copy').click();
    await until(() => written.length === 1);
    const copied = new URL(written[0] ?? '').hash;
    expect(copied).toBe(LINK);
  });

  it('si el portapapeles falla, lo dice', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => Promise.reject(new Error('no'))) }, configurable: true });
    start();
    $('share-copy').click();
    await until(() => /No se ha podido copiar el enlace/.test($('live-status').textContent ?? ''));
  });

  it('«Copiar enlace» no necesita pieza y está siempre activo', () => {
    start();
    expect($<HTMLButtonElement>('share-copy').disabled).toBe(false);
  });

  it('#ejemplo sigue cargando la pieza de ejemplo, y #ejemplo&… también aplica los parámetros', async () => {
    start('#ejemplo');
    await until(() => $('out-total').textContent !== '—');
    expect($('file-name').textContent).toBe('soporte-movil.stl');
    expect(checkedMaterial()).toBe('PLA');

    start('#ejemplo&v=1&mat=ABS&cp=2');
    await until(() => $('out-total').textContent !== '—');
    expect(checkedMaterial()).toBe('ABS');
    expect($<HTMLInputElement>('in-copies').value).toBe('2');
  });

  it('un enlace roto u hostil no rompe la página ni cambia nada', () => {
    for (const hash of ['#v=2&mat=PETG', '#v=1&mat=<script>', '#basura', '#v=1&infill=abc&cp=-9']) {
      expect(() => start(hash), hash).not.toThrow();
    }
    // El último sí era de versión 1: los valores malos se acotan.
    expect($<HTMLInputElement>('in-copies').value).toBe('1');
    expect($<HTMLInputElement>('in-infill').value).toBe('20');
  });

  it('en inglés, el mensaje y el botón salen en inglés', async () => {
    start(LINK);
    document.querySelector<HTMLButtonElement>('button[data-lang="en"]')?.click();
    expect($('share-copy').textContent).toBe('Copy link');
    expect($('out-summary').textContent).toBe('Link settings applied. Drop your part to calculate the quote.');
    document.querySelector<HTMLButtonElement>('button[data-lang="es"]')?.click();
  });
});
