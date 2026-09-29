import type { BoundingBox, Mesh, MeshStats, Vec3 } from './types';

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
export function computeStats(mesh: Mesh): MeshStats {
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
  return {
    triangleCount: mesh.triangleCount,
    signedVolume,
    volume: Math.abs(signedVolume),
    surfaceArea: area2 / 2,
    bounds,
    openEdges: countOpenEdges(p),
  };
}

/**
 * Cuenta las aristas que no comparten exactamente dos triángulos. En una malla
 * cerrada («estanca») el resultado es 0. Los vértices se sueldan por igualdad exacta
 * de coordenadas, que es como los escriben los exportadores habituales.
 */
export function countOpenEdges(positions: Float32Array): number {
  const vertexIds = new Map<string, number>();
  const idOf = (i: number): number => {
    const key = `${positions[i]},${positions[i + 1]},${positions[i + 2]}`;
    let id = vertexIds.get(key);
    if (id === undefined) {
      id = vertexIds.size;
      vertexIds.set(key, id);
    }
    return id;
  };

  const edges = new Map<number, number>();
  const addEdge = (a: number, b: number): void => {
    if (a === b) return; // triángulo degenerado
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const key = lo * 0x4000000 + hi; // único mientras haya menos de 2^26 vértices
    edges.set(key, (edges.get(key) ?? 0) + 1);
  };

  for (let i = 0; i + 8 < positions.length; i += 9) {
    const a = idOf(i), b = idOf(i + 3), c = idOf(i + 6);
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }

  let open = 0;
  for (const count of edges.values()) {
    if (count !== 2) open++;
  }
  return open;
}

export type MeshWarning = 'open-mesh' | 'inverted' | 'too-big';

/**
 * Avisos sobre la pieza:
 * - `open-mesh`: volumen ≈ 0 o aristas abiertas: el volumen puede no ser fiable.
 * - `inverted`: volumen con signo negativo (normales hacia dentro).
 * - `too-big`: no cabe en la cama ni girándola 90° sobre Z.
 */
export function meshWarnings(stats: MeshStats, bed: Vec3 = DEFAULT_BED): MeshWarning[] {
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
  return warnings;
}

/** ¿Cabe la caja en la cama? Se permite girar la pieza 90° sobre el eje Z. */
export function fitsBed(size: Vec3, bed: Vec3): boolean {
  if (size.z > bed.z) return false;
  return (size.x <= bed.x && size.y <= bed.y) || (size.y <= bed.x && size.x <= bed.y);
}
