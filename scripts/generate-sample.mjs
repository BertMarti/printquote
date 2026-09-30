// Genera la pieza de ejemplo de printquote: un soporte de móvil low-poly.
// Diseño original de este proyecto (licencia MIT, como el resto del repositorio).
//
// Uso: npm run sample  →  public/samples/soporte-movil.stl (STL binario, mm)
//
// La pieza es la extrusión en X de un perfil dibujado en el plano Y-Z:
// una pata delantera con labio para apoyar el móvil, un respaldo inclinado ~65°
// y una pata trasera, unidas por arriba y con un arco abierto por debajo para
// ahorrar material. Al ser una extrusión de un polígono simple, la malla es
// cerrada y con normales hacia fuera.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WIDTH = 70; // mm en X

/** Perfil en sentido antihorario, puntos [y, z] en mm (y = fondo, z = altura). */
const PROFILE = [
  [0, 0],
  [24.4, 0], // fin de la pata delantera
  [50.4, 60], // arco interior (lado delantero)
  [61, 60], // techo del arco
  [77.9, 0], // arco interior (lado trasero)
  [90, 0],
  [90, 5],
  [84, 8], // chaflán trasero
  [62, 86], // cara trasera del respaldo
  [55, 88], // cumbre
  [22, 12], // cara de apoyo del móvil (~65°)
  [12, 12], // ranura donde descansa el canto del móvil
  [12, 22], // labio
  [6, 22],
  [0, 14], // chaflán delantero
];

function signedArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

function cross(o, a, b) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function insideTriangle(p, a, b, c) {
  return cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
}

/** Triangulación por recorte de orejas de un polígono simple antihorario. Devuelve índices. */
function triangulate(poly) {
  const remaining = poly.map((_, i) => i);
  const triangles = [];
  let guard = 0;
  while (remaining.length > 3) {
    if (guard++ > 10000) throw new Error('No se pudo triangular el perfil');
    for (let k = 0; k < remaining.length; k++) {
      const ip = remaining[(k - 1 + remaining.length) % remaining.length];
      const ic = remaining[k];
      const inx = remaining[(k + 1) % remaining.length];
      const [a, b, c] = [poly[ip], poly[ic], poly[inx]];
      if (cross(a, b, c) <= 0) continue; // vértice cóncavo
      const blocked = remaining.some(
        (j) => j !== ip && j !== ic && j !== inx && insideTriangle(poly[j], a, b, c),
      );
      if (blocked) continue;
      triangles.push([ip, ic, inx]);
      remaining.splice(k, 1);
      break;
    }
  }
  triangles.push([remaining[0], remaining[1], remaining[2]]);
  return triangles;
}

function buildTriangles() {
  if (signedArea(PROFILE) <= 0) throw new Error('El perfil debe ser antihorario');
  const at = (x, [y, z]) => [x, y, z];
  const tris = [];

  // Tapas: en x = WIDTH la normal es +X (orden antihorario en Y-Z); en x = 0, invertida.
  for (const [a, b, c] of triangulate(PROFILE)) {
    tris.push([at(WIDTH, PROFILE[a]), at(WIDTH, PROFILE[b]), at(WIDTH, PROFILE[c])]);
    tris.push([at(0, PROFILE[a]), at(0, PROFILE[c]), at(0, PROFILE[b])]);
  }

  // Paredes: un quad por arista del perfil, con la normal hacia fuera.
  for (let i = 0; i < PROFILE.length; i++) {
    const p = PROFILE[i];
    const q = PROFILE[(i + 1) % PROFILE.length];
    const a0 = at(0, p), a1 = at(0, q), b1 = at(WIDTH, q), b0 = at(WIDTH, p);
    tris.push([a0, a1, b1], [a0, b1, b0]);
  }
  return tris;
}

function normal([a, b, c]) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const len = Math.hypot(...n) || 1;
  return n.map((value) => value / len);
}

function toBinaryStl(tris, header) {
  const buffer = Buffer.alloc(84 + tris.length * 50);
  buffer.write(header.padEnd(80, ' ').slice(0, 80), 0, 'ascii');
  buffer.writeUInt32LE(tris.length, 80);
  tris.forEach((tri, i) => {
    let offset = 84 + i * 50;
    for (const value of [...normal(tri), ...tri.flat()]) {
      buffer.writeFloatLE(value, offset);
      offset += 4;
    }
    buffer.writeUInt16LE(0, offset);
  });
  return buffer;
}

const tris = buildTriangles();
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../public/samples/soporte-movil.stl');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, toBinaryStl(tris, 'printquote sample - soporte de movil low-poly (MIT)'));

const volume = signedArea(PROFILE) * WIDTH;
console.log(`${out}\n${tris.length} triángulos · volumen ${(volume / 1000).toFixed(2)} cm³`);
