import { computeStats } from './geometry';
import { parseStl, StlParseError } from './parse';
import type { Mesh, MeshStats } from './types';

/** Resultado de leer y medir un STL. */
export interface AnalyzedStl {
  readonly mesh: Mesh;
  readonly stats: MeshStats;
}

/** Lee el STL y calcula su geometría. Es lo que hace el worker; también sirve de respaldo sin workers. */
export function analyzeStl(data: ArrayBuffer | Uint8Array): AnalyzedStl {
  const mesh = parseStl(data);
  return { mesh, stats: computeStats(mesh) };
}

export interface AnalyzeRequest {
  readonly id: number;
  readonly buffer: ArrayBuffer;
}

export type AnalyzeResponse =
  | { readonly id: number; readonly ok: true; readonly result: AnalyzedStl }
  | { readonly id: number; readonly ok: false; readonly message: string; readonly parseError: boolean };

/**
 * Atiende un mensaje del worker. Devuelve la respuesta y los buffers que se pueden
 * transferir (sin copiarlos) de vuelta al hilo principal.
 */
export function handleAnalyzeRequest(request: AnalyzeRequest): { response: AnalyzeResponse; transfer: Transferable[] } {
  try {
    const result = analyzeStl(request.buffer);
    return { response: { id: request.id, ok: true, result }, transfer: [result.mesh.positions.buffer as ArrayBuffer] };
  } catch (error) {
    const parseError = error instanceof StlParseError;
    const message = parseError ? error.message : error instanceof Error ? error.message : String(error);
    return { response: { id: request.id, ok: false, message, parseError }, transfer: [] };
  }
}
