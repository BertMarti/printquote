import type { ErrorKey } from '../i18n/es';
import type { Params } from '../i18n/interpolate';
import { ModelParseError } from './errors';
import { MAX_TRIANGLES, MAX_TRIANGLES_TEXT } from './limits';
import type { Mesh } from './types';
import { PROGRESS_EVERY, type ProgressFn } from './progress';
import { triangulate } from './triangulate';

export { MAX_EAR_CLIPPING, triangulate } from './triangulate';

/** Un OBJ con un byte nulo en el arranque es un binario cualquiera, no texto. */
const SNIFF_BYTES = 1024;

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const INTEGER = /^[-+]?\d+$/;
/**
 * Una línea `v` o `f` más larga que esto no es real (una cara de 100 000 vértices ocupa ~2 MB) y
 * partirla en palabras reservaría millones de cadenas de golpe: se rechaza antes de hacerlo.
 */
export const MAX_LINE_CHARS = 4 * 1024 * 1024;

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
 * - Caras de más de 3 vértices: en abanico si son convexas (lo habitual) y por recorte de orejas
 *   si son cóncavas (ver `src/stl/triangulate.ts`). `largePolygons` cuenta las cóncavas que se han tenido que
 *   cerrar en abanico (más de `MAX_EAR_CLIPPING` vértices o presupuesto agotado) y la interfaz avisa.
 * - Índices negativos: relativos al último vértice leído hasta ese punto de la línea.
 * - Se ignoran normales, texturas, grupos, materiales, líneas y puntos.
 * - Todas las piezas del archivo (`o`/`g`) se juntan en una sola malla.
 */
export function parseObj(data: ArrayBuffer | Uint8Array, onProgress?: ProgressFn): Mesh {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength === 0) throw new ModelParseError('err.empty');
  for (let i = 0, end = Math.min(bytes.length, SNIFF_BYTES); i < end; i++) {
    if (bytes[i] === 0) throw new ModelParseError('err.obj.binary');
  }

  const text = new TextDecoder('utf-8').decode(bytes);
  const vertices = new Growable((n) => new Float32Array(n));
  const faceIndices = new Growable((n) => new Int32Array(n)); // 3 por triángulo, ya absolutos
  let vertexCount = 0;
  let triangleCount = 0;
  let largePolygons = 0;
  let lineNumber = 0;

  const fail = (code: ErrorKey, params: Params = {}): never => {
    throw new ModelParseError(code, { line: lineNumber, ...params });
  };

  let pos = 0;
  // Las líneas tienen longitudes distintas: se informa al cruzar cada umbral, no en posiciones exactas.
  let nextReport = 0;
  while (pos < text.length) {
    if (onProgress && pos >= nextReport) {
      onProgress((pos / text.length) * 0.5);
      nextReport = pos + PROGRESS_EVERY;
    }
    // Una línea acabada en «\» continúa en la siguiente (algunos exportadores parten las caras largas).
    let line = '';
    for (;;) {
      let nl = text.indexOf('\n', pos);
      if (nl < 0) nl = text.length;
      const part = text.slice(pos, nl);
      pos = nl + 1;
      lineNumber++;
      const trimmed = part.trimEnd();
      // Con «\» se pueden encadenar líneas sin fin: se corta antes de seguir juntándolas.
      if (trimmed.endsWith('\\') && line.length + trimmed.length > MAX_LINE_CHARS) fail('err.obj.lineTooLong', { mb: MAX_LINE_CHARS / 1024 / 1024 });
      if (trimmed.endsWith('\\')) {
        // Un «\» final sin nada detrás (fin del archivo) simplemente se descarta.
        line += trimmed.slice(0, -1) + ' ';
        if (pos >= text.length) break;
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
    if (line.length > MAX_LINE_CHARS) fail('err.obj.lineTooLong', { mb: MAX_LINE_CHARS / 1024 / 1024 });
    const tokens = line.split(/\s+/);

    if (first === 0x76) {
      // v x y z [w]  (algunos exportadores añaden color: v x y z r g b)
      if (tokens.length < 4) fail('err.obj.vertexCoords');
      for (let k = 1; k <= 3; k++) {
        const token = tokens[k] ?? '';
        const value = NUMBER.test(token) ? Number(token) : Number.NaN;
        // Math.fround: 1e39 es finito en JS, pero no cabe en el float de 32 bits en que se guarda.
        if (!Number.isFinite(Math.fround(value))) fail('err.obj.badCoord', { token: token.slice(0, 20) });
        vertices.push(value);
      }
      vertexCount++;
    } else {
      // f v1[/vt1[/vn1]] v2 v3 …
      if (tokens.length < 4) fail('err.obj.faceVertices');
      const face: number[] = [];
      for (let k = 1; k < tokens.length; k++) {
        const ref = (tokens[k] ?? '').split('/')[0] ?? '';
        if (!INTEGER.test(ref)) fail('err.obj.badIndex', { token: (tokens[k] ?? '').slice(0, 20) });
        const index = Number(ref);
        if (index === 0) fail('err.obj.zeroIndex');
        // Positivo: 1 = primer vértice. Negativo: −1 = el último leído hasta ahora.
        const absolute = index > 0 ? index - 1 : vertexCount + index;
        if (absolute < 0) fail('err.obj.beforeFirst', { index });
        // Los índices se guardan en un Int32Array: uno enorme se cortaría y apuntaría a un vértice cualquiera.
        if (absolute > 0x7fffffff) fail('err.obj.outOfRange', { index, count: vertexCount });
        face.push(absolute);
      }
      // Una cara de n vértices da n − 2 triángulos: se corta antes de reservar memoria para ellos.
      if (triangleCount + face.length - 2 > MAX_TRIANGLES) {
        fail('err.tooManyTriangles', { max: MAX_TRIANGLES_TEXT });
      }
      const exact = triangulate(face, vertices.data, vertexCount, (a, b, c) => {
        faceIndices.push(a);
        faceIndices.push(b);
        faceIndices.push(c);
        triangleCount++;
      });
      if (!exact) largePolygons++;
    }
  }

  if (vertexCount === 0) throw new ModelParseError('err.obj.noVertices');
  if (triangleCount === 0) {
    throw new ModelParseError('err.obj.noFaces');
  }

  // Los índices positivos pueden apuntar a vértices que aparecen después: se validan al final.
  const positions = new Float32Array(triangleCount * 9);
  for (let i = 0; i < triangleCount * 3; i++) {
    const v = faceIndices.data[i] ?? 0;
    if (v >= vertexCount) {
      throw new ModelParseError('err.obj.outOfRange', { index: v + 1, count: vertexCount });
    }
    positions[i * 3] = vertices.data[v * 3] ?? 0;
    positions[i * 3 + 1] = vertices.data[v * 3 + 1] ?? 0;
    positions[i * 3 + 2] = vertices.data[v * 3 + 2] ?? 0;
    if (i % PROGRESS_EVERY === 0) onProgress?.(0.5 + (i / (triangleCount * 3)) * 0.5);
  }
  onProgress?.(1);
  return { positions, triangleCount, format: 'obj', largePolygons };
}
