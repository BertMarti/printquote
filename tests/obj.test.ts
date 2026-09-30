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

/** Prisma de altura `h` cuya base es el polígono `outline` (antihorario en XY), con las bases como UNA cara cada una. */
function prismObj(outline: ReadonlyArray<readonly [number, number]>, h: number, rotate = 0): string {
  const n = outline.length;
  const lines = [...outline.map(([x, y]) => `v ${x} ${y} 0`), ...outline.map(([x, y]) => `v ${x} ${y} ${h}`)];
  const ids = [...Array(n).keys()].map((i) => i + 1);
  const start = ids.map((_, i) => ids[(i + rotate) % n]);
  lines.push(`f ${[...start].reverse().join(' ')}`); // base (hacia −Z)
  lines.push(`f ${start.map((i) => i + n).join(' ')}`); // tapa (hacia +Z)
  for (let i = 1; i <= n; i++) lines.push(`f ${i} ${(i % n) + 1} ${(i % n) + 1 + n} ${i + n}`);
  return lines.join('\n') + '\n';
}

const U_SHAPE: ReadonlyArray<readonly [number, number]> = [[0, 0], [3, 0], [3, 2], [2, 2], [2, 1], [1, 1], [1, 2], [0, 2]]; // área 5

describe('OBJ con caras cóncavas', () => {
  it.each([0, 1, 3, 5, 7])('una base en «U» (empezando por el vértice %i) da el volumen exacto y una malla cerrada', async (rotate) => {
    const { stats } = await analyzeModel(encode(prismObj(U_SHAPE, 2, rotate)), 'u.obj');
    expect(stats.volume).toBeCloseTo(10, 6);
    expect(stats.surfaceArea).toBeCloseTo(34, 6); // 2 × 5 (bases) + 12 (perímetro) × 2 (altura); un abanico mal puesto la infla
    expect(stats.openEdges).toBe(0);
    expect(meshWarnings(stats)).toEqual([]);
    expect(parseObj(encode(prismObj(U_SHAPE, 2, rotate))).triangleCount).toBe(6 + 6 + 8 * 2); // U: n−2 triángulos por base
  });

  it('un polígono cóncavo en cualquier plano y con la orientación contraria también se trocea bien', async () => {
    const clockwise = [...U_SHAPE].reverse(); // un OBJ con las caras al revés: normales invertidas, pero mismo volumen
    const { stats } = await analyzeModel(encode(prismObj(clockwise, 2)), 'u.obj');
    expect(stats.volume).toBeCloseTo(10, 6);
    // Cara vertical (plano XZ): la misma U de canto
    const vertical = U_SHAPE.map(([x, y]) => `v ${x} 0 ${y}`).join('\n') + '\nf 1 2 3 4 5 6 7 8\n';
    const area = (() => {
      const mesh = parseObj(encode(vertical));
      let sum = 0;
      for (let t = 0; t < mesh.triangleCount; t++) {
        const p = mesh.positions.subarray(t * 9, t * 9 + 9);
        sum += Math.abs((p[3]! - p[0]!) * (p[8]! - p[2]!) - (p[5]! - p[2]!) * (p[6]! - p[0]!)) / 2;
      }
      return sum;
    })();
    expect(area).toBeCloseTo(5, 6);
  });

  it('un polígono degenerado o que se cruza no cuelga ni pierde caras', () => {
    const collinear = parseObj(encode('v 0 0 0\nv 1 0 0\nv 2 0 0\nv 3 0 0\nf 1 2 3 4\n'));
    expect(collinear.triangleCount).toBe(2);
    const bowtie = parseObj(encode('v 0 0 0\nv 2 2 0\nv 2 0 0\nv 0 2 0\nf 1 2 3 4\n'));
    expect(bowtie.triangleCount).toBe(2);
    const forward = parseObj(encode('f 1 2 3 4\nv 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\n'));
    expect(forward.triangleCount).toBe(2);
  });
});

describe('OBJ: índices enormes', () => {
  it('un índice que no cabe en 32 bits es un error, no un vértice cualquiera', () => {
    const text = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 4294967297\n'; // 2^32 + 1 se cortaría al vértice 2
    expect(() => parseObj(encode(text))).toThrow(/vértice 4294967297/);
  });
});

describe('OBJ: formas raras que no deben romper la lectura', () => {
  it('BOM, continuación al final del archivo, solo espacios y solo comentarios', () => {
    const text = '﻿v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3 \\';
    expect(parseObj(encode(text)).triangleCount).toBe(1);
    expect(() => parseObj(encode('   \n\t\n'))).toThrow(/no contiene vértices/);
    expect(() => parseObj(encode('# solo un comentario\n'))).toThrow(/no contiene vértices/);
  });
});
