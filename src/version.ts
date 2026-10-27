/**
 * Versión de printquote. La pone Vite al compilar (`define` en `vite.config.ts`, leída de `package.json`):
 * así solo hay que cambiarla en un sitio. Se ve en el colofón del panel y en el pie del PDF.
 */
declare const __APP_VERSION__: string | undefined;

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
