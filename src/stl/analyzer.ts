import { analyzeModel, type AnalyzedStl, type AnalyzeRequest, type AnalyzeResponse } from './analyze';
import { ModelParseError } from './errors';

/** Lo mínimo que se usa de un Worker (permite probarlo con un doble en Node). */
export interface WorkerLike {
  postMessage(message: AnalyzeRequest, transfer: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<AnalyzeResponse>) => void): void;
  addEventListener(type: 'error', listener: (event: Event) => void): void;
  terminate(): void;
}

function createStlWorker(): WorkerLike {
  // Vite detecta esta forma exacta y empaqueta el worker como un archivo aparte.
  return new Worker(new URL('./stl.worker.ts', import.meta.url), { type: 'module' });
}

interface Pending {
  resolve: (result: AnalyzedStl) => void;
  reject: (error: Error) => void;
}

/**
 * Analiza modelos 3D (STL, OBJ, 3MF) en un Web Worker. Si el navegador no puede crear el worker (o este
 * falla al arrancar), hace el trabajo en el hilo principal: más lento, pero funciona.
 */
export class StlAnalyzer {
  private worker: WorkerLike | null = null;
  private workerFailed = false;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor(private readonly createWorker: () => WorkerLike = createStlWorker) {}

  /** Lee y mide el modelo. El buffer se transfiere al worker: no se debe reutilizar después. */
  analyze(buffer: ArrayBuffer, fileName?: string): Promise<AnalyzedStl> {
    const worker = this.ensureWorker();
    if (!worker) {
      return analyzeModel(buffer, fileName);
    }
    const id = this.nextId++;
    return new Promise<AnalyzedStl>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage(fileName === undefined ? { id, buffer } : { id, buffer, fileName }, [buffer]);
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.rejectAll(new Error('Análisis cancelado.'));
  }

  private ensureWorker(): WorkerLike | null {
    if (this.worker || this.workerFailed) return this.worker;
    try {
      const worker = this.createWorker();
      worker.addEventListener('message', (event) => this.onMessage(event.data));
      worker.addEventListener('error', () => {
        // El worker no ha podido cargarse o ha reventado (p. ej. sin memoria): los
        // siguientes archivos se leerán en el hilo principal.
        this.workerFailed = true;
        this.worker?.terminate();
        this.worker = null;
        this.rejectAll(new Error('El proceso de lectura en segundo plano ha fallado.'));
      });
      this.worker = worker;
    } catch {
      this.workerFailed = true;
    }
    return this.worker;
  }

  private onMessage(response: AnalyzeResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    if (response.ok) {
      pending.resolve(response.result);
    } else {
      pending.reject(response.parseError ? new ModelParseError(response.message) : new Error(response.message));
    }
  }

  private rejectAll(error: Error): void {
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }
}
