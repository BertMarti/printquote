/**
 * Trusted Types: la CSP del build lleva `require-trusted-types-for 'script'` y `trusted-types printquote`.
 * Con eso el navegador rechaza cualquier cadena que llegue a un «sumidero» peligroso (`innerHTML`, `eval`,
 * `script.src`, `new Worker(url)`, `serviceWorker.register(url)`…) salvo que la haya creado una política
 * permitida. La única política es esta, y solo crea URL de script del propio sitio y dentro de la carpeta
 * de la app (`/printquote/`): el worker que lee los modelos y el service worker. No crea HTML ni scripts.
 *
 * Importa porque todas las webs de Alberto comparten el origen `https://bertmarti.github.io`: un fallo de
 * inyección aquí podría leer el `localStorage` de las demás.
 */

/** Lo mínimo que se usa de la API (aún no está en `lib.dom.d.ts`). */
interface ScriptUrlPolicy {
  createScriptURL(input: string): unknown;
}
interface TrustedTypesFactory {
  createPolicy(name: string, rules: { createScriptURL: (input: string) => string }): ScriptUrlPolicy;
}

/** Nombre de la política: debe coincidir con la directiva `trusted-types` de `scripts/csp-plugin.ts`. */
export const TRUSTED_TYPES_POLICY = 'printquote';

/** Valor que aceptan `new Worker()` y `serviceWorker.register()`: un `TrustedScriptURL` o, sin la API, la URL tal cual. */
export type ScriptUrl = string & { readonly __scriptUrl?: never };

/**
 * Comprueba que la URL es del mismo origen y está dentro de la carpeta de la app; si no, lanza.
 * Exportada para los tests.
 */
export function checkScriptUrl(input: string, base: string, origin: string, appPath: string): string {
  const url = new URL(input, base);
  if (url.origin !== origin || !url.pathname.startsWith(appPath)) {
    throw new TypeError(`URL de script no permitida: ${url.href}`);
  }
  return url.href;
}

let policy: ScriptUrlPolicy | null | undefined;

function getPolicy(): ScriptUrlPolicy | null {
  if (policy !== undefined) return policy;
  const factory = (globalThis as { trustedTypes?: TrustedTypesFactory }).trustedTypes;
  // Sin la API (Firefox, Safari antiguos, Node en los tests) no hay nada que crear: se usa la URL tal cual.
  policy = factory
    ? factory.createPolicy(TRUSTED_TYPES_POLICY, {
        createScriptURL: (input) => checkScriptUrl(input, location.href, location.origin, import.meta.env.BASE_URL),
      })
    : null;
  return policy;
}

/** URL de script lista para `new Worker()` o `navigator.serviceWorker.register()`. */
export function scriptUrl(input: string): ScriptUrl {
  const active = getPolicy();
  if (!active) return checkScriptUrl(input, location.href, location.origin, import.meta.env.BASE_URL) as ScriptUrl;
  // El navegador acepta el TrustedScriptURL donde pide una cadena; TypeScript no lo sabe.
  return active.createScriptURL(input) as ScriptUrl;
}
