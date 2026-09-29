import { describe, expect, it } from 'vitest';
import { computeBounds, computeStats, fitsBed, meshWarnings } from '../src/stl/geometry';
import type { Mesh } from '../src/stl/types';
import { cubeTriangles, flipWinding, toPositions, type Triangle } from './helpers/mesh';

function mesh(triangles: Triangle[]): Mesh {
  return { positions: toPositions(triangles), triangleCount: triangles.length, format: 'binary' };
}

describe('computeStats', () => {
  it('cubo de 20 mm: volumen 8000 mm³, área 2400 mm², 12 triángulos, cerrado', () => {
    const stats = computeStats(mesh(cubeTriangles(20)));
    expect(stats.volume).toBeCloseTo(8000, 6);
    expect(stats.signedVolume).toBeCloseTo(8000, 6);
    expect(stats.surfaceArea).toBeCloseTo(2400, 6);
    expect(stats.triangleCount).toBe(12);
    expect(stats.openEdges).toBe(0);
  });

  it('el volumen no depende de dónde esté la pieza', () => {
    const stats = computeStats(mesh(cubeTriangles(20, [1000, -2500, 730])));
    expect(stats.volume).toBeCloseTo(8000, 3);
    expect(stats.surfaceArea).toBeCloseTo(2400, 3);
  });

  it('caja envolvente con desplazamiento', () => {
    const { bounds } = computeStats(mesh(cubeTriangles(20, [10, -5, 2])));
    expect(bounds.min).toEqual({ x: 10, y: -5, z: 2 });
    expect(bounds.max).toEqual({ x: 30, y: 15, z: 22 });
    expect(bounds.size).toEqual({ x: 20, y: 20, z: 20 });
  });

  it('dos cubos separados: el volumen es la suma', () => {
    const stats = computeStats(mesh([...cubeTriangles(10), ...cubeTriangles(20, [50, 0, 0])]));
    expect(stats.volume).toBeCloseTo(1000 + 8000, 6);
    expect(stats.bounds.size).toEqual({ x: 70, y: 20, z: 20 });
  });

  it('normales invertidas: volumen con signo negativo, volumen positivo', () => {
    const stats = computeStats(mesh(flipWinding(cubeTriangles(20))));
    expect(stats.signedVolume).toBeCloseTo(-8000, 6);
    expect(stats.volume).toBeCloseTo(8000, 6);
  });

  it('cubo al que le falta una cara: 4 aristas abiertas', () => {
    expect(computeStats(mesh(cubeTriangles(20).slice(2))).openEdges).toBe(4);
  });

  it('caja nula para una malla sin vértices', () => {
    expect(computeBounds(new Float32Array()).size).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe('meshWarnings', () => {
  const bed = { x: 220, y: 220, z: 250 };

  it('sin avisos para un cubo cerrado que cabe', () => {
    expect(meshWarnings(computeStats(mesh(cubeTriangles(20))), bed)).toEqual([]);
  });

  it('avisa de malla abierta', () => {
    expect(meshWarnings(computeStats(mesh(cubeTriangles(20).slice(2))), bed)).toContain('open-mesh');
  });

  it('avisa de malla plana (volumen ≈ 0)', () => {
    const flat: Triangle[] = [
      [0, 0, 0, 10, 0, 0, 0, 10, 0],
      [0, 0, 0, 0, 10, 0, 10, 0, 0],
    ];
    expect(meshWarnings(computeStats(mesh(flat)), bed)).toContain('open-mesh');
  });

  it('avisa de normales invertidas', () => {
    expect(meshWarnings(computeStats(mesh(flipWinding(cubeTriangles(20)))), bed)).toEqual(['inverted']);
  });

  it('avisa si no cabe en la cama', () => {
    expect(meshWarnings(computeStats(mesh(cubeTriangles(300))), bed)).toContain('too-big');
  });
});

describe('fitsBed', () => {
  const bed = { x: 250, y: 210, z: 200 };
  it('cabe tal cual', () => expect(fitsBed({ x: 240, y: 200, z: 200 }, bed)).toBe(true));
  it('cabe girada 90° sobre Z', () => expect(fitsBed({ x: 200, y: 240, z: 10 }, bed)).toBe(true));
  it('no cabe por altura', () => expect(fitsBed({ x: 10, y: 10, z: 200.1 }, bed)).toBe(false));
  it('no cabe en planta', () => expect(fitsBed({ x: 251, y: 10, z: 10 }, bed)).toBe(false));
});
