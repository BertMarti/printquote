import { describe, expect, it } from 'vitest';
import { analyzeModel } from '../src/stl/analyze';
import { detectKind, parseModel } from '../src/stl/model';
import { composeMatrix, IDENTITY, parseTransform, type Matrix } from '../src/stl/threemf';
import { readZipDirectory, readZipEntry } from '../src/stl/zip';
import { binaryStl, cubeTriangles, encode } from './helpers/mesh';
import { buildZip, cube3mf, modelXml, objectXml, RELS } from './helpers/zip';

describe('ZIP', () => {
  it('lee el directorio central y descomprime con deflate y sin comprimir', async () => {
    const zip = await buildZip([
      { name: 'a.txt', data: 'hola'.repeat(100) },
      { name: 'carpeta/b.txt', data: 'sin comprimir', method: 0 },
    ]);
    const entries = readZipDirectory(zip);
    expect(Array.from(entries.keys())).toEqual(['a.txt', 'carpeta/b.txt']);
    const a = entries.get('a.txt');
    const b = entries.get('carpeta/b.txt');
    if (!a || !b) throw new Error('faltan entradas');
    expect(a.method).toBe(8);
    expect(b.method).toBe(0);
    expect(new TextDecoder().decode(await readZipEntry(zip, a))).toBe('hola'.repeat(100));
    expect(new TextDecoder().decode(await readZipEntry(zip, b))).toBe('sin comprimir');
  });

  it('si falta el directorio central, recorre las cabeceras locales', async () => {
    const { mesh } = await analyzeModel(
      await buildZip(
        [
          { name: '_rels/.rels', data: RELS },
          { name: '3D/3dmodel.model', data: modelXml(objectXml(1, cubeTriangles(20)), '<item objectid="1"/>') },
        ],
        { noDirectory: true },
      ),
    );
    expect(mesh.triangleCount).toBe(12);
  });

  it('entrada demasiado grande: se rechaza por la cabecera y, si esta miente, al descomprimir', async () => {
    const zip = await buildZip([{ name: 'a.txt', data: 'x'.repeat(1000) }]);
    const entry = readZipDirectory(zip).get('a.txt');
    if (!entry) throw new Error('falta la entrada');
    await expect(readZipEntry(zip, entry, 100)).rejects.toThrow(/demasiado grande/);
    await expect(readZipEntry(zip, { ...entry, size: 10 }, 100)).rejects.toThrow(/supera los/);
  });
});

describe('matrices 3MF', () => {
  it('parseTransform lee 12 números y acepta vacío', () => {
    expect(parseTransform(undefined)).toEqual(IDENTITY);
    expect(parseTransform('  ')).toEqual(IDENTITY);
    expect(parseTransform('1 0 0 0 1 0 0 0 1 5 6 7')[9]).toBe(5);
  });

  it('composeMatrix aplica primero la primera: escala ×2 y luego mover +10 en X', () => {
    const scale2: Matrix = [2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0];
    const move: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1, 10, 0, 0];
    expect(composeMatrix(scale2, move)).toEqual([2, 0, 0, 0, 2, 0, 0, 0, 2, 10, 0, 0]);
    expect(composeMatrix(move, scale2)).toEqual([2, 0, 0, 0, 2, 0, 0, 0, 2, 20, 0, 0]);
  });
});

describe('detección de formato', () => {
  it('el contenido manda: un ZIP es 3MF aunque se llame .stl', async () => {
    const zip = await cube3mf();
    expect(detectKind(zip, 'engañoso.stl')).toBe('3mf');
    expect((await parseModel(zip, 'engañoso.stl')).format).toBe('3mf');
  });

  it('OBJ por extensión o por contenido; STL por defecto', () => {
    expect(detectKind(encode('v 0 0 0'), 'a.obj')).toBe('obj');
    expect(detectKind(encode('# cubo\nv 0 0 0\nv 1 0 0\n'))).toBe('obj');
    expect(detectKind(encode('solid x\n facet normal 0 0 0\n'))).toBe('stl');
    expect(detectKind(new Uint8Array(binaryStl(cubeTriangles(10))))).toBe('stl');
    expect(detectKind(encode('lo que sea'), 'a.stl')).toBe('stl');
  });

  it('una extensión .3mf que no es un ZIP da un error claro', async () => {
    await expect(parseModel(encode('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'), 'a.3mf')).rejects.toThrow(/no es un 3MF válido/);
  });

  it('los STL siguen leyéndose igual por el mismo camino', async () => {
    const { mesh, stats } = await analyzeModel(binaryStl(cubeTriangles(20)), 'cubo.stl');
    expect(mesh.format).toBe('binary');
    expect(stats.volume).toBeCloseTo(8000, 6);
  });
});
