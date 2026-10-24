import { describe, expect, it } from 'vitest';
import { handleAnalyzeRequest, type AnalyzeRequest, type AnalyzeResponse } from '../src/stl/analyze';
import { StlAnalyzer, type WorkerLike } from '../src/stl/analyzer';
import { ModelParseError } from '../src/stl/errors';
import { binaryStl, cubeTriangles } from './helpers/mesh';

/**
 * Doble de Worker que obedece a `respond`: mientras sea `false` guarda la petición y no
 * contesta nunca (un archivo enorme puede tener el worker ocupado mucho rato).
 */
class MutedWorker implements WorkerLike {
  terminated = 0;
  posted = 0;
  respond = true;
  private onMessage: ((event: MessageEvent<AnalyzeResponse>) => void) | null = null;

  postMessage(message: AnalyzeRequest): void {
    this.posted++;
    if (!this.respond) return;
    void handleAnalyzeRequest(message).then(({ response }) => {
      this.onMessage?.({ data: response } as MessageEvent<AnalyzeResponse>);
    });
  }

  // El error del worker no se simula aquí: estos tests cancelan y leen, nunca lo hacen reventar.
  addEventListener(type: 'message' | 'error', listener: (event: never) => void): void {
    if (type === 'message') this.onMessage = listener as (event: MessageEvent<AnalyzeResponse>) => void;
  }

  terminate(): void {
    this.terminated++;
  }
}

/**
 * Analizador de prueba. Con `muteFirst` el primer worker nunca contesta (para poder cancelarlo
 * a mitad); los siguientes responden con el mismo manejador que el worker real.
 */
function makeAnalyzer(muteFirst = false): { analyzer: StlAnalyzer; workers: MutedWorker[] } {
  const workers: MutedWorker[] = [];
  const analyzer = new StlAnalyzer(() => {
    const worker = new MutedWorker();
    worker.respond = !(muteFirst && workers.length === 0);
    workers.push(worker);
    return worker;
  });
  return { analyzer, workers };
}

describe('StlAnalyzer · busy', () => {
  it('está en false sin trabajo, en true con análisis pendientes y en false al terminar', async () => {
    const { analyzer } = makeAnalyzer();
    expect(analyzer.busy).toBe(false);

    const pending = analyzer.analyze(binaryStl(cubeTriangles(20)));
    expect(analyzer.busy).toBe(true);

    const { stats } = await pending;
    expect(stats.triangleCount).toBe(12);
    expect(analyzer.busy).toBe(false);
  });

  it('sigue en true hasta que acaban las dos peticiones simultáneas', async () => {
    const { analyzer } = makeAnalyzer();
    const both = Promise.all([
      analyzer.analyze(binaryStl(cubeTriangles(10))),
      analyzer.analyze(binaryStl([...cubeTriangles(10), ...cubeTriangles(10, [20, 0, 0])])),
    ]);
    expect(analyzer.busy).toBe(true);
    const [a, b] = await both;
    expect(a.stats.triangleCount).toBe(12);
    expect(b.stats.triangleCount).toBe(24);
    expect(analyzer.busy).toBe(false);
  });
});

describe('StlAnalyzer · cancel()', () => {
  it('cierra el worker, rechaza lo pendiente con err.cancelled y deja busy en false', async () => {
    const { analyzer, workers } = makeAnalyzer(true);
    const first = analyzer.analyze(binaryStl(cubeTriangles(20)));
    const second = analyzer.analyze(binaryStl(cubeTriangles(20, [50, 0, 0])));
    expect(analyzer.busy).toBe(true);
    expect(workers).toHaveLength(1);

    analyzer.cancel();
    expect(workers.map((worker) => worker.terminated)).toEqual([1]);
    expect(workers.map((worker) => worker.posted)).toEqual([2]); // las dos llegaron y nadie contestó
    expect(analyzer.busy).toBe(false);

    await expect(first).rejects.toBeInstanceOf(ModelParseError);
    await expect(first).rejects.toMatchObject({ code: 'err.cancelled' });
    await expect(second).rejects.toMatchObject({ code: 'err.cancelled' });
    expect(analyzer.busy).toBe(false);
  });

  it('el siguiente análisis crea un worker nuevo (la fábrica se llama dos veces) y funciona', async () => {
    const { analyzer, workers } = makeAnalyzer(true);
    const pending = analyzer.analyze(binaryStl(cubeTriangles(20)));
    analyzer.cancel();
    await expect(pending).rejects.toMatchObject({ code: 'err.cancelled' });
    expect(workers).toHaveLength(1);

    const { stats } = await analyzer.analyze(binaryStl(cubeTriangles(20)));
    expect(workers).toHaveLength(2);
    expect(workers.map((worker) => worker.terminated)).toEqual([1, 0]);
    expect(stats.triangleCount).toBe(12);
    expect(analyzer.busy).toBe(false);
  });

  it('sin nada pendiente no rompe nada y lo siguiente se lee con normalidad', async () => {
    const { analyzer, workers } = makeAnalyzer();
    analyzer.cancel();
    expect(analyzer.busy).toBe(false);
    expect(workers).toHaveLength(0); // ni siquiera se había creado el worker

    const { stats } = await analyzer.analyze(binaryStl(cubeTriangles(20)));
    expect(workers).toHaveLength(1);
    expect(stats.triangleCount).toBe(12);
    expect(analyzer.busy).toBe(false);
  });
});

describe('StlAnalyzer · dispose()', () => {
  it('cierra el worker y sigue rechazando lo pendiente con err.cancelled', async () => {
    const { analyzer, workers } = makeAnalyzer(true);
    const pending = analyzer.analyze(binaryStl(cubeTriangles(20)));
    expect(analyzer.busy).toBe(true);

    analyzer.dispose();
    expect(workers.map((worker) => worker.terminated)).toEqual([1]);
    expect(analyzer.busy).toBe(false);

    await expect(pending).rejects.toBeInstanceOf(ModelParseError);
    await expect(pending).rejects.toMatchObject({ code: 'err.cancelled' });
  });
});
