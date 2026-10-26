// Prueba de integración del build en Chrome/Chromium sin cabeza (la misma web que se publica en Pages).
//
// Uso: npm run build && npm run test:integracion [carpeta]   (por defecto dist/)
//      CHROME=/ruta/a/chromium npm run test:integracion
//
// Sirve `dist/` bajo /printquote/ (como GitHub Pages), abre `#ejemplo` y falla si:
// - la CSP o Trusted Types registran alguna violación en la página (evento `securitypolicyviolation`, antes y
//   después de recargar, y los avisos «security» de la consola);
// - hay errores en la consola o excepciones sin capturar en la página o en el worker, o recursos que fallan.
//   Ojo: el worker tiene URL propia y no hereda la CSP del <meta> de la página; lo que se comprueba de él es
//   que se crea con la política de Trusted Types y que no registra errores (`Log.entryAdded`/consola);
// - la pieza de ejemplo no se analiza en el Web Worker (sin caer al hilo principal), el visor 3D no aparece,
//   el PDF no se genera o el service worker no queda activo y controlando la página tras recargar.
// Sin dependencias: usa el protocolo DevTools de `chrome.mjs`.

import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Node 20 trae WebSocket detrás de una opción: el script se vuelve a lanzar con ella.
// Las señales se reenvían al hijo para que cierre Chrome y borre sus carpetas antes de salir.
if (typeof WebSocket === 'undefined') {
  const child = spawn(process.execPath, ['--experimental-websocket', ...process.argv.slice(1)], { stdio: 'inherit' });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  const code = await new Promise((done) => child.on('exit', (status, signal) => done(status ?? (signal === 'SIGINT' ? 130 : 143))));
  process.exit(code);
}

const { cleanupOnSignal, removeSync, sleep, withChrome } = await import('./chrome.mjs');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(process.argv[2] ?? join(root, 'dist'));
const BASE = '/printquote/';
/** La Raspberry Pi pinta WebGL por software: hay que darle margen. */
const TIMEOUT_MS = Number(process.env.INTEGRACION_TIMEOUT_MS ?? 90_000);

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
  '.woff2': 'font/woff2',
  '.stl': 'model/stl',
};

