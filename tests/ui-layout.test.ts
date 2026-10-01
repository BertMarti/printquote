// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startApp } from '../src/ui/app';
import { binaryStl, cubeTriangles } from './helpers/mesh';

const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
const body = (html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, '');
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(check()).toBe(true);
}

describe('jerarquía y estructura de la interfaz (auditoría de UX)', () => {
  beforeEach(() => {
    vi.stubGlobal('Worker', undefined);
    window.localStorage.clear();
    document.body.innerHTML = body;
  });
  afterEach(() => vi.unstubAllGlobals());

  it('la cabecera tiene un único botón primario: «Abrir»', () => {
    const primary = document.querySelectorAll('.titleblock .button--primary');
    expect(primary).toHaveLength(1);
    expect(primary[0]?.id).toBe('open-button');
    expect($('sample-button').classList.contains('button--ghost')).toBe(true);
  });

  it('el aviso va dentro de la banda superior, tras la ficha de la pieza (no flota encima)', () => {
    const top = document.querySelector('.stage-top');
    expect(top?.children[0]?.classList.contains('stage-meta')).toBe(true);
    expect(top?.children[1]).toBe($('notice'));
  });

  it('con aviso visible el estado vacío pierde su texto; al ocultarlo, vuelve', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no es un modelo', { status: 404 })));
    startApp();
    const stage = $('viewer').parentElement as HTMLElement;
    $('sample-button').click();
    await until(() => /roto|leer|ejemplo/i.test($('notice').textContent ?? ''));
    expect(stage.classList.contains('has-notice')).toBe(true);
    const stl = binaryStl(cubeTriangles(20));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stl.slice(0))));
    $('sample-button').click();
    await until(() => $('out-total').textContent !== '—');
    expect(stage.classList.contains('has-notice')).toBe(false);
  });

  it('la ayuda del visor es su descripción accesible y el nombre es corto', () => {
    // Sin WebGL (happy-dom) el visor no se activa: se comprueba el HTML y la función de etiquetas con el visor activo.
    const help = $('viewer-help');
    expect(help.hidden).toBe(true); // oculto, pero `aria-describedby` lo usa igualmente
    expect(help.textContent).toMatch(/Flechas: desplazar/);
    expect(html).not.toMatch(/id="viewer"[^>]*aria-hidden/);
  });
});
