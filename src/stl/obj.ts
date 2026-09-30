import type { ErrorKey } from '../i18n/es';
import type { Params } from '../i18n/interpolate';
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

/** Polígonos de más vértices que esto se trianguan en abanico aunque sean cóncavos (el recorte de orejas es O(n³)). */
const MAX_EAR_CLIPPING = 200;

/**
 * Triangula un polígono (índices absolutos en `vertices`). Convexo: abanico desde el primer
 * vértice. Cóncavo: recorte de orejas sobre el plano de mayor área proyectada (normal de Newell).
 * Si el polígono es degenerado, referencia vértices que aún no se han leído o es enorme, cae al abanico.
 * ponytail: los polígonos cóncavos de más de 200 vértices se siguen trianguando en abanico.
 */
export function triangulate(
  face: readonly number[],
  vertices: Float32Array,
  vertexCount: number,
  emit: (a: number, b: number, c: number) => void,
): void {
  const n = face.length;
  const fan = (): void => {
    for (let k = 1; k + 1 < n; k++) emit(face[0] ?? 0, face[k] ?? 0, face[k + 1] ?? 0);
  };
  if (n <= 3 || n > MAX_EAR_CLIPPING || face.some((v) => v >= vertexCount)) return fan();

  const at = (i: number, axis: number): number => vertices[(face[i] ?? 0) * 3 + axis] ?? 0;
  // Normal de Newell: robusta con polígonos cóncavos y vértices colineales.
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    nx += (at(i, 1) - at(j, 1)) * (at(i, 2) + at(j, 2));
    ny += (at(i, 2) - at(j, 2)) * (at(i, 0) + at(j, 0));
    nz += (at(i, 0) - at(j, 0)) * (at(i, 1) + at(j, 1));
  }
  const largest = Math.max(Math.abs(nx), Math.abs(ny), Math.abs(nz));
  if (!(largest > 0)) return fan();
  // Se descarta el eje de la normal mayor; (u, v) son los otros dos en orden cíclico, de modo que
  // con la normal positiva el polígono queda en sentido antihorario.
  const drop = Math.abs(nz) === largest ? 2 : Math.abs(nx) === largest ? 0 : 1;
  const sign = (drop === 0 ? nx : drop === 1 ? ny : nz) > 0 ? 1 : -1;
  const uAxis = (drop + 1) % 3;
  const vAxis = (drop + 2) % 3;
  const u = (i: number): number => at(i, uAxis);
  const v = (i: number): number => at(i, vAxis);
  /** > 0 si el giro a→b→c va hacia el lado de la normal (esquina convexa). */
  const turn = (a: number, b: number, c: number): number =>
    sign * ((u(b) - u(a)) * (v(c) - v(a)) - (v(b) - v(a)) * (u(c) - u(a)));

  const ring = Array.from({ length: n }, (_, i) => i);
  if (ring.every((b, i) => turn(ring[(i + n - 1) % n] ?? 0, b, ring[(i + 1) % n] ?? 0) >= 0)) return fan();

  const same = (p: number, q: number): boolean => u(p) === u(q) && v(p) === v(q);
  const insideTriangle = (p: number, a: number, b: number, c: number): boolean =>
    !same(p, a) && !same(p, b) && !same(p, c) && turn(a, b, p) >= 0 && turn(b, c, p) >= 0 && turn(c, a, p) >= 0;

  while (ring.length > 3) {
    const m = ring.length;
    let ear = -1;
    for (let i = 0; i < m && ear < 0; i++) {
      const a = ring[(i + m - 1) % m] ?? 0;
      const b = ring[i] ?? 0;
      const c = ring[(i + 1) % m] ?? 0;
      if (turn(a, b, c) < 0) continue;
      if (ring.every((p) => p === a || p === b || p === c || !insideTriangle(p, a, b, c))) ear = i;
    }
    // Sin orejas (polígono que se cruza a sí mismo): se corta por donde sea para terminar siempre.
    if (ear < 0) ear = 0;
    emit(face[ring[(ear + m - 1) % m] ?? 0] ?? 0, face[ring[ear] ?? 0] ?? 0, face[ring[(ear + 1) % m] ?? 0] ?? 0);
    ring.splice(ear, 1);
  }
  emit(face[ring[0] ?? 0] ?? 0, face[ring[1] ?? 0] ?? 0, face[ring[2] ?? 0] ?? 0);
}

/**
 * Lee un OBJ de texto (Wavefront): vértices `v` y caras `f`.
 * - Caras de más de 3 vértices: en abanico si son convexas (lo habitual) y por recorte de orejas
 *   si son cóncavas (ver `triangulate`).
 * - Índices negativos: relativos al último vértice leído hasta ese punto de la línea.
 * - Se ignoran normales, texturas, grupos, materiales, líneas y puntos.
 * - Todas las piezas del archivo (`o`/`g`) se juntan en una sola malla.
 */
export function parseObj(data: ArrayBuffer | Uint8Array): Mesh {
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
  let lineNumber = 0;

  const fail = (code: ErrorKey, params: Params = {}): never => {
    throw new ModelParseError(code, { line: lineNumber, ...params });
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
      triangulate(face, vertices.data, vertexCount, (a, b, c) => {
        faceIndices.push(a);
        faceIndices.push(b);
        faceIndices.push(c);
        triangleCount++;
      });
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
  }
  return { positions, triangleCount, format: 'obj' };
}