// Servidor estático mínimo: solo GET dentro de dist/, como Pages (sin cabeceras CSP propias: la CSP va en el <meta>).
const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (!url.pathname.startsWith(BASE)) {
    response.writeHead(url.pathname === '/' ? 302 : 404, url.pathname === '/' ? { Location: BASE } : {});
    response.end();
    return;
  }
  let path;
  try {
    path = decodeURIComponent(url.pathname.slice(BASE.length - 1));
  } catch {
    response.writeHead(400).end(); // %-secuencia mal formada
    return;
  }
  let file = resolve(dist, `.${path}`);
  if (file !== dist && !file.startsWith(dist + sep)) {
    response.writeHead(403).end();
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
  createReadStream(file).pipe(response);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const appUrl = `${origin}${BASE}#ejemplo`;

const downloads = mkdtempSync(join(tmpdir(), 'printquote-pdf-'));
// Con Ctrl+C también se cierra el servidor y se borra la carpeta de descargas (Chrome lo cierra `chrome.mjs`).
const forgetCleanup = cleanupOnSignal(() => {
  server.close();
  removeSync(downloads);
});
const problems = [];
const checks = [];
const ok = (text) => checks.push(text);

// Se escucha `securitypolicyviolation` antes de que cargue nada: cubre la CSP y Trusted Types en la página.
const VIOLATIONS = `
  window.__pqViolations = [];
  document.addEventListener('securitypolicyviolation', (event) => {
    window.__pqViolations.push(event.violatedDirective + ' → ' + (event.blockedURI || event.sample || '(en línea)'));
  });
`;

try {
  await withChrome(async ({ send, run, on }) => {
    const describe = (args) => args.map((a) => a.value ?? a.description ?? a.type).join(' ');
    const watchConsole = (where) => (params, sessionId) => {
      if (where === 'worker' && !sessionId) return;
      if (where === 'página' && sessionId) return;
      if (params.type === 'error' || params.type === 'assert') problems.push(`Consola (${where}): ${describe(params.args)}`);
    };
    on('Runtime.consoleAPICalled', watchConsole('página'));
    on('Runtime.consoleAPICalled', watchConsole('worker'));
    on('Runtime.exceptionThrown', ({ exceptionDetails: e }, sessionId) =>
      problems.push(`Excepción (${sessionId ? 'worker' : 'página'}): ${e.exception?.description ?? e.text}`),
    );
    // Aquí llegan los «Refused to …» de la CSP, los fallos de red (404) y los avisos de Trusted Types.
    on('Log.entryAdded', ({ entry }) => {
      if (entry.level === 'error') problems.push(`Registro (${entry.source}): ${entry.text}${entry.url ? ` [${entry.url}]` : ''}`);
    });
    const workers = [];
    // Cada worker (y el service worker, si Chrome lo adjunta) espera a que se le escuche antes de arrancar.
    on('Target.attachedToTarget', ({ sessionId, targetInfo }) => {
      if (targetInfo.type === 'worker') workers.push(targetInfo.url);
      // Sin esperar las respuestas: un service worker en pausa no contesta a Runtime.enable hasta que se reanuda.
      // Las órdenes se atienden en orden, así que las tres llegan antes de que arranque su código.
      for (const method of ['Runtime.enable', 'Log.enable', 'Runtime.runIfWaitingForDebugger']) {
        send(method, {}, sessionId).catch(() => undefined);
      }
    });

    await send('Runtime.enable');
    await send('Log.enable');
    await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: VIOLATIONS });
    await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
    await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });

    const waitFor = async (what, expression) => {
      const end = Date.now() + TIMEOUT_MS;
      while (Date.now() < end) {
        if (await run(expression)) return true;
        await sleep(250);
      }
      problems.push(`Tiempo agotado esperando: ${what}`);
      return false;
    };
    const loaded = `(() => {
      const total = document.getElementById('out-total')?.textContent.trim();
      return !!total && total !== '—' && document.getElementById('notice').hidden && !document.querySelector('.stage.is-loading');
    })()`;

    // 1. Primera visita: pieza de ejemplo por el worker, visor 3D y CSP sin violaciones.
    await send('Page.navigate', { url: appUrl });
    if (await waitFor('la pieza de ejemplo analizada', loaded)) {
      const triangles = await run(`document.getElementById('out-triangles').textContent.trim()`);
      ok(`Pieza de ejemplo analizada (${triangles} triángulos, total ${await run(`document.getElementById('out-total').textContent.trim()`)})`);
    }
    // Un `display` de la hoja de estilos puede tapar el atributo hidden (pasó con el cajetín de carga).
    const visibleHidden = await run(`[...document.querySelectorAll('[hidden]')]
      .filter((el) => getComputedStyle(el).display !== 'none')
      .map((el) => el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + el.className)`);
    if (visibleHidden.length === 0) ok('Ningún elemento con hidden se ve (tampoco el cajetín de carga)');
    else problems.push(`Elementos con hidden que se ven: ${visibleHidden.join(', ')}`);
    if (workers.some((url) => url.includes(`${BASE}assets/stl.worker`))) ok('Análisis en el Web Worker (creado con la política de Trusted Types)');
    else problems.push(`El análisis no ha pasado por el Web Worker (workers vistos: ${workers.join(', ') || 'ninguno'})`);
    if (await waitFor('el visor 3D (three.js)', `!!document.querySelector('#viewer canvas')`)) ok('Visor 3D (three.js) dibujado');

    // 2. PDF (pdf-lib y las fuentes): se descarga de verdad y empieza por %PDF.
    await run(`document.getElementById('pdf-button').click()`);
    const pdfEnd = Date.now() + TIMEOUT_MS;
    let pdf = null;
    while (!pdf && Date.now() < pdfEnd) {
      pdf = readdirSync(downloads).find((name) => name.endsWith('.pdf')) ?? null;
      if (!pdf) await sleep(250);
    }
    if (!pdf) problems.push('El PDF no se ha descargado');
    else {
      await sleep(500); // que termine de escribirse
      const bytes = readFileSync(join(downloads, pdf));
      if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') ok(`PDF generado con pdf-lib (${pdf}, ${Math.round(bytes.length / 1024)} KB)`);
      else problems.push(`El archivo descargado no es un PDF (${pdf})`);
    }

    // 3. Service worker registrado (también pasa por Trusted Types) y, tras recargar, sirviendo la página.
    const sw = await run(`Promise.race([
      navigator.serviceWorker.ready.then((r) => r.active ? r.scope : null),
      new Promise((done) => setTimeout(() => done(null), ${TIMEOUT_MS})),
    ])`);
    if (sw === `${origin}${BASE}`) ok(`Service worker activo con alcance ${BASE}`);
    else problems.push(`El service worker no está activo en ${BASE} (alcance: ${sw})`);
    // La lista de la página se pierde al recargar: lo que haya hasta aquí se apunta ya.
    let pageViolations = 0;
    for (const v of await run(`window.__pqViolations.splice(0)`)) {
      problems.push(`Violación de la CSP: ${v}`);
      pageViolations++;
    }
    await send('Page.reload', { ignoreCache: false });
    if (await waitFor('la pieza de ejemplo tras recargar', loaded)) {
      if (await run(`!!navigator.serviceWorker.controller`)) ok('Tras recargar, la página la sirve el service worker y la pieza se vuelve a analizar');
      else problems.push('Tras recargar, el service worker no controla la página');
    }

    // 4. Trusted Types de verdad: una cadena en innerHTML debe rechazarse (y se cuenta aparte, no como fallo).
    const blocked = await run(`(() => { try { document.createElement('div').innerHTML = '<b>x</b>'; return false; } catch (e) { return e instanceof TypeError; } })()`);
    await sleep(500); // el aviso de la consola puede llegar un poco después
    const violations = await run(`window.__pqViolations.splice(0)`);
    if (blocked) {
      ok('Trusted Types activo: innerHTML con una cadena se rechaza');
      // Esa prueba provoca justo una violación de require-trusted-types-for, y su línea de registro: se quitan.
      const expected = violations.findIndex((v) => v.startsWith('require-trusted-types-for'));
      if (expected >= 0) violations.splice(expected, 1);
      const logged = problems.findIndex((p) => p.startsWith('Registro') && /TrustedHTML/.test(p));
      if (logged >= 0) problems.splice(logged, 1);
    } else problems.push('Trusted Types no está activo: innerHTML acepta cadenas');
    for (const v of violations) problems.push(`Violación de la CSP: ${v}`);
    if (violations.length + pageViolations === 0) ok('0 violaciones de la CSP (antes y después de recargar)');
  });
} finally {
  server.close();
  removeSync(downloads);
  forgetCleanup();
}

for (const line of checks) console.log(`✓ ${line}`);
for (const line of problems) console.error(`✗ ${line}`);
if (problems.length > 0) {
  console.error(`\nPrueba de integración: ${problems.length} problema(s).`);
  process.exit(1);
}
console.log('\nPrueba de integración superada.');
