// Plugin de Vite que añade la política de seguridad de contenidos (CSP) a `index.html` solo al
// compilar. En desarrollo no se pone: Vite inyecta los estilos con <style> y la recarga en caliente
// los necesita. GitHub Pages no permite cabeceras propias, así que va en un <meta>.
import type { Plugin } from 'vite';

/**
 * Directivas de la CSP. Todo sale del propio sitio:
 * - `script-src 'self'`: sin scripts en línea ni `eval` (ni three.js ni pdf-lib los usan).
 * - `style-src 'self'`: la hoja de estilos compilada; el visor y el código solo tocan `element.style`
 *   desde JavaScript (CSSOM), que la CSP permite.
 * - `img-src data: blob:`: el logotipo del negocio (data URL), la vista 3D de la hoja impresa
 *   (`toDataURL`) y la previsualización del logotipo (`createObjectURL`).
 * - `worker-src 'self'`: el worker que lee el modelo y el service worker de la PWA.
 * - `connect-src 'self'`: la pieza de ejemplo y las fuentes del PDF.
 * - `require-trusted-types-for 'script'` + `trusted-types printquote`: Trusted Types. Ninguna cadena llega a
 *   `innerHTML`, `eval`, `new Worker()` ni `serviceWorker.register()` sin pasar por la única política
 *   (`src/trusted-types.ts`), que solo admite URL de script de la carpeta de la app. Protege también al
 *   resto de webs del origen compartido `bertmarti.github.io`. Sin `'allow-duplicates'`: nadie más puede
 *   crear otra política con ese nombre después.
 * - `frame-ancestors` no vale en un <meta> (los navegadores lo ignoran), por eso no está.
 */
export const CSP_DIRECTIVES: readonly string[] = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "require-trusted-types-for 'script'",
  "trusted-types printquote",
];

export const CSP = CSP_DIRECTIVES.join('; ');

/** Inserta el <meta> de la CSP justo después de `<meta charset>` (debe ir antes de cualquier recurso). */
export function injectCsp(html: string, policy = CSP): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}" />`;
  const charset = /<meta charset="[^"]*"\s*\/?>/i;
  if (!charset.test(html)) throw new Error('index.html no tiene <meta charset>: no sé dónde poner la CSP.');
  return html.replace(charset, (tag) => `${tag}\n    ${meta}`);
}

export function csp(): Plugin {
  return {
    name: 'printquote-csp',
    apply: 'build',
    transformIndexHtml: (html) => injectCsp(html),
  };
}
