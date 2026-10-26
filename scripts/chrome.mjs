// Chrome o Edge headless manejado por el protocolo DevTools con el WebSocket de Node (sin dependencias).
// Lo usan `captura.mjs` (capturas del README), `iconos.mjs` (iconos de la PWA) e `integracion.mjs` (prueba del build).
//
// Con la variable CHROME se indica la ruta del navegador si no está en un sitio habitual. El puerto de depuración
// lo elige Chrome (`--remote-debugging-port=0`) y se lee de `DevToolsActivePort` en su perfil temporal: así nunca
// se engancha a otro Chrome que haya quedado vivo. Con Ctrl+C (SIGINT) o SIGTERM se cierra Chrome con todos sus
// procesos, se borra el perfil y se sale con 130 o 143.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Espera síncrona (para los manejadores de señales, que no pueden esperar promesas). */
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Borra una carpeta temporal; algún proceso hijo puede seguir escribiendo un instante: es un extra, nunca un fallo. */
export function removeSync(dir) {
  for (let i = 0; i < 5; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      sleepSync(200);
    }
  }
}

// Limpiezas pendientes si llega SIGINT o SIGTERM: un solo manejador para todas (Chrome, perfiles, descargas…).
const cleanups = new Set();
function onSignal(signal) {
  for (const cleanup of [...cleanups].reverse()) {
    try {
      cleanup();
    } catch {
      /* se sigue con las demás */
    }
  }
  process.exit(signal === 'SIGINT' ? 130 : 143);
}

/** Registra `cleanup` para Ctrl+C o SIGTERM. Devuelve la función que lo quita (llámala en el `finally`). */
export function cleanupOnSignal(cleanup) {
  if (cleanups.size === 0) {
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
  }
  cleanups.add(cleanup);
  return () => {
    cleanups.delete(cleanup);
    if (cleanups.size === 0) {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
    }
  };
}

function findChrome() {
  const found = [
    process.env.CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].find((path) => path && existsSync(path));
  if (!found) throw new Error('No encuentro Chrome ni Edge: indica la ruta con la variable CHROME.');
  return found;
}

async function connect(profile) {
  for (let i = 0; i < 100; i++) {
    try {
      // Chrome escribe aquí el puerto que ha elegido (primera línea) en cuanto está escuchando.
      const port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = pages.find((p) => p.type === 'page');
      if (page) return new WebSocket(page.webSocketDebuggerUrl);
    } catch {
      /* Chrome todavía está arrancando */
    }
    await sleep(200);
  }
  throw new Error('Chrome no responde');
}

/**
 * Abre un Chrome headless, llama a `callback({ send, run, on })` y lo cierra al terminar.
 * `send(método, parámetros, sesión?)` es una orden DevTools (la sesión, para un worker adjunto);
 * `run(expresión)` evalúa JavaScript en la página; `on(evento, manejador)` escucha eventos DevTools
 * (el manejador recibe los parámetros y el `sessionId`, si viene de un worker).
 */
export async function withChrome(callback) {
  const profile = mkdtempSync(join(tmpdir(), 'printquote-'));
  const browser = spawn(
    findChrome(),
    [
      '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
      '--hide-scrollbars', '--force-color-profile=srgb', '--lang=es-ES', '--accept-lang=es-ES',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      // En los ejecutores de GitHub (Ubuntu 24.04) AppArmor impide el sandbox de Chrome; solo se abre la web local.
      ...(process.env.CI ? ['--no-sandbox'] : []),
      'about:blank',
    ],
    // En su propio grupo de procesos (fuera de Windows) para cerrar también sus procesos hijos.
    { stdio: 'ignore', detached: process.platform !== 'win32' },
  );
  // Cierra Chrome y todos sus procesos hijos (están en su propio grupo fuera de Windows).
  const stop = () => {
    try {
      if (process.platform === 'win32') browser.kill();
      else process.kill(-browser.pid, 'SIGTERM');
    } catch {
      browser.kill();
    }
  };
  const forget = cleanupOnSignal(() => {
    stop();
    sleepSync(500);
    removeSync(profile);
  });
  try {
    const socket = await connect(profile);
    await new Promise((done) => socket.addEventListener('open', done, { once: true }));
    let id = 0;
    const pending = new Map();
    const listeners = new Map();
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.id !== undefined) pending.get(message.id)?.(message);
      else for (const listener of listeners.get(message.method) ?? []) listener(message.params, message.sessionId);
    });
    const on = (method, listener) => listeners.set(method, [...(listeners.get(method) ?? []), listener]);
    const send = (method, params = {}, sessionId) =>
      new Promise((done, fail) => {
        const n = ++id;
        pending.set(n, (message) => (message.error ? fail(new Error(message.error.message)) : done(message.result)));
        socket.send(JSON.stringify(sessionId ? { id: n, method, params, sessionId } : { id: n, method, params }));
      });
    const run = async (expression) => {
      const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
      return result.value;
    };
    await send('Page.enable');
    return await callback({ send, run, on });
  } finally {
    // Se espera a que Chrome se cierre del todo (en la Raspberry Pi no conviene dejar uno vivo) y se borra el perfil.
    const closed = browser.exitCode !== null ? Promise.resolve() : new Promise((done) => browser.once('exit', done));
    stop();
    await Promise.race([closed, sleep(5000)]);
    removeSync(profile);
    forget();
  }
}
