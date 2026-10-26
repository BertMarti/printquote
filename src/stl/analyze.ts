import type { ErrorKey } from '../i18n/es';
import type { Params } from '../i18n/interpolate';
import { ModelParseError } from './errors';
import { computeStats } from './geometry';
import { MAX_FILE_BYTES } from './limits';
import { parseModel } from './model';
import { parseStl } from './parse';
import type { Mesh, MeshStats } from './types';
import { createProgress, type ProgressFn } from './progress';

/** Resultado de leer y medir un modelo (STL, OBJ o 3MF). */
export interface AnalyzedStl {
  readonly mesh: Mesh;
  readonly stats: MeshStats;
}

/** Lee un STL y calcula su geometría (síncrono: el STL no necesita descomprimir nada). */
export function analyzeStl(data: ArrayBuffer | Uint8Array, onProgress?: ProgressFn): AnalyzedStl {
  const progress = createProgress(onProgress);
  const mesh = parseStl(data, (fraction) => progress.stage(0, 0.5)(fraction, 1));
  return { mesh, stats: computeStats(mesh, (fraction) => progress.stage(0.5, 1)(fraction, 1)) };
}

/**
 * Lee un STL, OBJ o 3MF (el formato se deduce del contenido y del nombre) y calcula su
 * geometría. Es lo que hace el worker; también sirve de respaldo sin workers.
 */
export async function analyzeModel(
  data: ArrayBuffer | Uint8Array,
  fileName?: string,
  signal?: AbortSignal,
  onProgress?: ProgressFn,
): Promise<AnalyzedStl> {
  // La interfaz ya lo comprueba con `File.size`; esto cubre cualquier otro camino (p. ej. el worker).
  if (data.byteLength > MAX_FILE_BYTES) {
    throw new ModelParseError('err.fileTooBig', { mb: MAX_FILE_BYTES / 1024 / 1024 });
  }
  try {
    const progress = createProgress(onProgress);
    const mesh = await parseModel(data, fileName, (fraction) => progress.stage(0, 0.5)(fraction, 1));
    // Sin worker esto corre en el hilo principal: si mientras tanto se pidió otro archivo, se para aquí
    // (antes de la soldadura de vértices, que es lo más caro) y se libera la memoria cuanto antes.
    if (signal?.aborted) throw new ModelParseError('err.cancelled');
    return {
      mesh,
      stats: computeStats(mesh, (fraction) => progress.stage(0.5, 1)(fraction, 1)),
    };
  } catch (error) {
    // Sin memoria para los arrays de trabajo (o un tope interno del motor de JavaScript): en vez del
    // mensaje genérico, se explica qué hacer.
    if (error instanceof RangeError) throw new ModelParseError('err.tooComplex');
    throw error;
  }
}

export interface AnalyzeRequest {
  readonly id: number;
  readonly buffer: ArrayBuffer;
  /** Nombre del archivo: desempata el formato cuando el contenido es texto (OBJ o STL ASCII). */
  readonly fileName?: string;
}

/** Aviso de progreso del worker (porcentaje entero de 0 a 100); puede llegar varias veces antes del resultado. */
export interface AnalyzeProgress {
  readonly id: number;
  readonly progress: number;
}

/** Mensajes del worker al hilo principal: progreso o resultado final. */
export type AnalyzeResponse = AnalyzeProgress | AnalyzeResult;

/** Resultado final de un análisis (una sola vez por petición). */
export type AnalyzeResult =
  | { readonly id: number; readonly ok: true; readonly result: AnalyzedStl }
  | {
      readonly id: number;
      readonly ok: false;
      readonly message: string;
      /** Si es un error de lectura previsto: su código y datos, para traducirlo en la interfaz. */
      readonly parseError: { readonly code: ErrorKey; readonly params: Params } | null;
    };

/**
 * Atiende un mensaje del worker. Devuelve la respuesta y los buffers que se pueden
 * transferir (sin copiarlos) de vuelta al hilo principal. `onProgress` recibe el porcentaje entero
 * (0–100) cada vez que cambia; el worker lo reenvía como `AnalyzeProgress`.
 */
export async function handleAnalyzeRequest(
  request: AnalyzeRequest,
  onProgress?: (percent: number) => void,
): Promise<{ response: AnalyzeResult; transfer: Transferable[] }> {
  try {
    const result = await analyzeModel(request.buffer, request.fileName, undefined, (fraction) => onProgress?.(Math.floor(fraction * 100)));
    return { response: { id: request.id, ok: true, result }, transfer: [result.mesh.positions.buffer as ArrayBuffer] };
  } catch (error) {
    const parseError = error instanceof ModelParseError ? { code: error.code, params: error.params } : null;
    const message = error instanceof Error ? error.message : String(error);
    return { response: { id: request.id, ok: false, message, parseError }, transfer: [] };
  }
}
