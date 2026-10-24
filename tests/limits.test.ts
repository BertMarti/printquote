import { describe, expect, it, vi } from 'vitest';
import { analyzeModel } from '../src/stl/analyze';
import { ModelParseError } from '../src/stl/errors';
import { asciiStl, binaryStl, cubeTriangles, discObj, encode } from './helpers/mesh';
import { buildZip, modelXml, objectXml, RELS } from './helpers/zip';

/**
 * Los límites reales (300 MB y 6 300 000 triángulos) no se pueden agotar en un test, así
 * que aquí se sustituyen por valores diminutos: los topes se prueban con archivos de pocos bytes.
 * El mock afecta solo a este archivo (cada test de Vitest aísla sus módulos); por eso vive en su
 * propio archivo y los demás tests siguen usando los límites de verdad.
 */
vi.mock('../src/stl/limits', () => ({
  MAX_FILE_BYTES: 4096,
  MAX_TRIANGLES: 20,
  MAX_TRIANGLES_TEXT: '20',
}));

/** Dos cubos: 24 triángulos, más de los 20 que permite el mock. */
const TWO_CUBES = [...cubeTriangles(20), ...cubeTriangles(20, [50, 0, 0])];

/** Cubo de 20 mm como OBJ: 6 cuadrados → 12 triángulos, menos de los 20 del mock. */
const CUBE_OBJ = `# cubo de 20 mm
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

const TOO_MANY = { code: 'err.tooManyTriangles', params: { max: '20' } };

describe('tope de triángulos (mock: MAX_TRIANGLES = 20)', () => {
  it('un STL binario de 24 triángulos se rechaza y uno de 12 se lee entero', async () => {
    await expect(analyzeModel(binaryStl(TWO_CUBES), 'dos.stl')).rejects.toMatchObject(TOO_MANY);
    await expect(analyzeModel(binaryStl(TWO_CUBES), 'dos.stl')).rejects.toBeInstanceOf(ModelParseError);

    const { mesh, stats } = await analyzeModel(binaryStl(cubeTriangles(20)), 'cubo.stl');
    expect(mesh.triangleCount).toBe(12);
    expect(stats.volume).toBeCloseTo(8000, 3);
  });

  it('el tope del STL binario es exacto: 21 triángulos fallan y 20 pasan', async () => {
    await expect(analyzeModel(binaryStl(TWO_CUBES.slice(0, 21)), '21.stl')).rejects.toMatchObject(TOO_MANY);
    const { mesh } = await analyzeModel(binaryStl(TWO_CUBES.slice(0, 20)), '20.stl');
    expect(mesh.triangleCount).toBe(20);
  });

  it('un STL ASCII de más de 20 facetas se rechaza en cuanto aparece la 21', async () => {
    await expect(analyzeModel(encode(asciiStl(TWO_CUBES.slice(0, 21))), '21.stl')).rejects.toMatchObject(TOO_MANY);
    const { mesh } = await analyzeModel(encode(asciiStl(TWO_CUBES.slice(0, 20))), '20.stl');
    expect(mesh.triangleCount).toBe(20);
  });

  it('una cara de 30 vértices en OBJ son 28 triángulos: se corta antes de reservarlos', async () => {
    await expect(analyzeModel(encode(discObj(30)), 'disco.obj')).rejects.toMatchObject(TOO_MANY);

    const { mesh, stats } = await analyzeModel(encode(CUBE_OBJ), 'cubo.obj');
    expect(mesh.triangleCount).toBe(12);
    expect(stats.volume).toBeCloseTo(8000, 3);
    expect(stats.openEdges).toBe(0);
  });
});

describe('tope de tamaño de archivo (mock: MAX_FILE_BYTES = 4096)', () => {
  it('analyzeModel rechaza un Uint8Array de 5000 bytes con err.fileTooBig', async () => {
    await expect(analyzeModel(new Uint8Array(5000), 'grande.stl')).rejects.toBeInstanceOf(ModelParseError);
    await expect(analyzeModel(new Uint8Array(5000), 'grande.stl')).rejects.toMatchObject({
      code: 'err.fileTooBig',
      params: { mb: 4096 / 1024 / 1024 },
    });
  });

  it('justo en el límite el archivo pasa el control y el fallo viene de la lectura', async () => {
    await expect(analyzeModel(new Uint8Array(4096), 'casi.stl')).rejects.toMatchObject({ code: 'err.stl.size' });
    await expect(analyzeModel(new Uint8Array(4097), 'grande.stl')).rejects.toMatchObject({ code: 'err.fileTooBig' });
  });
});

describe('tope de triángulos del 3MF (mock: MAX_TRIANGLES = 20)', () => {
  const threeMf = (triangles: number): Promise<Uint8Array> =>
    buildZip([
      { name: '_rels/.rels', data: RELS },
      { name: '3D/3dmodel.model', data: modelXml(objectXml(1, TWO_CUBES.slice(0, triangles)), '<item objectid="1"/>') },
    ]);

  it('un .model de 21 triángulos se rechaza al leerlo', async () => {
    await expect(analyzeModel(await threeMf(21), '21.3mf')).rejects.toMatchObject({
      code: 'err.3mf.tooManyTriangles',
      params: { max: '20' },
    });
  });

  it('uno de 20 triángulos se abre entero', async () => {
    const { mesh } = await analyzeModel(await threeMf(20), '20.3mf');
    expect(mesh.triangleCount).toBe(20);
    expect(mesh.format).toBe('3mf');
  });
});
