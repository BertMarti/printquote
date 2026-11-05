/** Polígonos de prueba para la triangulación (en el plano XY, sentido antihorario, sin cruces). */

type Point = readonly [number, number];

/** Generador pseudoaleatorio con semilla (mulberry32): las pruebas dan siempre lo mismo. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Estrella de `n` vértices (par) con radios alternos: la mitad de las esquinas son entrantes. */
export function star(n: number, outer = 50, inner = 30): Point[] {
  return Array.from({ length: n }, (_, i) => {
    const angle = (2 * Math.PI * i) / n;
    const r = i % 2 === 0 ? outer : inner;
    return [r * Math.cos(angle), r * Math.sin(angle)] as const;
  });
}

/** Polígono estrellado con radios aleatorios entre `min` y `max`: muy irregular, pero sin cruces. */
export function noisyStar(n: number, seed = 1, min = 10, max = 60): Point[] {
  const random = seeded(seed);
  return Array.from({ length: n }, (_, i) => {
    const angle = (2 * Math.PI * i) / n;
    const r = min + (max - min) * random();
    return [r * Math.cos(angle), r * Math.sin(angle)] as const;
  });
}

/** Peine de `teeth` púas (4 vértices por púa + 2 de la base): orejas muy estrechas y muchas esquinas entrantes. */
export function comb(teeth: number, width = 1, depth = 40): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < teeth; i++) {
    const x = i * 2 * width;
    points.push([x, 0], [x + width, 0], [x + width, depth], [x + 2 * width, depth]);
  }
  const end = teeth * 2 * width;
  points.push([end, -10], [0, -10]);
  // El peine se ha escrito en sentido horario (púas hacia arriba recorridas de izquierda a derecha): se invierte.
  return points.reverse();
}

/** Espiral gruesa de `n` vértices (par): la mitad por fuera hacia dentro y la otra mitad de vuelta. */
export function spiral(n: number, turns = 4, width = 3): Point[] {
  const half = n / 2;
  const at = (t: number, offset: number): Point => {
    const angle = t * turns * 2 * Math.PI;
    const r = 10 + t * turns * 2 * (width + 2) + offset;
    return [r * Math.cos(angle), r * Math.sin(angle)];
  };
  const outer = Array.from({ length: half }, (_, i) => at(i / (half - 1), width));
  const inner = Array.from({ length: half }, (_, i) => at(i / (half - 1), 0)).reverse();
  return [...outer, ...inner];
}

/** Área con signo (fórmula del zapatero): positiva si el polígono va en sentido antihorario. */
export function shoelace(points: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i] ?? [0, 0];
    const [x2, y2] = points[(i + 1) % points.length] ?? [0, 0];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

/** Polígono con un agujero cuadrado unido al borde por un puente (dos aristas que coinciden): vértices repetidos. */
export function keyhole(outer = 40, hole = 10): Point[] {
  const c = outer / 2;
  const h = hole / 2;
  return [
    [0, 0], [outer, 0], [outer, outer], [0, outer], [0, c], // borde exterior (antihorario) hasta el puente
    [c - h, c], [c - h, c + h], [c + h, c + h], [c + h, c - h], [c - h, c - h], [c - h, c], // agujero (horario)
    [0, c], // vuelta por el puente
  ];
}

/** OBJ de un prisma de altura `h` con la base `outline` (antihoraria en XY) como UNA cara arriba y otra abajo. */
export function prismObjText(outline: readonly Point[], h: number): string {
  const n = outline.length;
  const lines = [...outline.map(([x, y]) => `v ${x} ${y} 0`), ...outline.map(([x, y]) => `v ${x} ${y} ${h}`)];
  const ids = Array.from({ length: n }, (_, i) => i + 1);
  lines.push(`f ${[...ids].reverse().join(' ')}`); // base (hacia −Z)
  lines.push(`f ${ids.map((i) => i + n).join(' ')}`); // tapa (hacia +Z)
  for (let i = 1; i <= n; i++) lines.push(`f ${i} ${(i % n) + 1} ${(i % n) + 1 + n} ${i + n}`);
  return lines.join('\n') + '\n';
}

/** Perímetro del polígono. */
export function perimeter(points: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i] ?? [0, 0];
    const [x2, y2] = points[(i + 1) % points.length] ?? [0, 0];
    sum += Math.hypot(x2 - x1, y2 - y1);
  }
  return sum;
}
