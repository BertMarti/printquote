// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/quote/settings';
import { startApp } from '../src/ui/app';
import { loadSettings, saveSettings } from '../src/ui/storage';
import { binaryStl, cubeTriangles } from './helpers/mesh';

const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
const body = (html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, '');
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const SCALE = 0.05; // la demo de 13 s dura ~0,65 s
const MINE = normalizeSettings({ ...DEFAULT_SETTINGS, material: 'ABS', infillPercent: 35, copies: 3, marginPercent: 55 });

async function until(check: () => boolean, tries = 600): Promise<void> {
  for (let i = 0; i < tries && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(check()).toBe(true);
}

const material = (): string | undefined => document.querySelector<HTMLInputElement>('input[name="material"]:checked')?.value;
const pressed = (): string | null => $('demo-button').getAttribute('aria-pressed');

describe('«Ver demo» en la aplicación', () => {
  let setItem: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubGlobal('Worker', undefined);
    window.localStorage.clear();
    saveSettings(MINE);
    window.location.hash = '';
    document.body.innerHTML = body;
    const stl = binaryStl(cubeTriangles(30));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stl.slice(0))));
    startApp(SCALE);
    setItem = vi.spyOn(window.localStorage, 'setItem'); // desde aquí, cualquier escritura es de la demo
  });

  afterEach(() => {
    setItem.mockRestore();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('recorre la demo con el total cambiando, sin escribir nada y devolviendo los ajustes de la persona', async () => {
    expect(material()).toBe('ABS');
    const totals = new Set<string>();
    const sample = vi.fn();
    const seen = setInterval(() => {
      if ($('out-total').textContent !== '—') totals.add($('out-total').textContent ?? '');
      if ($('file-name').textContent === 'soporte-movil.stl') sample();
    }, 2);

    $('demo-button').click();
    expect(pressed()).toBe('true');
    await until(() => material() === 'PETG'); // paso 2
    await until(() => $<HTMLInputElement>('in-infill').value === '40'); // paso 3
    // Durante la demo no habla nada: ni el total ni los avisos ni el estado.
    expect($('out-total').closest('[aria-live]')?.getAttribute('aria-live')).toBe('off');
    expect($('live-status').textContent).toBe('');
    await until(() => pressed() === 'false'); // termina sola
    clearInterval(seen);

    expect(sample).toHaveBeenCalled();
    expect(totals.size).toBeGreaterThanOrEqual(3); // PLA 20 %, PETG 20 %, PETG 40 %… y el tuyo
    // Estado editable y de la persona: ajustes de antes, regiones vivas de vuelta, foco libre.
    expect(material()).toBe('ABS');
    expect($<HTMLInputElement>('in-infill').value).toBe('35');
    expect($<HTMLInputElement>('in-copies').value).toBe('3');
    expect($('out-total').closest('[aria-live]')?.getAttribute('aria-live')).toBe('polite');
    expect($('demo-bar').hidden).toBe(true);
    expect($<HTMLButtonElement>('copy-button').disabled).toBe(false); // hay pieza: se puede seguir

    // Un solo anuncio, al final.
    await until(() => ($('live-status').textContent ?? '') !== '');
    expect($('live-status').textContent).toMatch(/Demo terminada/);

    // Sin rastro: ni localStorage, ni historial, ni URL.
    expect(setItem).not.toHaveBeenCalled();
    expect(loadSettings()).toEqual(MINE);
    expect($('history-list').children).toHaveLength(0);
    expect(window.location.hash).toBe('');
  });

  it('se detiene con Esc a mitad: devuelve los ajustes y no guarda nada', async () => {
    $('demo-button').click();
    await until(() => material() === 'PETG');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(pressed()).toBe('false');
    await until(() => material() === 'ABS');
    expect($<HTMLInputElement>('in-infill').value).toBe('35');
    await new Promise((r) => setTimeout(r, 700)); // el guion no sigue solo
    expect(material()).toBe('ABS');
    expect(setItem).not.toHaveBeenCalled();
  });

  it('si ya había una pieza, la devuelve al terminar', async () => {
    const input = $<HTMLInputElement>('file-input');
    Object.defineProperty(input, 'files', { value: [new File([binaryStl(cubeTriangles(10)).slice(0)], 'mia.stl')], configurable: true });
    input.dispatchEvent(new Event('change'));
    await until(() => $('file-name').textContent === 'mia.stl');
    $('demo-button').click();
    await until(() => $('file-name').textContent === 'soporte-movil.stl');
    await until(() => pressed() === 'false');
    await until(() => $('file-name').textContent === 'mia.stl');
  });

  /** Simula soltar un archivo del sistema (un arrastre no genera pointerdown, keydown ni wheel). */
  function dropFile(name: string): void {
    const file = new File([binaryStl(cubeTriangles(12)).slice(0)], name);
    for (const type of ['dragenter', 'drop']) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files: [file] } });
      document.body.dispatchEvent(event); // como en un navegador: nace en un elemento y sube hasta la ventana
    }
  }

  it('soltar un archivo a mitad de demo conserva ese archivo (no vuelve la pieza anterior) y se anuncia', async () => {
    const input = $<HTMLInputElement>('file-input');
    Object.defineProperty(input, 'files', { value: [new File([binaryStl(cubeTriangles(10)).slice(0)], 'usuario.stl')], configurable: true });
    input.dispatchEvent(new Event('change'));
    await until(() => $('file-name').textContent === 'usuario.stl');
    $('demo-button').click();
    await until(() => material() === 'PETG');
    dropFile('otro.stl');
    expect(pressed()).toBe('false');
    await until(() => $('file-name').textContent === 'otro.stl');
    await new Promise((r) => setTimeout(r, 800)); // pasa el tiempo de una demo entera: nada lo pisa
    expect($('file-name').textContent).toBe('otro.stl');
    expect(material()).toBe('ABS'); // los ajustes de la persona sí vuelven
    expect($('live-status').textContent).not.toBe(''); // el anuncio de la carga ya no está silenciado
    expect($('out-total').closest('[aria-live]')?.getAttribute('aria-live')).toBe('polite');
    expect(setItem).not.toHaveBeenCalled();
  });

  it('un enlace con parámetros a mitad de demo se respeta: no se pisa al terminar', async () => {
    $('demo-button').click();
    await until(() => material() === 'PETG');
    window.location.hash = '#v=1&mat=TPU&infill=55';
    window.dispatchEvent(new Event('hashchange'));
    expect(pressed()).toBe('false');
    await new Promise((r) => setTimeout(r, 800));
    expect(material()).toBe('TPU');
    expect($<HTMLInputElement>('in-infill').value).toBe('55');
  });

  // Red de seguridad: aunque una pieza llegue SIN gesto que pare la demo, al terminar no se pisa con la anterior.
  it('si la pieza cambia sin gesto a mitad de demo, al terminar no se pisa con la anterior', async () => {
    const input = $<HTMLInputElement>('file-input');
    const choose = (name: string): void => {
      Object.defineProperty(input, 'files', { value: [new File([binaryStl(cubeTriangles(10)).slice(0)], name)], configurable: true });
      input.dispatchEvent(new Event('change'));
    };
    choose('usuario.stl');
    await until(() => $('file-name').textContent === 'usuario.stl');
    $('demo-button').click();
    await until(() => material() === 'PETG');
    choose('nueva.stl');
    await until(() => $('file-name').textContent === 'nueva.stl');
    await until(() => pressed() === 'false'); // la demo sigue y termina sola
    await new Promise((r) => setTimeout(r, 100));
    expect($('file-name').textContent).toBe('nueva.stl');
  });

  it('si los ajustes cambian por otra vía antes de pararse la demo, no se pisan con los anteriores', async () => {
    $('demo-button').click();
    await until(() => material() === 'PETG');
    const select = $<HTMLSelectElement>('in-printer');
    select.value = 'bambu-a1'; // p. ej. un enlace que la aplicación aplica antes de que la demo se entere
    select.dispatchEvent(new Event('change'));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((r) => setTimeout(r, 100));
    expect(pressed()).toBe('false');
    expect($<HTMLSelectElement>('in-printer').value).toBe('bambu-a1');
  });

  it('con una pieza que no carga, vuelve sola y el aviso de la app sigue ahí', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 404 })));
    $('demo-button').click();
    await until(() => !$('notice').hidden);
    await until(() => pressed() === 'false');
    expect(material()).toBe('ABS');
    expect($('notice').hidden).toBe(false);
    expect($('live-status').textContent).toBe(''); // sin anuncio de «demo terminada» si no hubo demo
  });
});
