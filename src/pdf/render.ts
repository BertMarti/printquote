// Este módulo importa pdf-lib (~500 kB): la interfaz lo carga con import() solo cuando se pide un PDF.
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import type { PdfRow, QuoteDocument } from './document';

/** A4 en puntos. */
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 42;
const CONTENT_W = PAGE_W - 2 * MARGIN;
const COLUMN_W = 240;
const RIGHT_W = 232;
const COLUMN_GAP = CONTENT_W - COLUMN_W - RIGHT_W;

// «Hoja técnica suiza» sobre papel blanco: tinta, gris, línea fina y un único acento naranja.
const INK = rgb(0.067, 0.067, 0.067);
const MUTED = rgb(0.361, 0.349, 0.322);
const LINE = rgb(0.851, 0.839, 0.812);
const ACCENT = rgb(1, 0.353, 0.122);

interface Fonts {
  readonly sans: PDFFont;
  readonly bold: PDFFont;
  readonly mono: PDFFont;
  readonly monoBold: PDFFont;
}

/** Las fuentes estándar solo llevan WinAnsi (español, francés, alemán…); lo demás se sustituye por «?». */
class Sanitizer {
  private readonly sets = new Map<PDFFont, Set<number>>();

  clean(text: string, font: PDFFont): string {
    let set = this.sets.get(font);
    if (!set) {
      set = new Set(font.getCharacterSet());
      this.sets.set(font, set);
    }
    let out = '';
    for (const char of text.normalize('NFC').replace(/\s+/g, ' ')) {
      const code = char.codePointAt(0) ?? 0x3f;
      out += set.has(code) ? char : '?';
    }
    return out;
  }
}

