// Casos de la revisión cruzada de 0.8.0: caminos que se saltaban los límites o corrompían la malla en silencio.
import { describe, expect, it } from 'vitest';
import { ModelParseError } from '../src/stl/errors';
import { MAX_LINE_CHARS, parseObj } from '../src/stl/obj';
import { parse3mf } from '../src/stl/threemf';
import { encode } from './helpers/mesh';
import { buildZip, modelXml, RELS } from './helpers/zip';

async function codeOf(run: () => unknown): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ModelParseError) return error.code;
    throw error;
  }
  throw new Error('no se lanzó ningún ModelParseError');
}

const threeMf = (model: string): Promise<Uint8Array> =>
  buildZip([
    { name: '_rels/.rels', data: RELS },
    { name: '3D/3dmodel.model', data: model },
  ]);

const object = (triangle: string): string =>
  `<object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles>${triangle}</triangles></mesh></object>`;

describe('3MF: índices de vértice que no caben en un Int32Array', () => {
  it.each(['2147483648', '4294967296'])('el índice %s se rechaza (antes se truncaba a otro vértice)', async (index) => {
    const model = modelXml(object(`<triangle v1="0" v2="1" v3="${index}"/>`), '<item objectid="1"/>');
    expect(await codeOf(async () => parse3mf(await threeMf(model)))).toBe('err.3mf.badIndex');
  });

  it('el mayor índice que cabe sigue llegando a la comprobación de rango', async () => {
    const model = modelXml(object('<triangle v1="0" v2="1" v3="2147483647"/>'), '<item objectid="1"/>');
    expect(await codeOf(async () => parse3mf(await threeMf(model)))).toBe('err.3mf.vertexRange');
  });
});

describe('OBJ: líneas encadenadas con «\\»', () => {
  it('muchas líneas cortas unidas con «\\» que pasan de 4 MB se rechazan', () => {
    const piece = '1 1 1 1 1 1 1 1 1 1 \\\n';
    const lines = Math.ceil(MAX_LINE_CHARS / (piece.length - 2)) + 4;
    const text = `v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3 \\\n${piece.repeat(lines)}1\n`;
    expect(() => parseObj(encode(text))).toThrow(ModelParseError);
    try {
      parseObj(encode(text));
    } catch (error) {
      expect((error as ModelParseError).code).toBe('err.obj.lineTooLong');
    }
  });

  it('una cara corta partida con «\\» se sigue leyendo', () => {
    const mesh = parseObj(encode('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 \\\n 2 \\\n 3\n'));
    expect(mesh.triangleCount).toBe(1);
  });
});
