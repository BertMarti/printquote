import { ModelParseError } from './errors';

/** Máximo que se descomprime de una sola entrada (protege de «bombas» ZIP). */
export const MAX_ENTRY_BYTES = 400 * 1024 * 1024;

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const END_MIN = 22;
const MAX_COMMENT = 0xffff;

export interface ZipEntry {
  /** Nombre tal como está en el archivo. */
  readonly name: string;
  /** 0 = sin comprimir, 8 = deflate. */
  readonly method: number;
  readonly compressedSize: number;
  readonly size: number;
  /** Posición de los datos comprimidos dentro del archivo. */
  readonly dataOffset: number;
}

/** Clave de búsqueda: sin «/» inicial, con «/» y en minúsculas. */
export function zipKey(name: string): string {
  return name.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
}

/**
 * Lista las entradas de un ZIP leyendo el directorio central. Si el archivo no lo tiene
 * (está cortado), recorre las cabeceras locales una a una, siempre que estas lleven los
 * tamaños. No admite cifrado ni ZIP64: un modelo de más de 4 GB no cabría en el navegador.
 */
export function readZipDirectory(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = new Map<string, ZipEntry>();
  const decoder = new TextDecoder('utf-8');

  const endAt = findEnd(view);
  if (endAt < 0) {
    return scanLocalHeaders(bytes, view, decoder);
  }

  const total = view.getUint16(endAt + 10, true);
  const dirSize = view.getUint32(endAt + 12, true);
  let pos = view.getUint32(endAt + 16, true);
  if (total === 0xffff || dirSize === 0xffffffff || pos === 0xffffffff) {
    throw new ModelParseError('err.zip.zip64');
  }

  for (let i = 0; i < total; i++) {
    if (pos + 46 > bytes.length || view.getUint32(pos, true) !== SIG_CENTRAL) {
      throw new ModelParseError('err.zip.directory');
    }
    const flags = view.getUint16(pos + 8, true);
    const method = view.getUint16(pos + 10, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const size = view.getUint32(pos + 24, true);
    const nameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);
    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLength));
    pos += 46 + nameLength + extraLength + commentLength;

    if (flags & 1) throw new ModelParseError('err.zip.encrypted');
    if (name.endsWith('/')) continue; // carpeta
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== SIG_LOCAL) {
      throw new ModelParseError('err.zip.header', { name });
    }
    // Las longitudes de nombre y extra de la cabecera local pueden diferir de las del directorio.
    const dataOffset = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    entries.set(zipKey(name), { name, method, compressedSize, size, dataOffset });
  }
  return entries;
}

/** Posición de la firma «fin de directorio central», buscándola desde el final. */
function findEnd(view: DataView): number {
  const last = view.byteLength - END_MIN;
  const first = Math.max(0, last - MAX_COMMENT);
  for (let i = last; i >= first; i--) {
    if (view.getUint32(i, true) === SIG_END) return i;
  }
  return -1;
}

function scanLocalHeaders(bytes: Uint8Array, view: DataView, decoder: TextDecoder): Map<string, ZipEntry> {
  const entries = new Map<string, ZipEntry>();
  let pos = 0;
  while (pos + 30 <= bytes.length && view.getUint32(pos, true) === SIG_LOCAL) {
    const flags = view.getUint16(pos + 6, true);
    const method = view.getUint16(pos + 8, true);
    const compressedSize = view.getUint32(pos + 18, true);
    const size = view.getUint32(pos + 22, true);
    const nameLength = view.getUint16(pos + 26, true);
    const extraLength = view.getUint16(pos + 28, true);
    const name = decoder.decode(bytes.subarray(pos + 30, pos + 30 + nameLength));
    const dataOffset = pos + 30 + nameLength + extraLength;
    if (flags & 1) throw new ModelParseError('err.zip.encrypted');
    if (flags & 8) {
      throw new ModelParseError('err.zip.noDirectory');
    }
    if (dataOffset + compressedSize > bytes.length) {
      throw new ModelParseError('err.zip.truncated');
    }
    if (!name.endsWith('/')) entries.set(zipKey(name), { name, method, compressedSize, size, dataOffset });
    pos = dataOffset + compressedSize;
  }
  if (entries.size === 0) throw new ModelParseError('err.zip.invalid');
  return entries;
}

/** Contenido descomprimido de una entrada. */
export async function readZipEntry(bytes: Uint8Array, entry: ZipEntry, maxBytes = MAX_ENTRY_BYTES): Promise<Uint8Array> {
  if (entry.size > maxBytes) {
    throw new ModelParseError('err.zip.tooBig', { name: entry.name, mb: Math.round(entry.size / 1048576) });
  }
  if (entry.dataOffset + entry.compressedSize > bytes.length) {
    throw new ModelParseError('err.zip.truncated');
  }
  const raw = bytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
  if (entry.method === 0) return raw;
  if (entry.method !== 8) {
    throw new ModelParseError('err.zip.method', { method: entry.method });
  }
  if (typeof DecompressionStream === 'undefined') {
    throw new ModelParseError('err.zip.noStreams');
  }

  try {
    const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ModelParseError('err.zip.exceeds', { name: entry.name, mb: Math.round(maxBytes / 1048576) });
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  } catch (error) {
    if (error instanceof ModelParseError) throw error;
    throw new ModelParseError('err.zip.inflate', { name: entry.name });
  }
}
