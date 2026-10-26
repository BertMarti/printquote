import type { BoundingBox, Mesh, MeshStats, Vec3 } from './types';
import { createProgress, PROGRESS_EVERY, type ProgressFn } from './progress';

/** Tamaño de cama por defecto (mm): ancho X, fondo Y, alto Z. */
export const DEFAULT_BED: Vec3 = { x: 220, y: 220, z: 250 };

/** Umbral relativo por debajo del cual el volumen se considera ≈ 0. */
const RELATIVE_VOLUME_EPSILON = 1e-6;

export function computeBounds(positions: Float32Array): BoundingBox {
  if (positions.length === 0) {
    const zero = { x: 0, y: 0, z: 0 };
    return { min: zero, max: zero, size: zero };
  }
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] ?? 0, y = positions[i + 1] ?? 0, z = positions[i + 2] ?? 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
    size: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ },
  };
}

/**
 * Calcula volumen, área, caja envolvente y aristas abiertas.
 *
 * Volumen: suma de los volúmenes con signo de los tetraedros que forma cada
 * triángulo con un punto de referencia (v1 · (v2 × v3) / 6). Se usa el centro de
 * la caja como referencia para no perder precisión con piezas lejos del origen.
 */
export function computeStats(mesh: Mesh, onProgress?: ProgressFn): MeshStats {
  const progress = createProgress(onProgress);
  const p = mesh.positions;
  const bounds = computeBounds(p);
  const cx = (bounds.min.x + bounds.max.x) / 2;
  const cy = (bounds.min.y + bounds.max.y) / 2;
  const cz = (bounds.min.z + bounds.max.z) / 2;

  let signedVolume6 = 0;
  let area2 = 0;

  for (let i = 0; i + 8 < p.length; i += 9) {
    const ax = (p[i] ?? 0) - cx, ay = (p[i + 1] ?? 0) - cy, az = (p[i + 2] ?? 0) - cz;
    const bx = (p[i + 3] ?? 0) - cx, by = (p[i + 4] ?? 0) - cy, bz = (p[i + 5] ?? 0) - cz;
    const qx = (p[i + 6] ?? 0) - cx, qy = (p[i + 7] ?? 0) - cy, qz = (p[i + 8] ?? 0) - cz;

    // Volumen con signo: a · (b × c)
    signedVolume6 += ax * (by * qz - bz * qy) + ay * (bz * qx - bx * qz) + az * (bx * qy - by * qx);

    // Área: |(b − a) × (c − a)| / 2
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = qx - ax, vy = qy - ay, vz = qz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    area2 += Math.sqrt(nx * nx + ny * ny + nz * nz);
  }

  const signedVolume = signedVolume6 / 6;
  const welded = weldVertices(p, WELD_TOLERANCE, (fraction) => progress.stage(0, 0.7)(fraction, 1));
  const openEdges = countOpenEdgesFromIds(welded.ids, welded.count, (fraction) => progress.stage(0.7, 0.9)(fraction, 1));
  progress.done();
  return {
    triangleCount: mesh.triangleCount,
    signedVolume,
    volume: Math.abs(signedVolume),
    surfaceArea: area2 / 2,
    bounds,
    openEdges,
  };
}

/** Distancia mínima (mm, en cada eje) por debajo de la cual dos vértices se consideran el mismo. */
export const WELD_TOLERANCE = 1e-4;
/**
 * Lejos del origen el float de 32 bits del STL pierde resolución (a 1000 mm un paso
 * mide ~6e-5 mm), así que la tolerancia crece con el tamaño de las coordenadas.
 */
const WELD_RELATIVE_TOLERANCE = 1e-6;
/** Las celdas de la rejilla miden 16 tolerancias: casi siempre basta con mirar una. */
const WELD_CELL_FACTOR = 16;

/**
 * Suelda vértices casi coincidentes y devuelve un id por vértice (3 números por vértice).
 *
 * Los exportadores no siempre escriben coordenadas idénticas para un vértice compartido
 * (redondeos, conversiones de unidades). Se usa una rejilla espacial; un vértice a
 * menos de `tol` del borde de su celda busca también en la vecina, así dos puntos casi
 * iguales a ambos lados de un borde se unen igualmente.
 */
