import { decodePDFRawStream, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';

/** Mapa «glifo → carácter» de la tabla ToUnicode de una fuente incrustada. */
function toUnicode(map: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const [, gid, code] of map.matchAll(/<([0-9A-Fa-f]{4})>\s*<([0-9A-Fa-f]{4,8})>/g)) {
    out.set(parseInt(gid ?? '', 16), String.fromCodePoint(parseInt(code ?? '', 16)));
  }
  return out;
}

const decode = (stream: unknown, encoding: string): string =>
  stream instanceof PDFRawStream ? new TextDecoder(encoding).decode(decodePDFRawStream(stream).decode()) : '';

/** Textos dibujados en una página (la primera por defecto): cada `Tj` decodificado con la tabla ToUnicode de su fuente. */
export async function pageTexts(bytes: Uint8Array, pageIndex = 0): Promise<string[]> {
  const pdf = await PDFDocument.load(bytes);
  const page = pdf.getPage(pageIndex);
  const fonts = page.node.Resources()?.lookup(PDFName.of('Font'), PDFDict);
  const maps = new Map<string, Map<number, string>>();
  for (const name of fonts?.keys() ?? []) {
    const font = fonts?.lookup(name, PDFDict);
    const cmap = font?.lookup(PDFName.of('ToUnicode'));
    maps.set(name.decodeText().replace(/^\//, ''), toUnicode(decode(cmap, 'latin1')));
  }
  const contents = page.node.Contents();
  const refs = contents && 'asArray' in contents ? contents.asArray() : contents ? [contents] : [];
  const texts: string[] = [];
  for (const ref of refs) {
    const source = decode(pdf.context.lookup(ref), 'latin1');
    let current = new Map<number, string>();
    for (const match of source.matchAll(/\/(\S+)\s+[\d.]+\s+Tf|<([0-9A-Fa-f]+)>\s*Tj/g)) {
      if (match[1] !== undefined) {
        current = maps.get(match[1]) ?? new Map();
        continue;
      }
      const hex = match[2] ?? '';
      let text = '';
      for (let i = 0; i < hex.length; i += 4) text += current.get(parseInt(hex.slice(i, i + 4), 16)) ?? '�';
      texts.push(text);
    }
  }
  return texts;
}
