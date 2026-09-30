import { es, type ErrorKey } from '../i18n/es';
import { interpolate, type Params } from '../i18n/interpolate';

/**
 * Error de lectura de un modelo 3D. Lleva un código de mensaje y sus datos para que la
 * interfaz lo muestre en el idioma activo (también cruza el Web Worker, que solo puede enviar
 * datos simples). `message` está siempre en español, para los registros y las pruebas.
 */
export class ModelParseError extends Error {
  constructor(
    readonly code: ErrorKey,
    readonly params: Params = {},
  ) {
    super(interpolate(es[code], params));
    this.name = 'ModelParseError';
  }
}