export function weldVertices(positions: Float32Array, tolerance = WELD_TOLERANCE, onProgress?: ProgressFn): { ids: Uint32Array; count: number } {
  const vertexCount = Math.floor(positions.length / 3);
  let maxAbs = 0;
  for (let i = 0; i < vertexCount * 3; i++) {
    const v = Math.abs(positions[i] ?? 0);
    if (v > maxAbs) maxAbs = v;
  }
  const tol = Math.max(tolerance, maxAbs * WELD_RELATIVE_TOLERANCE);
  const cell = tol * WELD_CELL_FACTOR;

  const ids = new Uint32Array(vertexCount);
  // Coordenadas de cada vértice soldado y lista enlazada de los que comparten cubeta.
  const rep = new Float32Array(vertexCount * 3);
  const nextInCell = new Int32Array(vertexCount);
  // Tabla de cubetas en un Int32Array (antes un Map, que en V8 no admite más de 2^24 ≈ 16,7 M entradas y
  // reventaba con mallas grandes sin vértices compartidos). Varias celdas pueden caer en la misma cubeta:
  // da igual, porque siempre se comparan las coordenadas. Tope de 2^24 cubetas (64 MB).
  const bucketBits = Math.min(24, Math.max(4, Math.ceil(Math.log2(Math.max(vertexCount, 1)))));
  const bucketMask = (1 << bucketBits) - 1;
  const firstInCell = new Int32Array(bucketMask + 1).fill(-1);
  const hash = (cx: number, cy: number, cz: number): number => {
    const h = Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663) ^ Math.imul(cz, 83492791);
    const m = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    return (m ^ (m >>> 16)) & bucketMask;
  };

  let count = 0;
  for (let v = 0; v < vertexCount; v++) {
    const x = positions[v * 3] ?? 0, y = positions[v * 3 + 1] ?? 0, z = positions[v * 3 + 2] ?? 0;
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    // Celdas vecinas solo en los ejes en los que el vértice está cerca del borde.
    const x0 = x - cx * cell <= tol ? -1 : 0, x1 = (cx + 1) * cell - x <= tol ? 1 : 0;
    const y0 = y - cy * cell <= tol ? -1 : 0, y1 = (cy + 1) * cell - y <= tol ? 1 : 0;
    const z0 = z - cz * cell <= tol ? -1 : 0, z1 = (cz + 1) * cell - z <= tol ? 1 : 0;

    let found = -1;
    search: for (let dx = x0; dx <= x1; dx++) {
      for (let dy = y0; dy <= y1; dy++) {
        for (let dz = z0; dz <= z1; dz++) {
          // El hash puede colisionar: siempre se comprueban las coordenadas.
          let id = firstInCell[hash(cx + dx, cy + dy, cz + dz)] ?? -1;
          while (id >= 0) {
            if (
              Math.abs((rep[id * 3] ?? 0) - x) <= tol &&
              Math.abs((rep[id * 3 + 1] ?? 0) - y) <= tol &&
              Math.abs((rep[id * 3 + 2] ?? 0) - z) <= tol
            ) {
              found = id;
              break search;
            }
            id = nextInCell[id] ?? -1;
          }
        }
      }
    }

    if (found < 0) {
      found = count++;
      rep[found * 3] = x;
      rep[found * 3 + 1] = y;
      rep[found * 3 + 2] = z;
      const key = hash(cx, cy, cz);
      nextInCell[found] = firstInCell[key] ?? -1;
      firstInCell[key] = found;
    }
    ids[v] = found;
    if (v % PROGRESS_EVERY === 0) onProgress?.((v + 1) / vertexCount);
  }
  onProgress?.(1);
  return { ids, count };
}

/**
 * Cuenta las aristas que no comparten exactamente dos triángulos. En una malla
 * cerrada («estanca») el resultado es 0. Antes se sueldan los vértices casi
 * coincidentes (`weldVertices`) para no dar falsos avisos de malla abierta.
 */
