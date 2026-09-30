# Contribuir a printquote

Gracias por querer ayudar. Esta guía es breve; las reglas completas del proyecto están en [`AGENTS.md`](AGENTS.md) y el estado y las decisiones, en [`MEMORY.md`](MEMORY.md). Léelos antes de empezar. La guía para personas usuarias es [`docs/USO.md`](docs/USO.md).

## Requisitos

- **Node 22.12 o superior** (el CI usa Node 22) y **npm**.
- Un navegador moderno con WebGL para probar el visor.

```bash
git clone https://github.com/BertMarti/printquote.git
cd printquote
npm ci
npm run dev        # http://localhost:5173/printquote/
```

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo con recarga en caliente. |
| `npm run lint` | ESLint sobre todo el proyecto. |
| `npm run typecheck` | TypeScript estricto sobre `src/` y `tests/`. |
| `npm test` | Tests unitarios y de interfaz (Vitest). `npm run test:watch` los deja escuchando. |
| `npm run build` | Comprueba tipos y genera la web estática en `dist/`. |
| `npm run preview` | Sirve `dist/` en <http://localhost:4173/printquote/>. |
| `npm run sample` | Regenera la pieza de ejemplo `public/samples/soporte-movil.stl`. |

Antes de abrir un PR: `npm run lint && npm test && npm run build` en verde. El CI lo repite en Ubuntu y Windows.

## Ramas y pull requests

- `main` está protegida: **nunca se hace commit directo**. Crea una rama desde `main` (`feat/...`, `fix/...`, `docs/...`; el equipo de agentes usa `agent/<rol>/<n>-<slug>`, con `<n>` el número de su issue) y abre un pull request.
- Rellena la plantilla del PR (qué cambia, cómo se ha verificado, checklist).
- Cambios pequeños y con sentido propio, un tema por PR.
- Anota los cambios visibles para quien use la web en `CHANGELOG.md`, bajo «Sin publicar» ([Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/): Añadido, Cambiado, Corregido…).
- Actualiza `MEMORY.md` al terminar (estado, decisiones, siguiente paso y una línea en «Registro de sesiones»).
- No subas claves, tokens ni datos personales: el repositorio es público. No añadas dependencias sin justificarlas en «Decisiones» de `MEMORY.md`.

## Commits

