import { describe, expect, it } from 'vitest';
import { analyzeModel } from '../src/stl/analyze';
import { computeStats } from '../src/stl/geometry';
import { parseObj } from '../src/stl/obj';
import { budgetFor, triangulate } from '../src/stl/triangulate';
import { encode } from './helpers/mesh';
import { legacyTriangulate } from './helpers/legacy-triangulate';
import { comb, keyhole, noisyStar, perimeter, prismObjText, seeded, shoelace, spiral, star } from './helpers/polygons';

type Point = readonly [number, number];
type Plane = 'xy' | 'xz' | 'yz';

/** Vértices en un Float32Array (como los guarda `parseObj`), en el plano pedido. */
function verticesOf(points: readonly Point[], plane: Plane = 'xy'): Float32Array {
  const out = new Float32Array(points.length * 3);
  points.forEach(([a, b], i) => {
    const [x, y, z] = plane === 'xy' ? [a, b, 0] : plane === 'xz' ? [a, 0, b] : [0, a, b];
    out.set([x, y, z], i * 3);
  });
  return out;
}

interface Result {
  readonly triangles: number[][];
  readonly exact: boolean;
  readonly ms: number;
}

function run(
  algorithm: 'new' | 'legacy',
  points: readonly Point[],
  options: { plane?: Plane; reverse?: boolean; steps?: number } = {},
): Result {
  const vertices = verticesOf(points, options.plane);
  const face = points.map((_, i) => i);
  if (options.reverse) face.reverse();
  const triangles: number[][] = [];
  const emit = (a: number, b: number, c: number): void => {
    triangles.push([a, b, c]);
  };
  const start = performance.now();
  const exact =
    algorithm === 'new'
      ? triangulate(face, vertices, points.length, emit, options.steps)
      : (legacyTriangulate(face, vertices, emit), true);
  return { triangles, exact, ms: performance.now() - start };
}

/** Área con signo de cada triángulo en el plano de la cara (en el sentido de `points`). */
function signedAreas(points: readonly Point[], triangles: readonly number[][]): number[] {
  return triangles.map(([a = 0, b = 0, c = 0]) => {
    const [ax, ay] = points[a] ?? [0, 0];
    const [bx, by] = points[b] ?? [0, 0];
    const [cx, cy] = points[c] ?? [0, 0];
    return ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2;
  });
}

const sum = (values: readonly number[]): number => values.reduce((acc, value) => acc + value, 0);
/** Área de verdad (sin signo): la que usa la superficie de la pieza. Si un triángulo sale al revés, la infla. */
const unsignedArea = (points: readonly Point[], result: Result): number => sum(signedAreas(points, result.triangles).map(Math.abs));

/**
 * Polígonos cóncavos grandes de formas distintas: engranaje, ruido, peine y espiral, con el tamaño al que se compara
 * con la 1.1 (que es O(n³): con la espiral de 2000 vértices tarda ~6 s en la Raspberry Pi, por eso esa va con 1000).
 */
const SHAPES: ReadonlyArray<readonly [string, (n: number) => Point[], number]> = [
  ['engranaje (estrella de radios alternos)', (n) => star(n), 2000],
  ['estrella con radios al azar', (n) => noisyStar(n, 7), 2000],
  ['peine de púas finas', (n) => comb(Math.floor((n - 2) / 4)), 2000],
  ['espiral gruesa', (n) => spiral(n), 1000],
];