export function countOpenEdges(positions: Float32Array, tolerance = WELD_TOLERANCE): number {
  const { ids, count } = weldVertices(positions, tolerance);
  return countOpenEdgesFromIds(ids, count);
}

/** `countOpenEdges` con los vértices ya soldados (`computeStats` suelda una sola vez e informa del progreso). */
function countOpenEdgesFromIds(ids: Uint32Array, count: number, onProgress?: ProgressFn): number {
  // Cada arista es un número exacto (`lo * count + hi`; count² < 2^53 en cualquier malla que quepa en memoria).
  // Se guardan en un Float64Array y se ordenan: las repetidas quedan juntas. Antes era un Map, limitado en V8
  // a 2^24 ≈ 16,7 M entradas: una malla de 6,3 M triángulos sin aristas compartidas lo desbordaba y daba un
  // error genérico. Así ocupa 8 bytes por arista y no tiene tope propio.
  const keys = new Float64Array(ids.length);
  let n = 0;
  const addEdge = (a: number, b: number): void => {
    if (a === b) return; // arista degenerada (dos vértices soldados en uno)
    keys[n++] = a < b ? a * count + b : b * count + a;
  };
  for (let t = 0; t + 2 < ids.length; t += 3) {
    const a = ids[t] ?? 0, b = ids[t + 1] ?? 0, c = ids[t + 2] ?? 0;
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
    if (t % (3 * PROGRESS_EVERY) === 0) onProgress?.((t / Math.max(ids.length, 1)) * 0.5);
  }

  const sorted = keys.subarray(0, n).sort();
  let open = 0;
  let nextReport = 0;
  for (let i = 0; i < n; ) {
    const key = sorted[i];
    let j = i + 1;
    while (j < n && sorted[j] === key) j++;
    if (j - i !== 2) open++;
    if (onProgress && j >= nextReport) {
      onProgress(0.5 + (j / Math.max(n, 1)) * 0.5);
      nextReport = j + PROGRESS_EVERY;
    }
    i = j;
  }
  onProgress?.(1);
  return open;
}

export type MeshWarning = 'open-mesh' | 'inverted' | 'too-big' | 'tiny' | 'big-polygons';

/** Por debajo de este tamaño (mm, dimensión mayor) la pieza seguramente se exportó en metros o pulgadas. */
const TINY_PART_MM = 1;

/**
 * Avisos sobre la pieza:
 * - `open-mesh`: volumen ≈ 0 o aristas abiertas: el volumen puede no ser fiable.
 * - `inverted`: volumen con signo negativo (normales hacia dentro).
 * - `too-big`: no cabe en la cama ni girándola 90° sobre Z.
 * - `tiny`: la dimensión mayor mide menos de 1 mm (¿exportada en metros o pulgadas?).
 * - `big-polygons`: el OBJ trae polígonos de más de 200 vértices (`Mesh.largePolygons`), triangulados
 *   en abanico: si son cóncavos, la superficie y el visor salen mal.
 */
export function meshWarnings(stats: MeshStats, bed: Vec3 = DEFAULT_BED, largePolygons = 0): MeshWarning[] {
  const warnings: MeshWarning[] = [];
  const { size } = stats.bounds;
  const boxVolume = size.x * size.y * size.z;
  const nearZero = Math.abs(stats.signedVolume) <= RELATIVE_VOLUME_EPSILON * Math.max(boxVolume, 1);

  if (nearZero || stats.openEdges > 0) {
    warnings.push('open-mesh');
  } else if (stats.signedVolume < 0) {
    warnings.push('inverted');
  }
  if (!fitsBed(size, bed)) {
    warnings.push('too-big');
  }
  if (Math.max(size.x, size.y, size.z) < TINY_PART_MM) {
    warnings.push('tiny');
  }
  if (largePolygons > 0) {
    warnings.push('big-polygons');
  }
  return warnings;
}

/** ¿Cabe la caja en la cama? Se permite girar la pieza 90° sobre el eje Z. */
export function fitsBed(size: Vec3, bed: Vec3): boolean {
  if (size.z > bed.z) return false;
  return (size.x <= bed.x && size.y <= bed.y) || (size.y <= bed.x && size.x <= bed.y);
}
