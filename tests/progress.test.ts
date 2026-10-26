import { describe, expect, it } from 'vitest';
import { analyzeModel, handleAnalyzeRequest, type AnalyzedStl, type AnalyzeRequest, type AnalyzeResponse } from '../src/stl/analyze';
import { StlAnalyzer, type WorkerLike } from '../src/stl/analyzer';
import { createProgress } from '../src/stl/progress';
import { asciiStl, binaryStl, cubeTriangles, discObj, encode } from './helpers/mesh';
import { cube3mf } from './helpers/zip';

/** Formato de prueba: `make` devuelve los bytes del archivo (el 3MF se construye al vuelo). */
interface Caso {
  readonly nombre: string;
  readonly fileName: string;
  readonly make: () => ArrayBuffer | Uint8Array | Promise<ArrayBuffer | Uint8Array>;
}

/** Ejecuta `analyzeModel` guardando las fracciones (0–1) que va emitiendo. */
async function medir(
  make: Caso['make'],
  fileName: string,
): Promise<{ values: number[]; result: AnalyzedStl }> {
  const values: number[] = [];
  const result = await analyzeModel(await make(), fileName, undefined, (fraction) => values.push(fraction));
  return { values, result };
}

/** Lo que tiene que salir idéntico con y sin `onProgress`. */
const resumen = ({ mesh, stats }: AnalyzedStl): readonly [number, number, number, number] => [
  stats.volume,
  stats.triangleCount,
  stats.openEdges,
  mesh.triangleCount,
];

/** STL binario de `count` triángulos sueltos (cada uno con tres vértices distintos). */
function stlGrande(count: number): ArrayBuffer {
  const buffer = new ArrayBuffer(84 + count * 50);
  const view = new DataView(buffer);
  view.setUint32(80, count, true);
  for (let t = 0; t < count; t++) {
    const base = 84 + t * 50;
    const x = t % 1000;
    const y = Math.floor(t / 1000);
    const coords = [x, y, 0, x + 1, y, 0, x, y + 1, 0];
    for (let k = 0; k < 9; k++) view.setFloat32(base + 12 + k * 4, coords[k] ?? 0, true);
  }
  return buffer;
}

/** ¿Está estrictamente creciente (por tanto, sin repetidos)? */
const creciente = (values: readonly number[]): boolean =>
  values.every((value, i) => i === 0 || value > (values[i - 1] ?? Number.NEGATIVE_INFINITY));

describe('createProgress', () => {
  it('sin callback no falla al informar ni al terminar', () => {
    const progress = createProgress();
    const report = progress.stage(0, 1);
    expect(() => {
      report(0, 10);
      report(1, 10);
      report(5, 0);
      progress.done();
    }).not.toThrow();
  });

  it('emite fracciones crecientes, en [0, 1], sin repetir y como mucho 101 veces', () => {
    const values: number[] = [];
    const progress = createProgress((fraction) => values.push(fraction));
    const lectura = progress.stage(0, 0.5);
    const geometria = progress.stage(0.5, 1);
    // 10 001 llamadas por etapa (20 002 en total): como mucho puede cambiar 101 porcentajes.
    for (let i = 0; i <= 10_000; i++) {
      lectura(i, 10_000);
      geometria(i, 10_000);
    }
    expect(values.length).toBeGreaterThan(1);
    expect(values.length).toBeLessThanOrEqual(101);
    expect(creciente(values)).toBe(true);
    expect(new Set(values).size).toBe(values.length);
    expect(values.every((value) => value >= 0 && value <= 1)).toBe(true);
  });

  it('done() entrega el 1 una sola vez aunque se llame varias veces', () => {
    const values: number[] = [];
    const progress = createProgress((fraction) => values.push(fraction));
    progress.done();
    progress.done();
    expect(values).toEqual([1]);
  });

  it('los valores que bajan no se emiten', () => {
    const values: number[] = [];
    const progress = createProgress((fraction) => values.push(fraction));
    const report = progress.stage(0, 1);
    report(1, 2); // 0,5
    report(0, 4); // 0,25: más bajo, no se emite
    report(1, 1); // 1
    progress.done(); // sigue siendo 1: no se repite
    expect(values).toEqual([0.5, 1]);
  });
});

describe('analyzeModel con onProgress', () => {
  const casos: readonly Caso[] = [
    { nombre: 'STL binario', fileName: 'cubo.stl', make: () => binaryStl(cubeTriangles(20)) },
    { nombre: 'STL ASCII', fileName: 'cubo.stl', make: () => encode(asciiStl(cubeTriangles(20))) },
    { nombre: 'OBJ', fileName: 'a.obj', make: () => encode(discObj(12)) },
    { nombre: '3MF', fileName: 'a.3mf', make: () => cube3mf(20) },
  ];

  for (const { nombre, fileName, make } of casos) {
    it(`reparte el progreso en ${nombre} sin cambiar el resultado`, async () => {
      const con = await medir(make, fileName);
      const sin = await analyzeModel(await make(), fileName);

      expect(con.values.length).toBeGreaterThan(0);
      expect(creciente(con.values)).toBe(true);
      expect(con.values.at(-1)).toBe(1);
      expect(con.values.every((value) => value >= 0 && value <= 1)).toBe(true);
      expect(resumen(con.result)).toEqual(resumen(sin));
    });
  }

  it('una malla de 70 000 triángulos informa de varios puntos intermedios', async () => {
    const values: number[] = [];
    const { stats } = await analyzeModel(stlGrande(70_000), 'grande.stl', undefined, (fraction) => values.push(fraction));
    expect(stats.triangleCount).toBe(70_000);
    const intermedios = new Set(values.filter((fraction) => fraction > 0 && fraction < 1));
    expect(intermedios.size).toBeGreaterThan(3);
    expect(values.at(-1)).toBe(1);
  }, 60_000);
});

