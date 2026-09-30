import { describe, expect, it } from 'vitest';
import { analyzeModel } from '../src/stl/analyze';
import { computeStats, meshWarnings } from '../src/stl/geometry';
import { ModelParseError } from '../src/stl/errors';
import { parseObj } from '../src/stl/obj';
import { cubeTriangles, encode } from './helpers/mesh';

/** Cubo de lado 20 como OBJ con caras cuadradas y normales hacia fuera. */
const CUBE_QUADS = `# cubo de 20 mm
o cubo
v 0 0 0
v 20 0 0
v 20 20 0
v 0 20 0
v 0 0 20
v 20 0 20
v 20 20 20
v 0 20 20
f 1 4 3 2
f 5 6 7 8
f 1 2 6 5
f 2 3 7 6
f 3 4 8 7
f 4 1 5 8
`;

describe('parseObj', () => {
  it('lee vértices y caras de tres vértices', () => {
    const mesh = parseObj(encode('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'));
    expect(mesh.format).toBe('obj');
    expect(mesh.triangleCount).toBe(1);
    expect(Array.from(mesh.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });

  it('tria las caras de más de tres vértices en abanico', () => {
    const mesh = parseObj(encode(CUBE_QUADS));
    expect(mesh.triangleCount).toBe(12); // 6 cuadrados → 12 triángulos
    const pentagon = parseObj(encode('v 0 0 0\nv 2 0 0\nv 3 1 0\nv 1 2 0\nv -1 1 0\nf 1 2 3 4 5\n'));
    expect(pentagon.triangleCount).toBe(3);
  });

  it('un cubo en OBJ da la misma geometría y ningún aviso, como en STL', async () => {
    const { mesh, stats } = await analyzeModel(encode(CUBE_QUADS), 'cubo.obj');
    expect(mesh.format).toBe('obj');
    expect(stats.volume).toBeCloseTo(8000, 6);
    expect(stats.surfaceArea).toBeCloseTo(2400, 6);
    expect(stats.openEdges).toBe(0);
    expect(meshWarnings(stats)).toEqual([]);
    const reference = computeStats({ positions: Float32Array.from(cubeTriangles(20).flat()), triangleCount: 12, format: 'binary' });
    expect(stats.volume).toBeCloseTo(reference.volume, 9);
  });

  it('un OBJ abierto o con normales invertidas da los mismos avisos que un STL', async () => {
    const reversed = CUBE_QUADS.split(String.fromCharCode(10))
      .map((line) => (line.startsWith('f ') ? `f ${line.slice(2).split(' ').reverse().join(' ')}` : line))
      .join(String.fromCharCode(10));
    const inverted = (await analyzeModel(encode(reversed), 'invertido.obj')).stats;
    expect(inverted.signedVolume).toBeLessThan(0);
    expect(meshWarnings(inverted)).toContain('inverted');
    const open = (await analyzeModel(encode(CUBE_QUADS.replace('f 4 1 5 8\n', '')), 'abierto.obj')).stats;
    expect(meshWarnings(open)).toContain('open-mesh');
  });

  it('acepta índices negativos (relativos al último vértice leído)', () => {
    const mesh = parseObj(encode('v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1\nv 5 5 5\nf -1 -2 -3\n'));
    expect(mesh.triangleCount).toBe(2);
    expect(Array.from(mesh.positions.slice(0, 9))).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(Array.from(mesh.positions.slice(9, 18))).toEqual([5, 5, 5, 0, 1, 0, 1, 0, 0]);
  });

  it('acepta las formas v/vt, v//vn y v/vt/vn, comentarios y líneas que no interesan', () => {
    const text = [
      'mtllib a.mtl', 'vt 0 0', 'vn 0 0 1', 'usemtl rojo', 's off', 'g grupo',
      'v 0 0 0 1 0 0   # con color', 'v 1 0 0', 'v 0 1 0 1.0', 'l 1 2', 'p 3',
      'f 1/1/1 2/1/1 3/1/1', 'f 1//1 2//1 3//1', 'f 1/1 2/1 3/1 # comentario',
    ].join('\r\n');
    expect(parseObj(encode(text)).triangleCount).toBe(3);
  });

  it('une las caras partidas con «\\» al final de la línea', () => {
    const mesh = parseObj(encode('v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 \\\n 3 4\n'));
    expect(mesh.triangleCount).toBe(2);
  });

  it('con varios objetos o grupos los junta en una sola malla', async () => {
    const two = `${CUBE_QUADS}o otro\n` + [...Array(8).keys()].map((i) => `v ${(i & 1) * 20 + 100} ${((i >> 1) & 1) * 20} ${((i >> 2) & 1) * 20}`).join('\n') + '\nf 9 10 12 11\nf 13 15 16 14\nf 9 13 14 10\nf 11 12 16 15\nf 9 11 15 13\nf 10 14 16 12\n';
    const { stats } = await analyzeModel(encode(two), 'dos.obj');
    expect(stats.triangleCount).toBe(24);
  });

  it('ignora números con exponente y acepta coordenadas grandes o negativas', () => {
    const mesh = parseObj(encode('v -1e2 2.5E1 .5\nv 1 -0.5 +3\nv 0 0 0\nf 1 2 3\n'));
    expect(Array.from(mesh.positions.slice(0, 3))).toEqual([-100, 25, 0.5]);
  });

  describe('errores en español', () => {
    const bad: ReadonlyArray<readonly [string, string, RegExp]> = [
      ['vacío', '', /vacío/],
      ['sin vértices', 'f 1 2 3\n', /no contiene vértices/],
      ['sin caras', 'v 0 0 0\nv 1 0 0\nv 0 1 0\n', /no contiene caras/],
      ['vértice incompleto', 'v 0 0\n', /Línea 1.*tres coordenadas/],
      ['coordenada no numérica', 'v 0 0 abc\n', /Línea 1.*«abc»/],
      ['coordenada fuera de rango', 'v 0 0 1e39\n', /coordenada válida/],
      ['NaN o infinito', 'v 0 0 nan\nv 0 0 inf\n', /coordenada válida/],
      ['cara con menos de 3 vértices', 'v 0 0 0\nv 1 0 0\nf 1 2\n', /Línea 3.*al menos 3/],
      ['índice cero', 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 0 1 2\n', /empiezan en 1/],
      ['índice negativo hacia atrás de más', 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf -4 -2 -1\n', /antes del primer vértice/],
      ['índice inexistente', 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 9\n', /vértice 9.*solo tiene 3/],
      ['índice no numérico', 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 x\n', /Línea 4.*«x»/],
      ['binario', 'v 0 0 0\u0000\u0001\u0002', /binario/],
    ];
    it.each(bad)('%s', (_name, text, message) => {
      expect(() => parseObj(encode(text))).toThrow(ModelParseError);
      expect(() => parseObj(encode(text))).toThrow(message);
    });
  });
});
