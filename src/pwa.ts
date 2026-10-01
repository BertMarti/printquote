/**
 * Registra el service worker (`src/sw.js`, que `scripts/pwa-plugin.ts` copia a `dist/sw.js`) para que la
 * app se pueda instalar y abrir sin conexión. Solo en producción: en `npm run dev` estorbaría al hot reload.
 * Un fallo al registrar no afecta a la app, que sigue funcionando con red.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  // Tras `load`: el precaché (≈ 0,7 MB) no compite con la primera carga.
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL, updateViaCache: 'none' })
      .catch(() => undefined);
  });
}
