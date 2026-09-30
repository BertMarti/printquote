// Worker que lee el modelo (STL, OBJ o 3MF) y calcula su geometría fuera del hilo principal, para que la
// interfaz no se congele con archivos de cientos de miles de triángulos.
import { handleAnalyzeRequest, type AnalyzeRequest } from './analyze';

// Tipado mínimo del ámbito del worker (la lib «webworker» choca con la lib «dom» del proyecto).
interface WorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent<AnalyzeRequest>) => void): void;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.addEventListener('message', (event) => {
  void handleAnalyzeRequest(event.data).then(({ response, transfer }) => scope.postMessage(response, transfer));
});
