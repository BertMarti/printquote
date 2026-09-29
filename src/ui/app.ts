import { formatDuration, formatEuro, formatNumber } from '../quote/format';
import { isMaterialId, MATERIALS } from '../quote/materials';
import { computeQuote, type Quote } from '../quote/model';
import { DEFAULT_SETTINGS, LIMITS, normalizeSettings, type QuoteSettings } from '../quote/settings';
import { buildQuoteText } from '../quote/text';
import { StlAnalyzer } from '../stl/analyzer';
import { meshWarnings, type MeshWarning } from '../stl/geometry';
import { StlParseError } from '../stl/parse';
import type { Mesh, MeshStats, Vec3 } from '../stl/types';
import type { Viewer, ViewerTheme } from '../viewer/viewer';
import { supportsWebGL } from '../viewer/webgl';
import { NumberField } from './number-field';
import { renderPrintSheet } from './print-sheet';
import { clearSettings, loadSettings, saveSettings } from './storage';

const SAMPLE_FILE = 'soporte-movil.stl';
const MAX_FILE_BYTES = 300 * 1024 * 1024;

interface LoadedPart {
  readonly fileName: string;
  readonly mesh: Mesh;
  readonly stats: MeshStats;
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Falta el elemento #${id} en index.html`);
  return node as T;
}

function readTheme(): ViewerTheme {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback;
  return {
    background: token('--stage', '#eeece7'),
    ink: token('--ink', '#111111'),
    line: token('--line', '#d9d6cf'),
    accent: token('--accent', '#ff5a1f'),
  };
}

