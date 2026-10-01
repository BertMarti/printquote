// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/quote/settings';
import { DEMO_END_MS, DEMO_STEPS, setupDemo, type DemoHost } from '../src/ui/demo';

const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
const body = (html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, '');
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

interface Calls {
  readonly log: string[];
  readonly host: DemoHost;
  release: () => void;
}

/** Host de mentira: anota lo que la demo le pide, en orden. Con `gate`, `begin` no termina hasta que se libera. */
function fakeHost(options: { loads?: boolean; gate?: boolean } = {}): Calls {
  const log: string[] = [];
  let release = (): void => {};
  const gate = options.gate ? new Promise<void>((done) => (release = done)) : Promise.resolve();
  const host: DemoHost = {
    async begin() {
      log.push('begin');
      await gate;
      return options.loads ?? true;
    },
    apply: (patch) => log.push(patch === 'restore' ? 'restore' : 'apply'),
    spin: (on) => log.push(`spin:${on}`),
    end: () => log.push('end'),
    announce: (message) => log.push(`announce:${message}`),
  };
  return { log, host, release: () => release() };
}

const button = (): HTMLButtonElement => $<HTMLButtonElement>('demo-button');
const pressed = (): string | null => button().getAttribute('aria-pressed');
const count = (log: string[], what: string): number => log.filter((l) => l === what || l.startsWith(`${what}:`)).length;
/** Cambios de ajustes pedidos al host (los pasos, incluido el que devuelve los de la persona). */
const changes = (log: string[]): number => count(log, 'apply') + count(log, 'restore');
const settle = (): Promise<unknown> => vi.advanceTimersByTimeAsync(0);
const key = (target: EventTarget, name: string): boolean => target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
const pointer = (target: EventTarget, type = 'pointerdown'): boolean => target.dispatchEvent(new Event(type, { bubbles: true }));

