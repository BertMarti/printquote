/**
 * ¿Puede este navegador crear un contexto WebGL? Vive aparte del visor para poder
 * comprobarlo sin descargar three.js.
 */
export function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}
