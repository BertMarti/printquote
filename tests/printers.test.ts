// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPrinter, CUSTOM_PRINTER, getPrinter, isPrinterId, matchesPrinter, PRINTERS } from '../src/quote/printers';
import { DEFAULT_SETTINGS, LIMITS, normalizeSettings } from '../src/quote/settings';
import { startApp } from '../src/ui/app';
import { loadSettings, saveSettings } from '../src/ui/storage';
import { binaryStl, cubeTriangles } from './helpers/mesh';

describe('datos de los perfiles', () => {
  it('incluye los modelos pedidos, con identificadores únicos', () => {
    const names = PRINTERS.map((p) => p.name);
    for (const expected of ['Bambu Lab A1', 'Bambu Lab P1S', 'Prusa MK4', 'Prusa MINI+', 'Creality Ender-3 V3', 'Creality K1', 'Elegoo Neptune 4']) {
      expect(names).toContain(expected);
    }
    expect(new Set(PRINTERS.map((p) => p.id)).size).toBe(PRINTERS.length);
    expect(PRINTERS.map((p) => p.id)).not.toContain(CUSTOM_PRINTER);
  });

  it.each(PRINTERS.map((p) => [p.name, p] as const))('%s: valores dentro de los límites y con nota de origen', (_name, printer) => {
    expect(printer.flowRate).toBeGreaterThanOrEqual(LIMITS.flowRate.min);
    expect(printer.flowRate).toBeLessThanOrEqual(LIMITS.flowRate.max);
    expect(printer.powerWatts).toBeGreaterThanOrEqual(LIMITS.powerWatts.min);
    expect(printer.powerWatts).toBeLessThanOrEqual(LIMITS.powerWatts.max);
    for (const axis of [printer.bedX, printer.bedY, printer.bedZ]) {
      expect(axis).toBeGreaterThanOrEqual(LIMITS.bedX.min);
      expect(axis).toBeLessThanOrEqual(LIMITS.bedX.max);
    }
    expect(printer.note).toMatch(/fabricante/);
    expect(printer.note).toMatch(/estimaciones/);
  });
});

describe('aplicar un perfil', () => {
  it('rellena caudal, potencia y cama y deja el resto como estaba', () => {
    const base = { ...DEFAULT_SETTINGS, marginPercent: 45, copies: 3 };
    const applied = applyPrinter(base, 'prusa-mini');
    const mini = getPrinter('prusa-mini');
    if (!mini) throw new Error('falta el perfil Prusa MINI+');
    expect(applied).toMatchObject({
      printerId: 'prusa-mini',
      flowRate: mini.flowRate,
      powerWatts: mini.powerWatts,
      bedX: 180,
      bedY: 180,
      bedZ: 180,
      marginPercent: 45,
      copies: 3,
    });
    expect(matchesPrinter(applied, mini)).toBe(true);
  });

  it('«Personalizada» (o un id desconocido) no cambia ningún valor', () => {
    const base = applyPrinter(DEFAULT_SETTINGS, 'bambu-a1');
    expect(applyPrinter(base, CUSTOM_PRINTER)).toEqual({ ...base, printerId: CUSTOM_PRINTER });
    expect(applyPrinter(base, 'no-existe')).toEqual({ ...base, printerId: CUSTOM_PRINTER });
    expect(isPrinterId('prusa-mk4')).toBe(true);
    expect(isPrinterId(CUSTOM_PRINTER)).toBe(false);
    expect(isPrinterId(7)).toBe(false);
  });

  it('normalizar conserva el perfil mientras los valores coinciden y pasa a «Personalizada» si se editan', () => {
    const applied = applyPrinter(DEFAULT_SETTINGS, 'creality-k1');
    expect(normalizeSettings(applied).printerId).toBe('creality-k1');
    for (const patch of [{ flowRate: applied.flowRate + 1 }, { powerWatts: 1 }, { bedX: 100 }, { bedY: 100 }, { bedZ: 100 }]) {
      expect(normalizeSettings({ ...applied, ...patch }).printerId).toBe(CUSTOM_PRINTER);
    }
    // Cambiar ajustes que no rellena el perfil no lo desactiva.
    expect(normalizeSettings({ ...applied, marginPercent: 10 }).printerId).toBe('creality-k1');
  });

  it('un perfil desconocido o mal tipado guardado en localStorage pasa a «Personalizada»', () => {
    expect(normalizeSettings({ printerId: 'ya-no-existe' }).printerId).toBe(CUSTOM_PRINTER);
    expect(normalizeSettings({ printerId: 42 }).printerId).toBe(CUSTOM_PRINTER);
    expect(normalizeSettings({}).printerId).toBe(CUSTOM_PRINTER);
  });
});

