// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startApp } from '../src/ui/app';
import { NumberField } from '../src/ui/number-field';
import { binaryStl, cubeTriangles } from './helpers/mesh';

const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
const body = (html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, '');

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(check()).toBe(true);
}

describe('NumberField', () => {
  beforeEach(() => {
    document.body.innerHTML = '<input id="f" /><p id="e" aria-live="polite"></p>';
  });

  it('el error es una región viva que siempre está en el documento y se vacía al corregir', () => {
    const input = $<HTMLInputElement>('f');
    const error = $('e');
    const values: number[] = [];
    const field = new NumberField({ input, error, min: 0, max: 100, decimals: 1, step: 1, onValue: (v) => values.push(v) });
    field.set(20);

    type(input, '150');
    expect(error.hidden).toBe(false);
    expect(error.textContent).toMatch(/entre 0 y 100/);
    expect(input.getAttribute('aria-invalid')).toBe('true');

    type(input, '42,5');
    expect(error.hidden).toBe(false);
    expect(error.textContent).toBe('');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(values).toEqual([42.5]);
  });

  it.each(['', 'abc', '-', 'Infinity', '1e3'])('«%s» al salir del campo vuelve al último valor válido', (bad) => {
    const input = $<HTMLInputElement>('f');
    const field = new NumberField({ input, error: $('e'), min: 0, max: 100, decimals: 1, step: 1, onValue: () => {} });
    field.set(20);
    type(input, bad);
    input.dispatchEvent(new Event('blur'));
    expect(input.value).toBe('20');
  });
});

describe('interfaz completa', () => {
  beforeEach(async () => {
    vi.stubGlobal('Worker', undefined); // sin workers: se usa el respaldo en el hilo principal
    window.localStorage.clear();
    document.body.innerHTML = body;
    // Pieza de 300 mm: no cabe en la cama, así que hay un aviso en la lista.
    const stl = binaryStl(cubeTriangles(300));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stl.slice(0))));
    startApp();
    $('sample-button').click();
    await until(() => $('out-total').textContent !== '—');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('el total está en una región viva y no se reescribe si no cambia', () => {
    const figure = $('out-total').closest('[aria-live]');
    expect(figure?.getAttribute('aria-live')).toBe('polite');
    expect(figure?.getAttribute('aria-atomic')).toBe('true');

    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    observer.observe($('out-total'), { childList: true, characterData: true, subtree: true });
    // Cambiar la cama no cambia el precio: el total no debe tocarse (ni anunciarse otra vez).
    type($<HTMLInputElement>('in-bedz'), '260');
    observer.disconnect();
    expect(mutations).toHaveLength(0);
  });

  it('los avisos (región viva) no se regeneran al cambiar un ajuste que no les afecta', () => {
    const before = Array.from($('warnings').children);
    expect(before).toHaveLength(1);
    type($<HTMLInputElement>('in-margin'), '45');
    expect(Array.from($('warnings').children)).toEqual(before);
    expect($('warnings').children[0]).toBe(before[0]);
  });

  it('dos clics seguidos en «Copiar» no dejan la etiqueta atascada en «Copiado»', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    vi.useFakeTimers();
    const button = $<HTMLButtonElement>('copy-button');
    button.click();
    await vi.advanceTimersByTimeAsync(100);
    button.click();
    await vi.advanceTimersByTimeAsync(100);
    expect(button.textContent).toBe('Copiado');
    await vi.advanceTimersByTimeAsync(3000);
    expect(button.textContent).toBe('Copiar presupuesto');
    expect(writeText).toHaveBeenCalledTimes(2);
  });

  it('en la interfaz nunca aparecen NaN, Infinity ni undefined con entradas absurdas', () => {
    for (const id of ['in-price', 'in-infill', 'in-flow', 'in-margin', 'in-copies', 'in-energy']) {
      const input = $<HTMLInputElement>(id);
      for (const value of ['', '-1', 'abc', '1e999', '99999999999999999999', ',']) {
        type(input, value);
        input.dispatchEvent(new Event('blur'));
        expect(document.body.textContent).not.toMatch(/NaN|Infinity|undefined/);
      }
    }
  });
});
