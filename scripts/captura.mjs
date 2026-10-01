// Regenera las capturas del README y de la vista previa al compartir el enlace con Chrome headless
// (hace falta Chrome o Edge y la web en marcha: `npm run dev` o `npm run preview`).
//
// Uso: node scripts/captura.mjs [url]   (por defecto http://localhost:5173/printquote/)
//      CHROME=/ruta/a/chrome node scripts/captura.mjs
//  →  docs/captura.png (1440 × 1200: ficha completa, con el perfil de impresora Bambu Lab A1)
//     public/og.png    (1440 × 900: primera pantalla, la que se ve al abrir la pieza de ejemplo)
//
// Siempre la pieza de ejemplo, en español y con el tema claro. El HTML se toma tal cual lo sirve la web:
// si cambia la interfaz, basta volver a ejecutarlo.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] ?? 'http://localhost:5173/printquote/';
const chrome = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((path) => path && existsSync(path));
if (!chrome) throw new Error('No encuentro Chrome ni Edge: indica la ruta con la variable CHROME.');

const PORT = 9333;
const process_ = spawn(
  chrome,
  [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'printquote-'))}`,
    '--hide-scrollbars', '--force-color-profile=srgb', '--lang=es-ES', '--accept-lang=es-ES',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

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

  const shoot = async (file, width, height, prepare) => {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await send('Page.navigate', { url: 'about:blank' });
    await send('Page.navigate', { url: `${base}#ejemplo` });
    // Espera a que la pieza de ejemplo esté cargada y el visor dibujado.
    for (let i = 0; i < 100 && !(await run(`document.getElementById('out-total')?.textContent.trim() !== '—' && !!document.querySelector('#viewer canvas')`)); i++) await sleep(200);
    await run(`localStorage.clear()`);
    await run(prepare);
    await sleep(800);
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(root, file), Buffer.from(data, 'base64'));
    console.log(`${file} (${width} × ${height})`);
  };

  // Se simula lo que haría una persona: escribir en el campo y avisar a la página.
  const setValue = (inputId, value) =>
    `(() => { const e = document.getElementById('${inputId}'); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); })();`;

  await send('Page.enable');
  await shoot('public/og.png', 1440, 900, `document.querySelector('button[data-lang="es"]').click();`);
  await shoot(
    'docs/captura.png',
    1440,
    1200,
    [
      `document.querySelector('button[data-lang="es"]').click();`,
      setValue('in-printer', 'bambu-a1'),
    ].join('\n'),
  );
} finally {
  process_.kill();
}