/** Bytes de un PDF de presupuesto de una página. */
export async function renderQuotePdf(doc: QuoteDocument): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(doc.metadata.title);
  pdf.setAuthor(doc.metadata.author);
  pdf.setCreator('printquote');
  pdf.setProducer('printquote');
  pdf.setCreationDate(doc.date);
  pdf.setModificationDate(doc.date);
  pdf.setLanguage(doc.metadata.language);

  const fonts: Fonts = {
    sans: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    mono: await pdf.embedFont(StandardFonts.Courier),
    monoBold: await pdf.embedFont(StandardFonts.CourierBold),
  };
  const sanitizer = new Sanitizer();
  const page = pdf.addPage([PAGE_W, PAGE_H]);

  // Imágenes: si una no se puede leer, el PDF sale igualmente sin ella.
  const embed = async (dataUrl: string | null): Promise<PDFImage | null> => {
    if (!dataUrl) return null;
    try {
      return dataUrl.startsWith('data:image/jpeg') ? await pdf.embedJpg(dataUrl) : await pdf.embedPng(dataUrl);
    } catch {
      return null;
    }
  };
  const logo = await embed(doc.logo);
  const snapshot = await embed(doc.image);

  const draw = new Drawer(page, fonts, sanitizer);

  // ── Cabecera: logotipo o marca + nombre, y a la derecha el número ──
  let top = MARGIN;
  const numberText = doc.meta[0]?.[1] ?? '';
  const numberSize = Math.min(16, Math.max(9, 190 / (Math.max(numberText.length, 1) * 0.6)));
  const rightBlockW = 200;

  let nameX = MARGIN;
  let headerH = 30;
  if (logo) {
    const scaled = fit(logo.width, logo.height, 150, 52);
    page.drawImage(logo, { x: MARGIN, y: PAGE_H - top - scaled.height, width: scaled.width, height: scaled.height });
    nameX = MARGIN + scaled.width + 14;
    headerH = Math.max(headerH, scaled.height);
  } else {
    page.drawRectangle({ x: MARGIN, y: PAGE_H - top - 15, width: 12, height: 12, color: ACCENT });
    nameX = MARGIN + 22;
  }
  const nameLines = draw.wrap(doc.businessName, fonts.bold, 16, CONTENT_W - rightBlockW - (nameX - MARGIN) - 12).slice(0, 3);
  nameLines.forEach((line, i) => draw.text(line, nameX, top + 13 + i * 19, { font: fonts.bold, size: 16 }));
  headerH = Math.max(headerH, nameLines.length * 19 + 4);

  draw.text(doc.title.toLocaleUpperCase(doc.metadata.language), MARGIN + CONTENT_W, top + 8, {
    font: fonts.bold,
    size: 8,
    color: MUTED,
    align: 'right',
  });
  draw.text(numberText, MARGIN + CONTENT_W, top + 8 + numberSize + 4, {
    font: fonts.monoBold,
    size: numberSize,
    align: 'right',
    maxWidth: rightBlockW,
  });

  top += headerH + 14;
  draw.rule(top, MARGIN, MARGIN + CONTENT_W, 1, INK);

  // ── Fecha, validez ──
  top += 16;
  const metaRows = doc.meta.slice(1);
  const metaColW = CONTENT_W / Math.max(metaRows.length, 1);
  metaRows.forEach(([label, value], i) => {
    const x = MARGIN + i * metaColW;
    draw.text(label.toLocaleUpperCase(doc.metadata.language), x, top, { font: fonts.sans, size: 7.5, color: MUTED });
    draw.text(value, x, top + 15, { font: fonts.mono, size: 10.5, maxWidth: metaColW - 10 });
  });
  top += 34;
  draw.rule(top, MARGIN, MARGIN + CONTENT_W, 0.5, LINE);
  top += 22;

  // ── Columna izquierda: emisor y vista 3D ──
  const leftX = MARGIN;
  const rightX = MARGIN + COLUMN_W + COLUMN_GAP;
  const rightW = MARGIN + CONTENT_W - rightX;
  let left = top;
  const issuer = doc.issuerLines.flatMap((line) => draw.wrap(line, fonts.sans, 9.5, COLUMN_W));
  if (issuer.length > 0) {
    left = draw.title(doc.issuerTitle, leftX, left, COLUMN_W);
    for (const line of issuer) {
      draw.text(line, leftX, left + 9, { font: fonts.sans, size: 9.5 });
      left += 13.5;
    }
  }
  if (snapshot) {
    if (issuer.length > 0) left += 14;
    const scaled = fit(snapshot.width, snapshot.height, COLUMN_W, 170);
    page.drawImage(snapshot, { x: leftX, y: PAGE_H - left - scaled.height, width: scaled.width, height: scaled.height });
    page.drawRectangle({
      x: leftX,
      y: PAGE_H - left - scaled.height,
      width: scaled.width,
      height: scaled.height,
      borderColor: LINE,
      borderWidth: 0.5,
    });
    left += scaled.height;
  }

  // ── Columna derecha: pieza y desglose ──
  let right = top;
  right = draw.title(doc.pieceTitle, rightX, right, rightW);
  right = draw.table(doc.pieceRows, rightX, right, rightW);
  right += 20;
  right = draw.title(doc.breakdownTitle, rightX, right, rightW);
  right = draw.table(doc.breakdownRows, rightX, right, rightW);

  // ── Totales y notas ──
  top = Math.max(left, right) + 22;
  const totalsW = rightW; // alineado con la columna derecha
  const totalsX = rightX;
  let totals = top;
  const taxRows = doc.totalRows.slice(0, -1);
  totals = draw.table(taxRows, totalsX, totals, totalsW);
  draw.rule(totals + 6, totalsX, totalsX + totalsW, 1.5, INK);
  totals += 16;
  const grand = doc.totalRows[doc.totalRows.length - 1];
  if (grand) {
    page.drawRectangle({ x: totalsX, y: PAGE_H - totals - 8, width: 9, height: 9, color: ACCENT });
    draw.text(grand[0].toLocaleUpperCase(doc.metadata.language), totalsX + 16, totals + 8, { font: fonts.bold, size: 8.5 });
    draw.text(grand[1], totalsX + totalsW, totals + 32, { font: fonts.monoBold, size: 22, align: 'right', maxWidth: totalsW });
  }

  let notes = top + 4;
  for (const note of doc.notes) {
    for (const line of draw.wrap(note, fonts.sans, 8, COLUMN_W)) {
      draw.text(line, MARGIN, notes + 7, { font: fonts.sans, size: 8, color: MUTED });
      notes += 11;
    }
    notes += 5;
  }

  // ── Pie ──
  const footerTop = PAGE_H - MARGIN + 6;
  draw.rule(footerTop - 10, MARGIN, MARGIN + CONTENT_W, 0.5, LINE);
  draw.text(doc.footer, MARGIN, footerTop + 2, { font: fonts.sans, size: 7.5, color: MUTED });

  return pdf.save();
}

