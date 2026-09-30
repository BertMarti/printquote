/**
 * Lector mínimo de etiquetas XML. `DOMParser` no existe en un Web Worker (ni en Node), y
 * un 3MF grande son cientos de MB de etiquetas `<vertex …/>`: un recorrido lineal sin
 * construir árbol gasta mucha menos memoria.
 *
 * Solo entiende lo que necesita un 3MF: etiquetas con atributos, comentarios, CDATA e
 * instrucciones (se saltan). No expande entidades definidas en un DOCTYPE (así no hay
 * «bombas» de entidades) y solo decodifica las cinco predefinidas y las numéricas.
 */

export interface XmlTag {
  /** Nombre sin prefijo de espacio de nombres («m:mesh» → «mesh»). */
  readonly name: string;
  readonly closing: boolean;
  readonly selfClosing: boolean;
  /** Texto de los atributos sin analizar; se lee con `attributes`. */
  readonly rawAttributes: string;
}

const ATTRIBUTE = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Atributos de una etiqueta como mapa de nombre local (sin prefijo) → valor decodificado. */
export function attributes(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  ATTRIBUTE.lastIndex = 0;
  for (let match = ATTRIBUTE.exec(raw); match; match = ATTRIBUTE.exec(raw)) {
    const name = match[1] ?? '';
    const value = match[2] ?? match[3] ?? '';
    const local = name.slice(name.indexOf(':') + 1);
    // xmlns:* no interesan; si un mismo nombre local aparece con y sin prefijo, gana el primero.
    if (name.startsWith('xmlns')) continue;
    if (!(local in result)) result[local] = value.includes('&') ? decodeEntities(value) : value;
  }
  return result;
}

const NAMED: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x')) return safeCodePoint(parseInt(body.slice(2), 16), whole);
    if (body.startsWith('#')) return safeCodePoint(parseInt(body.slice(1), 10), whole);
    return NAMED[body] ?? whole;
  });
}

function safeCodePoint(code: number, fallback: string): string {
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : fallback;
}

/** Recorre todas las etiquetas del texto, en orden de aparición. */
export function scanXml(text: string, onTag: (tag: XmlTag) => void): void {
  const length = text.length;
  let i = 0;
  while (i < length) {
    i = text.indexOf('<', i);
    if (i < 0) return;

    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      i = end < 0 ? length : end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', i)) {
      const end = text.indexOf(']]>', i + 9);
      i = end < 0 ? length : end + 3;
      continue;
    }
    const next = text.charCodeAt(i + 1);
    if (next === 0x3f /* ? */) {
      const end = text.indexOf('?>', i + 2);
      i = end < 0 ? length : end + 2;
      continue;
    }
    if (next === 0x21 /* ! */) {
      const end = text.indexOf('>', i + 2);
      i = end < 0 ? length : end + 1;
      continue;
    }

    // Fin de la etiqueta: el primer «>» que no esté dentro de comillas.
    let j = i + 1;
    let quote = 0;
    for (; j < length; j++) {
      const c = text.charCodeAt(j);
      if (quote !== 0) {
        if (c === quote) quote = 0;
      } else if (c === 0x22 || c === 0x27) {
        quote = c;
      } else if (c === 0x3e) {
        break;
      }
    }
    if (j >= length) return; // etiqueta sin cerrar: fin del documento

    const closing = next === 0x2f; /* / */
    let body = text.slice(closing ? i + 2 : i + 1, j);
    const selfClosing = body.endsWith('/');
    if (selfClosing) body = body.slice(0, -1);

    let nameEnd = 0;
    while (nameEnd < body.length && !/\s/.test(body.charAt(nameEnd))) nameEnd++;
    const fullName = body.slice(0, nameEnd);
    onTag({
      name: fullName.slice(fullName.indexOf(':') + 1),
      closing,
      selfClosing,
      rawAttributes: body.slice(nameEnd),
    });
    i = j + 1;
  }
}