describe('handleAnalyzeRequest', () => {
  it('informa de enteros crecientes sin repetir, con el último en 100, y responde ok', async () => {
    const percents: number[] = [];
    const { response } = await handleAnalyzeRequest(
      { id: 7, buffer: binaryStl(cubeTriangles(20)), fileName: 'cubo.stl' },
      (percent) => percents.push(percent),
    );
    expect(response.ok).toBe(true);
    expect(response.id).toBe(7);
    expect(percents.length).toBeGreaterThan(0);
    expect(percents.every((percent) => Number.isInteger(percent))).toBe(true);
    expect(percents.every((percent) => percent >= 0 && percent <= 100)).toBe(true);
    expect(creciente(percents)).toBe(true);
    expect(percents.at(-1)).toBe(100);
  });
});

/**
 * Doble de Worker que manda `{ id, progress }` antes de responder, como el worker real.
 * Con `auto = false` solo guarda la petición (así se puede cancelar a mitad).
 */
class ProgressWorker implements WorkerLike {
  readonly requests: AnalyzeRequest[] = [];
  auto = true;
  private onMessage: ((event: MessageEvent<AnalyzeResponse>) => void) | null = null;

  postMessage(message: AnalyzeRequest): void {
    this.requests.push(message);
    if (!this.auto) return;
    this.emitProgress(message.id, 10);
    this.emitProgress(message.id, 60);
    void handleAnalyzeRequest(message).then(({ response }) => {
      this.onMessage?.({ data: response } as MessageEvent<AnalyzeResponse>);
    });
  }

  emitProgress(id: number, progress: number): void {
    this.onMessage?.({ data: { id, progress } } as MessageEvent<AnalyzeResponse>);
  }

  addEventListener(type: 'message' | 'error', listener: (event: never) => void): void {
    if (type === 'message') this.onMessage = listener as (event: MessageEvent<AnalyzeResponse>) => void;
  }

  terminate(): void {
    // Nada que cerrar: el doble no tiene hilos.
  }
}

describe('StlAnalyzer · progreso', () => {
  it('reenvía los { id, progress } del worker al callback de ese análisis y resuelve', async () => {
    const worker = new ProgressWorker();
    const analyzer = new StlAnalyzer(() => worker);
    const seen: number[] = [];

    const { stats } = await analyzer.analyze(binaryStl(cubeTriangles(20)), 'cubo.stl', (percent) => seen.push(percent));

    expect(seen).toEqual([10, 60]);
    expect(stats.triangleCount).toBe(12);
    expect(analyzer.busy).toBe(false);
  });

  it('con dos análisis seguidos sin cancelar, cada uno recibe solo los suyos', async () => {
    const worker = new ProgressWorker();
    const analyzer = new StlAnalyzer(() => worker);
    const seenA: number[] = [];
    const seenB: number[] = [];

    const both = Promise.all([
      analyzer.analyze(binaryStl(cubeTriangles(10)), 'a.stl', (percent) => seenA.push(percent)),
      analyzer.analyze(binaryStl(cubeTriangles(10, [20, 0, 0])), 'b.stl', (percent) => seenB.push(percent)),
    ]);
    const [first, second] = await both;

    expect(seenA).toEqual([10, 60]);
    expect(seenB).toEqual([10, 60]);
    expect(first.stats.triangleCount).toBe(12);
    expect(second.stats.triangleCount).toBe(12);
    expect(worker.requests.map((request) => request.id)).toEqual([1, 2]);
  });

  it('tras cancel(), un { id, progress } tardío del id cancelado no llama al callback ni lanza', async () => {
    const worker = new ProgressWorker();
    worker.auto = false;
    const analyzer = new StlAnalyzer(() => worker);
    const seen: number[] = [];

    const pending = analyzer.analyze(binaryStl(cubeTriangles(20)), 'cubo.stl', (percent) => seen.push(percent));
    expect(worker.requests).toHaveLength(1);

    analyzer.cancel();
    await expect(pending).rejects.toMatchObject({ code: 'err.cancelled' });
    expect(analyzer.busy).toBe(false);
    expect(seen).toEqual([]);

    const id = worker.requests[0]?.id ?? 0;
    expect(() => worker.emitProgress(id, 90)).not.toThrow();
    expect(seen).toEqual([]);
  });
});
