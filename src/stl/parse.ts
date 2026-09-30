import type { ErrorKey } from '../i18n/es';
import type { Params } from '../i18n/interpolate';
import { ModelParseError } from './errors';
import type { Mesh } from './types';

/** Error de lectura de un STL (mensajes en `i18n/es.ts`, claves `err.stl.*`). */
export class StlParseError extends ModelParseError {
  constructor(code: ErrorKey, params?: Params) {
    super(code, params);
    this.name = 'StlParseError';
  }
}

const HEADER_BYTES = 80;
const COUNT_BYTES = 4;
const BINARY_PREAMBLE = HEADER_BYTES + COUNT_BYTES;
const BYTES_PER_TRIANGLE = 50;
/** Tamaño de la muestra que se inspecciona para decidir si el archivo es texto. */
const TEXT_SNIFF_BYTES = 1024;
/** Marca de orden de bytes de UTF-8 que algunos editores de Windows añaden al principio. */
const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;
/** Una coordenada ASCII más larga que esto no es un número razonable. */
const MAX_NUMBER_TOKEN = 64;

/**
 * Lee un STL binario o ASCII.
 *
 * La detección no se fía solo de la cabecera «solid»: muchos exportadores escriben
 * «solid …» en la cabecera de archivos binarios. Se decide así:
 * 1. Si el tamaño coincide exactamente con 84 + 50 × nº de triángulos, es binario,
 *    salvo que empiece por «solid», sea texto y contenga «facet» (ASCII casual).
 * 2. Si parece texto y empieza por «solid», es ASCII.
 * 3. Si el tamaño es mayor de lo esperado (relleno al final), se acepta como binario.
 * 4. Si el recuento es 0 pero el tamaño cuadra con 84 + 50 × n, se leen esos n
 *    triángulos (hay exportadores que no rellenan el recuento).
 */
export function parseStl(data: ArrayBuffer | Uint8Array): Mesh {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

  if (bytes.byteLength === 0) {
    throw new StlParseError('err.empty');
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
    const inferred = (bytes.byteLength - BINARY_PREAMBLE) / BYTES_PER_TRIANGLE;
    if (count === 0 && Number.isInteger(inferred)) {
      return parseBinary(view, inferred);
    }
    throw new StlParseError('err.stl.size');
  }

  if (looksAscii) {
    return parseAscii(bytes);
  }
  throw new StlParseError('err.stl.small');
}

function parseBinary(view: DataView, count: number): Mesh {
  if (count === 0) {
    throw new StlParseError('err.stl.noTriangles');
  }
  const positions = new Float32Array(count * 9);
  for (let t = 0; t < count; t++) {
    // Cada triángulo: normal (12 bytes), 3 vértices (36 bytes), atributo (2 bytes).
    const base = BINARY_PREAMBLE + t * BYTES_PER_TRIANGLE + 12;
    for (let k = 0; k < 9; k++) {
      const value = view.getFloat32(base + k * 4, true);
      if (!Number.isFinite(value)) {
        throw new StlParseError('err.stl.badTriangle', { n: t + 1 });
      }
      positions[t * 9 + k] = value;
    }
  }
  return { positions, triangleCount: count, format: 'binary' };
}

/**
 * Recorre el texto byte a byte, sin decodificarlo entero ni partirlo en un array de
 * palabras: con archivos de cientos de MB eso multiplicaba la memoria por diez.
 */
class Tokenizer {
  pos: number;
  start = 0;
  end = 0;

  constructor(private readonly bytes: Uint8Array, from: number) {
    this.pos = from;
  }

  /** Avanza a la siguiente palabra. Cualquier byte ≤ 0x20 (espacio, tabulador, CR, LF…) separa. */
  next(): boolean {
    const { bytes } = this;
    let i = this.pos;
    while (i < bytes.length && (bytes[i] ?? 0) <= 0x20) i++;
    if (i >= bytes.length) {
      this.pos = i;
      return false;
    }
    this.start = i;
    while (i < bytes.length && (bytes[i] ?? 0) > 0x20) i++;
    this.end = this.pos = i;
    return true;
  }

  /** ¿La palabra actual es `word` (en minúsculas), sin distinguir mayúsculas? */
  is(word: string): boolean {
    if (this.end - this.start !== word.length) return false;
    for (let k = 0; k < word.length; k++) {
      // `| 0x20` pasa A–Z a minúsculas; `word` solo contiene letras minúsculas.
      if (((this.bytes[this.start + k] ?? 0) | 0x20) !== word.charCodeAt(k)) return false;
    }
    return true;
  }

