// Mide la carga de la web compilada en Chrome/Chromium sin cabeza (sin dependencias: protocolo DevTools de `chrome.mjs`).
//
// Uso: npm run build && node scripts/medir-carga.mjs [carpeta] [repeticiones]   (por defecto dist/ y 3)
//      CHROME=/ruta/a/chromium node scripts/medir-carga.mjs
//
// Sirve la carpeta bajo /printquote/ comprimida con gzip y con `Cache-Control: max-age=600`, como GitHub Pages, y mide
// cada escenario con un perfil nuevo (primera visita, sin caché ni service worker):
// - escritorio: 1366 × 850, sin limitar;
// - móvil: 390 × 844, CPU 4 veces más lenta y red «4G lenta» (150 ms de ida y vuelta, 1,6 Mbit/s de bajada);
// - PDF en móvil: con la pieza de ejemplo ya analizada, del clic en «Descargar PDF» al archivo descargado, y lo mismo
//   con el puntero entrando en el botón 500 ms antes del clic (el tiempo cuenta desde que entra el puntero).
// Da la mediana de: primer pintado (FCP), DOMContentLoaded, visor 3D dibujado, «interactiva» (fin de la última tarea larga
// antes de 5 s sin ninguna, como el TTI de Lighthouse), tiempo bloqueado (TBT: lo que pasa de 50 ms cada tarea larga),
// la tarea más larga y, en el PDF, los kB descargados. Es una herramienta de medida, no una prueba: no falla por los números.
// El tamaño de cada chunk lo da `npm run build` (columna gzip).

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

// Node 20 trae WebSocket detrás de una opción: el script se vuelve a lanzar con ella.
if (typeof WebSocket === 'undefined') {
  const child = spawn(process.execPath, ['--experimental-websocket', ...process.argv.slice(1)], { stdio: 'inherit' });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  const code = await new Promise((done) => child.on('exit', (status, signal) => done(status ?? (signal === 'SIGINT' ? 130 : 143))));
  process.exit(code);
}

const { cleanupOnSignal, removeSync, sleep, withChrome } = await import('./chrome.mjs');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(process.argv[2] ?? join(root, 'dist'));
const RUNS = Math.max(1, Number(process.argv[3] ?? 3));
const BASE = '/printquote/';
const QUIET_MS = 5000;
const TIMEOUT_MS = 120_000;

if (!existsSync(join(dist, 'index.html'))) {
  console.error(`No encuentro ${join(dist, 'index.html')}: ejecuta antes «npm run build».`);
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.stl': 'model/stl',
};
/** Lo que GitHub Pages comprime (las imágenes PNG no). */
const COMPRESS = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.svg', '.ttf', '.stl']);
const gzipped = new Map();

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  let path;
  try {
    path = decodeURIComponent(url.pathname.slice(BASE.length - 1));
  } catch {
    response.writeHead(400).end();
    return;
  }
  let file = resolve(dist, `.${path}`);
  if (!url.pathname.startsWith(BASE) || (file !== dist && !file.startsWith(dist + sep))) {
    response.writeHead(404).end();
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) {
    response.writeHead(404).end();
    return;
  }
  const ext = extname(file);
  const headers = { 'Content-Type': TYPES[ext] ?? 'application/octet-stream', 'Cache-Control': 'max-age=600' };
  let body = readFileSync(file);
  if (COMPRESS.has(ext) && /\bgzip\b/.test(request.headers['accept-encoding'] ?? '')) {
    if (!gzipped.has(file)) gzipped.set(file, gzipSync(body, { level: 9 }));
    body = gzipped.get(file);
    headers['Content-Encoding'] = 'gzip';
  }
  response.writeHead(200, { ...headers, 'Content-Length': body.length });
  response.end(body);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const forget = cleanupOnSignal(() => server.close());

// Antes de que cargue nada: tareas largas y el momento en que aparece el lienzo del visor.
const PROBE = `
  window.__pq = { tasks: [], viewer: null };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__pq.tasks.push([e.startTime, e.duration]);
    }).observe({ type: 'longtask', buffered: true });
  } catch {}
  new MutationObserver(() => {
    if (window.__pq.viewer === null && document.querySelector('#viewer canvas')) window.__pq.viewer = performance.now();
  }).observe(document, { childList: true, subtree: true });
`;

const SCENARIOS = {
  escritorio: { width: 1366, height: 850, mobile: false, cpu: 1, network: null },
  movil: { width: 390, height: 844, mobile: true, cpu: 4, network: { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 } },
};

