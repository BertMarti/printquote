/** Utilidades para construir ZIP y 3MF de prueba en memoria. */
import { cubeTriangles, type Triangle } from './mesh';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export interface ZipFile {
  readonly name: string;
  readonly data: string | Uint8Array;
  /** 8 = deflate (por defecto), 0 = sin comprimir. */
  readonly method?: 0 | 8;
}

export interface ZipOptions {
  /** Omite el directorio central (archivo «cortado»). */
  readonly noDirectory?: boolean;
  /** Bytes para pegar tras el último registro. */
  readonly trailing?: Uint8Array;
}

/** Construye un ZIP con cabeceras locales, directorio central y fin de directorio. */
export async function buildZip(files: readonly ZipFile[], options: ZipOptions = {}): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const raw = typeof file.data === 'string' ? encoder.encode(file.data) : file.data;
    const method = file.method ?? 8;
    const body = method === 8 ? await deflateRaw(raw) : raw;
    const name = encoder.encode(file.name);
    const crc = crc32(raw);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // nombres en UTF-8
    lv.setUint16(8, method, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);

    const entry = new Uint8Array(46 + name.length);
    const ev = new DataView(entry.buffer);
    ev.setUint32(0, 0x02014b50, true);
    ev.setUint16(4, 20, true);
    ev.setUint16(6, 20, true);
    ev.setUint16(8, 0x0800, true);
    ev.setUint16(10, method, true);
    ev.setUint32(16, crc, true);
    ev.setUint32(20, body.length, true);
    ev.setUint32(24, raw.length, true);
    ev.setUint16(28, name.length, true);
    ev.setUint32(42, offset, true);
    entry.set(name, 46);

    parts.push(local, body);
    central.push(entry);
    offset += local.length + body.length;
  }

  if (!options.noDirectory) {
    const size = central.reduce((sum, c) => sum + c.length, 0);
    const end = new Uint8Array(22);
    const dv = new DataView(end.buffer);
    dv.setUint32(0, 0x06054b50, true);
    dv.setUint16(8, files.length, true);
    dv.setUint16(10, files.length, true);
    dv.setUint32(12, size, true);
    dv.setUint32(16, offset, true);
    parts.push(...central, end);
  }
  if (options.trailing) parts.push(options.trailing);

  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let pos = 0;
  for (const part of parts) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}

const NS = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';

export const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

/** `<vertex>` y `<triangle>` de una malla de triángulos sin indexar (cada vértice se repite: da igual para las pruebas). */
export function meshXml(triangles: readonly Triangle[]): string {
  const vertices: string[] = [];
  const tris: string[] = [];
  triangles.forEach((t, i) => {
    for (let k = 0; k < 9; k += 3) vertices.push(`<vertex x="${t[k]}" y="${t[k + 1]}" z="${t[k + 2]}"/>`);
    tris.push(`<triangle v1="${i * 3}" v2="${i * 3 + 1}" v3="${i * 3 + 2}"/>`);
  });
  return `<mesh><vertices>${vertices.join('')}</vertices><triangles>${tris.join('')}</triangles></mesh>`;
}

/** Objeto 3MF con una malla. */
export function objectXml(id: number, triangles: readonly Triangle[], extra = ''): string {
  return `<object id="${id}" type="model"${extra}>${meshXml(triangles)}</object>`;
}

/** Documento `.model` completo. */
export function modelXml(resources: string, build: string, attrs = 'unit="millimeter"'): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<model ${attrs} xml:lang="en-US" xmlns="${NS}" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">
  <resources>${resources}</resources>
  <build>${build}</build>
</model>`;
}

/** 3MF mínimo con un cubo de `size` mm. */
export async function cube3mf(size = 20): Promise<Uint8Array> {
  return buildZip([
    { name: '[Content_Types].xml', data: '<Types/>' },
    { name: '_rels/.rels', data: RELS },
    { name: '3D/3dmodel.model', data: modelXml(objectXml(1, cubeTriangles(size)), '<item objectid="1"/>') },
  ]);
}
