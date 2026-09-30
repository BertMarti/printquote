# MEMORY.md · printquote
Última actualización: 2026-09-30 por builder (v0.2.0)

## Estado actual

### v0.2.0 (hito en curso, agente builder)
Una rama y un PR por issue, cada rama parte de la anterior y todos van contra `main`:
- #5 Perfiles de impresora (rama `agent/builder-5-perfiles`, PR #11): hecho, CI en verde.
- #6 3MF y OBJ (rama `agent/builder-6-3mf-obj`): hecho, PR abierto (parte de la rama de #5).
- #7 PDF con datos del negocio, #8 interfaz en inglés: pendientes (ver «Siguiente paso»).

**#5 Perfiles de impresora.** `src/quote/printers.ts` (único archivo de datos, tipado, con `note` de origen por perfil): Bambu Lab A1 y P1S, Prusa MK4 y MINI+, Creality Ender-3 V3 y K1, Elegoo Neptune 4. Selector «Impresora» al principio del bloque 03; elegir un perfil rellena caudal, potencia y cama; editar cualquiera de esos campos vuelve a «Personalizada». `QuoteSettings.printerId` se guarda en localStorage (misma clave `printquote:ajustes:v1`; los ajustes antiguos sin perfil cargan como «Personalizada»).

**#6 OBJ y 3MF.** `src/stl/obj.ts`, `zip.ts`, `xml.ts`, `threemf.ts` y `model.ts` (detección de formato y punto de entrada `parseModel`). `analyzeModel` (asíncrono) sustituye a `analyzeStl` en el worker y en el respaldo del hilo principal; `analyzeStl` sigue existiendo para STL síncrono. El análisis (volumen, aristas abiertas, avisos) es el mismo para los tres formatos. Botón «Abrir modelo 3D», selector `.stl,.obj,.3mf`, la ficha muestra «OBJ · n triángulos» / «3MF · …». `ModelParseError` (en `errors.ts`) es la base de los errores de lectura; `StlParseError` la extiende. `Mesh.format` pasa a `'binary' | 'ascii' | 'obj' | '3mf'`.

### MVP y revisiones anteriores (v0.1.0)
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

