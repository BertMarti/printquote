import type { ErrorKey } from '../i18n/es';
import type { Params } from '../i18n/interpolate';
import { ModelParseError } from './errors';
import type { Mesh } from './types';
import { attributes, scanXml } from './xml';
import { readZipDirectory, readZipEntry, zipKey, type ZipEntry } from './zip';

/** Modelo principal cuando `_rels/.rels` no lo indica. */
const DEFAULT_MODEL = '3D/3dmodel.model';
/** Un objeto que se contiene a sí mismo (directa o indirectamente) no termina nunca. */
const MAX_DEPTH = 32;

/** Milímetros que mide cada unidad del 3MF. */
const UNIT_MM: Readonly<Record<string, number>> = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  inch: 25.4,
  foot: 304.8,
  meter: 1000,
};

/**
 * Transformación afín como en 3MF: 12 números (m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32)
 * con convención de vector fila: [x' y' z'] = [x y z] · M3×3 + [m30 m31 m32].
 */
export type Matrix = readonly [number, number, number, number, number, number, number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

/** Aplica primero `a` y después `b` (el producto A·B con vectores fila). */
export function composeMatrix(a: Matrix, b: Matrix): Matrix {
  const at = (r: number, c: number): number => a[r * 3 + c] ?? 0;
  const bt = (r: number, c: number): number => b[r * 3 + c] ?? 0;
  const out: number[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) out.push(at(r, 0) * bt(0, c) + at(r, 1) * bt(1, c) + at(r, 2) * bt(2, c));
  }
  for (let c = 0; c < 3; c++) out.push(at(3, 0) * bt(0, c) + at(3, 1) * bt(1, c) + at(3, 2) * bt(2, c) + bt(3, c));
  return out as unknown as Matrix;
}

