/** Cada pulsación acerca o aleja un 15 % (la rueda del ratón hace algo parecido por «muesca»). */
export const KEY_ZOOM_STEP = 1.15;

/**
 * Factor por el que hay que multiplicar la distancia de la cámara al objetivo para una tecla del
 * visor: menor que 1 acerca (`+`, `=`), mayor que 1 aleja (`-`, `_`). Devuelve `null` si no es una
 * tecla de zoom, si lleva Ctrl, Cmd o Alt (son el zoom de la página y atajos del sistema) o si no hay
 * pieza cargada (`hasPart`: con el visor vacío no hay nada que acercar).
 * El cambio es inmediato, sin animación, así que respeta `prefers-reduced-motion`.
 */
export function keyZoomFactor(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>, hasPart: boolean): number | null {
  if (!hasPart || event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.key === '+' || event.key === '=') return 1 / KEY_ZOOM_STEP;
  if (event.key === '-' || event.key === '_') return KEY_ZOOM_STEP;
  return null;
}
