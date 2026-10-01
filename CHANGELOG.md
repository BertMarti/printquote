# Registro de cambios

Todos los cambios relevantes de printquote se anotan aquí. El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa [versionado semántico](https://semver.org/lang/es/).

## [Sin publicar]

### Añadido

- **Reabrir un lote guardado desde el historial** (#52): «Abrir» en una entrada de lote carga las líneas en el bloque «06 Lote» (se despliega) y restaura el cliente, sin necesidad de pieza 3D. Se guarda lo mínimo para reconstruir cada línea (`surfaceMm2` además de nombre, medidas y ajustes; nunca la geometría) y las líneas se recalculan con `computeQuote`. Con un lote en curso, el botón pide un segundo clic («¿Reemplazar el lote?»). Los lotes guardados con 0.6.0 (sin área) se siguen listando, exportando y borrando, pero no se abren.
- **El lote sobrevive a recargar** (#51): se guarda en `localStorage` (`printquote:lote:v1`, con versión de esquema) tras cada cambio y se recupera al arrancar. Cada línea se guarda como una pieza del historial (nombre, medidas, ajustes y resultado, **más el área de la superficie**, nunca la geometría) y al leer se valida igual de estrictamente que el historial (una pieza rota, un lote vacío, de más de 50 piezas o de otra versión del esquema se descarta entero) y se recalcula con `computeQuote`. Si el navegador no deja guardar, falla en silencio. `HistoryPart` gana `surfaceMm2` opcional (las entradas antiguas se leen igual).

### Corregido

- **Imágenes de 0.6.0 (#50)**: la entrada de 0.6.0 decía que `public/og.png` y `docs/captura.png` muestran el bloque «06 Lote»: no es así. Son capturas de la primera pantalla (visor y primeros bloques del panel, que se desplaza): muestran la interfaz actual (cabecera con «Ver demo», perfiles de impresora) pero el bloque 06 queda fuera de ellas.
- **«Lote lleno» (#50)**: al añadir la pieza 50 el anuncio dice que el lote está lleno y el foco pasa a «Copiar lote» (antes se quedaba en el botón desactivado).
- **Idioma durante el PDF (#50)**: cambiar de idioma con un PDF en curso ya no pierde «Generando…» en `#batch-pdf` (ni en `#pdf-button`).
- **Historial (#50)**: el nombre accesible de «Borrar» (y de «Abrir») en un lote dice «lote de N piezas»; comentarios de `history.ts` (tamaño ≈ 1,1 kB por pieza) y de `ui/history.ts` corregidos; README (A4 y lotes, redacción del historial) y USO (el máximo de 100 depende del espacio; el redondeo por línea puede mostrar «Energía 0,00 €»); la especificación v0.6 cita `tests/batch-output.test.ts`.

## [0.6.0] - 2026-10-01

Hito v0.6.0 «Lotes»: presupuesto de pedidos con varias piezas, service worker más ligero e imágenes actualizadas. Especificación en `docs/specs/v0.6.md`.

### Añadido

- **Lote: presupuesto de varias piezas** (#40): bloque «06 Lote» (plegable) con «Añadir esta pieza» (muestra su importe), una lista con nombre, material, volumen, peso, tiempo, copias e importe de cada línea, «Quitar» y «Vaciar lote» (dos clics), y el **total del lote**. Cada línea conserva los ajustes con que se añadió y usa `computeQuote` (`src/quote/batch.ts` solo suma líneas ya redondeadas a céntimos, como una factura). Hasta 50 piezas; vive en memoria. Foco y anuncios accesibles, sin desborde a 320 px.
- **Lote en el texto copiado y en el PDF** (#41): «Copiar lote» (texto con todas las piezas, su importe y el desglose del lote) y «PDF del lote» (tabla de piezas, desglose del lote y el IVA sobre la suma, sin vista 3D). El PDF pasa a **varias páginas** cuando no caben todas las piezas (cabecera de la tabla repetida y «Página n de N»). `buildBatchDocument` y `buildBatchText` reutilizan las utilidades de una pieza; el PDF de una pieza no cambia.
- **Lote en el historial** (#42): «Guardar lote» (bloque 08) guarda una entrada con cada pieza, sus ajustes y su resultado (`parts`) y el agregado del lote en el primer nivel; las entradas antiguas se leen igual y un lote con una pieza rota, vacío o de más de 50 piezas se descarta al leer. Se lista como «Lote de N piezas» (sin «Abrir»: no se guarda la geometría) y se borra como el resto. El CSV lleva **una fila por pieza**. El enlace para compartir no cambia.

### Cambiado

- **Service worker: menos descarga en la primera visita** (#46): al instalar, los `assets/*` (con hash en el nombre, inmutables) se precachean con `cache: 'default'` en vez de `reload`, así salen de la caché HTTP en lugar de pedirse dos veces (index, CSS y visor, ~177 KB gz de más). `index.html`, el manifiesto, el favicon, los iconos y la pieza de ejemplo siguen con `reload`. Una versión nueva se invalida igual que antes (caché con el nombre de la versión; las antiguas se borran al activar), con test.
- «Datos del negocio» pasa a ser el bloque 07 y «Presupuestos», el 08.
- **Imágenes actualizadas** (#43): `public/og.png` (vista previa al compartir el enlace) y `docs/captura.png` (README) regeneradas con `scripts/captura.mjs` con la interfaz actual (cabecera con «Ver demo», bloque «06 Lote»…): estaban desactualizadas desde v0.4.0.

## [0.5.0] - 2026-10-01

Hito v0.5.0 «Demo y pulido»: modo demo en tiempo real y pulido visual y de accesibilidad. Especificación en `docs/specs/v0.5.md`.

### Añadido

- **Modo demo en tiempo real** (#37): botón «Ver demo» (`aria-pressed`) en la cabecera. En ~13 s carga la pieza de ejemplo, gira la cámara despacio, cambia el material a PETG y el relleno al 40 % con el total recalculándose en vivo, resalta el bloque que cambia con un subtítulo breve y devuelve los ajustes (y la pieza) de la persona. Se detiene con un segundo clic, Esc, cualquier interacción, al soltar un archivo o cambiar el enlace, o al pasar la pestaña a segundo plano (y nunca pisa un archivo cargado a mitad de recorrido); con `prefers-reduced-motion` no corre sola (pasos manuales «Siguiente»). **No escribe en `localStorage`, en el historial ni en la URL**; un único anuncio `aria-live` al final; funciona sin conexión. Módulo `src/ui/demo.ts` con el guion en datos, sin dependencias nuevas; `Viewer.setAutoRotate`.

### Cambiado

- **Pulido visual y de accesibilidad** (#36), a partir de la auditoría de UX (ver `docs/specs/v0.5.md`, §2): la cabecera tiene un único botón primario («Abrir modelo 3D») y la pieza de ejemplo pasa a acción terciaria; el aviso del visor ya no tapa el nombre de la pieza ni el texto del estado vacío (banda superior en flujo); los rótulos del visor se leen sobre la rejilla; filete de acento sobre el total, que se compacta en pantallas bajas; dianas táctiles de 44 px o más con puntero táctil o en pantallas de hasta 900 px; la cama X/Y/Z pasa a tres columnas en pantallas de hasta 480 px (a 320 px la página desbordaba); el visor tiene un nombre accesible corto y las teclas como descripción; con el visor estrecho (901 a 1100 px) la ayuda se ajusta a su ancho y se oculta la leyenda de la cama, que chocaba con las medidas.

## [0.4.0] - 2026-10-01

Hito v0.4.0 «Pro»: herramienta para talleres (app instalable y sin conexión, historial de presupuestos y enlace para compartir). Especificación en `docs/specs/v0.4.md`.

### Añadido

- **Enlace para compartir los parámetros** (#32): «Copiar enlace» (bloque 07) copia una URL con los parámetros del presupuesto en el hash (`#v=1&mat=PETG&price=24&printer=…`), sin el archivo 3D, la pieza, el cliente ni los datos del negocio. Al abrirla se aplican **sin guardarlos** (no pisan los ajustes de quien la recibe) y solo hay que arrastrar la pieza; compatible con `#ejemplo`. Entrada rota u hostil: se ignora lo que no se entiende, se acotan los rangos, y una versión desconocida o un hash de más de 1000 caracteres se ignora entero. Lógica pura en `src/quote/share.ts`.
- **Historial de presupuestos** (#31): bloque «07 Presupuestos» para guardar cada presupuesto en el navegador (pieza, cliente opcional, parámetros y resultado tal como salió; nunca el archivo 3D ni los datos del negocio), listarlos, **reabrirlos con sus parámetros**, borrarlos (uno a uno o todos, con confirmación) y **exportarlos a CSV** (UTF-8 con BOM; `;` y coma decimal en español, `,` y punto en inglés; neutraliza las fórmulas). Hasta 100, con aviso al descartar el más antiguo. Lógica pura en `src/quote/history.ts`.
- **App instalable y sin conexión (PWA)** (#30): `manifest.webmanifest` con iconos (192, 512 y maskable, más el de iOS, generados desde el favicon con `scripts/iconos.mjs`) y un service worker propio, sin dependencias nuevas. Precachea la app, el visor y la pieza de ejemplo; el chunk del PDF y las fuentes se guardan la primera vez que se piden. Navegación con red primero (se ve la versión publicada) y respaldo en caché; la caché lleva la versión (hash del contenido de `dist/`) y se limpian las antiguas al activarse. El JS inicial crece 0,2 kB.

## [0.3.0] - 2026-10-01

Hito v0.3.0: PDF en cualquier alfabeto, metadatos traducidos, avisos y límites en OBJ y 3MF, zoom con teclado y capturas nuevas.

### Añadido

- **Licencias de las fuentes del PDF** publicadas con la web (`/fonts/OFL-NotoSans.txt` y `/fonts/OFL-JetBrainsMono.txt`) y créditos en el README.
- **Aviso específico si no se pueden descargar las fuentes del PDF** («Comprueba tu conexión»), traducido; el error se registra además en la consola.

- **Capturas nuevas** (#22): `docs/captura.png` y `public/og.png` (vista previa al compartir el enlace) muestran la interfaz de v0.2 con la pieza de ejemplo: selector de idioma, «Abrir modelo 3D», perfil de impresora y botón «Descargar PDF». `scripts/captura.mjs` las regenera con Chrome o Edge headless.
- **Zoom con teclado en el visor** (#21): con el visor enfocado, `+` (o `=`) acerca y `-` (o `_`) aleja un 15 % por pulsación, sin animación (respeta `prefers-reduced-motion`). Indicado en la pista de controles y en la etiqueta accesible del visor.
- **Tope de triángulos en 3MF** (#20): un 3MF con más de 6 millones de triángulos en total (contando cada instancia y copia) da un error claro y traducido en lugar de un `RangeError` genérico. El límite se comprueba durante la lectura, antes de reservar la memoria.
- **Aviso de polígonos OBJ muy grandes** (#19): si un OBJ trae caras de más de 200 vértices (que se triangulan en abanico aunque sean cóncavas) se avisa en la lista de avisos, en español e inglés, con el número de caras.
- **Metadatos al cambiar de idioma** (#18): `description`, `og:title`, `og:description`, `og:image:alt`, `og:locale` y las etiquetas `twitter:*` (nuevas: título, descripción, imagen y texto alternativo) salen de los diccionarios y cambian con el idioma.
- **PDF con fuente incrustada** (#17): el PDF lleva Noto Sans y JetBrains Mono (licencia OFL, con su licencia en `src/pdf/fonts/`) mediante `@pdf-lib/fontkit`, así que el cirílico y el griego se ven bien en lugar de «?». Las fuentes y fontkit solo se descargan al pulsar «Descargar PDF»; el JS inicial no crece.

## [0.2.0] - 2026-09-30

Hito v0.2.0: más formatos de entrada, perfiles de impresora, presupuesto en PDF e interfaz en inglés.

### Añadido

- **Perfiles de impresora** (#5, PR #11): selector «Impresora» con Bambu Lab A1 y P1S, Prusa MK4 y MINI+, Creality Ender-3 V3 y K1, Elegoo Neptune 4 y «Personalizada». Al elegir un perfil se rellenan caudal, potencia y cama con valores de partida **orientativos** (cada perfil lleva una nota con su origen). Editar cualquiera de esos tres datos vuelve a «Personalizada». La elección se guarda con los ajustes.
- **OBJ y 3MF** (#6, PR #12): además del STL, se abren archivos OBJ (caras de más de tres vértices, índices negativos, varios objetos) y 3MF (varios objetos, transformaciones, componentes en otros `.model` como los de Bambu Studio y conversión de unidades a milímetros). Sin dependencias: el ZIP y el XML del 3MF se leen a mano y se descomprimen con `DecompressionStream`. Los tres formatos pasan por el mismo análisis y los mismos avisos. El botón pasa a llamarse «Abrir modelo 3D» y el formato se detecta por el contenido, no solo por la extensión.
- **Presupuesto en PDF** (#7, PR #13): botón «Descargar PDF» con un presupuesto de una página con el nombre, NIF/CIF, dirección, contacto y logotipo del negocio, número de presupuesto, fecha, validez, vista 3D, desglose e **IVA** (21 % por defecto, configurable). Se dibuja con `pdf-lib`, cargada solo al pedir el PDF. Bloque plegable «Datos del negocio» con todo lo anterior, guardado solo en el navegador, y número de presupuesto que sube solo tras cada descarga.
- **Interfaz en inglés** (#8, PR #14): selector ES / EN en la cabecera. El idioma inicial sale del navegador (`navigator.language`), se recuerda y cambia interfaz, avisos, errores de lectura, notas de las impresoras, texto copiado, hoja de impresión, PDF, números y fechas (`es-ES` / `en-GB`; la moneda sigue siendo el euro). Un test comprueba que los dos diccionarios tienen las mismas claves y marcadores, y que el HTML estático coincide con el diccionario español.
- **Documentación** (#10): este registro de cambios, `docs/USO.md` con OBJ y 3MF, perfiles, datos del negocio, PDF e idioma, y `CONTRIBUTING.md` con cómo añadir un perfil, una clave de traducción y un formato de archivo.

### Cambiado

- El análisis del modelo (`analyzeModel`, asíncrono) sustituye a `analyzeStl` en el Web Worker y en su respaldo del hilo principal. Los errores de lectura pasan a ser `ModelParseError`, con código y datos, para traducirlos en la interfaz.
- El JS inicial pasa de ~50 kB a ~78 kB (27 kB gzip), sobre todo por los dos diccionarios; el visor y el PDF siguen cargándose bajo demanda.
- Nueva dependencia en ejecución: `pdf-lib` (MIT, sin dependencias nativas). Motivos y alternativas descartadas, en `MEMORY.md`.
- Los ajustes guardados con la versión 0.1.0 siguen cargando (sin perfil, como «Personalizada»). Los datos del negocio se guardan aparte, con su propia clave de `localStorage`.

### Corregido

Resultado de la revisión de QA (#9, PR #15):

- **OBJ:** las caras cóncavas se trianguan por recorte de orejas (antes en abanico, con superficie inflada y visor incorrecto); los índices que no caben en 32 bits se rechazan en lugar de cortarse; una barra invertida al final del archivo ya no se toma por un índice.
- **PDF:** las letras fuera de WinAnsi se transcriben (ć → c, ł → l, ș → s…) y solo salen como «?» si no hay equivalente; se eliminan los caracteres invisibles; el IVA admite dos decimales y se guarda y rotula igual (10,55 % salía «10,6 %»); las direcciones largas se recortan a 10 líneas.
- **3MF y ZIP:** una unidad desconocida es un error (antes se tomaba como milímetros sin avisar y «constructor» daba NaN); las entradas con tamaños `0xFFFFFFFF` dan un error claro de ZIP64; el mensaje del método de compresión no soportado es correcto.
- **Idioma:** al cambiar de idioma se traducen el indicador «Leyendo…» y el último anuncio de la región viva.

## [0.1.0] - 2026-09-30

Primera versión: el MVP.

### Añadido

- **Carga de STL** binario y ASCII con un parser propio (PR #1), arrastrando el archivo o con un botón; pieza de ejemplo original (`#ejemplo` en la URL la abre sola).
- **Medidas y avisos:** volumen, superficie, caja envolvente y triángulos; avisos de malla abierta, normales invertidas, pieza que no cabe en la cama (con giro de 90° sobre Z) y pieza de menos de 1 mm (posible error de unidades).
- **Visor 3D** con three.js: pieza apoyada en la cama, rejilla de 10 mm, órbita, zoom, «Restablecer vista» y manejo con teclado.
- **Presupuesto en vivo** con un modelo simplificado: material (PLA, PETG, ABS, TPU), relleno, perímetros, caudal, energía, margen y copias; importes redondeados a céntimos por línea. Copiar como texto e imprimir una hoja limpia.
- Diseño «hoja técnica suiza» con modo oscuro, accesibilidad (etiquetas, teclado, contraste AA) y ajustes guardados en `localStorage`.
- CI en Ubuntu y Windows y despliegue en GitHub Pages.
- **Revisión de QA** (PR #2): parser ASCII byte a byte, soldado de vértices con tolerancia, lectura en un Web Worker, three.js cargado bajo demanda, regiones vivas accesibles, Open Graph y tests de interfaz (57 → 132 tests).
- **Documentación** (PR #4): guía de uso (`docs/USO.md`) y guía de contribución (`CONTRIBUTING.md`).

[Sin publicar]: https://github.com/BertMarti/printquote/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/BertMarti/printquote/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/BertMarti/printquote/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/BertMarti/printquote/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/BertMarti/printquote/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/BertMarti/printquote/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/BertMarti/printquote/releases/tag/v0.1.0
