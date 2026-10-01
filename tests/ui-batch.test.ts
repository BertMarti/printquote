// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../src/i18n';
import { BATCH_MAX } from '../src/quote/batch';
import { startApp } from '../src/ui/app';
import { binaryStl, cubeTriangles } from './helpers/mesh';

const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
const body = (html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, '');
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const button = (id: string): HTMLButtonElement => $<HTMLButtonElement>(id);
const items = (): HTMLElement[] => Array.from($('batch-list').children) as HTMLElement[];
const removeButtons = (): HTMLButtonElement[] => Array.from($('batch-list').querySelectorAll<HTMLButtonElement>('button[data-id]'));
const euros = (text: string | null | undefined): number => Number((text ?? '').replace(/[^\d,]/g, '').replace(',', '.'));

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(check()).toBe(true);
}

function type(id: string, value: string): void {
  const input = $<HTMLInputElement>(id);
  input.value = value;
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new Event('change'));
}

describe('lote en la interfaz', () => {
  async function start(withPart = true): Promise<void> {
    document.body.innerHTML = body;
    startApp();
    if (withPart) {
      $('sample-button').click();
      await until(() => $('out-total').textContent !== '—');
    }
  }

  beforeEach(() => {
    vi.stubGlobal('Worker', undefined);
    window.localStorage.clear();
    setLang('es');
    const stl = binaryStl(cubeTriangles(20));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stl.slice(0))));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('el bloque 06 es plegable, empieza plegado y vacío, y «Añadir» no se puede usar sin pieza', async () => {
    await start(false);
    const details = $<HTMLDetailsElement>('batch-details');
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')?.textContent).toMatch(/06\s*Lote/);
    expect(button('batch-add').disabled).toBe(true);
    expect(items()).toHaveLength(0);
    expect($('batch-empty').hidden).toBe(false);
    expect($('batch-summary').hidden).toBe(true);
    expect(button('batch-clear').disabled).toBe(true);
    // Los bloques de después se renumeran.
    expect($('h-business').textContent).toMatch(/07/);
    expect($('h-history').textContent).toMatch(/08/);
  });

  it('con pieza, el botón muestra el importe; al añadir se abre el bloque y aparece la línea con su total', async () => {
    await start();
    expect(button('batch-add').disabled).toBe(false);
    expect(button('batch-add').textContent).toBe(`Añadir esta pieza · ${$('out-total').textContent}`);
    button('batch-add').click();
    expect($<HTMLDetailsElement>('batch-details').open).toBe(true);
    expect(items()).toHaveLength(1);
    expect(items()[0]?.textContent).toContain('soporte-movil.stl');
    expect(items()[0]?.querySelector('.history-total')?.textContent).toBe($('out-total').textContent);
    expect(euros($('out-batch-total').textContent)).toBe(euros($('out-total').textContent));
    expect($('batch-count').textContent).toBe('(1)');
    expect($('batch-summary').hidden).toBe(false);
  });

  it('cada línea conserva los ajustes con que se añadió y el total del lote suma las líneas', async () => {
    await start();
    button('batch-add').click();
    const first = items()[0]?.querySelector('.history-total')?.textContent;
    type('in-copies', '4');
    document.querySelector<HTMLInputElement>('input[name="material"][value="PETG"]')?.click();
    button('batch-add').click();
    expect(items()).toHaveLength(2);
    expect(items()[0]?.querySelector('.history-total')?.textContent).toBe(first); // la primera no cambia
    expect(items()[1]?.querySelector('.history-meta')?.textContent).toMatch(/PETG.*4 copias/);
    expect(items()[0]?.querySelector('.history-meta')?.textContent).toMatch(/PLA.*1 copia$/);
    const sum = items().reduce((acc, li) => acc + euros(li.querySelector('.history-total')?.textContent), 0);
    expect(euros($('out-batch-total').textContent)).toBeCloseTo(sum, 2);
    expect($('out-batch-copies').textContent).toBe('5');
  });

  it('quitar recalcula, mueve el foco y anuncia; sin piezas vuelve al estado vacío', async () => {
    await start();
    button('batch-add').click();
    type('in-copies', '3');
    button('batch-add').click();
    type('in-copies', '2');
    button('batch-add').click();
    expect(items()).toHaveLength(3);
    const before = $('out-batch-total').textContent;

    const middle = removeButtons()[1];
    expect(middle?.getAttribute('aria-label')).toBe('Quitar soporte-movil.stl del lote');
    middle?.click();
    expect(items()).toHaveLength(2);
    expect($('out-batch-total').textContent).not.toBe(before);
    expect(document.activeElement).toBe(removeButtons()[1]); // el «Quitar» que ocupa su sitio
    await until(() => /Quedan 2/.test($('live-status').textContent ?? ''));

    removeButtons()[1]?.click();
    expect(document.activeElement).toBe(removeButtons()[0]); // era el último: el anterior
    removeButtons()[0]?.click();
    expect(items()).toHaveLength(0);
    expect($('batch-empty').hidden).toBe(false);
    expect($('batch-summary').hidden).toBe(true);
    expect($('batch-count').textContent).toBe('');
    expect(document.activeElement).toBe(button('batch-add'));
    await until(() => /vacío/.test($('live-status').textContent ?? ''));
  });

  it('«Vaciar lote» pide un segundo clic y se puede cancelar', async () => {
    await start();
    button('batch-add').click();
    button('batch-add').click();
    button('batch-clear').click();
    expect(button('batch-clear').textContent).toBe('Confirmar: quitar las 2');
    expect(button('batch-cancel').hidden).toBe(false);
    button('batch-cancel').click();
    expect(items()).toHaveLength(2);
    expect(button('batch-cancel').hidden).toBe(true);
    button('batch-clear').click();
    button('batch-clear').click();
    expect(items()).toHaveLength(0);
    expect(button('batch-clear').textContent).toBe('Vaciar lote');
  });

  it('con 50 piezas el botón se desactiva', async () => {
    await start();
    for (let i = 0; i < BATCH_MAX; i++) button('batch-add').click();
    expect(items()).toHaveLength(BATCH_MAX);
    expect(button('batch-add').disabled).toBe(true);
    expect(button('batch-add').textContent).toBe('Lote lleno (50 piezas)');
    removeButtons()[0]?.click();
    expect(button('batch-add').disabled).toBe(false);
  });

  it('al añadir la pieza 50 se anuncia «Lote lleno» y el foco no se queda en el botón desactivado', async () => {
    await start();
    for (let i = 0; i < BATCH_MAX; i++) button('batch-add').click();
    expect(button('batch-add').disabled).toBe(true);
    await until(() => /Lote lleno/.test($('live-status').textContent ?? ''));
    expect(document.activeElement).toBe(button('batch-copy'));
  });

  it('el lote sobrevive a recargar: mismas líneas y mismo total; vaciarlo borra lo guardado', async () => {
    await start();
    type('in-copies', '3');
    button('batch-add').click();
    document.querySelector<HTMLInputElement>('input[name="material"][value="PETG"]')?.click();
    button('batch-add').click();
    const total = $('out-batch-total').textContent;
    const names = items().map((item) => item.querySelector('.history-name')?.textContent);
    expect(window.localStorage.getItem('printquote:lote:v1')).not.toBeNull();

    // «Recargar»: la página vuelve a arrancar sin pieza cargada.
    await start(false);
    expect(items()).toHaveLength(2);
    expect(items().map((item) => item.querySelector('.history-name')?.textContent)).toEqual(names);
    expect($('out-batch-total').textContent).toBe(total);
    expect($('batch-count').textContent).toBe('(2)');
    expect(button('batch-copy').disabled).toBe(false);
    expect(button('batch-pdf').disabled).toBe(false);
    expect(button('history-save-batch').disabled).toBe(false);
    expect($('batch-empty').hidden).toBe(true);

    button('batch-clear').click();
    button('batch-clear').click();
    expect(window.localStorage.getItem('printquote:lote:v1')).toBeNull();
    await start(false);
    expect(items()).toHaveLength(0);
    expect(button('batch-copy').disabled).toBe(true);
  });

  it('un lote guardado corrupto se ignora y la app arranca vacía', async () => {
    window.localStorage.setItem('printquote:lote:v1', '{"v":1,"parts":[{"fileName":"x"}]}');
    await start(false);
    expect(items()).toHaveLength(0);
    expect($('batch-empty').hidden).toBe(false);
  });

  it('si no se puede guardar el lote, la lista sigue funcionando', async () => {
    await start();
    const set = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('lleno', 'QuotaExceededError');
    });
    try {
      button('batch-add').click();
    } finally {
      set.mockRestore();
    }
    expect(items()).toHaveLength(1);
  });

  describe('copias de una línea', () => {
    const copiesInput = (index = 0): HTMLInputElement => items()[index]?.querySelector<HTMLInputElement>('input[data-copies]') as HTMLInputElement;
    const setCopies = (input: HTMLInputElement, value: string): void => {
      input.value = value;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };

    it('cada línea tiene un campo numérico accesible con sus copias', async () => {
      await start();
      type('in-copies', '4');
      button('batch-add').click();
      const input = copiesInput();
      expect(input.type).toBe('number');
      expect(input.min).toBe('1');
      expect(input.max).toBe('10000');
      expect(input.step).toBe('1');
      expect(input.value).toBe('4');
      expect(input.getAttribute('aria-label')).toBe('Copias de soporte-movil.stl');
      expect(items()[0]?.querySelector('label')?.textContent).toContain('Copias');
    });

    it('cambiar las copias recalcula la línea con SUS ajustes (no los del formulario) y el total del lote', async () => {
      await start();
      document.querySelector<HTMLInputElement>('input[name="material"][value="PETG"]')?.click();
      type('in-copies', '3');
      const expected = euros($('out-total').textContent); // PETG × 3, calculado por la ficha
      type('in-copies', '1');
      button('batch-add').click();
      const oneCopy = euros(items()[0]?.querySelector('.history-total')?.textContent);
      document.querySelector<HTMLInputElement>('input[name="material"][value="ABS"]')?.click(); // el formulario ya no es PETG
      button('batch-add').click();
      const second = euros(items()[1]?.querySelector('.history-total')?.textContent);

      const input = copiesInput(0);
      setCopies(input, '3');
      expect(euros(items()[0]?.querySelector('.history-total')?.textContent)).toBe(expected);
      expect(expected).toBeGreaterThan(oneCopy);
      expect(items()[0]?.querySelector('.history-meta')?.textContent).toMatch(/PETG.*3 copias/);
      expect(euros(items()[1]?.querySelector('.history-total')?.textContent)).toBe(second);
      expect(euros($('out-batch-total').textContent)).toBeCloseTo(expected + second, 2);
      expect($('out-batch-copies').textContent).toBe('4');
      // El campo no se vuelve a crear: el foco y el cursor no se pierden.
      expect(copiesInput(0)).toBe(input);
      // Persiste.
      expect(JSON.parse(window.localStorage.getItem('printquote:lote:v1') ?? '{}').parts[0].settings.copies).toBe(3);
      await until(() => /Copias de soporte-movil\.stl: 3\. Total del lote/.test($('live-status').textContent ?? ''));
    });

    it('un valor vacío o no numérico vuelve al actual; fuera de rango o decimal se acota', async () => {
      await start();
      type('in-copies', '2');
      button('batch-add').click();
      const input = copiesInput();
      setCopies(input, '');
      expect(input.value).toBe('2');
      setCopies(input, 'abc');
      expect(input.value).toBe('2');
      setCopies(input, '0');
      expect(input.value).toBe('1');
      setCopies(input, '-4');
      expect(input.value).toBe('1');
      setCopies(input, '99999');
      expect(input.value).toBe('10000');
      setCopies(input, '2.6');
      expect(input.value).toBe('3');
      expect(items()[0]?.querySelector('.history-meta')?.textContent).toMatch(/3 copias/);
    });

    it('con 1 copia la línea dice «1 copia» y no se anuncia nada si no hay cambio', async () => {
      await start();
      type('in-copies', '2');
      button('batch-add').click();
      setCopies(copiesInput(), '1');
      expect(items()[0]?.querySelector('.history-meta')?.textContent).toContain('1 copia');
      expect(items()[0]?.querySelector('.history-meta')?.textContent).not.toMatch(/1 copias/);
      await until(() => /Copias de/.test($('live-status').textContent ?? ''));
      $('live-status').textContent = '';
      setCopies(copiesInput(), '1');
      await new Promise((r) => setTimeout(r, 80));
      expect($('live-status').textContent).toBe('');
    });

    it('en inglés el campo se llama «Copies of …»', async () => {
      await start();
      button('batch-add').click();
      setLang('en');
      document.querySelector<HTMLButtonElement>('button[data-lang="en"]')?.click();
      expect(copiesInput().getAttribute('aria-label')).toBe('Copies of soporte-movil.stl');
    });
  });

  it('el nombre del archivo nunca se interpreta como HTML', async () => {
    document.body.innerHTML = body;
    startApp();
    const evil = '<img src=x onerror=alert(1)>.stl';
    const file = new File([binaryStl(cubeTriangles(20))], evil);
    const input = $<HTMLInputElement>('file-input');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await until(() => $('out-total').textContent !== '—');
    button('batch-add').click();
    expect($('batch-list').querySelector('img')).toBeNull();
    expect(items()[0]?.querySelector('.history-name')?.textContent).toBe(evil);
  });

  it('el enlace para compartir lleva solo parámetros, con o sin lote', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await start();
    const copied = async (): Promise<string> => {
      writeText.mockClear();
      button('share-copy').click();
      await until(() => writeText.mock.calls.length > 0);
      return String((writeText.mock.calls[0] as unknown[])[0]);
    };
    const without = await copied();
    button('batch-add').click();
    expect(await copied()).toBe(without);
    expect(without).toContain('#v=1&');
    expect(without).not.toMatch(/soporte|parts|batch|lote/i);
  });
});