function reducedMotion(on: boolean): void {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({ matches: on && query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
  );
}

describe('guion de la demo', () => {
  it('es breve, ordenado y de 10 a 15 s; cambia material y relleno y devuelve los ajustes', () => {
    const times = DEMO_STEPS.map((step) => step.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(times[0]).toBe(0);
    expect(DEMO_END_MS).toBeGreaterThanOrEqual(10_000);
    expect(DEMO_END_MS).toBeLessThanOrEqual(15_000);
    expect(times.at(-1)).toBeLessThan(DEMO_END_MS);
    expect(DEMO_STEPS[0]?.patch).toEqual(DEFAULT_SETTINGS);
    const patches = DEMO_STEPS.map((s) => s.patch);
    expect(patches.some((p) => typeof p === 'object' && p.material === 'PETG')).toBe(true);
    expect(patches.some((p) => typeof p === 'object' && p.infillPercent === 40)).toBe(true);
    expect(patches.at(-1)).toBe('restore');
  });

  it('cada paso resalta un bloque que existe en la página', () => {
    document.body.innerHTML = body;
    for (const step of DEMO_STEPS) expect($(step.block).closest('section'), step.block).not.toBeNull();
  });
});

describe('demo en tiempo real', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reducedMotion(false);
    document.body.innerHTML = body;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('el botón empieza sin pulsar, y pulsarlo arranca: carga, gira y aplica el primer paso', async () => {
    const { host, log } = fakeHost();
    setupDemo(host);
    expect(pressed()).toBe('false');
    button().click();
    expect(pressed()).toBe('true');
    await settle();
    expect(log).toEqual(['begin', 'spin:true', 'apply']);
    expect($('demo-bar').hidden).toBe(false);
    expect($('demo-caption').getAttribute('aria-hidden')).toBe('true');
    expect($('demo-caption').textContent).toMatch(/pieza de ejemplo/i);
    expect($('h-part').closest('section')?.classList.contains('is-demo-focus')).toBe(true);
  });

  it('recorre los pasos en sus tiempos y termina sola con un único anuncio', async () => {
    const { host, log } = fakeHost();
    setupDemo(host);
    button().click();
    await settle();
    expect(changes(log)).toBe(1);
    await vi.advanceTimersByTimeAsync(3_600);
    expect(changes(log)).toBe(2);
    expect($('demo-caption').textContent).toMatch(/PETG/);
    await vi.advanceTimersByTimeAsync(3_500);
    expect(changes(log)).toBe(3);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(count(log, 'restore')).toBe(1);
    expect(pressed()).toBe('true'); // aún no ha terminado
    await vi.advanceTimersByTimeAsync(DEMO_END_MS);
    expect(pressed()).toBe('false');
    expect(log.slice(-3)).toEqual(['spin:false', 'end', expect.stringMatching(/^announce:Demo terminada/)]);
    expect(count(log, 'announce')).toBe(1);
    expect($('demo-bar').hidden).toBe(true);
    expect(document.querySelector('.is-demo-focus')).toBeNull();
  });

  it('el resaltado dura poco: se quita antes del siguiente paso', async () => {
    const { host } = fakeHost();
    setupDemo(host);
    button().click();
    await settle();
    expect(document.querySelector('.is-demo-focus')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(document.querySelector('.is-demo-focus')).toBeNull();
  });

  const interruptions: ReadonlyArray<readonly [string, () => void]> = [
    ['un segundo clic', () => button().click()],
    ['Esc', () => key(document.body, 'Escape')],
    ['cualquier tecla en el panel', () => key($('in-infill'), 'a')],
    ['un clic en el panel', () => pointer($('in-price'))],
    ['la rueda sobre el visor', () => pointer($('viewer'), 'wheel')],
    ['arrastrar un archivo sobre la ventana', () => pointer($('viewer'), 'dragenter')],
    ['arrastrar un archivo sobre la propia barra de la demo', () => pointer($('demo-bar'), 'dragenter')],
    ['soltar un archivo', () => pointer($('viewer'), 'drop')],
    ['un cambio de enlace (#ejemplo, #v=1…)', () => window.dispatchEvent(new Event('hashchange'))],
    [
      'pasar la pestaña a segundo plano',
      () => {
        Object.defineProperty(document, 'hidden', { value: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      },
    ],
  ];

  it.each(interruptions)('se detiene con %s: devuelve el estado y anuncia una sola vez', async (_name, interrupt) => {
    const { host, log } = fakeHost();
    setupDemo(host);
    button().click();
    await settle();
    await vi.advanceTimersByTimeAsync(4_000);
    interrupt();
    await settle();
    expect(pressed()).toBe('false');
    expect(log.slice(-3)).toEqual(['spin:false', 'end', expect.stringMatching(/^announce:/)]);
    expect(count(log, 'announce')).toBe(1);
    const applied = changes(log);
    await vi.advanceTimersByTimeAsync(DEMO_END_MS * 2); // ya no queda nada programado
    expect(changes(log)).toBe(applied);
    key(document.body, 'Escape'); // ni listeners colgados
    pointer($('in-price'));
    await settle();
    expect(count(log, 'end')).toBe(1);
    expect(count(log, 'announce')).toBe(1);
  });

  it('los controles de la propia demo no la detienen (el botón alterna con su clic)', async () => {
    const { host, log } = fakeHost();
    setupDemo(host);
    button().click();
    await settle();
    pointer(button());
    key(button(), 'Enter');
    pointer($('demo-bar'));
    await settle();
    expect(pressed()).toBe('true');
    expect(count(log, 'end')).toBe(0);
  });

  it('si se detiene mientras carga, espera a que acabe la carga antes de devolver el estado', async () => {
    const { host, log, release } = fakeHost({ gate: true });
    setupDemo(host);
    button().click();
    await settle();
    button().click();
    await settle();
    expect(pressed()).toBe('false');
    expect(log).toEqual(['begin']); // aún nada de end: la carga sigue en marcha
    release();
    await settle();
    expect(log).toEqual(['begin', 'end', expect.stringMatching(/^announce:/)]);
  });

  it('si la pieza no carga no hay recorrido ni anuncio de demo (el aviso ya lo da la app)', async () => {
    const { host, log } = fakeHost({ loads: false });
    setupDemo(host);
    button().click();
    await settle();
    expect(pressed()).toBe('false');
    expect(log).toEqual(['begin', 'end']);
  });

  it('se puede volver a ver: la segunda demo empieza de cero', async () => {
    const { host, log } = fakeHost();
    setupDemo(host);
    button().click();
    await vi.advanceTimersByTimeAsync(DEMO_END_MS + 100);
    button().click();
    await settle();
    expect(count(log, 'begin')).toBe(2);
    expect(pressed()).toBe('true');
  });
});

describe('demo con movimiento reducido', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reducedMotion(true);
    document.body.innerHTML = body;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('no avanza sola ni gira: enseña el primer paso y espera a «Siguiente»', async () => {
    const { host, log } = fakeHost();
    setupDemo(host);
    button().click();
    await settle();
    await vi.advanceTimersByTimeAsync(DEMO_END_MS * 2);
    expect(changes(log)).toBe(1);
    expect(log).not.toContain('spin:true');
    expect(pressed()).toBe('true');
    expect($('demo-next').hidden).toBe(false);
    // Sin movimiento, el subtítulo es texto legible y el botón lo describe.
    expect($('demo-caption').hasAttribute('aria-hidden')).toBe(false);
    expect($('demo-next').getAttribute('aria-describedby')).toBe('demo-caption');
  });

  it('«Siguiente» recorre los pasos; el último dice «Terminar» y cierra con un solo anuncio', async () => {
    const { host, log } = fakeHost();
    setupDemo(host);
    button().click();
    await settle();
    for (let i = 1; i < DEMO_STEPS.length; i++) {
      expect($('demo-next').textContent).toBe('Siguiente');
      $('demo-next').click();
      await settle();
      expect(changes(log)).toBe(i + 1);
    }
    expect($('demo-next').textContent).toBe('Terminar');
    $('demo-next').click();
    await settle();
    expect(pressed()).toBe('false');
    expect(count(log, 'announce')).toBe(1);
    expect(log).toContain('end');
  });

  it('pulsar «Siguiente» no la detiene, pero tocar el panel sí', async () => {
    const { host, log } = fakeHost();
    setupDemo(host);
    button().click();
    await settle();
    pointer($('demo-next'));
    expect(pressed()).toBe('true');
    pointer($('in-price'));
    await settle();
    expect(pressed()).toBe('false');
    expect(count(log, 'announce')).toBe(1);
  });
});
