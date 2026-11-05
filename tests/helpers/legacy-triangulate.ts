/**
 * Recorte de orejas de printquote 1.1 (`src/stl/obj.ts` hasta la 1.2), sin el tope de 200 vértices. Solo para las
 * pruebas: es la referencia con la que se compara el volumen y el área de la triangulación nueva, y la medida de
 * tiempo «antes». Coste O(n³) en el peor caso (cada paso recorre el anillo y, por cada candidata, todos los puntos).
 */
export function legacyTriangulate(
  face: readonly number[],
  vertices: Float32Array,
  emit: (a: number, b: number, c: number) => void,
): void {
  const n = face.length;
  const fan = (): void => {
    for (let k = 1; k + 1 < n; k++) emit(face[0] ?? 0, face[k] ?? 0, face[k + 1] ?? 0);
  };
  if (n <= 3) return fan();
  const at = (i: number, axis: number): number => vertices[(face[i] ?? 0) * 3 + axis] ?? 0;
  // Normal de Newell: robusta con polígonos cóncavos y vértices colineales.
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    nx += (at(i, 1) - at(j, 1)) * (at(i, 2) + at(j, 2));
    ny += (at(i, 2) - at(j, 2)) * (at(i, 0) + at(j, 0));
    nz += (at(i, 0) - at(j, 0)) * (at(i, 1) + at(j, 1));
  }
  const largest = Math.max(Math.abs(nx), Math.abs(ny), Math.abs(nz));
  if (!(largest > 0)) return fan();
  // Se descarta el eje de la normal mayor; (u, v) son los otros dos en orden cíclico, de modo que
  // con la normal positiva el polígono queda en sentido antihorario.
  const drop = Math.abs(nz) === largest ? 2 : Math.abs(nx) === largest ? 0 : 1;
  const sign = (drop === 0 ? nx : drop === 1 ? ny : nz) > 0 ? 1 : -1;
  const uAxis = (drop + 1) % 3;
  const vAxis = (drop + 2) % 3;
  const u = (i: number): number => at(i, uAxis);
  const v = (i: number): number => at(i, vAxis);
  /** > 0 si el giro a→b→c va hacia el lado de la normal (esquina convexa). */
  const turn = (a: number, b: number, c: number): number =>
    sign * ((u(b) - u(a)) * (v(c) - v(a)) - (v(b) - v(a)) * (u(c) - u(a)));

  const ring = Array.from({ length: n }, (_, i) => i);
  if (ring.every((b, i) => turn(ring[(i + n - 1) % n] ?? 0, b, ring[(i + 1) % n] ?? 0) >= 0)) return fan();

  const same = (p: number, q: number): boolean => u(p) === u(q) && v(p) === v(q);
  const insideTriangle = (p: number, a: number, b: number, c: number): boolean =>
    !same(p, a) && !same(p, b) && !same(p, c) && turn(a, b, p) >= 0 && turn(b, c, p) >= 0 && turn(c, a, p) >= 0;

  while (ring.length > 3) {
    const m = ring.length;
    let ear = -1;
    for (let i = 0; i < m && ear < 0; i++) {
      const a = ring[(i + m - 1) % m] ?? 0;
      const b = ring[i] ?? 0;
      const c = ring[(i + 1) % m] ?? 0;
      if (turn(a, b, c) < 0) continue;
      if (ring.every((p) => p === a || p === b || p === c || !insideTriangle(p, a, b, c))) ear = i;
    }
    // Sin orejas (polígono que se cruza a sí mismo): se corta por donde sea para terminar siempre.
    if (ear < 0) ear = 0;
    emit(face[ring[(ear + m - 1) % m] ?? 0] ?? 0, face[ring[ear] ?? 0] ?? 0, face[ring[(ear + 1) % m] ?? 0] ?? 0);
    ring.splice(ear, 1);
  }
  emit(face[ring[0] ?? 0] ?? 0, face[ring[1] ?? 0] ?? 0, face[ring[2] ?? 0] ?? 0);
}