describe('triangulación de polígonos cóncavos grandes (1.2)', () => {
  it.each(SHAPES)('%s (miles de vértices): n − 2 triángulos, ninguno al revés y la misma área que la 1.1', (_name, make, size) => {
    const points = make(size);
    const expected = shoelace(points);
    expect(expected).toBeGreaterThan(0);
    const fresh = run('new', points);
    const legacy = run('legacy', points);
    expect(fresh.exact).toBe(true);
    expect(fresh.triangles).toHaveLength(points.length - 2);
    expect(legacy.triangles).toHaveLength(points.length - 2);
    // Ningún triángulo al revés (que se solaparía con otro): la suma sin signo es la del polígono.
    expect(Math.min(...signedAreas(points, fresh.triangles))).toBeGreaterThanOrEqual(-1e-9);
    expect(unsignedArea(points, fresh)).toBeCloseTo(expected, 6);
    expect(unsignedArea(points, fresh)).toBeCloseTo(unsignedArea(points, legacy), 6);
    // Todos los vértices se usan: cada arista del borde sigue emparejada con la cara vecina.
    expect(new Set(fresh.triangles.flat()).size).toBe(points.length);
  });

  it.each(SHAPES)('%s como prisma: mismo volumen y superficie que la 1.1 y malla cerrada', async (_name, make, size) => {
    const points = make(size);
    const h = 7;
    const { stats } = await analyzeModel(encode(prismObjText(points, h)), 'prisma.obj');
    const area = shoelace(points);
    // La 1.1 con su recorte de orejas sin tope (hasta la 1.1 solo llegaba a 200 vértices; aquí, como referencia).
    const n = points.length;
    const vertices = new Float32Array(2 * n * 3);
    points.forEach(([x, y], i) => {
      vertices.set([x, y, 0], i * 3);
      vertices.set([x, y, h], (i + n) * 3);
    });
    const positions: number[] = [];
    const push = (a: number, b: number, c: number): void => {
      for (const v of [a, b, c]) positions.push(vertices[v * 3] ?? 0, vertices[v * 3 + 1] ?? 0, vertices[v * 3 + 2] ?? 0);
    };
    const ids = points.map((_, i) => i);
    legacyTriangulate([...ids].reverse(), vertices, push);
    legacyTriangulate(ids.map((i) => i + n), vertices, push);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      push(i, j, j + n);
      push(i, j + n, i + n);
    }
    const legacy = computeStats({ positions: Float32Array.from(positions), triangleCount: positions.length / 9, format: 'obj' });
    expect(stats.volume).toBeCloseTo(legacy.volume, 3);
    expect(stats.surfaceArea).toBeCloseTo(legacy.surfaceArea, 3);
    expect(stats.volume / (area * h)).toBeCloseTo(1, 5);
    expect(stats.surfaceArea / (2 * area + perimeter(points) * h)).toBeCloseTo(1, 5);
    expect(stats.openEdges).toBe(0);
  });

  it.each(SHAPES)('%s de 50 000 vértices: área exacta y en un tiempo razonable (tope holgado de 20 s)', (_name, make) => {
    const points = make(50_000);
    const fresh = run('new', points);
    expect(fresh.exact).toBe(true);
    expect(fresh.triangles).toHaveLength(points.length - 2);
    expect(unsignedArea(points, fresh) / shoelace(points)).toBeCloseTo(1, 9);
    // En la Raspberry Pi 5 tarda < 2 s; la 1.1 necesitaba ~6 s para 2000 vértices de la espiral y era O(n³).
    expect(fresh.ms).toBeLessThan(20_000);
  });

  it('la 1.2 es mucho más rápida que la 1.1 con un engranaje de 2000 dientes', () => {
    const points = star(4000);
    const legacy = run('legacy', points);
    const fresh = run('new', points);
    expect(unsignedArea(points, fresh)).toBeCloseTo(unsignedArea(points, legacy), 6);
    expect(fresh.ms).toBeLessThan(legacy.ms);
  });

  it('en otros planos y con el sentido contrario da la misma área', () => {
    const points = noisyStar(3000, 3);
    const expected = shoelace(points);
    for (const plane of ['xy', 'xz', 'yz'] as const) {
      for (const reverse of [false, true]) {
        const fresh = run('new', points, { plane, reverse });
        expect(fresh.triangles).toHaveLength(points.length - 2);
        expect(unsignedArea(points, fresh) / expected).toBeCloseTo(1, 9);
      }
    }
  });

  it('un polígono con agujero unido por un puente (vértices repetidos) da la misma área que la 1.1', () => {
    const points = keyhole();
    expect(shoelace(points)).toBe(1500);
    const fresh = run('new', points);
    expect(fresh.triangles).toHaveLength(points.length - 2);
    expect(unsignedArea(points, fresh)).toBeCloseTo(1500, 9);
    expect(unsignedArea(points, run('legacy', points))).toBeCloseTo(1500, 9);
    // Y el mismo agujero en un polígono grande (por encima del tope de la búsqueda sin rejilla).
    const big = [...keyhole(), ...star(200).map(([x, y]) => [x + 100, y + 20] as const)];
    expect(run('new', big).triangles).toHaveLength(big.length - 2);
  });

  it('un polígono que se cruza a sí mismo (puntos en orden al azar) termina y da n − 2 triángulos', () => {
    const random = seeded(11);
    const points = Array.from({ length: 3000 }, () => [random() * 100, random() * 100] as const);
    const fresh = run('new', points);
    expect(fresh.triangles).toHaveLength(points.length - 2);
    expect(fresh.ms).toBeLessThan(20_000);
  });

  it('si se agota el presupuesto de pasos, cierra en abanico, avisa y no pierde triángulos', () => {
    const points = noisyStar(5000, 5);
    const fresh = run('new', points, { steps: 1000 });
    expect(fresh.exact).toBe(false);
    expect(fresh.triangles).toHaveLength(points.length - 2);
    expect(budgetFor(points.length)).toBeGreaterThan(300 * points.length); // las caras simples de estas pruebas gastan < 175 por vértice
  });

  it('un OBJ con una cara cóncava de 20 000 vértices ya no avisa y su superficie es la correcta', async () => {
    const points = star(20_000);
    const { stats, mesh } = await analyzeModel(encode(prismObjText(points, 5)), 'engranaje.obj');
    expect(mesh.largePolygons).toBe(0);
    expect(stats.surfaceArea / (2 * shoelace(points) + perimeter(points) * 5)).toBeCloseTo(1, 5);
    expect(parseObj(encode(prismObjText(points, 5))).triangleCount).toBe(2 * (points.length - 2) + 2 * points.length);
  });

  it('una cara cóncava escrita antes que sus vértices (índices hacia delante) también se divide bien', async () => {
    const points = star(300);
    const lines = prismObjText(points, 5).trimEnd().split('\n');
    const faces = lines.filter((line) => line.startsWith('f '));
    const vertices = lines.filter((line) => line.startsWith('v '));
    const { stats, mesh } = await analyzeModel(encode(`${[...faces, ...vertices].join('\n')}\n`), 'al-reves.obj');
    expect(mesh.largePolygons).toBe(0);
    expect(stats.surfaceArea / (2 * shoelace(points) + perimeter(points) * 5)).toBeCloseTo(1, 5);
    expect(stats.volume / (shoelace(points) * 5)).toBeCloseTo(1, 5);
    expect(stats.openEdges).toBe(0);
  });

  it('con muchas caras antes que sus vértices, informa del progreso mientras las divide (y siempre hacia delante)', () => {
    const side = 200; // 200 × 200 = 40 000 caras de 4 vértices → 80 000 triángulos aplazados (> 65 536)
    const faces: string[] = [];
    const vertices: string[] = [];
    for (let y = 0; y <= side; y++) for (let x = 0; x <= side; x++) vertices.push(`v ${x} ${y} 0`);
    const at = (x: number, y: number): number => y * (side + 1) + x + 1;
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) faces.push(`f ${at(x, y)} ${at(x + 1, y)} ${at(x + 1, y + 1)} ${at(x, y + 1)}`);
    const steps: number[] = [];
    const mesh = parseObj(encode(`${faces.join('\n')}\n${vertices.join('\n')}\n`), (fraction) => steps.push(fraction));
    expect(mesh.triangleCount).toBe(2 * side * side);
    const deferred = steps.filter((fraction) => fraction >= 0.5 && fraction < 0.6);
    expect(deferred.length).toBeGreaterThanOrEqual(2); // al empezar y tras 65 536 triángulos
    expect(steps.every((fraction, i) => i === 0 || fraction >= (steps[i - 1] ?? 0))).toBe(true);
    expect(steps.at(-1)).toBe(1);
  });
});
