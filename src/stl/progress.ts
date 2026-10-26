/**
 * Progreso del análisis de un modelo (lo envía el worker al hilo principal para la barra de carga).
 * Los bucles largos llaman a su reportero cada 65 536 vueltas (o al cruzar un umbral de bytes): así
 * informar apenas cuesta y se envían como mucho ~101 mensajes por archivo.
 */

/** Recibe una fracción de 0 a 1. */
export type ProgressFn = (fraction: number) => void;

/** Cada cuántas vueltas (o bytes) informan los bucles de lectura y geometría. */
export const PROGRESS_EVERY = 0x10000;

/**
 * Reparte el progreso en etapas (`stage(inicio, fin)` devuelve un reportero `(hecho, total)`) y lo
 * entrega monótono (nunca baja), recortado a [0, 1] y solo cuando cambia el porcentaje entero.
 * Sin `onProgress` todo es una función vacía.
 */

export function createProgress(onProgress?: ProgressFn): {
  stage: (start: number, end: number) => (done: number, total: number) => void;
  done: () => void;
} {
  if (!onProgress) {
    const noop = (): void => undefined;
    return { stage: () => noop, done: noop };
  }
  let last = -1;
  const emit = (fraction: number): void => {
    const value = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
    const percent = Math.floor(value * 100);
    if (percent <= last) return;
    last = percent;
    onProgress(percent / 100);
  };
  return {
    stage: (start, end) => (done, total) => emit(start + (end - start) * (total > 0 ? done / total : 0)),
    done: () => emit(1),
  };
}
