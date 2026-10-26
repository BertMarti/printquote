// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeStl, type AnalyzedStl } from '../src/stl/analyze';
import { StlAnalyzer } from '../src/stl/analyzer';
import { LOAD_PROGRESS_DELAY_MS, startApp } from '../src/ui/app';
import { binaryStl, cubeTriangles } from './helpers/mesh';

/**
 * happy-dom no sabe hacer WebGL: sin estos mocks la aplicación mostraría al arrancar el aviso
 * «Sin vista 3D». El visor se sustituye por un doble; el mock solo afecta a este archivo.
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

const SAMPLE = 'soporte-movil.stl';

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 300 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(check()).toBe(true);
}

/**
 * Sustituye `StlAnalyzer.analyze` por una promesa que no acaba hasta que el test lo diga y
 * guarda el `onProgress` (3.er argumento) para llamarlo a mano.
 */
function analyzeSuspendida(): {
  llamadas: () => number;
  progreso: (percent: number) => void;
  terminar: (result: AnalyzedStl) => void;
} {
  const pendientes: Array<{
    onProgress: ((percent: number) => void) | undefined;
    resolve: (value: AnalyzedStl) => void;
  }> = [];
  vi.spyOn(StlAnalyzer.prototype, 'analyze').mockImplementation(
    (_buffer, _fileName, onProgress) =>
      new Promise<AnalyzedStl>((resolve) => pendientes.push({ onProgress, resolve })),
  );
  return {
    llamadas: () => pendientes.length,
    progreso: (percent) => pendientes[0]?.onProgress?.(percent),
    terminar: (result) => pendientes[0]?.resolve(result),
  };
}

describe('barra de progreso y «Cancelar»', () => {
  beforeEach(() => {
    vi.stubGlobal('Worker', undefined); // sin workers: el análisis va en el hilo principal
    window.localStorage.clear();
    document.body.innerHTML = body;
    const stl = binaryStl(cubeTriangles(30));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stl.slice(0))));
    startApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('la barra y «Cancelar» salen pasado el retardo y la barra refleja el progreso', async () => {
    const analysis = analyzeSuspendida();
    $('empty-sample').click();
    await until(() => analysis.llamadas() > 0);

    // Antes del retardo: ni barra ni botón (solo el rótulo de lectura).
    expect($('load-progress').hidden).toBe(true);
    expect($('load-cancel').hidden).toBe(true);
    expect($('stage-loading').hidden).toBe(false);

    await new Promise((r) => setTimeout(r, LOAD_PROGRESS_DELAY_MS + 150));
    expect($('load-progress').hidden).toBe(false);
    expect($('load-cancel').hidden).toBe(false);
    expect($('load-progress').getAttribute('role')).toBe('progressbar');

    analysis.progreso(45);
    expect($('load-progress').getAttribute('aria-valuenow')).toBe('45');
    expect($('load-progress').getAttribute('aria-valuetext')).toBe('45 %');
    expect($('load-progress-bar').style.transform).toMatch(/scaleX\(0\.45\)/);
  });

  it('«Cancelar» corta el análisis, deja el escenario limpio y anuncia sin aviso de error', async () => {
    const analysis = analyzeSuspendida();
    const cancel = vi.spyOn(StlAnalyzer.prototype, 'cancel');
    $('empty-sample').click();
    await until(() => analysis.llamadas() > 0);
    await until(() => !$('load-cancel').hidden);

    $('load-cancel').click();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect($('load-progress').hidden).toBe(true);
    expect($('load-cancel').hidden).toBe(true);
    expect($('stage-loading').hidden).toBe(true);
    const stage = $('viewer').parentElement as HTMLElement;
    expect(stage.classList.contains('is-loading')).toBe(false);
    expect(stage.hasAttribute('aria-busy')).toBe(false);
    expect(document.activeElement).toBe($('open-button'));
    expect($('notice').hidden).toBe(true);

    await until(() => ($('live-status').textContent ?? '').includes('cancelado'));
    expect($('live-status').textContent).toBe(`Análisis de «${SAMPLE}» cancelado.`);

    // La promesa vieja, aunque acabe, ya no tiene ticket: no se carga la pieza.
    analysis.terminar(analyzeStl(binaryStl(cubeTriangles(20))));
    await new Promise((r) => setTimeout(r, 50));
    expect($('out-total').textContent).toBe('—');
    expect($('notice').hidden).toBe(true);
    expect($('stage-loading').hidden).toBe(true);
  });

  it('una carga rápida no enseña nunca la barra ni el botón y el progreso vuelve a 0', async () => {
    const input = $<HTMLInputElement>('file-input');
    const file = new File([binaryStl(cubeTriangles(20)).slice(0)], 'corta.stl');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));

    let algunaVezVisible = false;
    const inicio = Date.now();
    while ($('out-total').textContent === '—' && Date.now() - inicio < 5_000) {
      if (!$('load-progress').hidden || !$('load-cancel').hidden) algunaVezVisible = true;
      await new Promise((r) => setTimeout(r, 2));
    }

    expect($('out-total').textContent).not.toBe('—');
    expect(algunaVezVisible).toBe(false);
    expect($('load-progress').hidden).toBe(true);
    expect($('load-cancel').hidden).toBe(true);
    expect($('stage-loading').hidden).toBe(true);
    expect($('load-progress').getAttribute('aria-valuenow')).toBe('0');
  });
});
