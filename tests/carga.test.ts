// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startApp } from '../src/ui/app';
import { fontResponse } from './helpers/fonts';
import { binaryStl, cubeTriangles } from './helpers/mesh';

// Carga más ligera (1.1): la comprobación de WebGL espera al primer pintado y el PDF se precarga con la intención.
const webgl = vi.hoisted(() => ({ supportsWebGL: vi.fn(() => false) }));
vi.mock('../src/viewer/webgl', () => webgl);

const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
const body = (html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, '');
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(check()).toBe(true);
}

describe('carga de la página', () => {
  const fetches: string[] = [];

  beforeEach(() => {
    fetches.length = 0;
    webgl.supportsWebGL.mockClear();
    vi.stubGlobal('Worker', undefined);
    window.localStorage.clear();
    document.body.innerHTML = body;
    const stl = binaryStl(cubeTriangles(20));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        fetches.push(String(url));
        return fontResponse(url) ?? new Response(stl.slice(0));
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('no crea el contexto WebGL de prueba al arrancar, sino tras el primer pintado', async () => {
    startApp();
    expect(webgl.supportsWebGL).not.toHaveBeenCalled();
    await until(() => webgl.supportsWebGL.mock.calls.length === 1);
    // Sin WebGL y sin pieza: el aviso de siempre.
    await until(() => /WebGL/.test($('notice').textContent ?? ''));
    expect($('notice').hidden).toBe(false);
  });

  it('si ya se está abriendo una pieza, el aviso «Sin vista 3D» no la tapa', async () => {
    startApp();
    $('sample-button').click();
    await until(() => webgl.supportsWebGL.mock.calls.length === 1);
    await until(() => $('out-total').textContent !== '—');
    expect($('notice').hidden).toBe(true);
  });

  it('pasar el puntero o enfocar «Descargar PDF» empieza a descargar las fuentes; desactivado, no', async () => {
    startApp();
    const button = $<HTMLButtonElement>('pdf-button');
    expect(button.disabled).toBe(true);
    button.dispatchEvent(new Event('pointerenter'));
    await new Promise((r) => setTimeout(r, 20));
    expect(fetches.some((url) => url.endsWith('.ttf'))).toBe(false);

    $('sample-button').click();
    await until(() => !button.disabled);
    button.dispatchEvent(new Event('focus'));
    await until(() => fetches.filter((url) => url.endsWith('.ttf')).length === 4);
    // Una segunda intención no vuelve a pedirlas (la promesa se reutiliza).
    button.dispatchEvent(new Event('pointerenter'));
    await new Promise((r) => setTimeout(r, 20));
    expect(fetches.filter((url) => url.endsWith('.ttf'))).toHaveLength(4);
  });
});
