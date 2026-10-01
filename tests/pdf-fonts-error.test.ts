// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startApp } from '../src/ui/app';
import { binaryStl, cubeTriangles } from './helpers/mesh';

// Archivo aparte de pdf-fonts.test.ts: `loadFonts` guarda su promesa en el módulo y aquí hace falta partir de cero.
const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
const body = (html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, '');
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(check()).toBe(true);
}

describe('aviso si no se pueden descargar las fuentes del PDF', () => {
  const stl = binaryStl(cubeTriangles(20));

  beforeEach(() => {
    vi.stubGlobal('Worker', undefined);
    window.localStorage.clear();
    document.body.innerHTML = body;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        if (!String(url).endsWith('.ttf')) return new Response(stl.slice(0));
        return new Response('no', { status: 404 });
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('si falla, el aviso lo dice en el idioma activo y el error se registra', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    startApp();
    $('sample-button').click();
    await until(() => $('out-total').textContent !== '—');
    const button = $<HTMLButtonElement>('pdf-button');

    button.click();
    await until(() => !$('notice').hidden);
    expect($('notice').textContent).toMatch(/No se ha podido descargar la fuente del PDF\. Comprueba tu conexión/);
    expect(log).toHaveBeenCalledTimes(1);

    // El aviso abierto se vuelve a escribir en el idioma nuevo.
    document.querySelector<HTMLButtonElement>('button[data-lang="en"]')?.click();
    await until(() => /Check your connection/.test($('notice').textContent ?? ''));
    document.querySelector<HTMLButtonElement>('button[data-lang="es"]')?.click();
  });
});
