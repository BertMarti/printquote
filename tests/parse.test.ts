import { describe, expect, it } from 'vitest';
import { parseStl, StlParseError } from '../src/stl/parse';
import { asciiStl, binaryStl, cubeTriangles, encode } from './helpers/mesh';

describe('parseStl · binario', () => {
  it('lee un cubo binario con 12 triángulos y sus coordenadas', () => {
    const mesh = parseStl(binaryStl(cubeTriangles(20)));
    expect(mesh.format).toBe('binary');
    expect(mesh.triangleCount).toBe(12);
    expect(mesh.positions).toHaveLength(12 * 9);
    expect(Array.from(mesh.positions.subarray(0, 9))).toEqual([0, 0, 0, 0, 20, 0, 20, 20, 0]);
  });

  it('no se deja engañar por una cabecera binaria que empieza por «solid»', () => {
    const mesh = parseStl(binaryStl(cubeTriangles(20), 'solid exportado por un CAD cualquiera'));
    expect(mesh.format).toBe('binary');
    expect(mesh.triangleCount).toBe(12);
  });

  it('acepta un Uint8Array con desplazamiento dentro de un buffer mayor', () => {
    const stl = new Uint8Array(binaryStl(cubeTriangles(20)));
    const big = new Uint8Array(stl.length + 16);
    big.set(stl, 16);
    expect(parseStl(big.subarray(16)).triangleCount).toBe(12);
  });

  it('tolera bytes de relleno al final del archivo', () => {
    const stl = new Uint8Array(binaryStl(cubeTriangles(20)));
    const padded = new Uint8Array(stl.length + 7);
    padded.set(stl);
    expect(parseStl(padded).triangleCount).toBe(12);
  });

  it('rechaza un binario truncado', () => {
    const stl = binaryStl(cubeTriangles(20)).slice(0, 84 + 50 * 5 + 10);
    expect(() => parseStl(stl)).toThrow(StlParseError);
  });

  it('rechaza un binario sin triángulos', () => {
    expect(() => parseStl(binaryStl([]))).toThrow(/ningún triángulo/);
  });

  it('rechaza coordenadas NaN o infinitas', () => {
    const buffer = binaryStl(cubeTriangles(20));
    new DataView(buffer).setFloat32(84 + 12, Number.NaN, true);
    expect(() => parseStl(buffer)).toThrow(/coordenadas no válidas/);
  });
});

describe('parseStl · ASCII', () => {
  it('lee un cubo ASCII', () => {
    const mesh = parseStl(encode(asciiStl(cubeTriangles(20))));
    expect(mesh.format).toBe('ascii');
    expect(mesh.triangleCount).toBe(12);
    expect(Array.from(mesh.positions)).toEqual(cubeTriangles(20).flat());
  });

  it('admite CRLF, mayúsculas, espacios iniciales y notación científica', () => {
    const text = [
      '   SOLID pieza',
      'FACET NORMAL 0 0 1',
      'OUTER LOOP',
      '\tVERTEX 0 0 0',
      '\tVERTEX 1.5e1 0 0',
      '\tVERTEX 0 -2.0E+1 0',
      'ENDLOOP',
      'ENDFACET',
      'ENDSOLID pieza',
    ].join('\r\n');
    const mesh = parseStl(encode(text));
    expect(mesh.format).toBe('ascii');
    expect(Array.from(mesh.positions)).toEqual([0, 0, 0, 15, 0, 0, 0, -20, 0]);
  });

  it('lee archivos ASCII de más de 84 bytes aunque el «recuento» leído como binario no cuadre', () => {
    // Un ASCII grande se reconoce por su contenido, no por su tamaño.
    const mesh = parseStl(encode(asciiStl(cubeTriangles(5), 'x'.repeat(200))));
    expect(mesh.format).toBe('ascii');
    expect(mesh.triangleCount).toBe(12);
  });

  it('lee archivos ASCII diminutos (menos de 84 bytes)', () => {
    const text = 'solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid';
    expect(parseStl(encode(text)).triangleCount).toBe(1);
  });

  it('rechaza una cara con dos vértices', () => {
    const text = 'solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nendloop\nendfacet\nendsolid t\n';
    expect(() => parseStl(encode(text))).toThrow(/exactamente 3 vértices/);
  });

  it('rechaza un vértice con coordenadas que no son números', () => {
    const text = asciiStl(cubeTriangles(20)).replace('vertex 0 0 0', 'vertex 0 abc 0');
    expect(() => parseStl(encode(text))).toThrow(/coordenadas no válidas/);
  });

  it('rechaza un ASCII cortado a mitad de cara', () => {
    const full = asciiStl(cubeTriangles(20));
    const cut = full.slice(0, full.indexOf('endloop', 400));
    expect(() => parseStl(encode(cut))).toThrow(/cortado/);
  });

  it('rechaza un «solid» sin caras', () => {
    expect(() => parseStl(encode('solid vacio\nendsolid vacio\n'))).toThrow(/ningún triángulo/);
  });
});

describe('parseStl · archivos no válidos', () => {
  it('rechaza un archivo vacío', () => {
    expect(() => parseStl(new ArrayBuffer(0))).toThrow(/vacío/);
  });

  it('rechaza texto que no es STL', () => {
    expect(() => parseStl(encode('Hola, esto es una lista de la compra.\n'))).toThrow(StlParseError);
  });

  it('rechaza datos binarios aleatorios', () => {
    const bytes = new Uint8Array(1000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 97 + 13) % 256;
    expect(() => parseStl(bytes)).toThrow(StlParseError);
  });
});
