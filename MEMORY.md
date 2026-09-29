# MEMORY.md · printquote
Última actualización: 2026-09-29 por builder

## Estado actual
MVP completo en la rama `agent/builder` (PR abierto a `main`, pendiente de revisión del lead):
- Parser STL propio binario/ASCII con detección robusta y errores en español (`src/stl/parse.ts`).
- Geometría: volumen (tetraedros con signo), área, caja, aristas abiertas y avisos (malla abierta, normales invertidas, no cabe en la cama) (`src/stl/geometry.ts`).
- Modelo de presupuesto puro y testeado (`src/quote/`): material, relleno, perímetros, caudal, energía, margen, copias; formato es-ES; texto para copiar.
- Visor three.js (`src/viewer/viewer.ts`): Z arriba, rejilla de cama, OrbitControls, render bajo demanda, tema claro/oscuro, captura para imprimir.
- Interfaz (`index.html`, `src/styles.css`, `src/ui/`): «hoja técnica suiza», panel numerado 01–05, total fijo abajo, arrastrar y soltar, pieza de ejemplo, `#ejemplo` en la URL la carga sola, localStorage, copiar, imprimir, accesible.
- Pieza de ejemplo original: `public/samples/soporte-movil.stl` generada por `scripts/generate-sample.mjs` (`npm run sample`).
- 57 tests (Vitest) en verde; lint y build en verde en local.
- CI (`.github/workflows/ci.yml`, Ubuntu + Windows, Node 22) y despliegue a Pages (`deploy.yml`).
- README completo con fórmulas, captura `docs/captura.png` (generada con Chrome headless) y badges.

## Decisiones (por qué)
- 2026-09-29: Todo el cálculo en el navegador para no gestionar servidores ni archivos de terceros (coste cero y privacidad).
- 2026-09-29: TypeScript + Vite + three.js: stack web estándar y distinto al de los otros dos proyectos.
- 2026-09-29 (builder): Dependencias de desarrollo: `typescript`, `vite`, `vitest`, `eslint`, `@eslint/js`, `typescript-eslint`, `globals` (lo pedido por AGENTS.md para lint/test/build) y `@types/node` (solo para que los tests lean la pieza de ejemplo del disco). En ejecución solo `three` (y `@types/three` en desarrollo).
- 2026-09-29 (builder): `base: '/printquote/'` fija en dev, build y preview. Condicionarla a `command === 'build'` rompía `vite preview` (servía index.html en lugar de los assets). En local la web está en `http://localhost:5173/printquote/`.
- 2026-09-29 (builder): Detección de formato STL: binario si el tamaño es exactamente 84 + 50·n (salvo que sea texto con «solid…facet»); ASCII si empieza por «solid» y la muestra inicial es texto; binario con relleno final si el tamaño supera lo esperado. Coordenadas NaN/Infinito → error.
- 2026-09-29 (builder): «Malla abierta» = aristas que no comparten exactamente 2 triángulos (vértices soldados por igualdad exacta) o volumen ≈ 0 (relativo a la caja). Volumen negativo = normales invertidas (aviso aparte). El volumen se calcula respecto al centro de la caja para no perder precisión lejos del origen.
- 2026-09-29 (builder): La sobrecarga fija de 5 min se aplica **por copia** (cada copia se considera una impresión). El margen se aplica sobre material + energía. Ancho de línea editable (por defecto 0,45 mm). Sobrecarga (5 min) no editable en la UI, pero sí en el modelo.
- 2026-09-29 (builder): Para caber en la cama se permite girar la pieza 90° sobre Z. Se asume STL en milímetros.
- 2026-09-29 (builder): Campos numéricos como `type="text" inputmode="decimal"` con parser propio (coma o punto) para que el formato es-ES sea coherente en todos los navegadores. Valor fuera de rango: error visible y se limita al salir del campo.
- 2026-09-29 (builder): Accesibilidad de color: el naranja `#ff5a1f` no llega a 3:1 sobre `#f6f5f2`, así que nunca se usa como texto sobre fondo claro; solo en rellenos (con texto tinta, 6:1) y como cifra del total sobre fondo tinta (≥ 5,4:1). El foco usa contorno de tinta.
- 2026-09-29 (builder): La pieza se pinta del color acento (es el filamento); render solo cuando cambia algo (sin bucle continuo). Espera antes de parsear con `setTimeout` y no `requestAnimationFrame`, que se pausa en pestañas en segundo plano.
- 2026-09-29 (builder): El parseo es síncrono en el hilo principal; límite de 300 MB por archivo. Suficiente para el MVP.

## Siguiente paso
1. lead: revisar y fusionar el PR de `agent/builder`; comprobar que el despliegue a Pages funciona tras el merge.
2. qa (`agent/qa`): casos límite del parser (ASCII con nombres raros tipo «solid facet», archivos enormes, triángulos degenerados, CRLF mezclado), test de accesibilidad con teclado y lector de pantalla, revisar contraste en modo oscuro, probar la hoja de impresión en Chrome/Firefox/Safari, valorar aviso de unidades (pieza < 1 mm o > cama: ¿metros o pulgadas?) y mover el parseo a un Web Worker si hace falta.
3. docs (`agent/opencode-docs`): `docs/USO.md` para personas usuarias: cómo cargar un STL, qué significa cada ajuste (relleno, perímetros, caudal, margen), cómo leer los avisos, el enlace `#ejemplo`, copiar/imprimir y limitaciones del modelo (tiempo = estimación). Puede reutilizar `docs/captura.png`.

## Problemas conocidos
- El bundle pesa ~580 kB (148 kB gzip) por three.js; se ha subido `chunkSizeWarningLimit` a 800 kB. Se podría dividir con import dinámico del visor.
- Modelo de coste simplificado: no incluye soportes, balsa ni purga; la cáscara (área × grosor) sobreestima en piezas muy detalladas.
- Soldadura de vértices por igualdad exacta: STL con vértices casi coincidentes (no exactos) pueden dar falsos avisos de «malla abierta».
- Mallas muy grandes (> 400 000 triángulos) no dibujan las aristas marcadas, por rendimiento.

## Registro de sesiones
- 2026-09-29 lead (main): creación del repositorio y reparto del equipo.
- 2026-09-29 builder (agent/builder): MVP completo (parser, geometría, presupuesto, visor, UI, tests, CI, Pages, README, captura) y PR abierto a main.
