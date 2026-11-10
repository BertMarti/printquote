/**
 * Triangulación de las caras de un OBJ (polígonos de n vértices → n − 2 triángulos).
 *
 * Convexo: abanico desde el primer vértice. Cóncavo: recorte de orejas sobre el plano de mayor área proyectada
 * (normal de Newell), con el anillo en una lista doblemente enlazada. Desde `GRID_MIN` vértices, para saber si una
 * oreja está libre solo se miran las esquinas entrantes (o colineales) de las celdas de una rejilla que tocan la caja
 * de la oreja: en un polígono simple, si un vértice queda dentro de una oreja, también queda una esquina entrante.
 * Es la idea de earcut (Mapbox, ISC), escrita aquí sin dependencia, con rejilla en vez de curva Z (con curva Z, las
 * orejas largas y finas de un engranaje de miles de dientes recorrían una cuarta parte de los puntos) y sin su
 * limpieza de puntos: se usan TODOS los vértices, así cada arista de la cara sigue emparejada con la de la cara
 * vecina (la malla no se abre) y siempre salen n − 2 triángulos. En cuanto no queda ninguna esquina entrante, el
 * resto (convexo) se cierra en abanico. Los predicados de giro y de punto en triángulo son los de la 1.1.
 *
 * Coste: casi lineal en la práctica (antes, O(n³) en el peor caso y por eso había un tope de 200 vértices). Para
 * que un polígono hecho a propósito no cuelgue el worker, cada cara tiene un presupuesto de pasos (`budgetFor`); si
 * se agota, el resto se cierra en abanico y `triangulate` devuelve `false` para que la interfaz avise, igual que con
 * las caras cóncavas de más de `MAX_EAR_CLIPPING` vértices.
 */

/** Caras de más vértices que esto se triangulan en abanico (y, si son cóncavas, se avisa). */
export const MAX_EAR_CLIPPING = 100_000;

/** Por debajo de esto recorrer el anillo entero sale más barato que mantener la rejilla. */
export const GRID_MIN = 64;

/**
 * Pasos (candidatas, celdas, puntos comprobados y reconstrucciones de la rejilla) por cara. Medido (1.2): las caras
 * simples de las pruebas gastan de 11 a 175 por vértice con 100 000 vértices (la peor, una estrella con radios al
 * azar: 17,5 M de 30,2 M). Una cara que se cruza a sí misma de 100 000 vértices lo agota en ~5 s en la Raspberry Pi
 * (con 1 000 000 + 1000 · n eran 13–17 s).
 */
export function budgetFor(n: number): number {
  return 200_000 + 300 * n;
}

// Memoria de trabajo reutilizada entre caras (un archivo puede traer millones): crece por duplicación.
let capacity = 0;
let xs = new Float64Array(0);
let ys = new Float64Array(0);
let prev = new Int32Array(0);
let next = new Int32Array(0);
/** Rejilla de las esquinas que pueden tapar orejas, por celdas: `cellItems[cellStart[c] .. cellStart[c + 1])`. */
let cellStart = new Int32Array(0);
let cellItems = new Uint32Array(0);
let cellOf = new Int32Array(0);
/** Cola circular de vértices por comprobar (cada uno, como mucho una vez a la vez). */
let queue = new Int32Array(0);
/** Por vértice: 1 = quitado, 2 = esquina entrante o colineal (puede tapar una oreja), 4 = estrictamente entrante, 8 = en la cola. */
let flags = new Uint8Array(0);

const REMOVED = 1;
const BLOCKER = 2;
const REFLEX = 4;
const QUEUED = 8;

function reserve(n: number): void {
  if (n <= capacity) return;
  capacity = Math.max(n, capacity * 2, 256);
  xs = new Float64Array(capacity);
  ys = new Float64Array(capacity);
  prev = new Int32Array(capacity);
  next = new Int32Array(capacity);
  // Hay como mucho GX · ⌈n / GX⌉ < n + GX ≤ 2n celdas.
  cellStart = new Int32Array(2 * capacity + 2);
  cellItems = new Uint32Array(capacity);
  cellOf = new Int32Array(capacity);
  queue = new Int32Array(capacity);
  flags = new Uint8Array(capacity);
}

/**
 * Triangula una cara (índices absolutos en `vertices`) y llama a `emit` con cada triángulo, siempre n − 2.
 * Devuelve `false` si la cara es cóncava (o no se ha podido comprobar) y se ha tenido que cerrar en abanico, que
 * puede dar un área y un volumen equivocados; `true` en el resto de casos (también si es degenerada o referencia
 * vértices que aún no se han leído: entonces el abanico es lo único posible y `parseObj` lo valida al final).
 */
