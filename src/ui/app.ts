import { browserLanguages, detectLang, getLang, LANGS, onLangChange, setLang, t, type Key, type Lang } from '../i18n';
import { applyStaticTranslations } from '../i18n/dom';
import { buildQuoteDocument } from '../pdf/document';
import { formatDuration, formatEuro, formatNumber } from '../quote/format';
import { BUSINESS_LIMITS, nextQuoteNumber, normalizeBusiness, type BusinessProfile } from '../quote/business';
import { isMaterialId, MATERIALS } from '../quote/materials';
import { computeQuote, type Quote } from '../quote/model';
import { applyPrinter, CUSTOM_PRINTER, getPrinter, PRINTERS, printerNote } from '../quote/printers';
import { DEFAULT_SETTINGS, LIMITS, normalizeSettings, type QuoteSettings } from '../quote/settings';
import { parseHash, settingsToHash } from '../quote/share';
import { buildQuoteText } from '../quote/text';
import { StlAnalyzer } from '../stl/analyzer';
import { meshWarnings, type MeshWarning } from '../stl/geometry';
import { ModelParseError } from '../stl/errors';
import type { Mesh, MeshStats, Vec3 } from '../stl/types';
import type { Viewer, ViewerTheme } from '../viewer/viewer';
import { supportsWebGL } from '../viewer/webgl';
import { formatLabel } from './format-label';
import { setupDemo } from './demo';
import { NumberField } from './number-field';
import { renderPrintSheet } from './print-sheet';
import { setupHistory } from './history';
import { LogoError, prepareLogo } from './logo';
import {
  clearBusiness,
  clearSettings,
  loadBusiness,
  loadLang,
  loadSettings,
  saveBusiness,
  saveLang,
  saveSettings,
} from './storage';

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

function warningText(warning: MeshWarning, size: Vec3, bed: Vec3, largePolygons: number): string {
  switch (warning) {
    case 'open-mesh':
      return t('warn.open');
    case 'inverted':
      return t('warn.inverted');
    case 'big-polygons':
      return t('warn.bigPolygons', { count: formatNumber(largePolygons, 0) });
    case 'tiny':
      return t('warn.tiny', { size: formatNumber(Math.max(size.x, size.y, size.z), 3) });
    case 'too-big':
      return t('warn.tooBig', {
        size: `${formatNumber(size.x, 1)} × ${formatNumber(size.y, 1)} × ${formatNumber(size.z, 1)}`,
        bed: `${formatNumber(bed.x, 0)} × ${formatNumber(bed.y, 0)} × ${formatNumber(bed.z, 0)}`,
      });
  }
}

/** Quita el listener de idioma de la instancia anterior (los tests arrancan la app varias veces). */
let detachLanguage: (() => void) | null = null;
/** Ídem para el listener de `hashchange`. */
let detachHash: (() => void) | null = null;

/** Descarga un archivo generado en el navegador. */
function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
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
    try {
      return document.execCommand('copy');
    } catch {
      return false; // sin `execCommand` (o bloqueado): se avisa de que no se ha copiado
    } finally {
      area.remove();
    }
  }
}

