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

import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sleep, withChrome } from './chrome.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] ?? 'http://localhost:5173/printquote/';

// Se simula lo que haría una persona: escribir en el campo y avisar a la página.
const setValue = (inputId, value) =>
  `(() => { const e = document.getElementById('${inputId}'); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); })();`;

await withChrome(async ({ send, run }) => {
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

  await shoot('public/og.png', 1440, 900, `document.querySelector('button[data-lang="es"]').click();`);
  await shoot(
    'docs/captura.png',
    1440,
    1200,
    [`document.querySelector('button[data-lang="es"]').click();`, setValue('in-printer', 'bambu-a1')].join('\n'),
  );
});