function warningText(warning: MeshWarning, size: Vec3, bed: Vec3): string {
  switch (warning) {
    case 'open-mesh':
      return 'La malla parece abierta o con huecos: el volumen, el peso y el precio pueden no ser fiables. Repárala en tu laminador o editor 3D.';
    case 'inverted':
      return 'Las normales parecen invertidas (volumen negativo). Se usa el valor absoluto, pero conviene revisar la malla.';
    case 'too-big':
      return `La pieza (${formatNumber(size.x, 1)} × ${formatNumber(size.y, 1)} × ${formatNumber(size.z, 1)} mm) no cabe en la cama de ${formatNumber(bed.x, 0)} × ${formatNumber(bed.y, 0)} × ${formatNumber(bed.z, 0)} mm, ni siquiera girándola.`;
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Respaldo para contextos sin la API del portapapeles.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

/** Arranca la aplicación: enlaza controles, visor, arrastrar y soltar y almacenamiento. */
export function startApp(): void {
  const stage = byId('viewer').parentElement as HTMLElement;
  const notice = byId('notice');
  const live = byId('live-status');
  const loading = byId('stage-loading');
  const fileInput = byId<HTMLInputElement>('file-input');
  const resetCameraButton = byId<HTMLButtonElement>('reset-camera');
  const copyButton = byId<HTMLButtonElement>('copy-button');
  const printButton = byId<HTMLButtonElement>('print-button');
  const infillRange = byId<HTMLInputElement>('in-infill-range');
  const materialRadios = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="material"]'));
  const out = (id: string): HTMLElement => byId(`out-${id}`);

  let settings = loadSettings();
  let part: LoadedPart | null = null;
  let quote: Quote | null = null;
  let viewer: Viewer | null = null;

  const analyzer = new StlAnalyzer();
  /** Cada carga recibe un número; si llega otra antes de terminar, el resultado viejo se descarta. */
  let loadTicket = 0;

  // ── Visor ──
  // three.js (~500 kB) se descarga aparte, después de pintar la interfaz: el panel
  // y el presupuesto funcionan desde el primer momento aunque el visor tarde.
  const noViewer = (): void =>
    showNotice('Sin vista 3D', 'Tu navegador no ha podido iniciar WebGL. El presupuesto funciona igualmente.');
  if (supportsWebGL()) {
    import('../viewer/viewer')
      .then(({ Viewer }) => {
        const container = byId('viewer');
        viewer = new Viewer(container, readTheme());
        // El visor admite teclado (lo gestiona OrbitControls): se hace enfocable y se explica.
        container.tabIndex = 0;
        container.setAttribute('role', 'application');
        container.setAttribute('aria-roledescription', 'visor 3D');
        container.setAttribute(
          'aria-label',
          'Vista 3D de la pieza. Flechas: desplazar. Mayúsculas más flechas: girar. «Restablecer vista» la vuelve a encuadrar.',
        );
        if (part) viewer.setPart(part.mesh.positions);
        render();
      })
      .catch(() => {
        viewer = null;
        noViewer();
      });
  } else {
    noViewer();
  }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => viewer?.setTheme(readTheme()));

  // ── Campos ──
  const bed = (): Vec3 => ({ x: settings.bedX, y: settings.bedY, z: settings.bedZ });

  const update = (patch: Partial<QuoteSettings>): void => {
    settings = normalizeSettings({ ...settings, ...patch });
    saveSettings(settings);
    render();
  };

  type FieldKey = Exclude<keyof QuoteSettings, 'material' | 'pricePerKg'>;
  const fieldSpec: ReadonlyArray<readonly [inputId: string, errorId: string, key: FieldKey | 'price', decimals: number, step: number]> = [
    ['in-price', 'err-price', 'price', 2, 1],
    ['in-infill', 'err-infill', 'infillPercent', 1, 5],
    ['in-perimeters', 'err-perimeters', 'perimeters', 0, 1],
    ['in-linewidth', 'err-linewidth', 'lineWidth', 2, 0.05],
    ['in-flow', 'err-flow', 'flowRate', 1, 1],
    ['in-bedx', 'err-bed', 'bedX', 0, 10],
    ['in-bedy', 'err-bed', 'bedY', 0, 10],
    ['in-bedz', 'err-bed', 'bedZ', 0, 10],
    ['in-power', 'err-power', 'powerWatts', 0, 10],
    ['in-energy', 'err-energy', 'energyPrice', 3, 0.01],
    ['in-margin', 'err-margin', 'marginPercent', 1, 5],
    ['in-copies', 'err-copies', 'copies', 0, 1],
  ];

  const fields = new Map<FieldKey | 'price', NumberField>();
  for (const [inputId, errorId, key, decimals, step] of fieldSpec) {
    const limit = key === 'price' ? LIMITS.pricePerKg : LIMITS[key];
    const field = new NumberField({
      input: byId<HTMLInputElement>(inputId),
      error: byId(errorId),
      min: limit.min,
      max: limit.max,
      integer: limit.integer ?? false,
      decimals,
      step,
      onValue: (value) => {
        if (key === 'price') {
          update({ pricePerKg: { ...settings.pricePerKg, [settings.material]: value } });
        } else {
          update({ [key]: value });
        }
      },
    });
    fields.set(key, field);
  }

  const syncForm = (): void => {
    for (const [key, field] of fields) {
      field.set(key === 'price' ? settings.pricePerKg[settings.material] : settings[key]);
    }
    for (const radio of materialRadios) radio.checked = radio.value === settings.material;
    infillRange.value = String(settings.infillPercent);
  };

  for (const radio of materialRadios) {
    radio.addEventListener('change', () => {
      if (radio.checked && isMaterialId(radio.value)) {
        update({ material: radio.value });
        fields.get('price')?.set(settings.pricePerKg[settings.material]);
      }
    });
  }

  infillRange.addEventListener('input', () => {
    const value = Number(infillRange.value);
    fields.get('infillPercent')?.set(value);
    update({ infillPercent: value });
  });

  byId('reset-settings').addEventListener('click', () => {
    clearSettings();
    settings = DEFAULT_SETTINGS;
    syncForm();
    render();
    announce('Ajustes restablecidos a los valores por defecto.');
  });

  // ── Render ──
  function render(): void {
    const b = bed();
    viewer?.setBed(b);
    byId('stage-legend').textContent = `Rejilla 10 mm · Cama ${formatNumber(b.x, 0)} × ${formatNumber(b.y, 0)} × ${formatNumber(b.z, 0)} mm`;
    infillRange.value = String(settings.infillPercent);
    infillRange.setAttribute('aria-valuetext', `${formatNumber(settings.infillPercent, 0)} %`);

    const hasPart = part !== null;
    stage.classList.toggle('has-part', hasPart);
    resetCameraButton.disabled = !hasPart || !viewer;
    copyButton.disabled = !hasPart;
    printButton.disabled = !hasPart;

    const warningsList = byId('warnings');
    if (!part) {
      quote = null;
      for (const id of ['volume', 'area', 'size', 'triangles', 'printed', 'weight', 'time', 'material', 'energy', 'subtotal', 'margin', 'total']) {
        out(id).textContent = '—';
      }
      out('kwh').textContent = '';
      out('margin-pct').textContent = '';
      out('summary').textContent = 'Carga una pieza para calcular el presupuesto.';
      byId('stage-dims').textContent = '';
      warningsList.replaceChildren();
      return;
    }

    const { stats } = part;
    const size = stats.bounds.size;
    quote = computeQuote(stats, settings);

    out('volume').textContent = formatNumber(stats.volume / 1000, 2);
    out('area').textContent = formatNumber(stats.surfaceArea / 100, 2);
    out('size').textContent = `${formatNumber(size.x, 1)} × ${formatNumber(size.y, 1)} × ${formatNumber(size.z, 1)}`;
    out('triangles').textContent = formatNumber(stats.triangleCount, 0);

    const dims = byId('stage-dims');
    dims.replaceChildren(
      ...(['x', 'y', 'z'] as const).map((axis) => {
        const span = document.createElement('span');
        const label = document.createElement('b');
        label.textContent = axis.toUpperCase();
        span.append(label, `${formatNumber(size[axis], 1)}`);
        return span;
      }),
      'mm',
    );

    warningsList.replaceChildren(
      ...meshWarnings(stats, b).map((warning) => {
        const li = document.createElement('li');
        li.textContent = warningText(warning, size, b);
        return li;
      }),
    );

    out('printed').textContent = formatNumber(quote.printedVolume / 1000, 2);
    out('weight').textContent = formatNumber(quote.totalWeightGrams, 1);
    out('weight-sub').textContent = quote.copies > 1 ? `total · ${quote.copies} copias` : 'total';
    out('time').textContent = formatDuration(quote.totalHours);
    out('material').textContent = formatNumber(quote.materialCost, 2);
    out('energy').textContent = formatNumber(quote.energyCost, 2);
    out('kwh').textContent = `${formatNumber(quote.energyKwh, 2)} kWh`;
    out('subtotal').textContent = formatNumber(quote.subtotal, 2);
    out('margin-pct').textContent = `${formatNumber(settings.marginPercent, 0)} %`;
    out('margin').textContent = formatNumber(quote.marginAmount, 2);
    out('total').textContent = formatEuro(quote.total);

    const copiesText = quote.copies === 1 ? '1 copia' : `${formatNumber(quote.copies, 0)} copias · ${formatEuro(quote.totalPerCopy)}/copia`;
    out('summary').textContent =
      `${copiesText} · ${MATERIALS[settings.material].name} ${formatNumber(settings.infillPercent, 0)} % · ` +
      `${formatDuration(quote.totalHours)} (estimación)`;
  }

  // ── Carga de archivos ──
  function showNotice(title: string, message: string): void {
    const heading = document.createElement('p');
    heading.className = 'notice-title';
    heading.textContent = title;
    const body = document.createElement('p');
    body.textContent = message;
    notice.replaceChildren(heading, body);
    notice.setAttribute('role', 'alert');
    notice.hidden = false;
  }

  function hideNotice(): void {
    notice.hidden = true;
    notice.removeAttribute('role');
    notice.replaceChildren();
  }

  function announce(message: string): void {
    live.textContent = '';
    window.setTimeout(() => (live.textContent = message), 50);
  }

  async function loadBuffer(fileName: string, getBuffer: () => Promise<ArrayBuffer>): Promise<void> {
    const ticket = ++loadTicket;
    hideNotice();
    stage.classList.add('is-loading');
    stage.setAttribute('aria-busy', 'true');
    loading.textContent = `Leyendo «${fileName}»…`;
    loading.hidden = false;
    announce(`Leyendo ${fileName}…`);
    try {
      const buffer = await getBuffer();
      // El parseo y la geometría van en un Web Worker: la interfaz sigue respondiendo.
      const { mesh, stats } = await analyzer.analyze(buffer);
      if (ticket !== loadTicket) return; // ya se ha pedido otro archivo
      part = { fileName, mesh, stats };
      viewer?.setPart(mesh.positions);

      byId('file-name').textContent = fileName;
      byId('file-detail').textContent =
        `STL ${mesh.format === 'binary' ? 'binario' : 'ASCII'} · ${formatNumber(mesh.triangleCount, 0)} triángulos`;
      document.title = `${fileName} · printquote`;
      render();
      announce(`Pieza cargada: ${fileName}. Total ${quote ? formatEuro(quote.total) : ''}.`);
    } catch (error) {
      if (ticket !== loadTicket) return;
      const message = error instanceof StlParseError
        ? error.message
        : 'Ha ocurrido un error inesperado al leer el archivo. Prueba a exportarlo de nuevo como STL.';
      showNotice(`No se ha podido leer «${fileName}»`, message);
    } finally {
      if (ticket === loadTicket) {
        stage.classList.remove('is-loading');
        stage.removeAttribute('aria-busy');
        loading.hidden = true;
      }
    }
  }

  function loadFile(file: File): void {
    if (file.size > MAX_FILE_BYTES) {
      showNotice(`«${file.name}» es demasiado grande`, 'El límite es de 300 MB para no bloquear el navegador.');
      return;
    }
    void loadBuffer(file.name, () => file.arrayBuffer());
  }

  byId('open-button').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) loadFile(file);
    fileInput.value = '';
  });

  const loadSample = (): void => {
    void loadBuffer(SAMPLE_FILE, async () => {
      const response = await fetch(`${import.meta.env.BASE_URL}samples/${SAMPLE_FILE}`);
      if (!response.ok) throw new StlParseError('No se ha podido descargar la pieza de ejemplo.');
      return response.arrayBuffer();
    });
  };
  byId('sample-button').addEventListener('click', loadSample);

  // ── Arrastrar y soltar en toda la ventana ──
  const overlay = byId('drop-overlay');
  let dragDepth = 0;
  const hasFiles = (event: DragEvent): boolean => Array.from(event.dataTransfer?.types ?? []).includes('Files');

  window.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth++;
    overlay.hidden = false;
  });
  window.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (event) => {
    if (!hasFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) overlay.hidden = true;
  });
  window.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    overlay.hidden = true;
    const file = event.dataTransfer?.files[0];
    if (file) loadFile(file);
  });

  // ── Acciones ──
  resetCameraButton.addEventListener('click', () => viewer?.resetCamera());

  copyButton.addEventListener('click', () => {
    if (!part || !quote) return;
    const text = buildQuoteText({ fileName: part.fileName, stats: part.stats, settings, quote });
    void copyText(text).then((ok) => {
      const label = copyButton.textContent;
      copyButton.textContent = ok ? 'Copiado' : 'No se pudo copiar';
      announce(ok ? 'Presupuesto copiado al portapapeles.' : 'No se ha podido copiar el presupuesto.');
      window.setTimeout(() => (copyButton.textContent = label), 1800);
    });
  });

  const fillPrintSheet = (): void => {
    if (!part || !quote) return;
    renderPrintSheet(byId('print-sheet'), {
      fileName: part.fileName,
      format: part.mesh.format,
      stats: part.stats,
      settings,
      quote,
      image: viewer ? viewer.snapshot() : null,
    });
  };
  window.addEventListener('beforeprint', fillPrintSheet);
  printButton.addEventListener('click', () => {
    fillPrintSheet();
    window.print();
  });

  syncForm();
  render();

  // Enlace directo a la demo con la pieza cargada: …/printquote/#ejemplo
  if (window.location.hash === '#ejemplo') loadSample();
}
