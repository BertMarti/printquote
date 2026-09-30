# Registro de cambios

Todos los cambios relevantes de printquote se anotan aquí. El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa [versionado semántico](https://semver.org/lang/es/).

## [Sin publicar]

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

[Sin publicar]: https://github.com/BertMarti/printquote/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/BertMarti/printquote/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/BertMarti/printquote/releases/tag/v0.1.0
