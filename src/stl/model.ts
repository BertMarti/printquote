import { ModelParseError } from './errors';
import { parseObj } from './obj';
import { parseStl } from './parse';
import { parse3mf } from './threemf';
import type { Mesh } from './types';

/** Extensiones que acepta la aplicación, para el selector de archivos. */
export const MODEL_EXTENSIONS = ['.stl', '.obj', '.3mf'] as const;

type Kind = 'stl' | 'obj' | '3mf';

/** ¿Empieza por la firma de un ZIP («PK»)? Un 3MF es siempre un ZIP. */
function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5) && (bytes[3] === 4 || bytes[3] === 6);
}

/** ¿Parece un OBJ de texto? Alguna línea «v x y z» o «f …» y ninguna «facet» de STL ASCII. */
function looksLikeObj(bytes: Uint8Array): boolean {
  const sample = new TextDecoder('utf-8').decode(bytes.subarray(0, 4096));
  if (/^\s*(solid|facet)\b/im.test(sample) || sample.includes('\u0000')) return false;
  return /^\s*v\s+[-+.\d]/m.test(sample);
}

/**
 * Decide el formato mirando el contenido y, si hace falta, el nombre. El contenido manda:
 * un ZIP es un 3MF aunque se llame «.stl», y un STL binario nunca se toma por OBJ. La
 * extensión desempata solo cuando el contenido es texto.
 */
export function detectKind(bytes: Uint8Array, fileName?: string): Kind {
  if (isZip(bytes)) return '3mf';
  const name = (fileName ?? '').toLowerCase();
  if (name.endsWith('.obj')) return 'obj';
  if (name.endsWith('.stl')) return 'stl';
  if (name.endsWith('.3mf')) return '3mf'; // no es un ZIP: parse3mf dará un error claro
  return looksLikeObj(bytes) ? 'obj' : 'stl';
}

/** Lee un STL, un OBJ o un 3MF. */
export async function parseModel(data: ArrayBuffer | Uint8Array, fileName?: string): Promise<Mesh> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  switch (detectKind(bytes, fileName)) {
    case '3mf':
      if (!isZip(bytes)) {
        throw new ModelParseError('err.3mf.notZip');
      }
      return parse3mf(bytes);
    case 'obj':
      return parseObj(bytes);
    case 'stl':
      return parseStl(bytes);
  }
}