  /** La palabra actual como número; NaN si no tiene forma de número decimal (nada de «0x10» ni «inf»). */
  number(): number {
    if (this.end - this.start > MAX_NUMBER_TOKEN) return Number.NaN;
    let text = '';
    for (let i = this.start; i < this.end; i++) {
      const b = this.bytes[i] ?? 0;
      const isNumberChar = (b >= 0x30 && b <= 0x39) || b === 0x2e || b === 0x2b || b === 0x2d || b === 0x65 || b === 0x45;
      if (!isNumberChar) return Number.NaN;
      text += String.fromCharCode(b);
    }
    return Number(text);
  }

  /** Salta el resto de la línea (el nombre tras «solid»/«endsolid»), salvo que no haya más saltos de línea. */
  skipLine(): void {
    const { bytes } = this;
    for (let i = this.pos; i < bytes.length; i++) {
      if (bytes[i] === 0x0a || bytes[i] === 0x0d) {
        this.pos = i;
        return;
      }
    }
    // Archivo en una sola línea: no se puede saber dónde acaba el nombre; se sigue leyendo.
  }
}

function parseAscii(bytes: Uint8Array): Mesh {
  const tokens = new Tokenizer(bytes, hasBom(bytes) ? UTF8_BOM.length : 0);
  let values = new Float32Array(9 * 1024);
  let length = 0;
  let facet = 0;
  let verticesInFacet = 0;
  let insideFacet = false;

  while (tokens.next()) {
    if (tokens.is('vertex')) {
      if (!insideFacet) {
        throw new StlParseError('err.stl.vertexOutside');
      }
      if (verticesInFacet === 3) {
        throw new StlParseError('err.stl.facetVertices', { n: facet });
      }
      if (length + 3 > values.length) {
        const grown = new Float32Array(values.length * 2);
        grown.set(values);
        values = grown;
      }
      for (let k = 0; k < 3; k++) {
        const value = tokens.next() ? tokens.number() : Number.NaN;
        // Math.fround: 1e39 es finito en JS, pero no cabe en el float de 32 bits en que se guarda.
        if (!Number.isFinite(Math.fround(value))) {
          throw new StlParseError('err.stl.badVertex', { n: facet });
        }
        values[length++] = value;
      }
      verticesInFacet++;
    } else if (tokens.is('facet')) {
      if (insideFacet) {
        throw new StlParseError('err.stl.facetOpen', { n: facet });
      }
      insideFacet = true;
      facet++;
      verticesInFacet = 0;
    } else if (tokens.is('endfacet')) {
      if (!insideFacet || verticesInFacet !== 3) {
        throw new StlParseError('err.stl.facetVertices', { n: facet });
      }
      insideFacet = false;
    } else if (tokens.is('solid') || tokens.is('endsolid')) {
      // El nombre del sólido puede contener cualquier cosa, incluso «facet» o «vertex».
      tokens.skipLine();
    }
    // El resto («normal», «outer», «loop», «endloop» y sus números) no hace falta:
    // las normales se recalculan a partir de los vértices.
  }

  if (insideFacet) {
    throw new StlParseError('err.stl.truncated');
  }
  if (facet === 0) {
    throw new StlParseError('err.stl.noTriangles');
  }

  return { positions: values.slice(0, length), triangleCount: facet, format: 'ascii' };
}

function hasBom(bytes: Uint8Array): boolean {
  return bytes[0] === UTF8_BOM[0] && bytes[1] === UTF8_BOM[1] && bytes[2] === UTF8_BOM[2];
}

function startsWithSolid(bytes: Uint8Array): boolean {
  let i = hasBom(bytes) ? UTF8_BOM.length : 0;
  while (i < bytes.length && isWhitespace(bytes[i] ?? 0)) i++;
  const word = String.fromCharCode(...bytes.subarray(i, i + 5)).toLowerCase();
  return word === 'solid';
}

/** Espacio, tabulador, LF, tabulador vertical, salto de página o CR. */
function isWhitespace(byte: number): boolean {
  return byte === 0x20 || (byte >= 0x09 && byte <= 0x0d);
}

/** Texto = sin bytes nulos ni de control (salvo espacios en blanco) en la muestra inicial. */
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