/** Arranca la aplicación: enlaza controles, visor, arrastrar y soltar y almacenamiento. */
export function startApp(demoScale = 1): void {
  const stage = byId('viewer').parentElement as HTMLElement;
  const notice = byId('notice');
  const live = byId('live-status');
  const loading = byId('stage-loading');
  const fileInput = byId<HTMLInputElement>('file-input');
  const resetCameraButton = byId<HTMLButtonElement>('reset-camera');
  const copyButton = byId<HTMLButtonElement>('copy-button');
  const printButton = byId<HTMLButtonElement>('print-button');
  const pdfButton = byId<HTMLButtonElement>('pdf-button');
  const infillRange = byId<HTMLInputElement>('in-infill-range');
  const materialRadios = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="material"]'));
  const out = (id: string): HTMLElement => byId(`out-${id}`);
  /** Solo toca el DOM si el texto cambia: el total es una región viva y no debe repetirse. */
  const setOut = (id: string, text: string): void => {
    const node = out(id);
    if (node.textContent !== text) node.textContent = text;
  };

  let settings = loadSettings();
  let business = loadBusiness();
  let pdfBusy = false;
  let part: LoadedPart | null = null;
  /** Se aplicaron los parámetros de un enlace y aún no hay pieza: el estado vacío lo dice. */
  let sharedApplied = false;
  let quote: Quote | null = null;
  let viewer: Viewer | null = null;
  /** Se crea más abajo, cuando existen `announce`, `showNotice` y `applySettings`. */
  let history: ReturnType<typeof setupHistory> | null = null;
  /** El aviso se guarda como función para poder volver a pintarlo si cambia el idioma. */
  let noticeBuilder: (() => readonly [title: string, message: string]) | null = null;

  const analyzer = new StlAnalyzer();
  /** Cada carga recibe un número; si llega otra antes de terminar, el resultado viejo se descarta. */
  let loadTicket = 0;
  /** Archivo que se está leyendo (para volver a rotular el indicador si cambia el idioma). */
  let loadingName: string | null = null;

  // ── Visor ──
  // three.js (~500 kB) se descarga aparte, después de pintar la interfaz: el panel
  // y el presupuesto funcionan desde el primer momento aunque el visor tarde.
  const noViewer = (): void => showNotice(() => [t('viewer.none.title'), t('viewer.none.text')]);
  if (supportsWebGL()) {
    import('../viewer/viewer')
      .then(({ Viewer }) => {
        const container = byId('viewer');
        viewer = new Viewer(container, readTheme());
        // El visor admite teclado (lo gestiona OrbitControls): se hace enfocable y se explica.
        container.tabIndex = 0;
        container.setAttribute('role', 'application');
        applyViewerLabels();
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
  /** Etiquetas del visor en el idioma activo (solo si el visor ya existe: es cuando se hace enfocable). */
  function applyViewerLabels(): void {
    const container = byId('viewer');
    if (!container.hasAttribute('role')) return;
    container.setAttribute('aria-roledescription', t('viewer.roledescription'));
    container.setAttribute('aria-label', t('viewer.label'));
    // Las teclas son la descripción (no el nombre): el nombre se lee corto y la ayuda, tras él.
    container.setAttribute('aria-describedby', 'viewer-help');
  }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => viewer?.setTheme(readTheme()));

  // ── Campos ──
  const bed = (): Vec3 => ({ x: settings.bedX, y: settings.bedY, z: settings.bedZ });

  const update = (patch: Partial<QuoteSettings>): void => {
    settings = normalizeSettings({ ...settings, ...patch });
    saveSettings(settings);
    render();
  };

  type FieldKey = Exclude<keyof QuoteSettings, 'material' | 'printerId' | 'pricePerKg'>;
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

  // Perfiles de impresora: elegir uno rellena caudal, potencia y cama; editar cualquiera de
  // esos campos vuelve a «Personalizada» (lo hace `normalizeSettings` al ver que ya no coinciden).
  const printerSelect = byId<HTMLSelectElement>('in-printer');
  const printerNoteEl = byId('printer-note');
  const option = (label: string, value: string): HTMLOptionElement => {
    const node = document.createElement('option');
    node.value = value;
    node.textContent = label;
    return node;
  };
  /** (Re)crea las opciones: «Personalizada» cambia con el idioma; los nombres de modelo no. */
  const fillPrinterOptions = (): void => {
    printerSelect.replaceChildren(
      option(t('printer.custom'), CUSTOM_PRINTER),
      ...PRINTERS.map((printer) => option(printer.name, printer.id)),
    );
    printerSelect.value = settings.printerId;
  };
  fillPrinterOptions();
  /**
   * Aplica unos ajustes a todos los campos y recalcula. Por defecto los guarda como los de trabajo; los de un
   * enlace no (`persist = false`): abrir un enlace no pisa lo que la persona tenía guardado.
   */
  const applySettings = (next: QuoteSettings, persist = true): void => {
    settings = normalizeSettings(next);
    if (persist) saveSettings(settings);
    syncForm();
    render();
  };
  printerSelect.addEventListener('change', () => {
    applySettings(applyPrinter(settings, printerSelect.value));
    const printer = getPrinter(settings.printerId);
    announce(printer ? t('printer.applied', { name: printer.name }) : t('printer.custom.applied'));
  });

  const syncForm = (): void => {
    for (const [key, field] of fields) {
      field.set(key === 'price' ? settings.pricePerKg[settings.material] : settings[key]);
    }
    for (const radio of materialRadios) radio.checked = radio.value === settings.material;
    infillRange.value = String(settings.infillPercent);
    syncPrinter();
  };

  function syncPrinter(): void {
    printerSelect.value = settings.printerId;
    const printer = getPrinter(settings.printerId);
    printerNoteEl.textContent = printer ? `${t('printer.note.prefix')} ${printerNote(printer)}` : t('printer.note.custom');
  }

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
    announce(t('settings.reset.done'));
  });

  // ── Render ──
  function render(): void {
    syncPrinter();
    const b = bed();
    viewer?.setBed(b);
    byId('stage-legend').textContent = t('stage.legend', { x: formatNumber(b.x, 0), y: formatNumber(b.y, 0), z: formatNumber(b.z, 0) });
    infillRange.value = String(settings.infillPercent);
    infillRange.setAttribute('aria-valuetext', `${formatNumber(settings.infillPercent, 0)} %`);

    const hasPart = part !== null;
    stage.classList.toggle('has-part', hasPart);
    resetCameraButton.disabled = !hasPart || !viewer;
    copyButton.disabled = !hasPart;
    printButton.disabled = !hasPart;
    if (!pdfBusy) pdfButton.disabled = !hasPart;

    const warningsList = byId('warnings');
    if (!part) {
      quote = null;
      for (const id of ['volume', 'area', 'size', 'triangles', 'printed', 'weight', 'time', 'material', 'energy', 'subtotal', 'margin', 'total']) {
        setOut(id, '—');
      }
      setOut('kwh', '');
      setOut('margin-pct', '');
      setOut('summary', t(sharedApplied ? 'summary.shared' : 'summary.empty'));
      byId('file-name').textContent = t('stage.none');
      byId('file-detail').textContent = '';
      document.title = t('meta.title');
      byId('stage-dims').textContent = '';
      warningsList.replaceChildren();
      history?.sync();
      return;
    }

    const { stats } = part;
    const size = stats.bounds.size;
    quote = computeQuote(stats, settings);

    setOut('volume', formatNumber(stats.volume / 1000, 2));
    setOut('area', formatNumber(stats.surfaceArea / 100, 2));
    setOut('size', `${formatNumber(size.x, 1)} × ${formatNumber(size.y, 1)} × ${formatNumber(size.z, 1)}`);
    setOut('triangles', formatNumber(stats.triangleCount, 0));

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

    // La lista es una región viva: solo se reescribe si los avisos cambian, para que el
    // lector de pantalla no los repita cada vez que se toca un ajuste.
    const largePolygons = part.mesh.largePolygons ?? 0;
    const warningTexts = meshWarnings(stats, b, largePolygons).map((warning) => warningText(warning, size, b, largePolygons));
    const currentTexts = Array.from(warningsList.children, (li) => li.textContent ?? '');
    if (warningTexts.join('|') !== currentTexts.join('|')) {
      warningsList.replaceChildren(
        ...warningTexts.map((text) => {
          const li = document.createElement('li');
          li.textContent = text;
          return li;
        }),
      );
    }

    setOut('printed', formatNumber(quote.printedVolume / 1000, 2));
    setOut('weight', formatNumber(quote.totalWeightGrams, 1));
    setOut('weight-sub', quote.copies > 1 ? t('breakdown.weight.copies', { n: formatNumber(quote.copies, 0) }) : t('breakdown.weight.total'));
    setOut('time', formatDuration(quote.totalHours));
    setOut('material', formatNumber(quote.materialCost, 2));
    setOut('energy', formatNumber(quote.energyCost, 2));
    setOut('kwh', `${formatNumber(quote.energyKwh, 2)} kWh`);
    setOut('subtotal', formatNumber(quote.subtotal, 2));
    setOut('margin-pct', `${formatNumber(settings.marginPercent, 0)} %`);
    setOut('margin', formatNumber(quote.marginAmount, 2));
    setOut('total', formatEuro(quote.total));

    const copiesText =
      quote.copies === 1
        ? t('summary.copies.one')
        : t('summary.copies.other', { n: formatNumber(quote.copies, 0), price: formatEuro(quote.totalPerCopy) });
    out('summary').textContent = t('summary.line', {
      copies: copiesText,
      material: MATERIALS[settings.material].name,
      infill: formatNumber(settings.infillPercent, 0),
      time: formatDuration(quote.totalHours),
    });
    byId('file-name').textContent = part.fileName;
    byId('file-detail').textContent = t('file.detail', {
      format: formatLabel(part.mesh.format),
      n: formatNumber(part.mesh.triangleCount, 0),
    });
    document.title = `${part.fileName} · printquote`;
    history?.sync();
  }

  // ── Carga de archivos ──
  function showNotice(build: () => readonly [title: string, message: string]): void {
    noticeBuilder = build;
    const [title, message] = build();
    const heading = document.createElement('p');
    heading.className = 'notice-title';
    heading.textContent = title;
    const body = document.createElement('p');
    body.textContent = message;
    notice.replaceChildren(heading, body);
    notice.setAttribute('role', 'alert');
    notice.hidden = false;
    stage.classList.add('has-notice');
  }

  function hideNotice(): void {
    noticeBuilder = null;
    notice.hidden = true;
    stage.classList.remove('has-notice');
    notice.removeAttribute('role');
    notice.replaceChildren();
  }

  let announceTimer = 0;
  /** Durante la demo no se anuncia nada (carga, avisos…): solo habla ella, una vez, al terminar. */
  let silent = false;
  function announce(message: string): void {
    if (silent) return;
    live.textContent = '';
    window.clearTimeout(announceTimer);
    announceTimer = window.setTimeout(() => (live.textContent = message), 50);
  }

  /** Devuelve `true` si la pieza quedó cargada (no si falló o llegó otra petición después). */
  async function loadBuffer(fileName: string, getBuffer: () => Promise<ArrayBuffer>): Promise<boolean> {
    const ticket = ++loadTicket;
    hideNotice();
    stage.classList.add('is-loading');
    stage.setAttribute('aria-busy', 'true');
    loadingName = fileName;
    loading.textContent = t('load.reading', { name: fileName });
    loading.hidden = false;
    announce(t('load.reading.announce', { name: fileName }));
    try {
      const buffer = await getBuffer();
      // El parseo y la geometría van en un Web Worker: la interfaz sigue respondiendo.
      const { mesh, stats } = await analyzer.analyze(buffer, fileName);
      if (ticket !== loadTicket) return false; // ya se ha pedido otro archivo
      part = { fileName, mesh, stats };
      viewer?.setPart(mesh.positions);

      render();
      // El total se anuncia solo: su contenedor es una región viva.
      announce(t('load.done', { name: fileName }));
      return true;
    } catch (error) {
      if (ticket !== loadTicket) return false;
      showNotice(() => [
        t('load.failed.title', { name: fileName }),
        error instanceof ModelParseError ? t(error.code, error.params) : t('err.unexpected'),
      ]);
      return false;
    } finally {
      if (ticket === loadTicket) {
        stage.classList.remove('is-loading');
        stage.removeAttribute('aria-busy');
        loading.hidden = true;
        loadingName = null;
      }
    }
  }

  function loadFile(file: File): void {
    if (file.size > MAX_FILE_BYTES) {
      showNotice(() => [t('load.tooBig.title', { name: file.name }), t('load.tooBig.text')]);
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

  const loadSample = (): Promise<boolean> =>
    loadBuffer(SAMPLE_FILE, async () => {
      const response = await fetch(`${import.meta.env.BASE_URL}samples/${SAMPLE_FILE}`);
      if (!response.ok) throw new ModelParseError('err.sample');
      return response.arrayBuffer();
    });
  byId('sample-button').addEventListener('click', () => void loadSample());

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

  let copyLabelTimer = 0;
  copyButton.addEventListener('click', () => {
    if (!part || !quote) return;
    const text = buildQuoteText({ fileName: part.fileName, stats: part.stats, settings, quote });
    void copyText(text).then((ok) => {
      // La etiqueta se restablece desde el diccionario (no desde el texto actual): con dos clics
      // seguidos se quedaba en «Copiado».
      copyButton.textContent = t(ok ? 'copy.done' : 'copy.failed');
      announce(t(ok ? 'copy.announce.ok' : 'copy.announce.failed'));
      window.clearTimeout(copyLabelTimer);
      copyLabelTimer = window.setTimeout(() => (copyButton.textContent = t('action.copy')), 1800);
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

  // ── Datos del negocio y presupuesto en PDF ──
  const bizText = [
    ['in-biz-name', 'name'],
    ['in-biz-taxid', 'taxId'],
    ['in-biz-address', 'address'],
    ['in-biz-phone', 'phone'],
    ['in-biz-email', 'email'],
    ['in-biz-web', 'web'],
    ['in-biz-number', 'quoteNumber'],
  ] as const;
  const bizInputs = bizText.map(([id, key]) => [byId<HTMLInputElement | HTMLTextAreaElement>(id), key] as const);
  const logoInput = byId<HTMLInputElement>('in-biz-logo');
  const logoPreview = byId('logo-preview');
  const logoImg = byId<HTMLImageElement>('logo-img');
  const logoStatus = byId('logo-status');
  /** Mensaje actual bajo el logotipo (una clave, para poder traducirlo si cambia el idioma). */
  let logoStatusKey: Key = 'biz.logo.hint';
  const setLogoStatus = (key: Key): void => {
    logoStatusKey = key;
    logoStatus.textContent = t(key);
  };

  const updateBusiness = (patch: Partial<BusinessProfile>): boolean => {
    business = normalizeBusiness({ ...business, ...patch });
    return saveBusiness(business);
  };

  const syncBusiness = (): void => {
    for (const [input, key] of bizInputs) input.value = business[key];
    validityField.set(business.validityDays);
    vatField.set(business.vatPercent);
    logoPreview.hidden = business.logo === null;
    if (business.logo) logoImg.src = business.logo;
    else logoImg.removeAttribute('src');
  };

  for (const [input, key] of bizInputs) {
    input.addEventListener('input', () => updateBusiness({ [key]: input.value }));
    // Al salir del campo se muestra lo que de verdad se ha guardado (recortado, o el número por defecto si se vació).
    input.addEventListener('change', () => (input.value = business[key]));
  }

  const validityField = new NumberField({
    input: byId<HTMLInputElement>('in-biz-validity'),
    error: byId('err-validity'),
    min: BUSINESS_LIMITS.validityDays.min,
    max: BUSINESS_LIMITS.validityDays.max,
    integer: true,
    decimals: 0,
    step: 1,
    onValue: (value) => void updateBusiness({ validityDays: value }),
  });
  const vatField = new NumberField({
    input: byId<HTMLInputElement>('in-biz-vat'),
    error: byId('err-vat'),
    min: BUSINESS_LIMITS.vatPercent.min,
    max: BUSINESS_LIMITS.vatPercent.max,
    decimals: 2,
    step: 1,
    onValue: (value) => void updateBusiness({ vatPercent: value }),
  });

  logoInput.addEventListener('change', () => {
    const file = logoInput.files?.[0];
    logoInput.value = '';
    if (!file) return;
    setLogoStatus('biz.logo.processing');
    prepareLogo(file)
      .then((logo) => {
        const saved = updateBusiness({ logo });
        syncBusiness();
        setLogoStatus(saved ? 'biz.logo.saved' : 'biz.logo.notSaved');
      })
      .catch((error: unknown) => {
        setLogoStatus(error instanceof LogoError ? error.code : 'err.logo.generic');
      });
  });
  byId('logo-remove').addEventListener('click', () => {
    updateBusiness({ logo: null });
    syncBusiness();
    setLogoStatus('biz.logo.removed');
    logoInput.focus();
  });
  byId('reset-business').addEventListener('click', () => {
    clearBusiness();
    business = normalizeBusiness(undefined);
    syncBusiness();
    setLogoStatus('biz.logo.hint');
    announce(t('biz.reset.done'));
  });
  byId('settings-form').addEventListener('submit', (event) => event.preventDefault());

  const pdfFileName = (): string => `${t('pdf.title').toLowerCase()}-${business.quoteNumber.replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf`;

  pdfButton.addEventListener('click', () => {
    if (!part || !quote || pdfBusy) return;
    pdfBusy = true;
    pdfButton.disabled = true;
    pdfButton.textContent = t('pdf.generating');
    announce(t('pdf.generating.announce'));
    const current = { part, quote, settings, business };
    void (async () => {
      try {
        // pdf-lib y fontkit (~1,1 MB; ~500 kB gzip) y las fuentes solo se descargan la primera vez que se pide un PDF.
        const { renderQuotePdf } = await import('../pdf/render');
        const bytes = await renderQuotePdf(
          buildQuoteDocument({
            business: current.business,
            fileName: current.part.fileName,
            stats: current.part.stats,
            settings: current.settings,
            quote: current.quote,
            image: viewer ? viewer.snapshot() : null,
          }),
        );
        const name = pdfFileName();
        download(new Blob([bytes as BlobPart], { type: 'application/pdf' }), name);
        // El número sube solo tras descargar: el siguiente presupuesto ya sale con el nuevo.
        updateBusiness({ quoteNumber: nextQuoteNumber(current.business.quoteNumber) });
        syncBusiness();
        announce(t('pdf.done', { name, next: business.quoteNumber }));
      } catch (error) {
        console.error(error);
        // Sin conexión (o sin las fuentes) es un fallo distinto de un error al dibujar el documento.
        const fonts = error instanceof Error && error.name === 'FontLoadError';
        showNotice(() => [t('pdf.failed.title'), t(fonts ? 'pdf.failed.fonts' : 'pdf.failed.text')]);
      } finally {
        pdfBusy = false;
        pdfButton.textContent = t('action.pdf');
        pdfButton.disabled = !part;
      }
    })();
  });

  // ── Historial de presupuestos ──
  history = setupHistory({
    current: () => (part && quote ? { fileName: part.fileName, stats: part.stats, quote, settings } : null),
    applySettings,
    announce,
    showNotice: (title, message) => showNotice(() => [title, message]),
    download,
  });

  // ── Demo («Ver demo») ──
  // Va antes que el bloque de enlaces: su `hashchange` se registra primero y para la demo antes de que la aplicación aplique el enlace.
  // Nunca guarda nada: aplica los ajustes con `persist = false` y, al acabar, devuelve los de la persona
  // (y su pieza, si había una). Así una edición posterior no guarda por sorpresa los valores de la demo.
  const liveRegions = [byId('out-total').closest<HTMLElement>('[aria-live]'), byId('warnings')];
  let before: { settings: QuoteSettings; part: LoadedPart | null } | null = null;
  /** La pieza que cargó la demo: si al acabar ya es otra, la persona soltó un archivo y no se pisa con la anterior. */
  let demoPart: LoadedPart | null = null;
  /** Lo último que puso la demo: si al acabar ya es otro objeto, algo (un enlace) cambió los ajustes y no se pisan. */
  let demoSettings: QuoteSettings | null = null;
  const demoApply = (next: QuoteSettings): void => {
    applySettings(next, false);
    demoSettings = settings;
  };
  setupDemo(
    {
      async begin() {
        before = { settings, part };
        silent = true;
        for (const region of liveRegions) region?.setAttribute('aria-live', 'off');
        demoApply(DEFAULT_SETTINGS);
        const loaded = await loadSample();
        demoPart = part;
        return loaded;
      },
      apply: (patch) => demoApply(patch === 'restore' ? (before?.settings ?? settings) : { ...settings, ...patch }),
      spin: (on) => viewer?.setAutoRotate(on),
      end() {
        if (before) {
          if (settings === demoSettings) {
            settings = normalizeSettings(before.settings);
            syncForm();
          }
          // La pieza solo se devuelve si sigue siendo la de la demo: un archivo cargado a mitad manda.
          if (before.part && part === demoPart) {
            part = before.part;
            viewer?.setPart(part.mesh.positions);
          }
        }
        before = demoPart = demoSettings = null;
        render();
        viewer?.resetCamera();
        silent = false;
        for (const region of liveRegions) region?.setAttribute('aria-live', 'polite');
      },
      announce,
    },
    demoScale,
  );

  // ── Enlace con los parámetros (en el hash de la URL) ──
  const shareButton = byId<HTMLButtonElement>('share-copy');
  let shareLabelTimer = 0;
  shareButton.addEventListener('click', () => {
    // Origen y ruta de esta página + el hash con los ajustes actuales (sin pieza, sin cliente, sin negocio).
    const link = `${window.location.origin}${window.location.pathname}${settingsToHash(settings)}`;
    void copyText(link).then((ok) => {
      shareButton.textContent = t(ok ? 'share.copied' : 'share.copyFailed');
      announce(t(ok ? 'share.copied' : 'share.copyFailed'));
      window.clearTimeout(shareLabelTimer);
      shareLabelTimer = window.setTimeout(() => (shareButton.textContent = t('share.copy')), 1800);
    });
  });

  /** `#v=1&…` aplica los parámetros; `#ejemplo` (solo o con ellos) carga la pieza de ejemplo. */
  const applyHash = (): void => {
    const { settings: shared, example } = parseHash(window.location.hash, settings);
    if (shared) {
      applySettings(shared, false);
      sharedApplied = part === null;
      render();
      announce(t(part ? 'share.applied.part' : 'share.applied'));
    }
    if (example) void loadSample();
  };
  detachHash?.();
  window.addEventListener('hashchange', applyHash);
  detachHash = () => window.removeEventListener('hashchange', applyHash);

  // ── Idioma ──
  const langButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-lang]'));

  /** Vuelve a pintar todo lo que depende del idioma: HTML estático, campos, avisos y cifras. */
  function applyLanguage(): void {
    const lang = getLang();
    document.documentElement.lang = lang;
    applyStaticTranslations();
    for (const node of document.querySelectorAll<HTMLElement>('[data-density]')) {
      const id = node.dataset['density'];
      if (isMaterialId(id)) node.textContent = formatNumber(MATERIALS[id].density, 2);
    }
    for (const button of langButtons) button.setAttribute('aria-pressed', String(button.dataset['lang'] === lang));
    fillPrinterOptions();
    logoStatus.textContent = t(logoStatusKey);
    if (loadingName !== null) loading.textContent = t('load.reading', { name: loadingName });
    // El último anuncio para lectores de pantalla quedaría en el idioma anterior.
    window.clearTimeout(announceTimer);
    live.textContent = '';
    applyViewerLabels();
    syncForm();
    syncBusiness();
    history?.render();
    shareButton.textContent = t('share.copy');
    if (noticeBuilder) showNotice(noticeBuilder);
    if (!pdfBusy) pdfButton.textContent = t('action.pdf');
    render();
  }

  for (const button of langButtons) {
    button.addEventListener('click', () => {
      const lang = button.dataset['lang'];
      if (lang && (LANGS as readonly string[]).includes(lang)) {
        saveLang(lang as Lang);
        setLang(lang as Lang);
      }
    });
  }

  detachLanguage?.();
  setLang(detectLang(browserLanguages(), loadLang()));
  detachLanguage = onLangChange(applyLanguage);
  applyLanguage();

  // Enlaces: …/printquote/#ejemplo (la pieza de ejemplo) y …/printquote/#v=1&… (parámetros compartidos).
  applyHash();
}
