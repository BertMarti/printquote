import { ModelParseError } from './errors';
import type { Mesh } from './types';

/** Un OBJ con un byte nulo en el arranque es un binario cualquiera, no texto. */
const SNIFF_BYTES = 1024;

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const INTEGER = /^[-+]?\d+$/;

/** Vector de números que crece por duplicación (evita `push` sobre millones de valores). */
class Growable<T extends Float32Array | Int32Array> {
  data: T;
  length = 0;

  constructor(private readonly make: (size: number) => T, initial = 3 * 1024) {
    this.data = make(initial);
  }

  push(value: number): void {
    if (this.length === this.data.length) {
      const grown = this.make(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    this.data[this.length++] = value;
  }
}

/**
 * Lee un OBJ de texto (Wavefront): vértices `v` y caras `f`.
 * - Caras de más de 3 vértices: se trianguliza en abanico desde el primero (correcto para
 *   polígonos convexos, que es lo habitual al exportar).
 * - Índices negativos: relativos al último vértice leído hasta ese punto de la línea.
 * - Se ignoran normales, texturas, grupos, materiales, líneas y puntos.
 * - Todas las piezas del archivo (`o`/`g`) se juntan en una sola malla.
 */
export function parseObj(data: ArrayBuffer | Uint8Array): Mesh {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength === 0) throw new ModelParseError('El archivo está vacío.');
  for (let i = 0, end = Math.min(bytes.length, SNIFF_BYTES); i < end; i++) {
    if (bytes[i] === 0) throw new ModelParseError('No parece un OBJ válido: es un archivo binario, no de texto.');
  }

  const text = new TextDecoder('utf-8').decode(bytes);
  const vertices = new Growable((n) => new Float32Array(n));
  const faceIndices = new Growable((n) => new Int32Array(n)); // 3 por triángulo, ya absolutos
  let vertexCount = 0;
  let triangleCount = 0;
  let lineNumber = 0;

  const fail = (message: string): never => {
    throw new ModelParseError(`Línea ${lineNumber} del OBJ: ${message}`);
  };

  let pos = 0;
  while (pos < text.length) {
    // Una línea acabada en «\» continúa en la siguiente (algunos exportadores parten las caras largas).
    let line = '';
    for (;;) {
      let nl = text.indexOf('\n', pos);
      if (nl < 0) nl = text.length;
      const part = text.slice(pos, nl);
      pos = nl + 1;
      lineNumber++;
      const trimmed = part.trimEnd();
      if (trimmed.endsWith('\\') && pos < text.length) {
        line += trimmed.slice(0, -1) + ' ';
      } else {
        line += trimmed;
        break;
      }
    }

    const hash = line.indexOf('#');
    if (hash >= 0) line = line.slice(0, hash);
    line = line.trim();
    if (line === '') continue;

    const first = line.charCodeAt(0);
    // Solo interesan `v` y `f` (seguidas de espacio): `vt`, `vn`, `vp`, `o`, `g`, `s`, `l`… se saltan.
    if ((first !== 0x76 && first !== 0x66) || !/\s/.test(line.charAt(1))) continue;
    const tokens = line.split(/\s+/);

    if (first === 0x76) {
      // v x y z [w]  (algunos exportadores añaden color: v x y z r g b)
      if (tokens.length < 4) fail('un vértice necesita tres coordenadas (x y z).');
      for (let k = 1; k <= 3; k++) {
        const token = tokens[k] ?? '';
        const value = NUMBER.test(token) ? Number(token) : Number.NaN;
        // Math.fround: 1e39 es finito en JS, pero no cabe en el float de 32 bits en que se guarda.
        if (!Number.isFinite(Math.fround(value))) fail(`«${token.slice(0, 20)}» no es una coordenada válida.`);
        vertices.push(value);
      }
      vertexCount++;
    } else {
      // f v1[/vt1[/vn1]] v2 v3 …
      if (tokens.length < 4) fail('una cara necesita al menos 3 vértices.');
      const face: number[] = [];
      for (let k = 1; k < tokens.length; k++) {
        const ref = (tokens[k] ?? '').split('/')[0] ?? '';
        if (!INTEGER.test(ref)) fail(`«${(tokens[k] ?? '').slice(0, 20)}» no es un índice de vértice válido.`);
        const index = Number(ref);
        if (index === 0) fail('los índices de vértice empiezan en 1 (o son negativos, relativos al final).');
        // Positivo: 1 = primer vértice. Negativo: −1 = el último leído hasta ahora.
        const absolute = index > 0 ? index - 1 : vertexCount + index;
        if (absolute < 0) fail(`el índice ${index} apunta antes del primer vértice.`);
        face.push(absolute);
      }
      const a = face[0] ?? 0;
      for (let k = 1; k + 1 < face.length; k++) {
        faceIndices.push(a);
        faceIndices.push(face[k] ?? 0);
        faceIndices.push(face[k + 1] ?? 0);
        triangleCount++;
      }
    }
  }

  if (vertexCount === 0) throw new ModelParseError('El OBJ no contiene vértices.');
  if (triangleCount === 0) {
    throw new ModelParseError('El OBJ no contiene caras: solo tiene vértices, líneas o puntos, no una superficie.');
  }

  // Los índices positivos pueden apuntar a vértices que aparecen después: se validan al final.
  const positions = new Float32Array(triangleCount * 9);
  for (let i = 0; i < triangleCount * 3; i++) {
    const v = faceIndices.data[i] ?? 0;
    if (v >= vertexCount) {
      throw new ModelParseError(
        `Una cara usa el vértice ${v + 1}, pero el OBJ solo tiene ${vertexCount} vértices.`,
      );
    }
    positions[i * 3] = vertices.data[v * 3] ?? 0;
    positions[i * 3 + 1] = vertices.data[v * 3 + 1] ?? 0;
    positions[i * 3 + 2] = vertices.data[v * 3 + 2] ?? 0;
  }
  return { positions, triangleCount, format: 'obj' };
}
