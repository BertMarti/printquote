// Chrome o Edge headless manejado por el protocolo DevTools con el WebSocket de Node (sin dependencias).
// Lo usan `captura.mjs` (capturas del README), `iconos.mjs` (iconos de la PWA) e `integracion.mjs` (prueba del build).
//
// Con la variable CHROME se indica la ruta del navegador si no está en un sitio habitual.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// CHROME_PORT permite elegir otro puerto de depuración si el 9333 está ocupado.
const PORT = Number(process.env.CHROME_PORT ?? 9333);

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

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
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
      '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
      '--hide-scrollbars', '--force-color-profile=srgb', '--lang=es-ES', '--accept-lang=es-ES',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      // En los ejecutores de GitHub (Ubuntu 24.04) AppArmor impide el sandbox de Chrome; solo se abre la web local.
      ...(process.env.CI ? ['--no-sandbox'] : []),
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  try {
    const socket = await connect();
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
    browser.kill();
    await Promise.race([closed, sleep(5000)]);
    rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  }
}
