import type { Mesh } from './types';

/** Error de lectura de STL con un mensaje pensado para mostrarse tal cual a la persona usuaria. */
export class StlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StlParseError';
  }
}

const HEADER_BYTES = 80;
const COUNT_BYTES = 4;
const BINARY_PREAMBLE = HEADER_BYTES + COUNT_BYTES;
const BYTES_PER_TRIANGLE = 50;
/** Tamaño de la muestra que se inspecciona para decidir si el archivo es texto. */
const TEXT_SNIFF_BYTES = 1024;

/**
 * Lee un STL binario o ASCII.
 *
 * La detección no se fía solo de la cabecera «solid»: muchos exportadores escriben
 * «solid …» en la cabecera de archivos binarios. Se decide así:
 * 1. Si el tamaño coincide exactamente con 84 + 50 × nº de triángulos, es binario,
 *    salvo que empiece por «solid», sea texto y contenga «facet» (ASCII casual).
 * 2. Si parece texto y empieza por «solid», es ASCII.
 * 3. Si el tamaño es mayor de lo esperado (relleno al final), se acepta como binario.
 */
export function parseStl(data: ArrayBuffer | Uint8Array): Mesh {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

  if (bytes.byteLength === 0) {
    throw new StlParseError('El archivo está vacío.');
  }

  const looksAscii = startsWithSolid(bytes) && isMostlyText(bytes);

  if (bytes.byteLength >= BINARY_PREAMBLE) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = view.getUint32(HEADER_BYTES, true);
    const expected = BINARY_PREAMBLE + count * BYTES_PER_TRIANGLE;

    if (expected === bytes.byteLength && !(looksAscii && containsFacet(bytes))) {
      return parseBinary(view, count);
    }
    if (looksAscii) {
      return parseAscii(bytes);
    }
    if (count > 0 && expected < bytes.byteLength) {
      return parseBinary(view, count);
    }
    if (count === 0 && expected === bytes.byteLength) {
      throw new StlParseError('El STL no contiene ningún triángulo.');
    }
    throw new StlParseError(
      'No parece un STL válido: el tamaño del archivo no coincide con el número de triángulos que declara y tampoco es un STL de texto.',
    );
  }

  if (looksAscii) {
    return parseAscii(bytes);
  }
  throw new StlParseError('No parece un STL válido: el archivo es demasiado pequeño.');
}

function parseBinary(view: DataView, count: number): Mesh {
  if (count === 0) {
    throw new StlParseError('El STL no contiene ningún triángulo.');
  }
  const positions = new Float32Array(count * 9);
  for (let t = 0; t < count; t++) {
    // Cada triángulo: normal (12 bytes), 3 vértices (36 bytes), atributo (2 bytes).
    const base = BINARY_PREAMBLE + t * BYTES_PER_TRIANGLE + 12;
    for (let k = 0; k < 9; k++) {
      const value = view.getFloat32(base + k * 4, true);
      if (!Number.isFinite(value)) {
        throw new StlParseError(`El triángulo ${t + 1} tiene coordenadas no válidas.`);
      }
      positions[t * 9 + k] = value;
    }
  }
  return { positions, triangleCount: count, format: 'binary' };
}

function parseAscii(bytes: Uint8Array): Mesh {
  const text = new TextDecoder('utf-8').decode(bytes);
  const tokens = text.split(/\s+/).filter((token) => token.length > 0);

  const values: number[] = [];
  let facet = 0;
  let verticesInFacet = 0;
  let insideFacet = false;

  for (let i = 0; i < tokens.length; i++) {
    const token = (tokens[i] ?? '').toLowerCase();
    if (token === 'facet') {
      if (insideFacet) {
        throw new StlParseError(`La cara ${facet} no se cierra con «endfacet».`);
      }
      insideFacet = true;
      facet++;
      verticesInFacet = 0;
    } else if (token === 'vertex') {
      if (!insideFacet) {
        throw new StlParseError('Hay un vértice fuera de una cara («facet»).');
      }
      for (let k = 1; k <= 3; k++) {
        const value = Number(tokens[i + k]);
        if (tokens[i + k] === undefined || !Number.isFinite(value)) {
          throw new StlParseError(`La cara ${facet} tiene un vértice con coordenadas no válidas.`);
        }
        values.push(value);
      }
      i += 3;
      verticesInFacet++;
    } else if (token === 'endfacet') {
      if (!insideFacet || verticesInFacet !== 3) {
        throw new StlParseError(`La cara ${facet} no tiene exactamente 3 vértices.`);
      }
      insideFacet = false;
    }
  }

  if (insideFacet) {
    throw new StlParseError('El archivo termina en mitad de una cara: parece estar cortado.');
  }
  if (facet === 0) {
    throw new StlParseError('El STL no contiene ningún triángulo.');
  }

  return { positions: Float32Array.from(values), triangleCount: facet, format: 'ascii' };
}

function startsWithSolid(bytes: Uint8Array): boolean {
  let i = 0;
  while (i < bytes.length && isWhitespace(bytes[i] ?? 0)) i++;
  const word = String.fromCharCode(...bytes.subarray(i, i + 5)).toLowerCase();
  return word === 'solid';
}

function isWhitespace(byte: number): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}

/** Texto = sin bytes nulos ni de control (salvo tabulador y saltos) en la muestra inicial. */
function isMostlyText(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, TEXT_SNIFF_BYTES);
  for (let i = 0; i < end; i++) {
    const b = bytes[i] ?? 0;
    if (b < 0x20 && !isWhitespace(b)) return false;
  }
  return true;
}

function containsFacet(bytes: Uint8Array): boolean {
  const sample = String.fromCharCode(...bytes.subarray(0, TEXT_SNIFF_BYTES)).toLowerCase();
  return sample.includes('facet');
}
