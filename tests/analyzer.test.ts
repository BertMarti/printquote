import { describe, expect, it } from 'vitest';
import { analyzeStl, handleAnalyzeRequest, type AnalyzeRequest, type AnalyzeResponse } from '../src/stl/analyze';
import { StlAnalyzer, type WorkerLike } from '../src/stl/analyzer';
import { ModelParseError } from '../src/stl/errors';
import { binaryStl, cubeTriangles, encode } from './helpers/mesh';

/** Doble de Worker: responde de forma asíncrona usando el mismo manejador que el worker real. */
class FakeWorker implements WorkerLike {
  private onMessage: ((event: MessageEvent<AnalyzeResponse>) => void) | null = null;
  private onError: ((event: Event) => void) | null = null;
  transfers: Transferable[][] = [];
  crash = false;

  postMessage(message: AnalyzeRequest, transfer: Transferable[]): void {
    this.transfers.push(transfer);
    queueMicrotask(() => {
      if (this.crash) {
        this.onError?.(new Event('error'));
        return;
      }
      void handleAnalyzeRequest(message).then(({ response }) => {
        this.onMessage?.({ data: response } as MessageEvent<AnalyzeResponse>);
      });
    });
  }

  addEventListener(type: 'message' | 'error', listener: (event: never) => void): void {
    if (type === 'message') this.onMessage = listener as (event: MessageEvent<AnalyzeResponse>) => void;
    else this.onError = listener as (event: Event) => void;
  }

  terminate(): void {}
}

describe('handleAnalyzeRequest (lo que corre dentro del worker)', () => {
  it('devuelve malla y geometría y transfiere el buffer de posiciones', async () => {
    const { response, transfer } = await handleAnalyzeRequest({ id: 7, buffer: binaryStl(cubeTriangles(20)) });
    expect(response.id).toBe(7);
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.result.stats.volume).toBeCloseTo(8000, 6);
    expect(transfer).toEqual([response.result.mesh.positions.buffer]);
  });

  it('convierte los errores de lectura en un mensaje serializable', async () => {
    const { response, transfer } = await handleAnalyzeRequest({ id: 1, buffer: encode('hola').buffer as ArrayBuffer });
    expect(response).toMatchObject({ id: 1, ok: false, parseError: { code: 'err.stl.small' } });
    expect(transfer).toEqual([]);
  });
});

describe('StlAnalyzer', () => {
  it('usa el worker y transfiere el archivo sin copiarlo', async () => {
    const worker = new FakeWorker();
    const analyzer = new StlAnalyzer(() => worker);
    const buffer = binaryStl(cubeTriangles(20));
    const { stats } = await analyzer.analyze(buffer);
    expect(stats.triangleCount).toBe(12);
    expect(worker.transfers).toEqual([[buffer]]);
  });

  it('los errores de lectura llegan como ModelParseError con el mensaje en español', async () => {
    const analyzer = new StlAnalyzer(() => new FakeWorker());
    await expect(analyzer.analyze(new ArrayBuffer(0))).rejects.toThrow(ModelParseError);
    await expect(analyzer.analyze(new ArrayBuffer(0))).rejects.toThrow(/vacío/);
    // El código y los datos cruzan el worker para poder traducir el mensaje en la interfaz.
    await expect(analyzer.analyze(new ArrayBuffer(0))).rejects.toMatchObject({ code: 'err.empty' });
  });

  it('peticiones simultáneas: cada una recibe su resultado', async () => {
    const analyzer = new StlAnalyzer(() => new FakeWorker());
    const [a, b] = await Promise.all([
      analyzer.analyze(binaryStl(cubeTriangles(10))),
      analyzer.analyze(binaryStl([...cubeTriangles(10), ...cubeTriangles(10, [20, 0, 0])])),
    ]);
    expect(a.stats.triangleCount).toBe(12);
    expect(b.stats.triangleCount).toBe(24);
  });

  it('sin soporte de workers, calcula en el hilo principal', async () => {
    const analyzer = new StlAnalyzer(() => {
      throw new ReferenceError('Worker is not defined');
    });
    const { stats } = await analyzer.analyze(binaryStl(cubeTriangles(20)));
    expect(stats.volume).toBeCloseTo(analyzeStl(binaryStl(cubeTriangles(20))).stats.volume, 9);
  });

  it('si el worker revienta, esa carga falla con un error y las siguientes van por el hilo principal', async () => {
    const worker = new FakeWorker();
    worker.crash = true;
    const analyzer = new StlAnalyzer(() => worker);
    await expect(analyzer.analyze(binaryStl(cubeTriangles(20)))).rejects.toThrow(/segundo plano/);
    const { stats } = await analyzer.analyze(binaryStl(cubeTriangles(20)));
    expect(stats.triangleCount).toBe(12);
  });
});