describe('persistencia', () => {
  beforeEach(() => window.localStorage.clear());

  it('el perfil elegido se guarda y se recupera', () => {
    saveSettings(applyPrinter(DEFAULT_SETTINGS, 'elegoo-neptune4'));
    const loaded = loadSettings();
    expect(loaded.printerId).toBe('elegoo-neptune4');
    expect(loaded.bedZ).toBe(265);
  });

  it('ajustes guardados antes de v0.2.0 (sin perfil) siguen cargando', () => {
    window.localStorage.setItem('printquote:ajustes:v1', JSON.stringify({ material: 'PETG', flowRate: 9 }));
    const loaded = loadSettings();
    expect(loaded.printerId).toBe(CUSTOM_PRINTER);
    expect(loaded.material).toBe('PETG');
    expect(loaded.flowRate).toBe(9);
  });
});

const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
const body = (html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, '');
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

describe('selector de impresora en la interfaz', () => {
  beforeEach(() => {
    vi.stubGlobal('Worker', undefined);
    window.localStorage.clear();
    document.body.innerHTML = body;
  });

  function choose(value: string): void {
    const select = $<HTMLSelectElement>('in-printer');
    select.value = value;
    select.dispatchEvent(new Event('change'));
  }

  it('lista «Personalizada» y todos los perfiles, y arranca en «Personalizada»', () => {
    startApp();
    const select = $<HTMLSelectElement>('in-printer');
    expect(Array.from(select.options, (o) => o.value)).toEqual([CUSTOM_PRINTER, ...PRINTERS.map((p) => p.id)]);
    expect(select.options[0]?.text).toBe('Personalizada');
    expect(select.value).toBe(CUSTOM_PRINTER);
  });

  it('elegir un perfil actualiza los campos, la leyenda de la cama y la nota; editar un campo vuelve a «Personalizada»', () => {
    startApp();
    choose('bambu-p1s');
    expect($<HTMLInputElement>('in-flow').value).toBe('15');
    expect($<HTMLInputElement>('in-power').value).toBe('110');
    expect($<HTMLInputElement>('in-bedx').value).toBe('256');
    expect($('stage-legend').textContent).toContain('256 × 256 × 256');
    expect($('printer-note').textContent).toMatch(/orientativos/);
    expect($('printer-note').textContent).toMatch(/fabricante/);

    const flow = $<HTMLInputElement>('in-flow');
    flow.value = '14';
    flow.dispatchEvent(new Event('input'));
    expect($<HTMLSelectElement>('in-printer').value).toBe(CUSTOM_PRINTER);
    expect($<HTMLInputElement>('in-bedx').value).toBe('256'); // el resto se conserva
    expect($('printer-note').textContent).toMatch(/tus propios valores/);
  });

  it('el perfil sobrevive a recargar la página', () => {
    startApp();
    choose('prusa-mk4');
    document.body.innerHTML = body;
    startApp();
    expect($<HTMLSelectElement>('in-printer').value).toBe('prusa-mk4');
    expect($<HTMLInputElement>('in-bedy').value).toBe('210');
  });

  it('elegir un perfil cambia el aviso «no cabe en la cama»', async () => {
    const stl = binaryStl(cubeTriangles(230));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stl.slice(0))));
    startApp();
    $('sample-button').click();
    for (let i = 0; i < 200 && $('out-total').textContent === '—'; i++) await new Promise((r) => setTimeout(r, 5));
    expect($('warnings').textContent).toMatch(/no cabe/);
    choose('bambu-a1'); // 256 mm: cabe
    expect($('warnings').textContent).not.toMatch(/no cabe/);
    choose('prusa-mini'); // 180 mm: no cabe
    expect($('warnings').textContent).toMatch(/no cabe/);
    vi.unstubAllGlobals();
  });

  it('«Restablecer valores por defecto» vuelve a «Personalizada»', () => {
    startApp();
    choose('creality-k1');
    $('reset-settings').click();
    expect($<HTMLSelectElement>('in-printer').value).toBe(CUSTOM_PRINTER);
    expect($<HTMLInputElement>('in-flow').value).toBe('8');
  });
});