export function triangulate(
  face: readonly number[],
  vertices: Float32Array,
  vertexCount: number,
  emit: (a: number, b: number, c: number) => void,
  /** Solo para pruebas: otro presupuesto de pasos que el de `budgetFor`. */
  steps?: number,
): boolean {
  const n = face.length;
  const id = (i: number): number => face[i] ?? 0;
  const fan = (): void => {
    for (let k = 1; k + 1 < n; k++) emit(id(0), id(k), id(k + 1));
  };
  if (n <= 3 || face.some((v) => v >= vertexCount)) {
    fan();
    return true;
  }

  const at = (i: number, axis: number): number => vertices[id(i) * 3 + axis] ?? 0;
  // Normal de Newell: robusta con polígonos cóncavos y vértices colineales.
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1;
    nx += (at(i, 1) - at(j, 1)) * (at(i, 2) + at(j, 2));
    ny += (at(i, 2) - at(j, 2)) * (at(i, 0) + at(j, 0));
    nz += (at(i, 0) - at(j, 0)) * (at(i, 1) + at(j, 1));
  }
  const largest = Math.max(Math.abs(nx), Math.abs(ny), Math.abs(nz));
  if (!(largest > 0)) {
    fan();
    return true;
  }
  // Se descarta el eje de la normal mayor; (u, v) son los otros dos en orden cíclico. Con `v` multiplicado por el
  // signo de la normal, el polígono queda en sentido antihorario y un giro positivo es una esquina convexa.
  const drop = Math.abs(nz) === largest ? 2 : Math.abs(nx) === largest ? 0 : 1;
  const sign = (drop === 0 ? nx : drop === 1 ? ny : nz) > 0 ? 1 : -1;
  const uAxis = (drop + 1) % 3;
  const vAxis = (drop + 2) % 3;

  if (n > MAX_EAR_CLIPPING) {
    // Demasiado grande para recortar orejas: en abanico, y se avisa solo si es cóncava (mirarlo es lineal).
    const u = (i: number): number => at(i, uAxis);
    const v = (i: number): number => sign * at(i, vAxis);
    let convex = true;
    for (let i = 0; i < n && convex; i++) {
      const a = i === 0 ? n - 1 : i - 1;
      const c = i + 1 === n ? 0 : i + 1;
      convex = (u(i) - u(a)) * (v(c) - v(a)) - (v(i) - v(a)) * (u(c) - u(a)) >= 0;
    }
    fan();
    return convex;
  }

  reserve(n);
  for (let i = 0; i < n; i++) {
    xs[i] = at(i, uAxis);
    ys[i] = sign * at(i, vAxis);
    prev[i] = i === 0 ? n - 1 : i - 1;
    next[i] = i + 1 === n ? 0 : i + 1;
  }
  const X = (i: number): number => xs[i] ?? 0;
  const Y = (i: number): number => ys[i] ?? 0;
  const P = (i: number): number => prev[i] ?? 0;
  const N = (i: number): number => next[i] ?? 0;
  const F = (i: number): number => flags[i] ?? 0;
  /** > 0 si el giro a→b→c es hacia el lado de la normal (esquina convexa); 0 si son colineales. */
  const turn = (a: number, b: number, c: number): number =>
    (X(b) - X(a)) * (Y(c) - Y(a)) - (Y(b) - Y(a)) * (X(c) - X(a));

  /** Esquinas estrictamente entrantes que quedan: con 0, lo que queda es convexo y basta un abanico. */
  let reflexCount = 0;
  /** ¿Hay alguna esquina que pueda tapar orejas y no está en la rejilla? Entonces hay que reconstruirla. */
  let stale = false;
  /** Recalcula si `i` es esquina entrante (o colineal) y lleva la cuenta de las entrantes. */
  const classify = (i: number): void => {
    const t = turn(P(i), i, N(i));
    const old = F(i);
    const now = (old & (REMOVED | QUEUED)) | (t <= 0 ? BLOCKER : 0) | (t < 0 ? REFLEX : 0);
    if (old & REFLEX) reflexCount--;
    if (now & REFLEX) reflexCount++;
    if (now & BLOCKER && !(old & BLOCKER)) stale = true;
    flags[i] = now;
  };
  for (let i = 0; i < n; i++) flags[i] = 0;
  for (let i = 0; i < n; i++) classify(i);
  if (reflexCount === 0) {
    fan();
    return true;
  }

  let budget = steps ?? budgetFor(n);
  const same = (p: number, q: number): boolean => X(p) === X(q) && Y(p) === Y(q);
  /** ¿Impide `p` recortar la oreja a-b-c? Dentro o en el borde, salvo que coincida con una de sus esquinas. */
  const blocks = (p: number, a: number, b: number, c: number): boolean =>
    !same(p, a) && !same(p, b) && !same(p, c) && turn(a, b, p) >= 0 && turn(b, c, p) >= 0 && turn(c, a, p) >= 0;

  // Rejilla de GX × GY celdas sobre la caja de la cara (≈ una celda por esquina y con la forma de la caja, para que
  // un perfil largo y plano no quede en celdas alargadas): cada esquina entrante o colineal va en la celda de su
  // punto. Las que se quitan o dejan de serlo se saltan y, cuando sobran muchas, se reconstruye.
  const useGrid = n >= GRID_MIN;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let GX = 1;
  let GY = 1;
  let gx = 0;
  let gy = 0;
  let live = 0;
  let dead = 0;
  const column = (x: number): number => Math.min(GX - 1, Math.max(0, Math.floor((x - minX) * gx)));
  const row = (y: number): number => Math.min(GY - 1, Math.max(0, Math.floor((y - minY) * gy)));
  const rebuild = (): void => {
    live = 0;
    for (let i = 0; i < n; i++) if ((F(i) & (REMOVED | BLOCKER)) === BLOCKER) live++;
    const width = maxX - minX;
    const height = maxY - minY;
    const cellsWanted = Math.max(1, live);
    GX = height > 0 ? Math.ceil(Math.sqrt((cellsWanted * width) / height)) : cellsWanted;
    GX = Math.min(cellsWanted, Math.max(1, GX));
    GY = Math.max(1, Math.ceil(cellsWanted / GX));
    gx = width > 0 ? GX / width : 0;
    gy = height > 0 ? GY / height : 0;
    const cells = GX * GY;
    cellStart.fill(0, 0, cells + 1);
    for (let i = 0; i < n; i++) {
      if ((F(i) & (REMOVED | BLOCKER)) !== BLOCKER) continue;
      const cell = column(X(i)) + GX * row(Y(i));
      cellOf[i] = cell;
      cellStart[cell + 1] = (cellStart[cell + 1] ?? 0) + 1;
    }
    for (let c = 0; c < cells; c++) cellStart[c + 1] = (cellStart[c + 1] ?? 0) + (cellStart[c] ?? 0);
    // Reparto (ordenación por recuento): `cellStart[c]` avanza dentro de cada celda y luego se desplaza un puesto.
    for (let i = 0; i < n; i++) {
      if ((F(i) & (REMOVED | BLOCKER)) !== BLOCKER) continue;
      const cell = cellOf[i] ?? 0;
      cellItems[cellStart[cell] ?? 0] = i;
      cellStart[cell] = (cellStart[cell] ?? 0) + 1;
    }
    for (let c = cells; c > 0; c--) cellStart[c] = cellStart[c - 1] ?? 0;
    cellStart[0] = 0;
    dead = 0;
    stale = false;
    budget -= n + cells;
  };
  if (useGrid) {
    for (let i = 0; i < n; i++) {
      minX = Math.min(minX, X(i));
      minY = Math.min(minY, Y(i));
      maxX = Math.max(maxX, X(i));
      maxY = Math.max(maxY, Y(i));
    }
    rebuild();
  }

  /** ¿Hay algún otro vértice del anillo dentro de la oreja a-b-c? */
  const occupied = (a: number, b: number, c: number): boolean => {
    if (!useGrid) {
      // Pocos vértices: se miran todos, como en la 1.1.
      for (let p = N(c); p !== a; p = N(p)) {
        budget--;
        if (blocks(p, a, b, c)) return true;
      }
      return false;
    }
    if (stale || dead * 2 > live + 64) rebuild();
    const lowX = Math.min(X(a), X(b), X(c));
    const lowY = Math.min(Y(a), Y(b), Y(c));
    const highX = Math.max(X(a), X(b), X(c));
    const highY = Math.max(Y(a), Y(b), Y(c));
    // Solo las celdas que toca el triángulo, fila a fila (una oreja larga y en diagonal tiene una caja enorme):
    // en cada franja se mira el tramo en x del triángulo, ensanchado un pelo para no perder un punto del borde por
    // redondeo.
    const r0 = row(lowY);
    const r1 = row(highY);
    const epsY = (highY - lowY) * 1e-9 + 1e-300;
    const epsX = (highX - lowX) * 1e-9 + 1e-300;
    const ax = X(a);
    const ay = Y(a);
    const bx = X(b);
    const by = Y(b);
    const cx = X(c);
    const cy = Y(c);
    for (let r = r0; r <= r1; r++) {
      const top = r === r0 ? lowY : Math.max(lowY, minY + r / gy - epsY);
      const bottom = r === r1 ? highY : Math.min(highY, minY + (r + 1) / gy + epsY);
      let from = Infinity;
      let to = -Infinity;
      const take = (x: number): void => {
        if (x < from) from = x;
        if (x > to) to = x;
      };
      if (ay >= top && ay <= bottom) take(ax);
      if (by >= top && by <= bottom) take(bx);
      if (cy >= top && cy <= bottom) take(cx);
      const edge = (px: number, py: number, qx: number, qy: number): void => {
        if (py === qy) return;
        for (const y of [top, bottom]) {
          if ((y - py) * (y - qy) <= 0) take(px + ((y - py) * (qx - px)) / (qy - py));
        }
      };
      edge(ax, ay, bx, by);
      edge(bx, by, cx, cy);
      edge(cx, cy, ax, ay);
      if (from > to) continue;
      const c0 = column(Math.max(lowX, from - epsX));
      const c1 = column(Math.min(highX, to + epsX));
      for (let col = c0; col <= c1; col++) {
        const cell = col + GX * r;
        const end = cellStart[cell + 1] ?? 0;
        budget--;
        for (let k = cellStart[cell] ?? 0; k < end; k++) {
          const p = cellItems[k] ?? 0;
          budget--;
          if ((F(p) & (REMOVED | BLOCKER)) !== BLOCKER || p === a || p === b || p === c) continue;
          const x = X(p);
          const y = Y(p);
          if (x >= lowX && x <= highX && y >= lowY && y <= highY && blocks(p, a, b, c)) return true;
        }
      }
    }
    return false;
  };

  const cut = (b: number): void => {
    const a = P(b);
    const c = N(b);
    emit(id(a), id(b), id(c));
    next[a] = c;
    prev[c] = a;
    const old = F(b);
    if (old & REFLEX) reflexCount--;
    if (old & BLOCKER) dead++;
    flags[b] = REMOVED;
    for (const i of [a, c]) {
      const was = F(i) & BLOCKER;
      classify(i);
      if (was && !(F(i) & BLOCKER)) dead++;
    }
  };

  /** Cierra en abanico lo que queda del anillo, desde `start`. */
  const fanFrom = (start: number): void => {
    for (let p = N(start); N(p) !== start; p = N(p)) emit(id(start), id(p), id(N(p)));
  };

  // Cola de candidatas a oreja. En un polígono simple, una esquina solo pasa a ser oreja cuando cambia uno de sus
  // vecinos (si dentro de su triángulo hay un vértice, también hay una esquina entrante, y esas solo dejan de serlo
  // al quitar un vecino suyo): basta con volver a mirar los dos vecinos de cada oreja quitada. Así cada triángulo
  // cuesta unas pocas comprobaciones, también en una tira larga (una espiral) que se cierra desde un extremo.
  let head = 0;
  let size = 0;
  const push = (i: number): void => {
    if (F(i) & (QUEUED | REMOVED)) return;
    flags[i] = F(i) | QUEUED;
    queue[(head + size) % n] = i;
    size++;
  };
  const pop = (): number => {
    const i = queue[head] ?? 0;
    head = head + 1 === n ? 0 : head + 1;
    size--;
    flags[i] = F(i) & ~QUEUED;
    return i;
  };
  for (let i = 0; i < n; i++) push(i);

  let remaining = n;
  /** Un vértice que sigue en el anillo (desde él se cierra lo que quede). */
  let cursor = 0;
  /** ¿Se ha quitado alguna oreja desde la última vez que se encoló el anillo entero? */
  let progress = true;
  /** Vecino siguiente de la última oreja: se deja para la vuelta siguiente (como en earcut, evita abanicos de triángulos finos). */
  let deferred = -1;
  const clip = (v: number): void => {
    const a = P(v);
    const c = N(v);
    cut(v);
    remaining--;
    cursor = a;
    push(a);
    push(c);
    deferred = c;
  };
  while (remaining > 3) {
    if (reflexCount === 0) {
      fanFrom(cursor);
      return true;
    }
    if (budget <= 0) {
      fanFrom(cursor);
      return false;
    }
    if (size === 0) {
      if (progress) {
        // Ninguna candidata (no debería pasar en un polígono simple): se vuelven a mirar todas.
        progress = false;
        for (let p = cursor, k = 0; k < remaining; p = N(p), k++) push(p);
        budget -= remaining;
      } else {
        // Una vuelta entera sin orejas (la cara se cruza a sí misma): se corta por aquí para terminar siempre, como
        // en la 1.1.
        clip(cursor);
        progress = true;
      }
      continue;
    }
    const v = pop();
    if (F(v) & REMOVED) continue;
    if (v === deferred) {
      deferred = -1;
      push(v);
      continue;
    }
    budget--;
    const a = P(v);
    const c = N(v);
    if (turn(a, v, c) >= 0 && !occupied(a, v, c)) {
      clip(v);
      progress = true;
    }
  }
  emit(id(P(cursor)), id(cursor), id(N(cursor)));
  return true;
}