[Commits convencionales](https://www.conventionalcommits.org/es/) en español: `feat:`, `fix:`, `test:`, `docs:`, `ci:`, `chore:`, `refactor:`, `perf:`. Ejemplo: `fix: importes redondeados a céntimos línea a línea`.

## Dónde está cada cosa

La interfaz está en español e inglés y la documentación, en español; los nombres del código, en inglés.

| Qué | Dónde | Cómo se prueba |
|---|---|---|
| Lectura de STL (binario y ASCII) | `src/stl/parse.ts` | `tests/parse.test.ts`, `tests/parse-edge.test.ts` |
| Volumen, superficie, caja, aristas abiertas, avisos y «¿cabe en la cama?» | `src/stl/geometry.ts` | `tests/geometry.test.ts`, `tests/weld.test.ts` |
| Worker y respaldo en el hilo principal | `src/stl/stl.worker.ts`, `src/stl/analyzer.ts`, `src/stl/analyze.ts` | `tests/analyzer.test.ts` |
| Fórmulas del presupuesto (cáscara, relleno, peso, tiempo, energía, margen, redondeo) | `src/quote/model.ts` | `tests/quote.test.ts`, `tests/quote-edge.test.ts` |
| Materiales y densidades | `src/quote/materials.ts` | `tests/quote.test.ts` |
| Ajustes, valores por defecto y rangos (`LIMITS`) | `src/quote/settings.ts` | `tests/quote.test.ts` |
| Formato de números y moneda según el idioma, y lectura de números | `src/quote/format.ts` | `tests/format.test.ts`, `tests/i18n.test.ts` |
| Textos e idiomas (diccionarios `es`/`en`, `t()`, idioma inicial) | `src/i18n/` | `tests/i18n.test.ts`, `tests/ui-i18n.test.ts` |
| Perfiles de impresora | `src/quote/printers.ts` | `tests/printers.test.ts` |
| Lectura de OBJ y 3MF (ZIP y XML a mano) | `src/stl/obj.ts`, `src/stl/threemf.ts`, `src/stl/zip.ts`, `src/stl/xml.ts`, `src/stl/model.ts` | `tests/obj.test.ts`, `tests/threemf.test.ts`, `tests/zip.test.ts` |
| IVA y datos del negocio | `src/quote/tax.ts`, `src/quote/business.ts` | `tests/pdf.test.ts`, `tests/pdf-ui.test.ts` |
| Presupuesto en PDF (contenido puro y dibujo con pdf-lib) | `src/pdf/` | `tests/pdf.test.ts` |
| Texto para copiar | `src/quote/text.ts` | `tests/format.test.ts` |
| Interfaz, campos, hoja de impresión | `index.html`, `src/ui/`, `src/styles.css` | `tests/ui.test.ts` (carga el `index.html` real con happy-dom), `tests/meta.test.ts` |
| Visor three.js | `src/viewer/` | a mano en el navegador (`npm run dev`) |

### Textos e idiomas

Todo texto que ve una persona sale de `src/i18n/es.ts` (idioma de referencia) y `src/i18n/en.ts`, que deben tener las mismas claves y los mismos `{marcadores}` (lo comprueba el compilador y `tests/i18n.test.ts`). En el código se usa `t('clave', { marcador: valor })`. En `index.html` el texto en español va escrito tal cual y se marca con `data-i18n="clave"` (o `data-i18n-attr="atributo:clave"`); el test comprueba que coincide con el diccionario. Los errores de lectura llevan un código (`ModelParseError`) y se traducen en la interfaz. Para añadir un idioma: una constante en `src/i18n/`, su entrada en `DICTIONARIES` y `LOCALES`, y un botón en la cabecera. Para añadir un texto, mira [Añadir una clave de traducción](#añadir-una-clave-de-traducción).

### Cómo testear una fórmula

Las fórmulas de `src/quote/` y `src/stl/geometry.ts` son **funciones puras**: mismos datos, mismo resultado. Para cambiar una:

1. Escribe primero el caso en `tests/quote.test.ts` con un cálculo hecho a mano. Los STL de prueba se construyen en memoria con los ayudantes de `tests/helpers/mesh.ts` (por ejemplo, `cubeTriangles`); no se suben archivos STL al repositorio.
2. Un cubo de 20 mm (V = 8 000 mm³, A = 2 400 mm²) con los valores por defecto es la referencia del README: 3 328 mm³ impresos, 4,13 g, 12 min y 0,10 €.
3. Si cambia una fórmula o un valor por defecto, actualiza también el README y `docs/USO.md`: deben coincidir con el código.

## Añadir un material

1. **`src/quote/materials.ts`**: añade el identificador al tipo `MaterialId`, la entrada en `MATERIALS` (nombre, densidad en g/cm³ y precio por defecto en €/kg) y el identificador en `MATERIAL_IDS`.
2. **`src/quote/settings.ts`**: añade el precio por defecto a `DEFAULT_SETTINGS.pricePerKg` (la lista es explícita).
3. **`index.html`**: añade su botón `<label class="segment">…` dentro del `fieldset` de material, con la densidad. La interfaz lee los materiales desde ahí.
4. **Tests**: revisa `tests/quote.test.ts` y `tests/quote-edge.test.ts` (asumen cuatro materiales en algunos casos, p. ej. `MATERIAL_IDS[i % 4]` y la comparación de `pricePerKg`) y añade un caso con el peso de un relleno del 100 % con la nueva densidad.
5. **Documentación**: actualiza las tablas de materiales del README y de `docs/USO.md`.

## Añadir un perfil de impresora

Los perfiles son datos: no hay que tocar la interfaz.

1. **`src/quote/printers.ts`**: añade un objeto a `PRINTERS` con `id` (minúsculas y guiones, único y distinto de `custom`), `name`, `flowRate` (mm³/s), `powerWatts` (W), `bedX`, `bedY`, `bedZ` (mm) y `note`. Criterio de los valores: la **cama** sale de la ficha técnica del fabricante; el **caudal** y la **potencia** son estimaciones redondeadas de un uso normal con PLA, muy por debajo del máximo publicitario. Todos dentro de `LIMITS` (`src/quote/settings.ts`).
2. **`note`** es una lista de claves de texto que se unen en la nota que ve la persona usuaria: usa `[BED, ESTIMATE]` y, si el modelo necesita una advertencia (cerrada, otras variantes con otra altura…), una clave propia `printer.note.<id>` en `src/i18n/es.ts` y `en.ts` (mira [Añadir una clave de traducción](#añadir-una-clave-de-traducción)).
3. El selector, el guardado en `localStorage` y el paso a «Personalizada» al editar un valor salen solos de esa lista: `normalizeSettings` mantiene el perfil solo mientras caudal, potencia y cama coinciden con él.
4. **Tests**: `tests/printers.test.ts` recorre `PRINTERS` y comprueba límites, identificadores únicos y que la nota (en español) menciona al fabricante y las estimaciones. Añade el nombre a la lista de modelos de ese test.
5. **Documentación**: la tabla de perfiles de `docs/USO.md` (sección 7), el README si nombra los modelos y `CHANGELOG.md`.

## Añadir una clave de traducción

Todo texto que ve una persona sale de `src/i18n/`. Para añadir uno:

1. Añade la clave a **`src/i18n/es.ts`** (idioma de referencia) con el formato `grupo.nombre`, por ejemplo `'pdf.footer'`. Los datos variables van como `{marcador}`. Las claves de errores de lectura empiezan por `err.` (las únicas que admite `ModelParseError`).
2. Añade **la misma clave a `src/i18n/en.ts`**, con los mismos `{marcadores}`. Si falta, el compilador falla (`en` es un `Record<Key, string>`).
3. Úsala con `t('grupo.nombre', { marcador: valor })`. En `index.html`, escribe el texto en español tal cual y marca el elemento con `data-i18n="grupo.nombre"` (o `data-i18n-attr="atributo:grupo.nombre"`). Si el texto se calcula al pintar (no se escribe una sola vez), hay que repintarlo al cambiar de idioma: `applyLanguage` en `src/ui/app.ts`. Las etiquetas del PDF además pasan por `src/pdf/labels.ts` y `PdfLabels`.
4. **El test que lo vigila es `tests/i18n.test.ts`**. Falla si: a un idioma le falta una clave, alguna clave usa otros `{marcadores}`, hay un texto vacío, una frase de más de 40 caracteres es idéntica en español e inglés (casi seguro un olvido), hay una clave que no se usa en ningún sitio de `src/` o `index.html` (huérfana), el código pide una clave que no existe, o el español del HTML estático no coincide con el diccionario. Si compones una clave en tiempo de ejecución (como `format.${…}`), hay que añadir su prefijo a `dynamic` en el test de claves huérfanas.
5. Ejecuta `npm test` y mira la interfaz en los dos idiomas (`npm run dev`, selector ES / EN).

## Añadir un formato de archivo

Los formatos (STL, OBJ, 3MF) solo aportan un lector: el análisis geométrico y los avisos son comunes (`analyzeModel` en `src/stl/analyze.ts`).

1. **Lector** en `src/stl/<formato>.ts`: recibe un `Uint8Array` y devuelve un `Mesh` (`positions` con 9 números por triángulo, **en milímetros**: convierte las unidades si el formato las guarda; si no, se asumen mm). Los errores son `ModelParseError('err.<formato>.<motivo>', { datos })`, con sus claves en español e inglés. Sin dependencias nuevas si se puede (el ZIP y el XML del 3MF se leen a mano).
2. **`src/stl/types.ts`**: añade el valor a `MeshFormat` y las claves `format.<valor>` en `es.ts` y `en.ts` (es la etiqueta que sale bajo el nombre de la pieza).
3. **`src/stl/model.ts`**: la extensión en `MODEL_EXTENSIONS`, el tipo en `Kind`, la detección en `detectKind` (el contenido manda; la extensión solo desempata entre textos) y la llamada en `parseModel`.
4. **`index.html`**: el atributo `accept` del selector de archivos (extensión y tipo MIME) y los textos que enumeran los formatos (`empty.text`, `meta.description`, etc., también en el diccionario).
5. **Tests**: `tests/<formato>.test.ts` con los archivos construidos en memoria (`tests/helpers/mesh.ts` y `tests/helpers/zip.ts`; no se suben archivos al repositorio), casos de error y de detección, y una prueba en `tests/ui-formats.test.ts` de que la interfaz lo carga y lo rotula.
6. **Documentación**: la sección 3 de `docs/USO.md` (unidades y qué da error), el README y `CHANGELOG.md`.

## Reglas de diseño

El diseño es una «hoja técnica suiza» (detalle en [`AGENTS.md`](AGENTS.md)). Lo que más se rompe sin querer:

- **El acento naranja `#ff5a1f` nunca se usa como color de texto sobre fondo claro**: no llega a 3:1 de contraste. Solo va en rellenos (con texto de tinta encima) y como cifra sobre fondo tinta.
- **Las cifras van en monoespaciada** (clase `.num`, `ui-monospace`, `tabular-nums`) y alineadas.
- Un único acento, sin sombras ni degradados, esquinas rectas, retícula fina.
- Mantén el modo oscuro (`prefers-color-scheme`) y el contraste AA en ambos modos.
- Los tiempos se rotulan siempre como **estimación**.
- Accesibilidad: todo control con etiqueta, uso completo con teclado, foco visible y regiones vivas sin repeticiones. El foco usa contorno de tinta.
- Todo texto visible sale de `src/i18n/` en español e inglés; números y fechas con `Intl` según el idioma activo (`es-ES`: coma decimal; `en-GB`: punto decimal). La moneda es siempre el euro.

## Licencia

Al contribuir aceptas que tu aportación se publique bajo la licencia [MIT](LICENSE) del proyecto.
