import { t, type Key } from '../i18n';
import { DEFAULT_SETTINGS, type QuoteSettings } from '../quote/settings';

/** Un paso del guion: qué cambia, qué bloque se resalta y qué dice el subtítulo. */
export interface DemoStep {
  /** Milisegundos desde que la pieza está cargada. */
  readonly at: number;
  readonly caption: Key;
  /** Id del encabezado del bloque (o del total) que se resalta. */
  readonly block: string;
  /** Cambio de ajustes; `'restore'` devuelve los de la persona. */
  readonly patch: Partial<QuoteSettings> | 'restore';
}

export const DEMO_STEPS: readonly DemoStep[] = [
  { at: 0, caption: 'demo.step.part', block: 'h-part', patch: DEFAULT_SETTINGS },
  { at: 3_500, caption: 'demo.step.material', block: 'h-material', patch: { material: 'PETG' } },
  { at: 7_000, caption: 'demo.step.infill', block: 'h-print', patch: { infillPercent: 40 } },
  { at: 10_000, caption: 'demo.step.yours', block: 'total-label', patch: 'restore' },
];

/** La demo termina sola a los 13 s. */
export const DEMO_END_MS = 13_000;
/** Gestos de la persona que paran la demo (salvo sobre sus propios controles). */
const GESTURES = ['pointerdown', 'keydown', 'wheel'];
/** El resaltado de cada bloque dura poco. */
const HIGHLIGHT_MS = 2_200;

/** Lo que la demo necesita de la aplicación: así no importa `app.ts` y se prueba con un host de mentira. */
export interface DemoHost {
  /** Guarda el estado de la persona, silencia los anuncios y carga la pieza de ejemplo. `false` si no se pudo. */
  begin(): Promise<boolean>;
  /** Aplica ajustes sin guardarlos (nunca `localStorage`). */
  apply(patch: Partial<QuoteSettings> | 'restore'): void;
  /** La cámara gira despacio (o deja de girar). */
  spin(on: boolean): void;
  /** Devuelve ajustes y pieza de la persona y reactiva los anuncios. */
  end(): void;
  announce(message: string): void;
}

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Falta el elemento #${id} en index.html`);
  return node as T;
}

/**
 * Demo guiada: «Ver demo» (`aria-pressed`) carga la pieza de ejemplo, gira la cámara, cambia material y
 * relleno y devuelve los ajustes. Se detiene con un segundo clic, Esc o cualquier interacción ajena a sus
 * controles. Con `prefers-reduced-motion` no corre sola: pasos manuales con «Siguiente».
 * `scale` acorta o alarga los tiempos (los tests de integración usan una fracción).
 */
export function setupDemo(host: DemoHost, scale = 1): void {
  const button = byId<HTMLButtonElement>('demo-button');
  const bar = byId('demo-bar');
  const caption = byId('demo-caption');
  const next = byId<HTMLButtonElement>('demo-next');

  let running = false;
  /** Entre «detener» y que acabe de devolverse el estado no se admite otro arranque. */
  let busy = false;
  let manual = false;
  let spun = false;
  let step = -1;
  let timers: number[] = [];
  let begun: Promise<boolean> = Promise.resolve(true);
  let listeners: AbortController | null = null;

  const clearHighlight = (): void => document.querySelector('.is-demo-focus')?.classList.remove('is-demo-focus');

  function highlight(block: string): void {
    clearHighlight();
    const target = document.getElementById(block)?.closest('section');
    if (!target) return;
    target.classList.add('is-demo-focus');
    // La ficha se desplaza sola en escritorio; en móvil se desplazaría toda la página, así que no.
    if (!window.matchMedia('(max-width: 900px)').matches) {
      target.scrollIntoView?.({ block: 'nearest', behavior: manual ? 'auto' : 'smooth' });
    }
  }

  function show(index: number): void {
    const current = DEMO_STEPS[index];
    if (!current) return;
    step = index;
    host.apply(current.patch);
    const counter = document.createElement('span');
    counter.className = 'demo-step num';
    counter.textContent = `${index + 1}/${DEMO_STEPS.length}`;
    caption.replaceChildren(counter, t(current.caption));
    highlight(current.block);
    if (manual) next.textContent = t(index === DEMO_STEPS.length - 1 ? 'demo.finish' : 'demo.next');
  }

  const later = (action: () => void, ms: number): void => {
    if (ms <= 0) action();
    else timers.push(window.setTimeout(action, ms * scale));
  };

  function stop(): void {
    if (!running) return;
    running = false;
    busy = true;
    for (const timer of timers) window.clearTimeout(timer);
    timers = [];
    listeners?.abort();
    clearHighlight();
    const hadFocus = bar.contains(document.activeElement);
    button.setAttribute('aria-pressed', 'false');
    bar.hidden = true;
    next.hidden = true;
    if (hadFocus) button.focus();
    // Si aún estaba cargando, el estado se devuelve cuando acabe la carga (no antes).
    void begun.then((ok) => {
      if (spun) host.spin(false);
      spun = false;
      host.end();
      busy = false;
      if (ok) host.announce(t('demo.done')); // el único anuncio de toda la demo
    });
  }

  function start(): void {
    if (running || busy) return;
    running = true;
    manual = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    step = -1;
    button.setAttribute('aria-pressed', 'true');
    bar.hidden = false;
    next.hidden = true;
    caption.replaceChildren();
    if (manual) caption.removeAttribute('aria-hidden'); // sin movimiento, el subtítulo es texto para leer
    else caption.setAttribute('aria-hidden', 'true'); // con movimiento sería verborrea: un solo anuncio, al final

    listeners = new AbortController();
    const { signal } = listeners;
    const interrupt = (event: Event): void => {
      if (event instanceof KeyboardEvent && event.key === 'Escape') return stop();
      // Sus propios controles no la paran (solo los gestos de la persona; un archivo que llega, siempre).
      if (GESTURES.includes(event.type) && event.target instanceof Element && event.target.closest('[data-demo-ui]')) return;
      stop();
    };
    for (const type of [...GESTURES, 'dragenter', 'drop']) document.addEventListener(type, interrupt, { capture: true, signal });
    // Un archivo soltado no genera pointerdown ni keydown: también la para (el de `hashchange` está en `setupDemo`).
    document.addEventListener('visibilitychange', () => document.hidden && stop(), { signal });

    begun = host.begin().catch(() => false);
    void begun.then((ok) => {
      if (!running) return;
      if (!ok) return stop();
      if (manual) {
        next.hidden = false;
        show(0);
        next.focus();
        return;
      }
      host.spin(true);
      spun = true;
      DEMO_STEPS.forEach((s, i) => {
        later(() => show(i), s.at);
        later(clearHighlight, s.at + HIGHLIGHT_MS);
      });
      later(stop, DEMO_END_MS);
    });
  }

  button.addEventListener('click', () => (running ? stop() : start()));
  // Un enlace nuevo (#ejemplo, #v=1…) también la para. Se registra aquí, una vez y antes que el de la aplicación
  // (si `setupDemo` se llama antes), para que la aplicación lo aplique con la demo ya parada.
  window.addEventListener('hashchange', () => stop());
  next.addEventListener('click', () => (step >= DEMO_STEPS.length - 1 ? stop() : show(step + 1)));
}
