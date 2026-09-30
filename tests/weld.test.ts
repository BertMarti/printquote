import { describe, expect, it } from 'vitest';
import { computeStats, countOpenEdges, meshWarnings, weldVertices } from '../src/stl/geometry';
import { cubeTriangles, toPositions, type Triangle } from './helpers/mesh';

/** Desplaza `delta` el vértice que coincide con `target` en los triángulos de índice impar. */
function jitter(triangles: Triangle[], target: readonly [number, number, number], delta: number): Triangle[] {
  return triangles.map((t, i) => {
    if (i % 2 === 0) return t;
    const out = [...t];
    for (let k = 0; k < 9; k += 3) {
      if (out[k] === target[0] && out[k + 1] === target[1] && out[k + 2] === target[2]) {
        out[k] = target[0] + delta;
        out[k + 1] = target[1] - delta;
      }
    }
    return out as unknown as Triangle;
  });
}

describe('soldado de vértices con tolerancia', () => {
  it('vértices casi coincidentes (2e-5 mm) no dan falsas aristas abiertas', () => {
    const tris = jitter(cubeTriangles(20), [20, 20, 20], 2e-5);
    const positions = toPositions(tris);
    // Comprobación del propio test: en float32 las coordenadas sí son distintas.
    expect(new Set(Array.from(positions)).has(Math.fround(20 + 2e-5))).toBe(true);
    expect(countOpenEdges(positions)).toBe(0);
    const stats = computeStats({ positions, triangleCount: tris.length, format: 'binary' });
    expect(meshWarnings(stats)).toEqual([]);
  });

  it('también a ambos lados de un borde de celda (alrededor de 0)', () => {
    const tris = jitter(cubeTriangles(20), [0, 0, 0], -3e-5);
    expect(countOpenEdges(toPositions(tris))).toBe(0);
  });

  it('un hueco real (0,01 mm) sigue contando como malla abierta', () => {
    const tris = jitter(cubeTriangles(20), [20, 20, 20], 0.01);
    expect(countOpenEdges(toPositions(tris))).toBeGreaterThan(0);
  });

  it('el cubo tiene 8 vértices únicos', () => {
    expect(weldVertices(toPositions(cubeTriangles(20))).count).toBe(8);
  });

  it('pieza lejos del origen con error de redondeo float32: la tolerancia crece con las coordenadas', () => {
    const tris = jitter(cubeTriangles(20, [5000, 5000, 0]), [5020, 5020, 20], 1e-3);
    expect(countOpenEdges(toPositions(tris))).toBe(0);
  });

  it('una malla grande (200 000 triángulos) cerrada se procesa y da 0 aristas abiertas', () => {
    // Rejilla de n × n cubos pegados: comparten caras interiores (no variedad), pero
    // una tira de cubos separados es cerrada; usamos 16 667 cubos separados.
    const tris: Triangle[] = [];
    for (let i = 0; i < 16_667; i++) tris.push(...cubeTriangles(1, [(i % 100) * 2, Math.floor(i / 100) * 2, 0]));
    expect(countOpenEdges(toPositions(tris))).toBe(0);
  });
});
