import { isValidLogo } from '../quote/business';

/** Lado mayor del logotipo guardado, en píxeles: de sobra para un PDF y ligero para localStorage. */
export const LOGO_MAX_SIDE = 400;
/** Archivos más grandes que esto ni se intentan leer. */
export const LOGO_MAX_FILE_BYTES = 8 * 1024 * 1024;

const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];

/** Error con un mensaje listo para mostrar. */
export class LogoError extends Error {}

/** Tamaño final: el lado mayor se limita a `max` sin ampliar ni deformar. */
export function logoSize(width: number, height: number, max = LOGO_MAX_SIDE): { width: number; height: number } {
  const ratio = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

function load(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new LogoError('No se ha podido leer la imagen. Prueba con otro archivo PNG o JPEG.'));
    };
    image.src = url;
  });
}

/**
 * Reduce una imagen local a un «data URL» PNG (o JPEG si el original lo era) apto para
 * guardar y para el PDF. Todo ocurre en el navegador: la imagen no se envía a ninguna parte.
 */
export async function prepareLogo(file: File): Promise<string> {
  if (!ACCEPTED.includes(file.type)) {
    throw new LogoError('Formato no admitido: usa una imagen PNG, JPEG o WebP.');
  }
  if (file.size > LOGO_MAX_FILE_BYTES) {
    throw new LogoError('La imagen pesa demasiado (máximo 8 MB). Reduce su tamaño y vuelve a probar.');
  }
  const image = await load(file);
  if (!image.naturalWidth || !image.naturalHeight) throw new LogoError('La imagen está vacía.');

  const jpeg = file.type === 'image/jpeg';
  for (const side of [LOGO_MAX_SIDE, 240, 120]) {
    const { width, height } = logoSize(image.naturalWidth, image.naturalHeight, side);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new LogoError('Tu navegador no puede procesar imágenes.');
    if (jpeg) {
      context.fillStyle = '#ffffff'; // JPEG no tiene transparencia
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(image, 0, 0, width, height);
    const dataUrl = canvas.toDataURL(jpeg ? 'image/jpeg' : 'image/png', 0.9);
    if (isValidLogo(dataUrl)) return dataUrl;
  }
  throw new LogoError('La imagen sigue siendo demasiado pesada para guardarla. Prueba con una más sencilla.');
}