Revisión QA en la rama `agent/qa` (PR #2 contra `agent/builder`, se fusiona después de #1):
- Parser ASCII byte a byte (sin picos de memoria), BOM, nombres de sólido con palabras clave, rechazo de valores fuera de float32/«inf»/«NaN»/hex; binario con recuento 0 deducido del tamaño.
- Soldado de vértices con tolerancia (1e-4 mm o 1e-6 × coordenada mayor) con rejilla espacial.
- Parseo + geometría en Web Worker (`src/stl/stl.worker.ts`, cliente `analyzer.ts` con respaldo al hilo principal); indicador de carga; cargas concurrentes resueltas por número de carga.
- three.js bajo demanda (`import()`): JS inicial 26 kB (10 kB gzip), visor en chunk aparte.
- Importes redondeados a céntimos por línea: el desglose siempre suma el total.
- Accesibilidad: total y errores en regiones vivas, avisos sin repeticiones, visor manejable con teclado, sin inercia con `prefers-reduced-motion`, pista táctil.
- Open Graph, tarjeta de Twitter, canonical; aviso de unidades (pieza < 1 mm).
- 132 tests (incluidos tests de interfaz con happy-dom que cargan `index.html`); lint, tests y build en verde en local y en el CI.

Documentación en la rama `agent/docs` (PR contra `agent/qa`, se fusiona después de #1 y #2):
- `docs/USO.md`: guía de uso en español (pieza de ejemplo, carga de STL, visor con ratón, táctil y teclado, avisos, material y precio, parámetros con valores de partida, energía y margen, copias, copiar e imprimir, cálculo con ejemplo completo, calibración con el laminador, privacidad, preguntas frecuentes). Cifras comprobadas contra el código y contra `npm run dev` (pieza de ejemplo: 59,3 g, 1 h 45 min, 1,59 €).
- `CONTRIBUTING.md`: requisitos, comandos, ramas y PR, commits, dónde está cada fórmula y cómo testearla, cómo añadir un material y reglas de diseño.
- README con sección «Documentación» y «Cómo se ha hecho» ajustada; fila de docs de `AGENTS.md` actualizada.

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
- 2026-09-29 (builder): El parseo es síncrono en el hilo principal; límite de 300 MB por archivo. Suficiente para el MVP. **Sustituida el 2026-09-30 por qa (ver abajo).**
- 2026-09-30 (qa): Parseo y geometría en un Web Worker (`new Worker(new URL('./stl.worker.ts', import.meta.url), { type: 'module' })`). El buffer se transfiere (no se copia) ida y vuelta. Si el worker no se puede crear o revienta, se calcula en el hilo principal. Límite de 300 MB se mantiene.
- 2026-09-30 (qa): three.js se carga con `import()` tras pintar la interfaz (decisión sencilla: un solo punto de carga en `app.ts`, `supportsWebGL` separado en `viewer/webgl.ts` para no arrastrar three.js). El panel funciona antes de que llegue el visor; si ya hay pieza, se muestra al llegar.
- 2026-09-30 (qa): Parser ASCII con tokenizador byte a byte: con `split(/s+/)` un ASCII de 67 MB ocupaba ~800 MB de memoria; 300 MB habrían tumbado la pestaña. El nombre tras `solid`/`endsolid` se salta hasta fin de línea (salvo archivos de una sola línea). Solo se aceptan números con [0-9 . + - e E] y que quepan en float32.
- 2026-09-30 (qa): Soldado de vértices con tolerancia 1e-4 mm (o 1e-6 × la coordenada mayor, porque lejos del origen el float32 pierde resolución), rejilla con celdas de 16 × tolerancia y búsqueda en la celda vecina solo cerca del borde. 1 millón de triángulos en ~0,6 s (antes ~0,8 s con claves de texto).
- 2026-09-30 (qa): Importes redondeados a céntimos **por línea** (material, energía, margen) y subtotal/total como suma de líneas, como una factura. Consecuencia aceptada: el total puede diferir 1–2 céntimos del cálculo sin redondear y el total de N copias no es exactamente N × el de una. `roundCents` pasa por 12 cifras significativas para evitar el ruido de coma flotante (1,005 → 1,01).
- 2026-09-30 (qa): Nueva dependencia de desarrollo `happy-dom`: solo para tests de interfaz (`// @vitest-environment happy-dom` en `tests/ui.test.ts`), que cargan el `index.html` real y arrancan la app. Sin ella no se podían probar las regiones vivas ni el botón de copiar. No afecta al paquete publicado.
- 2026-09-30 (qa): Contraste revisado (WCAG, calculado): claro — tinta/fondo 17,3, gris/fondo 6,4, gris/escenario 5,9, naranja/tinta 6,1; oscuro — gris/fondo 7,5, naranja/resumen 5,4. Todo AA; no hacía falta cambiar colores.
- 2026-09-30 (qa): Móvil: sin scroll horizontal a 360 px (comprobado en el navegador). El lienzo mantiene `touch-action: none` para que OrbitControls reciba los gestos (un dedo gira, pellizco acerca, dos dedos desplazan); la página se desplaza tocando la cabecera o el total fijo.
- 2026-09-30 (docs): La documentación la ha hecho Claude Code (Sonnet) y no OpenCode, porque el sistema de permisos no permite lanzar OpenCode en modo autónomo. `AGENTS.md` conserva OpenCode como herramienta futura «cuando se permita su ejecución autónoma»; la rama pasa de `agent/opencode-docs` a `agent/docs`.
- 2026-09-30 (docs): La guía de uso explica el aviso de unidades tal como es en el código (solo salta por debajo de 1 mm): un STL en pulgadas de una pieza grande no avisa, y se indica al lector que compruebe las dimensiones. La sobrecarga de 5 min por copia no es editable en la interfaz y así se dice.
- 2026-09-30 (builder, #5): El perfil no se «detecta» comparando valores: `printerId` se guarda, y `normalizeSettings` lo mantiene solo mientras caudal, potencia y cama coinciden con el perfil (si no, pasa a `custom`). Así editar un campo vuelve a «Personalizada» sin lógica extra en la interfaz, y un perfil que ya no exista (o valores retocados a mano en localStorage) se degrada bien. Si alguien vuelve a escribir a mano los valores de un perfil, sigue en «Personalizada» (intencionado, es lo más simple).
- 2026-09-30 (builder, #5): Valores de perfiles = cama de la ficha del fabricante; caudal y potencia son estimaciones redondeadas de uso normal con PLA (muy por debajo del máximo publicitario) y así se rotula en la interfaz («Valores de partida orientativos») y en la nota de cada perfil. La Ender-3 V3 usa las medidas de la V3 SE (220 × 220 × 250); la nota avisa de que KE y CoreXZ difieren.
- 2026-09-30 (builder, #6): Sin dependencias para 3MF. ZIP leído a mano (directorio central; si falta, recorre cabeceras locales con tamaños) y descompresión con `DecompressionStream('deflate-raw')` (Node ≥ 18 y todos los navegadores actuales). No se usa `DOMParser` porque no existe en un Web Worker ni en Node: `xml.ts` es un lector lineal de etiquetas (sin árbol, no expande entidades de DOCTYPE), suficiente para 3MF. Límite de 400 MB por entrada descomprimida (también si la cabecera miente) contra «bombas» ZIP. No se admite ZIP64 ni cifrado (error claro).
- 2026-09-30 (builder, #6): Detección de formato por contenido primero (firma ZIP → 3MF; el nombre solo desempata texto). Un STL binario nunca se toma por OBJ.
- 2026-09-30 (builder, #6): 3MF: se toman los `item` de `build` que sean `printable` y de tipo `model` (los soportes, superficies y «otros» se omiten); transformación de 12 números con convención de vector fila, componiendo componente → objeto padre → item; unidades del modelo a mm (las del archivo de cada malla se convierten a las de la plantilla); una transformación con determinante negativo (espejo) invierte el orden de los vértices para que el volumen no salga negativo. Soporta `p:path` (componentes en otros `.model`, como los de Bambu Studio/PrusaSlicer). Sin `build`, usa los objetos que nadie referencia.
- 2026-09-30 (builder, #6): OBJ: se juntan todos los objetos/grupos en una malla; caras poligonales trianguladas en abanico (bien para polígonos convexos; un polígono cóncavo puede dar una triangulación incorrecta, límite conocido). Sin unidades: se asume mm, como el STL.
- 2026-09-30 (qa): Imagen Open Graph = copia de `docs/captura.png` en `public/og.png` (1440 × 900), URL absoluta de GitHub Pages.

## Siguiente paso
00. Alberto: borrar la rama remota `agent/builder` (ya fusionada en `main`, SHA 5b0a29b: se puede recrear). Mientras exista, Git impide crear ramas `agent/builder/…`, y las de v0.2.0 se llaman `agent/builder-<n>-<slug>`. El borrado lo denegó el sistema de permisos del agente.
0. builder (v0.2.0): tras #5 y #6, seguir con #7 (PDF) y #8 (inglés). Alberto fusiona los PR en ese orden (#11 antes que el de #6).
1. lead: revisar y fusionar el PR de `agent/builder`; comprobar que el despliegue a Pages funciona tras el merge.
2. lead: tras fusionar #1, revisar y fusionar el PR #2 de `agent/qa` (base `agent/builder`; si GitHub lo retarga a `main` al borrar la rama, vale igual).
3. Pendiente de una persona (no automatizable aquí): probar con lector de pantalla real (NVDA/VoiceOver) y la hoja de impresión en Firefox y Safari; comprobar la vista previa del enlace (og.png) una vez desplegado.
4. lead: tras fusionar #1 y #2, revisar y fusionar el PR de `agent/docs` (base `agent/qa`; si GitHub lo retarga a `main` al borrar la rama, vale igual). Comprobar que los enlaces de `docs/USO.md` y `CONTRIBUTING.md` funcionan en GitHub.
5. Pendiente de una persona: releer `docs/USO.md` con calma y probar la calibración con su laminador real; los valores de partida (caudal, potencia) son orientativos.

## Problemas conocidos
- El chunk del visor pesa ~560 kB (139 kB gzip) por three.js; se carga aparte con `import()` y `chunkSizeWarningLimit` sigue en 800 kB.
- Modelo de coste simplificado: no incluye soportes, balsa ni purga; la cáscara (área × grosor) sobreestima en piezas muy detalladas.
- OBJ: los polígonos cóncavos (caras de más de 3 vértices) se trianguan en abanico y pueden salir mal; los OBJ y 3MF no se han probado con archivos reales de laminadores (solo con los construidos en los tests y una prueba manual en Chrome).
- Mallas muy grandes (> 400 000 triángulos) no dibujan las aristas marcadas, por rendimiento. Con mallas grandes (< 400 000) el `EdgesGeometry` y las normales del visor se calculan aún en el hilo principal (unos cientos de ms de bloqueo tras la lectura).
- Si falla la lectura de un archivo, se mantiene la pieza anterior en pantalla junto al aviso de error (intencionado, pero puede confundir).
- El enlace `#ejemplo` solo se atiende al cargar la página (no escucha `hashchange`).
- El visor con teclado usa lo que da OrbitControls (flechas desplazan, Mayús + flechas giran); no hay zoom con teclado.

## Registro de sesiones
- 2026-09-29 lead (main): creación del repositorio y reparto del equipo.
- 2026-09-29 builder (agent/builder): MVP completo (parser, geometría, presupuesto, visor, UI, tests, CI, Pages, README, captura) y PR abierto a main.
- 2026-09-30 qa (agent/qa): revisión y endurecimiento (parser, soldado con tolerancia, Web Worker, carga diferida de three.js, redondeo por líneas, accesibilidad, Open Graph, aviso de unidades), 57 → 132 tests; PR #2 contra agent/builder.
- 2026-09-30 docs · Claude Code Sonnet (agent/docs): `docs/USO.md` y `CONTRIBUTING.md`, sección «Documentación» y «Cómo se ha hecho» del README, fila docs de AGENTS.md; sin cambios de código; PR contra agent/qa.
- 2026-09-30 builder · Claude Code Sonnet (agent/builder-5-perfiles): #5 perfiles de impresora (`printers.ts`, selector, persistencia, tests) y actualización de AGENTS.md con el flujo por issues del hito.
- 2026-09-30 builder · Claude Code Sonnet (agent/builder-6-3mf-obj): #6 soporte de OBJ y 3MF (parsers, ZIP a mano, detección de formato, avisos iguales que STL, interfaz y tests).
