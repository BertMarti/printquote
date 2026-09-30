import { formatDuration, formatEuro, formatNumber } from '../quote/format';
import { buildQuoteDocument } from '../pdf/document';
import { BUSINESS_LIMITS, nextQuoteNumber, normalizeBusiness, type BusinessProfile } from '../quote/business';
import { isMaterialId, MATERIALS } from '../quote/materials';
import { computeQuote, type Quote } from '../quote/model';
import { applyPrinter, CUSTOM_PRINTER, getPrinter, PRINTERS } from '../quote/printers';
import { DEFAULT_SETTINGS, LIMITS, normalizeSettings, type QuoteSettings } from '../quote/settings';
import { buildQuoteText } from '../quote/text';
import { StlAnalyzer } from '../stl/analyzer';
import { meshWarnings, type MeshWarning } from '../stl/geometry';
import { ModelParseError } from '../stl/errors';
import type { Mesh, MeshStats, Vec3 } from '../stl/types';
import type { Viewer, ViewerTheme } from '../viewer/viewer';
import { supportsWebGL } from '../viewer/webgl';
import { formatLabel } from './format-label';
import { NumberField } from './number-field';
import { renderPrintSheet } from './print-sheet';
import { LogoError, prepareLogo } from './logo';
import { clearBusiness, clearSettings, loadBusiness, loadSettings, saveBusiness, saveSettings } from './storage';

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
    case 'tiny':
      return `La pieza mide solo ${formatNumber(Math.max(size.x, size.y, size.z), 3)} mm en su lado mayor. printquote asume que el modelo está en milímetros: si se exportó en metros o pulgadas, cambia las unidades al exportar.`;
    case 'too-big':
      return `La pieza (${formatNumber(size.x, 1)} × ${formatNumber(size.y, 1)} × ${formatNumber(size.z, 1)} mm) no cabe en la cama de ${formatNumber(bed.x, 0)} × ${formatNumber(bed.y, 0)} × ${formatNumber(bed.z, 0)} mm, ni siquiera girándola.`;
  }
}

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
  const printerNote = byId('printer-note');
  const option = (label: string, value: string): HTMLOptionElement => {
    const node = document.createElement('option');
    node.value = value;
    node.textContent = label;
    return node;
  };
  printerSelect.append(option('Personalizada', CUSTOM_PRINTER), ...PRINTERS.map((printer) => option(printer.name, printer.id)));
  printerSelect.addEventListener('change', () => {
    settings = normalizeSettings(applyPrinter(settings, printerSelect.value));
    saveSettings(settings);
    syncForm();
    render();
    const printer = getPrinter(settings.printerId);
    announce(
      printer
        ? `Perfil ${printer.name} aplicado: caudal, potencia y cama actualizados.`
        : 'Perfil personalizado: los valores no cambian.',
    );
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
    printerNote.textContent = printer
      ? `Valores de partida orientativos. ${printer.note}`
      : 'Escribe tus propios valores de caudal, potencia y cama, o elige una impresora para rellenarlos.';
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
    announce('Ajustes restablecidos a los valores por defecto.');
  });

  // ── Render ──
  function render(): void {
    syncPrinter();
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
    if (!pdfBusy) pdfButton.disabled = !hasPart;

    const warningsList = byId('warnings');
    if (!part) {
      quote = null;
      for (const id of ['volume', 'area', 'size', 'triangles', 'printed', 'weight', 'time', 'material', 'energy', 'subtotal', 'margin', 'total']) {
        setOut(id, '—');
      }
      setOut('kwh', '');
      setOut('margin-pct', '');
      setOut('summary', 'Carga una pieza para calcular el presupuesto.');
      byId('stage-dims').textContent = '';
      warningsList.replaceChildren();
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
    const warningTexts = meshWarnings(stats, b).map((warning) => warningText(warning, size, b));
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
    setOut('weight-sub', quote.copies > 1 ? `total · ${formatNumber(quote.copies, 0)} copias` : 'total');
    setOut('time', formatDuration(quote.totalHours));
    setOut('material', formatNumber(quote.materialCost, 2));
    setOut('energy', formatNumber(quote.energyCost, 2));
    setOut('kwh', `${formatNumber(quote.energyKwh, 2)} kWh`);
    setOut('subtotal', formatNumber(quote.subtotal, 2));
    setOut('margin-pct', `${formatNumber(settings.marginPercent, 0)} %`);
    setOut('margin', formatNumber(quote.marginAmount, 2));
    setOut('total', formatEuro(quote.total));

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
      const { mesh, stats } = await analyzer.analyze(buffer, fileName);
      if (ticket !== loadTicket) return; // ya se ha pedido otro archivo
      part = { fileName, mesh, stats };
      viewer?.setPart(mesh.positions);

      byId('file-name').textContent = fileName;
      byId('file-detail').textContent = `${formatLabel(mesh.format)} · ${formatNumber(mesh.triangleCount, 0)} triángulos`;
      document.title = `${fileName} · printquote`;
      render();
      // El total se anuncia solo: su contenedor es una región viva.
      announce(`Pieza cargada: ${fileName}.`);
    } catch (error) {
      if (ticket !== loadTicket) return;
      const message = error instanceof ModelParseError
        ? error.message
        : 'Ha ocurrido un error inesperado al leer el archivo. Prueba a exportarlo de nuevo como STL, OBJ o 3MF.';
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
      if (!response.ok) throw new ModelParseError('No se ha podido descargar la pieza de ejemplo.');
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

  const copyLabel = copyButton.textContent;
  let copyLabelTimer = 0;
  copyButton.addEventListener('click', () => {
    if (!part || !quote) return;
    const text = buildQuoteText({ fileName: part.fileName, stats: part.stats, settings, quote });
    void copyText(text).then((ok) => {
      // Etiqueta original guardada fuera: con dos clics seguidos se quedaba en «Copiado».
      copyButton.textContent = ok ? 'Copiado' : 'No se pudo copiar';
      announce(ok ? 'Presupuesto copiado al portapapeles.' : 'No se ha podido copiar el presupuesto.');
      window.clearTimeout(copyLabelTimer);
      copyLabelTimer = window.setTimeout(() => (copyButton.textContent = copyLabel), 1800);
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
  const logoHint = logoStatus.textContent ?? '';

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
    decimals: 1,
    step: 1,
    onValue: (value) => void updateBusiness({ vatPercent: value }),
  });

  logoInput.addEventListener('change', () => {
    const file = logoInput.files?.[0];
    logoInput.value = '';
    if (!file) return;
    logoStatus.textContent = 'Procesando la imagen…';
    prepareLogo(file)
      .then((logo) => {
        const saved = updateBusiness({ logo });
        syncBusiness();
        logoStatus.textContent = saved
          ? 'Logotipo cargado. Se queda en este navegador.'
          : 'Logotipo cargado, pero el navegador no deja guardarlo: tendrás que subirlo de nuevo la próxima vez.';
      })
      .catch((error: unknown) => {
        logoStatus.textContent = error instanceof LogoError ? error.message : 'No se ha podido cargar la imagen.';
      });
  });
  byId('logo-remove').addEventListener('click', () => {
    updateBusiness({ logo: null });
    syncBusiness();
    logoStatus.textContent = 'Logotipo quitado.';
    logoInput.focus();
  });
  byId('reset-business').addEventListener('click', () => {
    clearBusiness();
    business = normalizeBusiness(undefined);
    syncBusiness();
    logoStatus.textContent = logoHint;
    announce('Datos del negocio borrados.');
  });
  byId('settings-form').addEventListener('submit', (event) => event.preventDefault());

  const pdfFileName = (): string => `presupuesto-${business.quoteNumber.replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf`;

  pdfButton.addEventListener('click', () => {
    if (!part || !quote || pdfBusy) return;
    const label = pdfButton.textContent;
    pdfBusy = true;
    pdfButton.disabled = true;
    pdfButton.textContent = 'Generando PDF…';
    announce('Generando el PDF…');
    const current = { part, quote, settings, business };
    void (async () => {
      try {
        // pdf-lib (~500 kB) solo se descarga la primera vez que se pide un PDF.
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
        announce(`PDF descargado: ${name}. El próximo número de presupuesto es ${business.quoteNumber}.`);
      } catch {
        showNotice('No se ha podido crear el PDF', 'Ha ocurrido un error al generar el documento. Vuelve a intentarlo; si sigue fallando, usa «Imprimir» y guarda como PDF.');
      } finally {
        pdfBusy = false;
        pdfButton.textContent = label;
        pdfButton.disabled = !part;
      }
    })();
  });

  syncForm();
  syncBusiness();
  render();

  // Enlace directo a la demo con la pieza cargada: …/printquote/#ejemplo
  if (window.location.hash === '#ejemplo') loadSample();
}
