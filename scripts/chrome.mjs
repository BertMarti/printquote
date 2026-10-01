// Chrome o Edge headless manejado por el protocolo DevTools con el WebSocket de Node (sin dependencias).
// Lo usan `captura.mjs` (capturas del README) y `iconos.mjs` (iconos de la PWA).
//
// Con la variable CHROME se indica la ruta del navegador si no está en un sitio habitual.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const PORT = 9333;

function findChrome() {
  const found = [
    process.env.CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
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
 * Abre un Chrome headless, llama a `callback({ send, run })` y lo cierra al terminar.
 * `send(método, parámetros)` es una orden DevTools; `run(expresión)` evalúa JavaScript en la página.
 */
export async function withChrome(callback) {
  const browser = spawn(
    findChrome(),
    [
      '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'printquote-'))}`,
      '--hide-scrollbars', '--force-color-profile=srgb', '--lang=es-ES', '--accept-lang=es-ES',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank',
    ],
    { stdio: 'ignore' },
  );
  try {
    const socket = await connect();
    await new Promise((done) => socket.addEventListener('open', done, { once: true }));
    let id = 0;
    const pending = new Map();
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      pending.get(message.id)?.(message);
    });
    const send = (method, params = {}) =>
      new Promise((done, fail) => {
        const n = ++id;
        pending.set(n, (message) => (message.error ? fail(new Error(message.error.message)) : done(message.result)));
        socket.send(JSON.stringify({ id: n, method, params }));
      });
    const run = async (expression) => {
      const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
      return result.value;
    };
    await send('Page.enable');
    return await callback({ send, run });
  } finally {
    browser.kill();
  }
}
