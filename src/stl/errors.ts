/** Error de lectura de un modelo 3D con un mensaje pensado para mostrarse tal cual a la persona usuaria. */
export class ModelParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelParseError';
  }
}
