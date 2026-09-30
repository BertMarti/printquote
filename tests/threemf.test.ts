import { describe, expect, it } from 'vitest';
import { analyzeModel } from '../src/stl/analyze';
import { ModelParseError } from '../src/stl/errors';
import { meshWarnings } from '../src/stl/geometry';
import { parse3mf } from '../src/stl/threemf';
import { readZipDirectory } from '../src/stl/zip';
import { cubeTriangles, encode } from './helpers/mesh';
import { buildZip, cube3mf, modelXml, objectXml, RELS } from './helpers/zip';

const zipWithModel = (model: string, extra: Parameters<typeof buildZip>[0] = []): Promise<Uint8Array> =>
  buildZip([{ name: '_rels/.rels', data: RELS }, { name: '3D/3dmodel.model', data: model }, ...extra]);

const bounds = (positions: Float32Array): { min: number[]; max: number[] } => {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    const axis = i % 3;
    min[axis] = Math.min(min[axis] ?? 0, positions[i] ?? 0);
    max[axis] = Math.max(max[axis] ?? 0, positions[i] ?? 0);
  }
  return { min, max };
};

const MOVE = (x: number, y: number, z: number): string => `1 0 0 0 1 0 0 0 1 ${x} ${y} ${z}`;

describe('parse3mf', () => {
  it('lee un cubo y da la misma geometría y los mismos avisos que en STL', async () => {
    const { mesh, stats } = await analyzeModel(await cube3mf(20), 'cubo.3mf');
    expect(mesh.format).toBe('3mf');
    expect(mesh.triangleCount).toBe(12);
    expect(stats.volume).toBeCloseTo(8000, 6);
    expect(stats.surfaceArea).toBeCloseTo(2400, 6);
    expect(stats.openEdges).toBe(0);
    expect(meshWarnings(stats)).toEqual([]);
    expect(meshWarnings((await analyzeModel(await cube3mf(300))).stats)).toEqual(['too-big']);
  });

  it('con varios objetos y transformaciones junta todos en su sitio', async () => {
    const model = modelXml(
      objectXml(1, cubeTriangles(10)) + objectXml(2, cubeTriangles(10)),
      `<item objectid="1"/><item objectid="2" transform="${MOVE(50, 0, 0)}"/><item objectid="1" transform="${MOVE(0, 30, 5)}"/>`,
    );
    const { mesh, stats } = await analyzeModel(await zipWithModel(model));
    expect(mesh.triangleCount).toBe(36);
    expect(stats.volume).toBeCloseTo(3000, 6);
    const { min, max } = bounds(mesh.positions);
    expect(min).toEqual([0, 0, 0]);
    expect(max).toEqual([60, 40, 15]);
  });

  it('aplica la rotación con la convención de 3MF (vector fila)', async () => {
    // Giro de 90° sobre Z: (x, y) → (−y, x). Fila 1 = (0 1 0), fila 2 = (−1 0 0) en la convención de 3MF.
    const model = modelXml(objectXml(1, cubeTriangles(10)), '<item objectid="1" transform="0 1 0 -1 0 0 0 0 1 0 0 0"/>');
    const { mesh, stats } = await analyzeModel(await zipWithModel(model));
    const { min, max } = bounds(mesh.positions);
    expect(min).toEqual([-10, 0, 0]);
    expect(max).toEqual([0, 10, 10]);
    expect(stats.volume).toBeCloseTo(1000, 6);
    expect(meshWarnings(stats)).toEqual([]);
  });

  it('una transformación que refleja no deja el volumen «invertido»', async () => {
    const model = modelXml(objectXml(1, cubeTriangles(10)), '<item objectid="1" transform="-1 0 0 0 1 0 0 0 1 0 0 0"/>');
    const { stats, mesh } = await analyzeModel(await zipWithModel(model));
    expect(stats.signedVolume).toBeGreaterThan(0);
    expect(meshWarnings(stats)).toEqual([]);
    expect(bounds(mesh.positions).min[0]).toBe(-10);
  });

  it('resuelve componentes anidados componiendo las transformaciones (componente primero, luego el item)', async () => {
    const model = modelXml(
      objectXml(1, cubeTriangles(10)) +
        `<object id="2" type="model"><components><component objectid="1" transform="${MOVE(20, 0, 0)}"/><component objectid="1"/></components></object>` +
        '<object id="3" type="model"><components><component objectid="2" transform="2 0 0 0 2 0 0 0 2 0 0 0"/></components></object>',
      `<item objectid="3" transform="${MOVE(0, 0, 100)}"/>`,
    );
    const { mesh, stats } = await analyzeModel(await zipWithModel(model));
    expect(mesh.triangleCount).toBe(24);
    // Dos cubos de 10 escalados ×2 = dos cubos de 20 (8000 cada uno).
    expect(stats.volume).toBeCloseTo(16000, 4);
    const { min, max } = bounds(mesh.positions);
    expect(min).toEqual([0, 0, 100]);
    expect(max).toEqual([60, 20, 120]); // segundo cubo desplazado 20 × 2 = 40, más su lado 20
  });

  it('convierte las unidades del modelo a milímetros', async () => {
    for (const [unit, factor] of [['centimeter', 10], ['inch', 25.4], ['meter', 1000], ['micron', 0.001]] as const) {
      const model = modelXml(objectXml(1, cubeTriangles(2)), '<item objectid="1"/>', `unit="${unit}"`);
      const { stats } = await analyzeModel(await zipWithModel(model));
      expect(stats.bounds.size.x).toBeCloseTo(2 * factor, 4);
    }
  });

  it('sin atributo unit, asume milímetros', async () => {
    const model = modelXml(objectXml(1, cubeTriangles(7)), '<item objectid="1"/>', '');
    expect((await analyzeModel(await zipWithModel(model))).stats.bounds.size.x).toBe(7);
  });

  it('omite los elementos no imprimibles y los objetos que no son piezas (soportes)', async () => {
    const model = modelXml(
      objectXml(1, cubeTriangles(10)) + objectXml(2, cubeTriangles(10)).replace('type="model"', 'type="support"'),
      `<item objectid="1"/><item objectid="2"/><item objectid="1" printable="0" transform="${MOVE(99, 0, 0)}"/>`,
    );
    const { mesh } = await analyzeModel(await zipWithModel(model));
    expect(mesh.triangleCount).toBe(12);
    expect(bounds(mesh.positions).max[0]).toBe(10);
  });

  it('lee componentes que apuntan a otro .model del ZIP (extensión de producción, como Bambu Studio)', async () => {
    const root = modelXml(
      `<object id="2" type="model"><components><component p:path="/3D/Objects/object_1.model" objectid="1" transform="${MOVE(5, 5, 0)}"/></components></object>`,
      `<item objectid="2" transform="${MOVE(100, 0, 0)}"/>`,
    );
    const part = modelXml(objectXml(1, cubeTriangles(10)), '');
    const zip = await zipWithModel(root, [{ name: '3D/Objects/object_1.model', data: part }]);
    const { mesh } = await analyzeModel(zip);
    expect(mesh.triangleCount).toBe(12);
    const { min, max } = bounds(mesh.positions);
    expect(min).toEqual([105, 5, 0]);
    expect(max).toEqual([115, 15, 10]);
  });

  it('respeta la ruta del modelo indicada en _rels/.rels y los prefijos de espacio de nombres', async () => {
    const model = modelXml(objectXml(1, cubeTriangles(10)), '<item objectid="1"/>').replace(
      /<(\/?)(model|resources|build|object|mesh|vertices|vertex|triangles|triangle|item)\b/g,
      '<$1m:$2',
    );
    const rels = RELS.replace('/3D/3dmodel.model', '/otra/ruta.model');
    const zip = await buildZip([
      { name: '_rels/.rels', data: rels },
      { name: 'otra/ruta.model', data: model },
    ]);
    expect((await analyzeModel(zip)).stats.volume).toBeCloseTo(1000, 6);
  });

  it('funciona con datos sin comprimir y con comentarios, CDATA y saltos de línea entre atributos', async () => {
    const model = modelXml(
      '<!-- comentario <vertex x="9" y="9" z="9"/> --><metadata><![CDATA[<vertex x="1" y="1" z="1"/>]]></metadata>' +
        objectXml(1, cubeTriangles(10)).replace(/<vertex /g, '<vertex\n  '),
      '<item objectid="1"/>',
    );
    const zip = await buildZip([
      { name: '_rels/.rels', data: RELS, method: 0 },
      { name: '3D/3dmodel.model', data: model, method: 0 },
    ]);
    const { mesh } = await analyzeModel(zip);
    expect(mesh.triangleCount).toBe(12);
  });

  it('si no hay plantilla (build), usa los objetos que nadie referencia', async () => {
    const model = modelXml(objectXml(1, cubeTriangles(10)) + objectXml(2, cubeTriangles(10)), '');
    expect((await analyzeModel(await zipWithModel(model))).mesh.triangleCount).toBe(24);
  });
});

