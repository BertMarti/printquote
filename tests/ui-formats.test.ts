// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { startApp } from '../src/ui/app';
import { binaryStl, cubeTriangles } from './helpers/mesh';
import { cube3mf } from './helpers/zip';

const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
const body = (html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, '');
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(check()).toBe(true);
}

function openFile(file: File): void {
  const input = $<HTMLInputElement>('file-input');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
}

const OBJ_CUBE = [
  'v 0 0 0', 'v 20 0 0', 'v 20 20 0', 'v 0 20 0', 'v 0 0 20', 'v 20 0 20', 'v 20 20 20', 'v 0 20 20',
  'f 1 4 3 2', 'f 5 6 7 8', 'f 1 2 6 5', 'f 2 3 7 6', 'f 3 4 8 7', 'f 4 1 5 8',
].join('\n');

describe('carga de STL, OBJ y 3MF en la interfaz', () => {
  beforeEach(() => {
    vi.stubGlobal('Worker', undefined);
    window.localStorage.clear();
    document.body.innerHTML = body;
    startApp();
  });

  it('el selector de archivos acepta STL, OBJ y 3MF', () => {
    const accept = $<HTMLInputElement>('file-input').getAttribute('accept') ?? '';
    for (const extension of ['.stl', '.obj', '.3mf']) expect(accept).toContain(extension);
  });

  it('un STL binario sigue funcionando y se rotula como STL binario', async () => {
    openFile(new File([binaryStl(cubeTriangles(20))], 'cubo.stl'));
    await until(() => $('out-total').textContent !== '—');
    expect($('file-detail').textContent).toMatch(/^STL binario · 12/);
    expect($('out-volume').textContent).toBe('8,00');
  });

  it('un OBJ da el mismo volumen que el STL y se rotula como OBJ', async () => {
    openFile(new File([OBJ_CUBE], 'cubo.obj'));
    await until(() => $('out-total').textContent !== '—');
    expect($('file-detail').textContent).toMatch(/^OBJ · 12/);
    expect($('out-volume').textContent).toBe('8,00');
    expect($('warnings').children).toHaveLength(0);
  });

  it('un 3MF da el mismo volumen que el STL y se rotula como 3MF', async () => {
    const zip = await cube3mf(20);
    openFile(new File([zip as BlobPart], 'cubo.3mf'));
    await until(() => $('out-total').textContent !== '—');
    expect($('file-detail').textContent).toMatch(/^3MF · 12/);
    expect($('out-volume').textContent).toBe('8,00');
  });

  it('un archivo dañado muestra un error claro en español y no rompe la página', async () => {
    openFile(new File(['PK\u0003\u0004esto no es un zip de verdad, solo lo parece'], 'roto.3mf'));
    await until(() => !$('notice').hidden);
    expect($('notice').textContent).toMatch(/No se ha podido leer «roto\.3mf»/);
    expect($('notice').textContent).toMatch(/ZIP/);
    expect($('notice').getAttribute('role')).toBe('alert');
  });
});
