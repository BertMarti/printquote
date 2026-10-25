import { describe, expect, it, vi } from 'vitest';
import { analyzeModel } from '../src/stl/analyze';
import { StlAnalyzer } from '../src/stl/analyzer';
import { ModelParseError } from '../src/stl/errors';
import { countOpenEdges, weldVertices } from '../src/stl/geometry';
import * as model from '../src/stl/model';
import { binaryStl, cubeTriangles, toPositions } from './helpers/mesh';

vi.mock('../src/stl/model', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/stl/model')>();
  return { ...original, parseModel: vi.fn(original.parseModel) };
});

/** Aristas abiertas contadas a lo bruto (vértices exactos, sin tolerancia): referencia para comparar. */
function naiveOpenEdges(positions: Float32Array): number {
  const id = new Map<string, number>();
  const vid = (i: number): number => {
    const key = `${positions[i * 3]},${positions[i * 3 + 1]},${positions[i * 3 + 2]}`;
    if (!id.has(key)) id.set(key, id.size);
    return id.get(key) ?? -1;
  };
  const edges = new Map<string, number>();
  for (let t = 0; t < positions.length / 9; t++) {
    const v = [vid(t * 3), vid(t * 3 + 1), vid(t * 3 + 2)];
    for (const [a, b] of [[v[0], v[1]], [v[1], v[2]], [v[2], v[0]]] as [number, number][]) {
      if (a === b) continue;
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const n of edges.values()) if (n !== 2) open++;
  return open;
}

describe('aristas abiertas sin Map (tope de 2^24 entradas de V8)', () => {
  it('triángulos sueltos: cada uno aporta 3 aristas abiertas', () => {
    const n = 20_000;
    const positions = new Float32Array(n * 9);
    for (let t = 0; t < n; t++) {
      const x = (t % 200) * 10, y = Math.floor(t / 200) * 10;
      positions.set([x, y, 0, x + 1, y, 0, x, y + 1, 0], t * 9);
    }
    expect(countOpenEdges(positions)).toBe(3 * n);
    expect(weldVertices(positions).count).toBe(3 * n);
  });

  it('coincide con el recuento a lo bruto en mallas cerradas, abiertas y con aristas triples', () => {
    const cube = cubeTriangles(20);
    const open = cube.slice(1); // falta un triángulo: 3 aristas abiertas
    const triple = [...cube, ...cube.slice(0, 1)]; // un triángulo repetido: sus aristas las comparten 3
    for (const tris of [cube, open, triple]) {
      const positions = toPositions(tris);
      expect(countOpenEdges(positions)).toBe(naiveOpenEdges(positions));
    }
    expect(countOpenEdges(toPositions(cube))).toBe(0);
    expect(countOpenEdges(toPositions(open))).toBe(3);
  });

  it('muchos vértices en una misma cubeta siguen soldándose bien', () => {
    // Rejilla de 300 × 300 cuadrados (180 000 triángulos) en una superficie abierta: solo el borde está abierto.
    const side = 300;
    const tris: number[] = [];
    for (let i = 0; i < side; i++)
      for (let j = 0; j < side; j++) {
        tris.push(i, j, 0, i + 1, j, 0, i + 1, j + 1, 0, i, j, 0, i + 1, j + 1, 0, i, j + 1, 0);
      }
    const positions = new Float32Array(tris);
    expect(weldVertices(positions).count).toBe((side + 1) ** 2);
    expect(countOpenEdges(positions)).toBe(4 * side);
  });
});

describe('errores de memoria con mensaje útil', () => {
  it('un RangeError al analizar se convierte en err.tooComplex', async () => {
    vi.mocked(model.parseModel).mockRejectedValueOnce(new RangeError('Array buffer allocation failed'));
    await expect(analyzeModel(new Uint8Array(84))).rejects.toMatchObject({ code: 'err.tooComplex' });
  });
});

describe('cancelación sin worker (hilo principal)', () => {
  const noWorker = (): never => {
    throw new Error('sin Worker');
  };

  it('un análisis nuevo cancela el anterior y solo llega el último', async () => {
    const analyzer = new StlAnalyzer(noWorker);
    const first = analyzer.analyze(binaryStl(cubeTriangles(10)), 'a.stl');
    expect(analyzer.busy).toBe(true);
    const second = analyzer.analyze(binaryStl(cubeTriangles(20)), 'b.stl');
    await expect(first).rejects.toBeInstanceOf(ModelParseError);
    await expect(first).rejects.toMatchObject({ code: 'err.cancelled' });
    const result = await second;
    expect(result.stats.volume).toBeCloseTo(8000, 0);
    expect(analyzer.busy).toBe(false);
  });

  it('cancel() para el análisis del hilo principal', async () => {
    const analyzer = new StlAnalyzer(noWorker);
    const pending = analyzer.analyze(binaryStl(cubeTriangles(10)), 'a.stl');
    analyzer.cancel();
    await expect(pending).rejects.toMatchObject({ code: 'err.cancelled' });
    expect(analyzer.busy).toBe(false);
  });
});
