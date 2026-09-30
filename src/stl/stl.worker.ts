// Worker que lee el STL y calcula su geometría fuera del hilo principal, para que la
// interfaz no se congele con archivos de cientos de miles de triángulos.
import { handleAnalyzeRequest, type AnalyzeRequest } from './analyze';

// Tipado mínimo del ámbito del worker (la lib «webworker» choca con la lib «dom» del proyecto).
interface WorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent<AnalyzeRequest>) => void): void;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.addEventListener('message', (event) => {
  const { response, transfer } = handleAnalyzeRequest(event.data);
  scope.postMessage(response, transfer);
});