describe('parse3mf: errores en español', () => {
  const expectError = async (data: Uint8Array | ArrayBuffer, message: RegExp): Promise<void> => {
    await expect(parse3mf(data)).rejects.toThrow(ModelParseError);
    await expect(parse3mf(data)).rejects.toThrow(message);
  };
  const valid = modelXml(objectXml(1, cubeTriangles(10)), '<item objectid="1"/>');

  it('archivo vacío o que no es un ZIP', async () => {
    await expectError(new Uint8Array(0), /vacío/);
    await expectError(encode('esto no es un zip, aunque pese más de veintidós bytes'), /no es un ZIP válido/);
  });

  it('ZIP sin el modelo', async () => {
    await expectError(await buildZip([{ name: 'hola.txt', data: 'x' }]), /no contiene el modelo/);
  });

  it('datos comprimidos dañados', async () => {
    const zip = await zipWithModel(valid);
    const entry = readZipDirectory(zip).get('3d/3dmodel.model');
    if (!entry) throw new Error('falta la entrada');
    const broken = zip.slice();
    for (let i = 0; i < 12; i++) broken[entry.dataOffset + 2 + i] = 0xff;
    await expectError(broken, /no se ha podido descomprimir/i);
  });

  it('archivo cortado a la mitad', async () => {
    const zip = await cube3mf();
    await expectError(zip.slice(0, Math.floor(zip.length / 2)), /cortado|dañado|no es un ZIP/);
  });

  it('sin triángulos', async () => {
    const model = modelXml('<object id="1" type="model"><mesh><vertices/><triangles/></mesh></object>', '<item objectid="1"/>');
    await expectError(await zipWithModel(model), /ninguna pieza imprimible/);
  });

  it('objeto de la plantilla que no existe', async () => {
    await expectError(await zipWithModel(valid.replace('<item objectid="1"/>', '<item objectid="7"/>')), /objeto 7/);
  });

  it('índice de vértice fuera de rango o coordenada no numérica', async () => {
    await expectError(await zipWithModel(valid.replace('v1="0"', 'v1="9999"')), /vértice 10000/);
    await expectError(await zipWithModel(valid.replace('x="0"', 'x="abc"')), /coordenada X no válida/);
  });

  it('transformación mal formada', async () => {
    await expectError(await zipWithModel(valid.replace('<item objectid="1"/>', '<item objectid="1" transform="1 0 0"/>')), /transformación no válida/);
  });

  it('referencia a un archivo que no está en el ZIP', async () => {
    const model = modelXml(
      '<object id="2"><components><component p:path="/3D/falta.model" objectid="1"/></components></object>',
      '<item objectid="2"/>',
    );
    await expectError(await zipWithModel(model), /3D\/falta\.model/);
  });

  it('objetos que se contienen a sí mismos', async () => {
    const model = modelXml('<object id="1"><components><component objectid="1"/></components></object>', '<item objectid="1"/>');
    await expectError(await zipWithModel(model), /circulares/);
  });
});

