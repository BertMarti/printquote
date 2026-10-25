import type { ErrorKey } from '../i18n/es';
import type { Params } from '../i18n/interpolate';
import { ModelParseError } from './errors';
import { computeStats } from './geometry';
import { MAX_FILE_BYTES } from './limits';
import { parseModel } from './model';
import { parseStl } from './parse';
import type { Mesh, MeshStats } from './types';

/** Resultado de leer y medir un modelo (STL, OBJ o 3MF). */
export interface AnalyzedStl {
  readonly mesh: Mesh;
  readonly stats: MeshStats;
}

/** Lee un STL y calcula su geometría (síncrono: el STL no necesita descomprimir nada). */
export function analyzeStl(data: ArrayBuffer | Uint8Array): AnalyzedStl {
  const mesh = parseStl(data);
  return { mesh, stats: computeStats(mesh) };
}

/**
 * Lee un STL, OBJ o 3MF (el formato se deduce del contenido y del nombre) y calcula su
 * geometría. Es lo que hace el worker; también sirve de respaldo sin workers.
 */
export async function analyzeModel(data: ArrayBuffer | Uint8Array, fileName?: string, signal?: AbortSignal): Promise<AnalyzedStl> {
  // La interfaz ya lo comprueba con `File.size`; esto cubre cualquier otro camino (p. ej. el worker).
  if (data.byteLength > MAX_FILE_BYTES) {
    throw new ModelParseError('err.fileTooBig', { mb: MAX_FILE_BYTES / 1024 / 1024 });
  }
  try {
    const mesh = await parseModel(data, fileName);
    // Sin worker esto corre en el hilo principal: si mientras tanto se pidió otro archivo, se para aquí
    // (antes de la soldadura de vértices, que es lo más caro) y se libera la memoria cuanto antes.
    if (signal?.aborted) throw new ModelParseError('err.cancelled');
    return { mesh, stats: computeStats(mesh) };
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

export type AnalyzeResponse =
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
 * transferir (sin copiarlos) de vuelta al hilo principal.
 */
export async function handleAnalyzeRequest(
  request: AnalyzeRequest,
): Promise<{ response: AnalyzeResponse; transfer: Transferable[] }> {
  try {
    const result = await analyzeModel(request.buffer, request.fileName);
    return { response: { id: request.id, ok: true, result }, transfer: [result.mesh.positions.buffer as ArrayBuffer] };
  } catch (error) {
    const parseError = error instanceof ModelParseError ? { code: error.code, params: error.params } : null;
    const message = error instanceof Error ? error.message : String(error);
    return { response: { id: request.id, ok: false, message, parseError }, transfer: [] };
  }
}