/** Escala `w × h` para que quepa en `maxW × maxH` sin deformarse ni ampliarse. */
export function fit(w: number, h: number, maxW: number, maxH: number): { width: number; height: number } {
  const ratio = Math.min(maxW / w, maxH / h, 1);
  return { width: w * ratio, height: h * ratio };
}

interface TextOptions {
  readonly font: PDFFont;
  readonly size: number;
  readonly color?: ReturnType<typeof rgb>;
  readonly align?: 'left' | 'right';
  /** Si el texto es más ancho, se acorta con «…». */
  readonly maxWidth?: number;
}

/** Dibuja con coordenadas «desde arriba» (el origen de PDF es la esquina inferior izquierda). */
class Drawer {
  constructor(
    private readonly page: PDFPage,
    private readonly fonts: Fonts,
    private readonly sanitizer: Sanitizer,
  ) {}

  /** `top` es la línea base del texto medida desde el borde superior de la página. */
  text(value: string, x: number, top: number, options: TextOptions): void {
    const { font, size, color = INK, align = 'left', maxWidth } = options;
    let text = this.sanitizer.clean(value, font);
    if (maxWidth !== undefined) text = this.truncate(text, font, size, maxWidth);
    const width = font.widthOfTextAtSize(text, size);
    this.page.drawText(text, {
      x: align === 'right' ? x - width : x,
      y: PAGE_H - top,
      size,
      font,
      color,
    });
  }

  rule(top: number, x1: number, x2: number, thickness: number, color: ReturnType<typeof rgb>): void {
    this.page.drawLine({ start: { x: x1, y: PAGE_H - top }, end: { x: x2, y: PAGE_H - top }, thickness, color });
  }

  /** Título de sección (mayúsculas pequeñas) con filete; devuelve la siguiente posición. */
  title(label: string, x: number, top: number, width: number): number {
    this.text(label.toLocaleUpperCase(), x, top + 8, { font: this.fonts.bold, size: 8, color: MUTED });
    this.rule(top + 14, x, x + width, 0.75, INK);
    return top + 14;
  }

  /** Tabla «etiqueta … valor»: etiqueta en sans, valor en monoespaciada alineado a la derecha. */
  table(rows: readonly PdfRow[], x: number, top: number, width: number): number {
    let y = top;
    for (const [label, value] of rows) {
      const valueFont = this.fonts.mono;
      const valueWidth = valueFont.widthOfTextAtSize(this.sanitizer.clean(value, valueFont), 9.5);
      const labelMax = Math.max(40, width - valueWidth - 12);
      this.text(label, x, y + 13, { font: this.fonts.sans, size: 9, color: MUTED, maxWidth: labelMax });
      this.text(value, x + width, y + 13, { font: valueFont, size: 9.5, align: 'right', maxWidth: width - 40 });
      y += 18;
      this.rule(y, x, x + width, 0.5, LINE);
    }
    return y;
  }

  truncate(text: string, font: PDFFont, size: number, maxWidth: number): string {
    if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
    let end = text.length;
    while (end > 1 && font.widthOfTextAtSize(`${text.slice(0, end)}...`, size) > maxWidth) end--;
    return `${text.slice(0, end)}...`;
  }

  /** Parte el texto en líneas que caben en `maxWidth`; las palabras más largas se cortan. */
  wrap(value: string, font: PDFFont, size: number, maxWidth: number): string[] {
    const text = this.sanitizer.clean(value, font);
    const lines: string[] = [];
    let current = '';
    const fits = (candidate: string): boolean => font.widthOfTextAtSize(candidate, size) <= maxWidth;
    for (const word of text.split(' ')) {
      const candidate = current === '' ? word : `${current} ${word}`;
      if (fits(candidate)) {
        current = candidate;
        continue;
      }
      if (current !== '') lines.push(current);
      current = word;
      while (!fits(current) && current.length > 1) {
        let cut = current.length - 1;
        while (cut > 1 && !fits(current.slice(0, cut))) cut--;
        lines.push(current.slice(0, cut));
        current = current.slice(cut);
      }
    }
    if (current !== '') lines.push(current);
    return lines.length > 0 ? lines : [''];
  }
}