async function prepare(chrome, scenario) {
  const { send, on } = chrome;
  let bytes = 0;
  on('Network.loadingFinished', ({ encodedDataLength }) => (bytes += encodedDataLength));
  await send('Network.enable');
  // El service worker (que reclama la página al activarse) ocultaría lo descargado: se mide la red de verdad.
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
  await send('Emulation.setDeviceMetricsOverride', { width: scenario.width, height: scenario.height, deviceScaleFactor: scenario.mobile ? 2 : 1, mobile: scenario.mobile });
  if (scenario.mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  if (scenario.cpu > 1) await send('Emulation.setCPUThrottlingRate', { rate: scenario.cpu });
  if (scenario.network) await send('Network.emulateNetworkConditions', { offline: false, ...scenario.network });
  // En un navegador de verdad el proceso de la GPU ya está en marcha; en Chrome sin cabeza arranca con el primer
  // contexto WebGL y bloquea la página varios segundos (SwiftShader). Se arranca antes, en about:blank, salvo con
  // MEDIR_GPU_FRIA=1, para medir la web y no el arranque del navegador.
  if (!process.env.MEDIR_GPU_FRIA) await chrome.run(`!!document.createElement('canvas').getContext('webgl')`);
  return () => bytes;
}

/** Primera visita: espera al visor y a 5 s sin tareas largas, y calcula las medidas. */
async function firstVisit(scenario) {
  return withChrome(async (chrome) => {
    const { send, run } = chrome;
    await prepare(chrome, scenario);
    await send('Page.navigate', { url: `${origin}${BASE}` });
    const end = Date.now() + TIMEOUT_MS;
    let sample = null;
    while (Date.now() < end) {
      await sleep(250);
      sample = await run(`(() => {
        const nav = performance.getEntriesByType('navigation')[0];
        const fcp = performance.getEntriesByName('first-contentful-paint')[0];
        return { now: performance.now(), fcp: fcp ? fcp.startTime : null, dcl: nav ? nav.domContentLoadedEventEnd : 0,
                 viewer: window.__pq.viewer, tasks: window.__pq.tasks };
      })()`).catch(() => null);
      if (!sample || sample.fcp === null || sample.viewer === null || sample.dcl === 0) continue;
      const lastEnd = sample.tasks.reduce((max, [start, duration]) => Math.max(max, start + duration), 0);
      if (sample.now - Math.max(lastEnd, sample.viewer) >= QUIET_MS) break;
    }
    if (!sample || sample.viewer === null) throw new Error('El visor no ha aparecido');
    const { fcp, dcl, viewer, tasks } = sample;
    const lastEnd = tasks.reduce((max, [start, duration]) => Math.max(max, start + duration), 0);
    const tbt = tasks.filter(([start]) => start >= fcp).reduce((sum, [, duration]) => sum + Math.max(0, duration - 50), 0);
    const longest = tasks.reduce((max, [, duration]) => Math.max(max, duration), 0);
    // MEDIR_DEBUG=1 enseña cada tarea larga ([inicio, duración] en ms).
    if (process.env.MEDIR_DEBUG) console.log(JSON.stringify({ fcp, dcl, viewer, tasks: tasks.map(([s, d]) => [Math.round(s), Math.round(d)]) }));
    return { fcp, dcl, viewer, tti: Math.max(fcp, dcl, lastEnd), tbt, longest };
  });
}

/** Con la pieza de ejemplo analizada: del clic en «Descargar PDF» al archivo en disco. */
async function pdfClick(scenario, intentMs = 0) {
  const downloads = mkdtempSync(join(tmpdir(), 'printquote-medir-'));
  try {
    return await withChrome(async (chrome) => {
      const { send, run } = chrome;
      const bytes = await prepare(chrome, scenario);
      await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
      await send('Page.navigate', { url: `${origin}${BASE}#ejemplo` });
      const ready = `(() => { const t = document.getElementById('out-total')?.textContent.trim();
        return !!t && t !== '—' && window.__pq.viewer !== null && !document.querySelector('.stage.is-loading'); })()`;
      const end = Date.now() + TIMEOUT_MS;
      while (!(await run(ready).catch(() => false))) {
        if (Date.now() > end) throw new Error('La pieza de ejemplo no se ha analizado');
        await sleep(250);
      }
      await sleep(QUIET_MS);
      const before = bytes();
      const start = Date.now();
      // Con intención: el puntero entra en el botón `intentMs` antes del clic (lo que tarda una persona en pulsar).
      if (intentMs > 0) {
        await run(`document.getElementById('pdf-button').dispatchEvent(new PointerEvent('pointerenter'))`);
        await sleep(intentMs);
      }
      await run(`document.getElementById('pdf-button').click()`);
      while (!readdirSync(downloads).some((name) => name.endsWith('.pdf'))) {
        if (Date.now() > start + TIMEOUT_MS) throw new Error('El PDF no se ha descargado');
        await sleep(50);
      }
      return { pdf: Date.now() - start, kb: (bytes() - before) / 1024 };
    });
  } finally {
    removeSync(downloads);
  }
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const ms = (value) => `${Math.round(value)} ms`.padStart(9);

try {
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) runs.push(await firstVisit(scenario));
    const m = (key) => median(runs.map((run) => run[key]));
    console.log(
      `${name.padEnd(10)} FCP ${ms(m('fcp'))} · DCL ${ms(m('dcl'))} · visor ${ms(m('viewer'))} · interactiva ${ms(m('tti'))}` +
        ` · TBT ${ms(m('tbt'))} · tarea más larga ${ms(m('longest'))}`,
    );
  }
  for (const intent of [0, 500]) {
    const pdfRuns = [];
    for (let i = 0; i < RUNS; i++) pdfRuns.push(await pdfClick(SCENARIOS.movil, intent));
    const label = intent ? `puntero ${intent} ms antes → archivo` : 'clic → archivo';
    console.log(`pdf (móvil) ${label} ${ms(median(pdfRuns.map((r) => r.pdf)))} · ${Math.round(median(pdfRuns.map((r) => r.kb)))} kB`);
  }
} finally {
  server.close();
  forget();
}