describe('3MF: ZIP de otros programas, unidades y objetos vacíos', () => {
  const valid = modelXml(objectXml(1, cubeTriangles(10)), '<item objectid="1"/>');
  const files = (model: string, extra: Partial<Parameters<typeof buildZip>[0][number]> = {}): Parameters<typeof buildZip>[0] => [
    { name: '_rels/.rels', data: RELS, ...extra },
    { name: '3D/3dmodel.model', data: model, ...extra },
  ];

  it('entradas con descriptor de datos (ZIP en flujo, como el de 3D Builder): comprimidas y sin comprimir', async () => {
    for (const method of [8, 0]) {
      const { mesh } = await analyzeModel(await buildZip(files(valid, { descriptor: true, method })));
      expect(mesh.triangleCount, `método ${method}`).toBe(12);
    }
  });

  it('un descriptor de datos sin directorio central da un error claro (no se puede saber dónde acaba cada entrada)', async () => {
    const zip = await buildZip(files(valid, { descriptor: true }), { noDirectory: true });
    await expect(parse3mf(zip)).rejects.toThrow(/le falta el directorio central/);
  });

  it('método de compresión que no soportamos, ZIP64 por entrada y cifrado: errores claros', async () => {
    await expect(parse3mf(await buildZip(files(valid, { method: 12 })))).rejects.toThrow(/método de compresión \(12\)/);
    await expect(parse3mf(await buildZip(files(valid, { zip64: true })))).rejects.toThrow(/ZIP64/);
    await expect(parse3mf(await buildZip(files(valid, { encrypted: true })))).rejects.toThrow(/contraseña/);
  });

  it('un archivo de datos aleatorios con firma de ZIP no cuelga ni lanza un error genérico', async () => {
    const noise = new Uint8Array(400).map((_, i) => (i * 37 + 11) & 0xff);
    noise.set([0x50, 0x4b, 0x03, 0x04]);
    await expect(parse3mf(noise)).rejects.toThrow(ModelParseError);
  });

  it('unidad en pulgadas: la traslación del item va en pulgadas y todo sale en milímetros', async () => {
    const model = modelXml(objectXml(1, cubeTriangles(1)), `<item objectid="1" transform="${MOVE(2, 0, 0)}"/>`, 'unit="inch"');
    const { mesh } = await analyzeModel(await zipWithModel(model));
    const { min, max } = bounds(mesh.positions);
    expect(min[0]).toBeCloseTo(50.8, 4);
    expect(max[0]).toBeCloseTo(76.2, 4);
  });

  it('una unidad desconocida es un error (no se supone milímetros en silencio) y no falla con nombres de Object', async () => {
    for (const unit of ['parsec', 'constructor', 'toString']) {
      const model = modelXml(objectXml(1, cubeTriangles(2)), '<item objectid="1"/>', `unit="${unit}"`);
      await expect(parse3mf(await zipWithModel(model)), unit).rejects.toThrow(/unidad desconocida/);
    }
    const upper = modelXml(objectXml(1, cubeTriangles(2)), '<item objectid="1"/>', 'unit="Millimeter"');
    expect((await analyzeModel(await zipWithModel(upper))).stats.bounds.size.x).toBe(2);
  });

  it('un objeto sin triángulos junto a uno válido se ignora; solo con objetos vacíos es un error', async () => {
    const empty = '<object id="9" type="model"><mesh><vertices/><triangles/></mesh></object>';
    const both = modelXml(empty + objectXml(1, cubeTriangles(10)), '<item objectid="9"/><item objectid="1"/>');
    expect((await analyzeModel(await zipWithModel(both))).mesh.triangleCount).toBe(12);
    const onlyEmpty = modelXml(empty, '<item objectid="9"/>');
    await expect(parse3mf(await zipWithModel(onlyEmpty))).rejects.toThrow(/ninguna pieza imprimible/);
  });

  it('transformación compuesta: giro de 90° sobre Z, escala ×2 y traslación, en un componente dentro de otro objeto', async () => {
    // Vector fila: (x, y, z) · [[0, 1, 0], [−1, 0, 0], [0, 0, 1]] = (−y, x, z): gira 90° antihorario.
    const rotate90 = '0 1 0 -1 0 0 0 0 1 0 0 0';
    const model = modelXml(
      objectXml(1, cubeTriangles(10)) +
        `<object id="2" type="model"><components><component objectid="1" transform="${rotate90}"/></components></object>`,
      `<item objectid="2" transform="2 0 0 0 2 0 0 0 2 100 0 0"/>`,
    );
    const { mesh } = await analyzeModel(await zipWithModel(model));
    const { min, max } = bounds(mesh.positions);
    // Cubo [0,10]³ → girado: x ∈ [−10, 0], y ∈ [0, 10] → ×2 → x ∈ [−20, 0], y ∈ [0, 20] → +100 en X.
    expect(min).toEqual([80, 0, 0]);
    expect(max).toEqual([100, 20, 20]);
  });
});