/** Signo del determinante de la parte lineal: negativo = la transformación refleja (invierte las caras). */
function determinant(m: Matrix): number {
  const [a, b, c, d, e, f, g, h, i] = m;
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

/** Lee el atributo `transform`; vacío o ausente = identidad. */
export function parseTransform(text: string | undefined): Matrix {
  if (text === undefined || text.trim() === '') return IDENTITY;
  const parts = text.trim().split(/\s+/).map(Number);
  if (parts.length !== 12 || parts.some((n) => !Number.isFinite(n))) {
    throw new ModelParseError('err.3mf.transform', { text: text.slice(0, 60) });
  }
  return parts as unknown as Matrix;
}

class Growable<T extends Float32Array | Int32Array> {
  data: T;
  length = 0;

  constructor(private readonly make: (size: number) => T) {
    this.data = make(1024);
  }

  push(value: number): void {
    if (this.length === this.data.length) {
      const grown = this.make(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    this.data[this.length++] = value;
  }

  done(): T {
    return this.data.slice(0, this.length) as T;
  }
}

interface MeshData {
  readonly vertices: Float32Array;
  readonly triangles: Int32Array;
}

interface Component {
  readonly objectId: string;
  readonly path: string | undefined;
  readonly transform: Matrix;
}

interface ModelObject {
  readonly id: string;
  readonly printable: boolean;
  mesh?: MeshData;
  readonly components: Component[];
}

interface BuildItem {
  readonly objectId: string;
  readonly path: string | undefined;
  readonly transform: Matrix;
}

interface ModelFile {
  readonly path: string;
  /** Milímetros por unidad del archivo. */
  readonly unit: number;
  readonly objects: Map<string, ModelObject>;
  readonly build: BuildItem[];
}

function fail(code: ErrorKey, params: Params = {}): never {
  throw new ModelParseError(code, params);
}

/** Recorre el XML de un `.model` y lo deja en objetos con sus mallas, componentes y elementos de la plantilla. */
function parseModelXml(path: string, text: string): ModelFile {
  const objects = new Map<string, ModelObject>();
  const build: BuildItem[] = [];
  let unit = 1;
  let current: ModelObject | null = null;
  let vertices: Growable<Float32Array> | null = null;
  let triangles: Growable<Int32Array> | null = null;
  let inBuild = false;
  let vertexCount = 0;

  scanXml(text, (tag) => {
    if (tag.closing) {
      if (tag.name === 'object' && current) {
        if (vertices && triangles) current.mesh = { vertices: vertices.done(), triangles: triangles.done() };
        current = null;
        vertices = null;
        triangles = null;
      } else if (tag.name === 'build') {
        inBuild = false;
      }
      return;
    }

    switch (tag.name) {
      case 'model': {
        const value = attributes(tag.rawAttributes)['unit'];
        if (value !== undefined) {
          const name = value.trim().toLowerCase();
          if (!Object.hasOwn(UNIT_MM, name)) fail('err.3mf.unit', { unit: value.slice(0, 20) });
          unit = UNIT_MM[name] ?? 1;
        }
        break;
      }
      case 'object': {
        const a = attributes(tag.rawAttributes);
        const id = a['id'];
        if (id === undefined) fail('err.3mf.objectId', { path });
        const type = (a['type'] ?? 'model').toLowerCase();
        // Soportes, superficies y «otros» no son piezas que se impriman como tal.
        current = { id, printable: type === 'model', components: [] };
        objects.set(current.id, current);
        vertices = null;
        triangles = null;
        vertexCount = 0;
        if (tag.selfClosing) current = null;
        break;
      }
      case 'mesh':
        if (!current) fail('err.3mf.meshOutside', { path });
        vertices = new Growable((n) => new Float32Array(n));
        triangles = new Growable((n) => new Int32Array(n));
        vertexCount = 0;
        break;
      case 'vertex': {
        if (!vertices) fail('err.3mf.vertexOutside', { path });
        const a = attributes(tag.rawAttributes);
        for (const axis of ['x', 'y', 'z'] as const) {
          const value = Number(a[axis]);
          if (a[axis] === undefined || !Number.isFinite(Math.fround(value))) {
            fail('err.3mf.badCoord', { n: vertexCount + 1, path, axis: axis.toUpperCase() });
          }
          vertices?.push(value);
        }
        vertexCount++;
        break;
      }
      case 'triangle': {
        if (!triangles) fail('err.3mf.triangleOutside', { path });
        const a = attributes(tag.rawAttributes);
        for (const key of ['v1', 'v2', 'v3'] as const) {
          const value = Number(a[key]);
          if (a[key] === undefined || !Number.isInteger(value) || value < 0) {
            fail('err.3mf.badIndex', { path, key });
          }
          triangles?.push(value);
        }
        break;
      }
      case 'component': {
        if (!current) fail('err.3mf.componentOutside', { path });
        const a = attributes(tag.rawAttributes);
        if (a['objectid'] === undefined) fail('err.3mf.componentId', { path });
        current.components.push({ objectId: a['objectid'], path: a['path'], transform: parseTransform(a['transform']) });
        break;
      }
      case 'build':
        inBuild = !tag.selfClosing;
        break;
      case 'item': {
        if (!inBuild) break;
        const a = attributes(tag.rawAttributes);
        if (a['objectid'] === undefined) fail('err.3mf.itemId');
        if (a['printable'] === '0' || a['printable']?.toLowerCase() === 'false') break;
        build.push({ objectId: a['objectid'], path: a['path'], transform: parseTransform(a['transform']) });
        break;
      }
      default:
        break;
    }
  });

  return { path, unit, objects, build };
}

/** Ruta del modelo principal según `_rels/.rels`, o la de por defecto. */
function rootModelPath(rels: string | null): string {
  if (rels) {
    let found: string | null = null;
    scanXml(rels, (tag) => {
      if (tag.closing || tag.name !== 'Relationship' || found) return;
      const a = attributes(tag.rawAttributes);
      if ((a['Type'] ?? '').toLowerCase().endsWith('/3dmodel') && a['Target']) found = a['Target'];
    });
    if (found) return found;
  }
  return DEFAULT_MODEL;
}

/** Instancia de una malla con la transformación (en mm) que la lleva a su sitio en la plantilla. */
interface Instance {
  readonly mesh: MeshData;
  readonly matrix: Matrix;
}

function scale(factor: number): Matrix {
  return [factor, 0, 0, 0, factor, 0, 0, 0, factor, 0, 0, 0];
}

/**
 * Lee un 3MF (ZIP con XML): descomprime `3D/3dmodel.model` con `DecompressionStream`, junta
 * todos los objetos de la plantilla de impresión (`build`) aplicando la transformación de cada
 * `item` y de cada `component`, y convierte las unidades a milímetros. Admite componentes que
 * apuntan a otros archivos `.model` del ZIP (extensión de producción, que usan Bambu Studio y
 * PrusaSlicer).
 */
export async function parse3mf(data: ArrayBuffer | Uint8Array): Promise<Mesh> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength === 0) fail('err.empty');

  const entries = readZipDirectory(bytes);
  const decoder = new TextDecoder('utf-8');
  const read = async (entry: ZipEntry): Promise<string> => decoder.decode(await readZipEntry(bytes, entry));

  const relsEntry = entries.get(zipKey('_rels/.rels'));
  const rootPath = rootModelPath(relsEntry ? await read(relsEntry) : null);
  const rootEntry = entries.get(zipKey(rootPath));
  if (!rootEntry) {
    fail('err.3mf.noModel', { path: rootPath.replace(/^\//, '') });
  }

  const files = new Map<string, ModelFile>();
  const load = async (path: string): Promise<ModelFile> => {
    const key = zipKey(path);
    const cached = files.get(key);
    if (cached) return cached;
    const entry = entries.get(key);
    if (!entry) fail('err.3mf.missingFile', { path: path.replace(/^\//, '') });
    const file = parseModelXml(path, await read(entry));
    files.set(key, file);
    return file;
  };

  const root = await load(rootPath);
  const instances: Instance[] = [];

  const visit = async (file: ModelFile, objectId: string, matrix: Matrix, depth: number, topLevel: boolean): Promise<void> => {
    if (depth > MAX_DEPTH) fail('err.3mf.circular');
    const object = file.objects.get(objectId);
    if (!object) fail('err.3mf.missingObject', { id: objectId });
    if (topLevel && !object.printable) return;

    if (object.mesh) {
      // Del sistema del archivo de la malla al de la plantilla (unidades), luego la matriz, luego a mm.
      const toRoot = composeMatrix(scale(file.unit / root.unit), matrix);
      instances.push({ mesh: object.mesh, matrix: composeMatrix(toRoot, scale(root.unit)) });
    }
    for (const component of object.components) {
      const target = component.path ? await load(component.path) : file;
      await visit(target, component.objectId, composeMatrix(component.transform, matrix), depth + 1, false);
    }
  };

  if (root.build.length > 0) {
    for (const item of root.build) {
      const target = item.path ? await load(item.path) : root;
      await visit(target, item.objectId, item.transform, 0, true);
    }
  } else {
    // Sin plantilla (archivo incompleto): se toman los objetos que nadie usa como componente.
    const used = new Set<string>();
    for (const object of root.objects.values()) for (const c of object.components) if (!c.path) used.add(c.objectId);
    for (const object of root.objects.values()) {
      if (!used.has(object.id)) await visit(root, object.id, IDENTITY, 0, true);
    }
  }

  return meshFromInstances(instances);
}

function meshFromInstances(instances: readonly Instance[]): Mesh {
  let triangleCount = 0;
  for (const { mesh } of instances) triangleCount += mesh.triangles.length / 3;
  if (triangleCount === 0) {
    fail('err.3mf.empty');
  }

  const positions = new Float32Array(triangleCount * 9);
  let out = 0;
  for (const { mesh, matrix } of instances) {
    const { vertices, triangles } = mesh;
    const vertexTotal = vertices.length / 3;
    const [m0, m1, m2, m3, m4, m5, m6, m7, m8, tx, ty, tz] = matrix;
    // Una transformación con determinante negativo refleja la pieza y darle la vuelta a las
    // caras evita que el volumen salga negativo («normales invertidas»).
    const flip = determinant(matrix) < 0;
    for (let t = 0; t < triangles.length; t += 3) {
      const corner = [triangles[t] ?? 0, triangles[t + 1] ?? 0, triangles[t + 2] ?? 0];
      if (flip) corner.reverse();
      for (const v of corner) {
        if (v >= vertexTotal) {
          fail('err.3mf.vertexRange', { index: v + 1, count: vertexTotal });
        }
        const x = vertices[v * 3] ?? 0, y = vertices[v * 3 + 1] ?? 0, z = vertices[v * 3 + 2] ?? 0;
        positions[out++] = x * (m0 ?? 1) + y * (m3 ?? 0) + z * (m6 ?? 0) + (tx ?? 0);
        positions[out++] = x * (m1 ?? 0) + y * (m4 ?? 1) + z * (m7 ?? 0) + (ty ?? 0);
        positions[out++] = x * (m2 ?? 0) + y * (m5 ?? 0) + z * (m8 ?? 1) + (tz ?? 0);
      }
    }
  }
  return { positions, triangleCount, format: '3mf' };
}
