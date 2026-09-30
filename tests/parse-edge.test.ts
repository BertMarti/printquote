import { describe, expect, it } from 'vitest';
import { parseStl, StlParseError } from '../src/stl/parse';
import { asciiStl, binaryStl, cubeTriangles, encode } from './helpers/mesh';

/** Una cara ASCII con los vértices dados como texto tal cual. */
function facet(v1: string, v2: string, v3: string): string {
  return `facet normal 0 0 1\nouter loop\nvertex ${v1}\nvertex ${v2}\nvertex ${v3}\nendloop\nendfacet\n`;
}

describe('parseStl · ASCII con casos límite', () => {
  it('ignora la marca BOM de UTF-8 al principio', () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    const body = encode(asciiStl(cubeTriangles(10)));
    const bytes = new Uint8Array(bom.length + body.length);
    bytes.set(bom);
    bytes.set(body, bom.length);
    const mesh = parseStl(bytes);
    expect(mesh.format).toBe('ascii');
    expect(mesh.triangleCount).toBe(12);
  });

  it('el nombre del sólido puede contener palabras clave («solid facet vertex»)', () => {
    const mesh = parseStl(encode(asciiStl(cubeTriangles(10), 'facet vertex endfacet')));
    expect(mesh.format).toBe('ascii');
    expect(mesh.triangleCount).toBe(12);
  });

  it('lee varios sólidos seguidos en el mismo archivo', () => {
    const text = asciiStl(cubeTriangles(10), 'a') + asciiStl(cubeTriangles(10, [20, 0, 0]), 'b');
    expect(parseStl(encode(text)).triangleCount).toBe(24);
  });

  it('admite tabuladores, espacios repetidos, CR solo (Mac antiguo), CRLF y LF mezclados y sin salto final', () => {
    const text =
      'solid  raro\r' +
      '\t facet\tnormal 0 0 1\r\n' +
      'outer   loop\n' +
      '  vertex\t0\t0\t0   \r' +
      'vertex 1 0 0\r\n' +
      '\t\tvertex 0   1 0\n' +
      'endloop\r\nendfacet\rendsolid raro';
    const mesh = parseStl(encode(text));
    expect(Array.from(mesh.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });

  it('admite un archivo entero en una sola línea', () => {
    const text = 'solid x facet normal 0 0 1 outer loop vertex 0 0 0 vertex 1 0 0 vertex 0 1 0 endloop endfacet endsolid x';
    expect(parseStl(encode(text)).triangleCount).toBe(1);
  });

  it('lee todas las variantes de notación científica y signos', () => {
    const text = `solid n\n${facet('1E-3 -.5 +2', '5. 1e+02 -0', '2.5E1 1.0e-0 0.000')}endsolid n\n`;
    const mesh = parseStl(encode(text));
    expect(Array.from(mesh.positions)).toEqual([
      Math.fround(1e-3), -0.5, 2, 5, 100, -0, 25, 1, 0,
    ]);
  });

  it.each(['NaN', 'nan', 'inf', '-Infinity', '1.#QNAN', '0x10', '1,5'])('rechaza la coordenada «%s»', (bad) => {
    const text = `solid n\n${facet(`0 ${bad} 0`, '1 0 0', '0 1 0')}endsolid n\n`;
    expect(() => parseStl(encode(text))).toThrow(/coordenadas no válidas/);
  });

  it('rechaza coordenadas que no caben en un float de 32 bits (1e39)', () => {
    const text = `solid n\n${facet('0 0 0', '1e39 0 0', '0 1 0')}endsolid n\n`;
    expect(() => parseStl(encode(text))).toThrow(/coordenadas no válidas/);
  });

  it('rechaza un vértice fuera de una cara', () => {
    expect(() => parseStl(encode('solid n\nvertex 0 0 0\nendsolid n\n'))).toThrow(/fuera de una cara/);
  });

  it('rechaza una cara sin cerrar antes de la siguiente', () => {
    const text = 'solid n\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\n' + facet('0 0 0', '1 0 0', '0 1 0');
    expect(() => parseStl(encode(text))).toThrow(/no se cierra/);
  });

  it('un ASCII grande (50 000 caras) se lee sin problemas', () => {
    const triangles = Array.from({ length: 50_000 }, (_, i) => [i, 0, 0, i + 1, 0, 0, i, 1, 0.5] as const);
    const mesh = parseStl(encode(asciiStl(triangles)));
    expect(mesh.triangleCount).toBe(50_000);
    expect(mesh.positions[mesh.positions.length - 1]).toBe(0.5);
  });
});

describe('parseStl · binario con casos límite', () => {
  it('cabecera «solid … facet normal» con el tamaño exacto: sigue siendo binario', () => {
    const mesh = parseStl(binaryStl(cubeTriangles(20), 'solid facet normal vertex endfacet endsolid'));
    expect(mesh.format).toBe('binary');
    expect(mesh.triangleCount).toBe(12);
  });

  it('recuento de triángulos a 0 en la cabecera (exportadores defectuosos): se deduce del tamaño', () => {
    const buffer = binaryStl(cubeTriangles(20));
    new DataView(buffer).setUint32(80, 0, true);
    const mesh = parseStl(buffer);
    expect(mesh.format).toBe('binary');
    expect(mesh.triangleCount).toBe(12);
  });

  it('rechaza coordenadas infinitas', () => {
    const buffer = binaryStl(cubeTriangles(20));
    new DataView(buffer).setFloat32(84 + 50 * 3 + 12 + 8, Number.POSITIVE_INFINITY, true);
    expect(() => parseStl(buffer)).toThrow(/triángulo 4 tiene coordenadas no válidas/);
  });

  it('un recuento absurdo (4 294 967 295) no intenta reservar memoria: error claro', () => {
    const buffer = binaryStl(cubeTriangles(20));
    new DataView(buffer).setUint32(80, 0xffffffff, true);
    expect(() => parseStl(buffer)).toThrow(StlParseError);
  });
});
