/** Utilidades para construir mallas y archivos STL de prueba en memoria. */

export type Triangle = readonly [number, number, number, number, number, number, number, number, number];

type Point = readonly [number, number, number];

function quad(a: Point, b: Point, c: Point, d: Point): Triangle[] {
  return [
    [...a, ...b, ...c],
    [...a, ...c, ...d],
  ];
}

/** Cubo de lado `size` con la esquina mínima en `origin` y normales hacia fuera. */
export function cubeTriangles(size = 20, origin: Point = [0, 0, 0]): Triangle[] {
  const [ox, oy, oz] = origin;
  const p = (x: number, y: number, z: number): Point => [ox + x * size, oy + y * size, oz + z * size];
  return [
    ...quad(p(0, 0, 0), p(0, 1, 0), p(1, 1, 0), p(1, 0, 0)), // abajo  (−Z)
    ...quad(p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)), // arriba (+Z)
    ...quad(p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1)), // frente (−Y)
    ...quad(p(0, 1, 0), p(0, 1, 1), p(1, 1, 1), p(1, 1, 0)), // fondo  (+Y)
    ...quad(p(0, 0, 0), p(0, 0, 1), p(0, 1, 1), p(0, 1, 0)), // izq.   (−X)
    ...quad(p(1, 0, 0), p(1, 1, 0), p(1, 1, 1), p(1, 0, 1)), // der.   (+X)
  ];
}

/** Invierte el orden de los vértices (normales hacia dentro). */
export function flipWinding(triangles: Triangle[]): Triangle[] {
  return triangles.map((t) => [t[0], t[1], t[2], t[6], t[7], t[8], t[3], t[4], t[5]] as const);
}

export function toPositions(triangles: Triangle[]): Float32Array {
  return Float32Array.from(triangles.flat());
}

/** STL binario: cabecera de 80 bytes, uint32 con el nº de triángulos y 50 bytes por triángulo. */
export function binaryStl(triangles: Triangle[], header = 'printquote test'): ArrayBuffer {
  const buffer = new ArrayBuffer(84 + triangles.length * 50);
  const view = new DataView(buffer);
  const headerBytes = new TextEncoder().encode(header).subarray(0, 80);
  new Uint8Array(buffer).set(headerBytes, 0);
  view.setUint32(80, triangles.length, true);
  triangles.forEach((t, i) => {
    const base = 84 + i * 50;
    // normal (0,0,0): los lectores deben recalcularla
    t.forEach((value, k) => view.setFloat32(base + 12 + k * 4, value, true));
  });
  return buffer;
}

/** STL ASCII. */
export function asciiStl(triangles: Triangle[], name = 'test', newline = '\n'): string {
  const lines = [`solid ${name}`];
  for (const t of triangles) {
    lines.push('  facet normal 0 0 0', '    outer loop');
    for (let k = 0; k < 9; k += 3) {
      lines.push(`      vertex ${t[k]} ${t[k + 1]} ${t[k + 2]}`);
    }
    lines.push('    endloop', '  endfacet');
  }
  lines.push(`endsolid ${name}`);
  return lines.join(newline) + newline;
}

export function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** OBJ de un prisma regular de `sides` lados (radio 10, alto 10) con las dos bases como un único polígono cada una. */
export function discObj(sides: number): string {
  const lines: string[] = [];
  for (const z of [0, 10]) {
    for (let i = 0; i < sides; i++) {
      const angle = (2 * Math.PI * i) / sides;
      lines.push(`v ${(10 * Math.cos(angle)).toFixed(5)} ${(10 * Math.sin(angle)).toFixed(5)} ${z}`);
    }
  }
  const ring = (offset: number): number[] => Array.from({ length: sides }, (_, i) => offset + i + 1);
  lines.push(`f ${ring(0).reverse().join(' ')}`); // base inferior, normal hacia abajo
  lines.push(`f ${ring(sides).join(' ')}`); // base superior
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    lines.push(`f ${i + 1} ${j + 1} ${sides + j + 1} ${sides + i + 1}`);
  }
  return lines.join('\n');
}
