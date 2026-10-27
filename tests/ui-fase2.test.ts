// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startApp } from '../src/ui/app';

/**
 * happy-dom no sabe hacer WebGL: sin estos dos mocks la aplicación mostraría al arrancar el aviso
 * «Sin vista 3D» y taparía el aviso de datos dañados que se comprueba más abajo. El visor se
 * sustituye por un doble de la misma forma pública; el mock solo afecta a este archivo
 * (cada test de Vitest aísla sus módulos).
 */
vi.mock('../src/viewer/webgl', () => ({ supportsWebGL: () => true }));
vi.mock('../src/viewer/viewer', () => ({
  Viewer: class {
    setBed(): void {}
    setPart(): void {}
    setTheme(): void {}
    resetCamera(): void {}
    setAutoRotate(): void {}
    snapshot(): null {
      return null;
    }
  },
}));

const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
const body = (html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, '');

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

const WELCOME_KEY = 'printquote:bienvenida:v1';
const PROFILES_KEY = 'printquote:perfiles:v1';
const SETTINGS_KEY = 'printquote:ajustes:v1';

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(check()).toBe(true);
}

function type(id: string, value: string): void {
  const input = $<HTMLInputElement>(id);
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

/** Vuelve a montar el cuerpo del HTML y arranca la aplicación, como al cargar la página. */
function start(): void {
  document.body.innerHTML = body;
  startApp();
}

const helpButton = (controls: string): HTMLButtonElement | null =>
  document.querySelector<HTMLButtonElement>(`.help-toggle[aria-controls="${controls}"]`);

const backupFile = (content: string): File => new File([content], 'ajustes.json', { type: 'application/json' });

/** Simula elegir un archivo en el campo de importación y lanza su evento `change`. */
function chooseFile(file: File): void {
  const input = $<HTMLInputElement>('data-file');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
}

describe('fase 2 en la interfaz completa', () => {
  beforeEach(() => {
    vi.stubGlobal('Worker', undefined); // sin workers: se usa el respaldo en el hilo principal
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // ── 1. Primera visita ──
  it('la guía de bienvenida sale en la primera visita y se guarda al cerrarla', () => {
    start();
    expect($('welcome').hidden).toBe(false);
    expect(document.getElementById('empty-sample')).not.toBeNull();

    $('welcome-done').click();
    expect($('welcome').hidden).toBe(true);
    expect(window.localStorage.getItem(WELCOME_KEY)).toBe('1');

    start(); // «recarga» con la clave ya guardada
    expect($('welcome').hidden).toBe(true);
  });

  // ── 2. Ayuda ──
  it('la ayuda se abre con su botón, se cierra con Escape y devuelve el foco al botón', () => {
    start();
    const button = helpButton('help-infill');
    expect(button).not.toBeNull();
    button?.click();
    expect($('help-infill').hidden).toBe(false);
    expect(button?.getAttribute('aria-expanded')).toBe('true');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect($('help-infill').hidden).toBe(true);
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
  });

  it('al abrir otra ayuda, la que estaba abierta se cierra', () => {
    start();
    const infill = helpButton('help-infill');
    const perimeters = helpButton('help-perimeters');
    infill?.click();
    perimeters?.click();
    expect($('help-infill').hidden).toBe(true);
    expect(infill?.getAttribute('aria-expanded')).toBe('false');
    expect($('help-perimeters').hidden).toBe(false);
    expect(perimeters?.getAttribute('aria-expanded')).toBe('true');
  });

  // ── 3. Perfiles propios ──
  it('guarda una impresora propia: aparece en la lista y en localStorage', () => {
    start();
    type('printer-preset-name', 'Mi taller');
    $('printer-preset-save').click();

    const items = Array.from($('printer-presets').children);
    expect(items).toHaveLength(1);
    expect(items[0]?.textContent).toContain('Mi taller');

    const saved = JSON.parse(window.localStorage.getItem(PROFILES_KEY) ?? '{}') as { printers?: { name?: string }[]; materials?: unknown[] };
    expect(saved.printers?.[0]?.name).toBe('Mi taller');
    expect(saved.materials).toEqual([]);
  });

  it('un nombre con HTML se ve como texto: dentro de la lista no hay etiquetas', () => {
    start();
    const xss = '<img src=x onerror=alert(1)>';
    type('printer-preset-name', xss);
    $('printer-preset-save').click();

    const list = $('printer-presets');
    expect(list.querySelectorAll('img')).toHaveLength(0);
    expect(list.textContent).toContain(xss);
    expect(window.localStorage.getItem(PROFILES_KEY)).not.toBeNull();
  });

  it('sin nombre no se guarda nada y el estado pide que se escriba uno', () => {
    start();
    $('printer-preset-save').click();
    expect($('printer-preset-status').textContent).toMatch(/Escribe un nombre/);
    expect($('printer-presets').children).toHaveLength(0);
    expect(window.localStorage.getItem(PROFILES_KEY)).toBeNull();
  });

  it('aplicar un material propio cambia el precio y el material marcado', () => {
    start();
    document.querySelector<HTMLInputElement>('input[name="material"][value="PETG"]')?.click();
    type('in-price', '45');
    type('material-preset-name', 'Mi PETG');
    $('material-preset-save').click();

    document.querySelector<HTMLInputElement>('input[name="material"][value="PLA"]')?.click();
    expect(document.querySelector<HTMLInputElement>('input[name="material"]:checked')?.value).toBe('PLA');
    expect($<HTMLInputElement>('in-price').value).toBe('20');

    document.querySelector<HTMLButtonElement>('#material-presets li button')?.click();
    expect(document.querySelector<HTMLInputElement>('input[name="material"]:checked')?.value).toBe('PETG');
    expect($<HTMLInputElement>('in-price').value).toBe('45');
  });

  // ── 4. Datos dañados ──
  it('con los ajustes guardados rotos, el aviso dice que se han descartado', () => {
    window.localStorage.setItem(SETTINGS_KEY, '{roto');
    start();
    expect($('notice').hidden).toBe(false);
    expect($('notice').textContent).toMatch(/ajustes/);
  });

  it('sin datos guardados no hay aviso', () => {
    start();
    expect($('notice').hidden).toBe(true);
  });

  // ── 5. Borrar mis datos ──
  it('«Borrar mis datos» pide confirmación y solo quita las claves de printquote', () => {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ infillPercent: 40 }));
    window.localStorage.setItem('otra-web:clave', 'no me toques');
    start();
    const reload = vi.fn();
    Object.defineProperty(window.location, 'reload', { value: reload, configurable: true });

    $('data-clear').click();
    expect($('data-clear').textContent).toMatch(/Seguro/);
    expect($('data-cancel').hidden).toBe(false);
    expect(window.localStorage.getItem(SETTINGS_KEY)).not.toBeNull();
    expect(window.localStorage.getItem('otra-web:clave')).toBe('no me toques');

    $('data-clear').click();
    expect(window.localStorage.getItem(SETTINGS_KEY)).toBeNull();
    expect(window.localStorage.getItem('otra-web:clave')).toBe('no me toques');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // ── 6. Importar ──
  it('importa un archivo de ajustes válido y aplica el relleno', async () => {
    start();
    chooseFile(backupFile(JSON.stringify({ app: 'printquote', v: 1, settings: { infillPercent: 55 } })));
    await until(() => /importados/.test($('data-status').textContent ?? ''));
    expect($<HTMLInputElement>('in-infill').value).toBe('55');
  });

  it('tras importar perfiles, la lista y el siguiente «Guardar actual» parten de los importados', async () => {
    start();
    const printer = (name: string): Record<string, unknown> => ({
      name, flowRate: 12, powerWatts: 100, bedX: 200, bedY: 200, bedZ: 200, lineWidth: 0.4, perimeters: 3, overheadMinutes: 5,
    });
    const names = (): (string | null)[] => Array.from(document.querySelectorAll('#printer-presets li > span')).map((e) => e.textContent);
    const stored = (): string[] =>
      (JSON.parse(localStorage.getItem('printquote:perfiles:v1') ?? '{"printers":[]}') as { printers: { name: string }[] }).printers.map((p) => p.name);

    $<HTMLInputElement>('printer-preset-name').value = 'Vieja';
    $('printer-preset-save').click();
    expect(names()).toEqual(['Vieja']);

    chooseFile(backupFile(JSON.stringify({ app: 'printquote', v: 1, printers: [printer('Importada')] })));
    await until(() => ($('data-status').textContent ?? '') !== '');
    expect(stored()).toEqual(['Importada']);
    expect(names()).toEqual(['Importada']);

    $<HTMLInputElement>('printer-preset-name').value = 'Nueva';
    $('printer-preset-save').click();
    expect(stored()).toEqual(['Nueva', 'Importada']);
  });

  it('si el navegador no deja guardar lo importado, se aplica igual pero lo avisa', async () => {
    start();
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('lleno', 'QuotaExceededError');
    });
    chooseFile(backupFile(JSON.stringify({ app: 'printquote', v: 1, settings: { infillPercent: 35 } })));
    await until(() => /importados/.test($('data-status').textContent ?? ''));
    expect($('data-status').textContent).toMatch(/se perderán al recargar/);
    expect($<HTMLInputElement>('in-infill').value).toBe('35');
  });

  it('un archivo de otra aplicación no se importa', async () => {
    start();
    chooseFile(backupFile(JSON.stringify({ app: 'otra', v: 1 })));
    await until(() => /No es un archivo de ajustes de printquote/.test($('data-status').textContent ?? ''));
    expect($<HTMLInputElement>('in-infill').value).toBe('20');
  });

  it('un archivo de más de 1 MiB se rechaza antes de leerlo', () => {
    start();
    chooseFile(backupFile('x'.repeat(1024 * 1024 + 1)));
    expect($('data-status').textContent).toMatch(/más de 1 MB/);
    expect($<HTMLInputElement>('in-infill').value).toBe('20');
  });
});
