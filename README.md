# printquote

**Presupuesta una impresión 3D en segundos: arrastra un STL, OBJ o 3MF, míralo en 3D y obtén peso, tiempo estimado y precio. Tu archivo no sale de tu navegador.**

[![CI](https://github.com/BertMarti/printquote/actions/workflows/ci.yml/badge.svg)](https://github.com/BertMarti/printquote/actions/workflows/ci.yml)
[![Despliegue](https://github.com/BertMarti/printquote/actions/workflows/deploy.yml/badge.svg)](https://github.com/BertMarti/printquote/actions/workflows/deploy.yml)
[![Licencia: MIT](https://img.shields.io/badge/licencia-MIT-111111.svg)](LICENSE)

**Demo:** <https://bertmarti.github.io/printquote/> · [abrir con la pieza de ejemplo](https://bertmarti.github.io/printquote/#ejemplo)

![printquote: visor 3D a la izquierda con un soporte de móvil naranja sobre la rejilla de la cama y, a la derecha, la ficha técnica con el perfil de impresora y el presupuesto](docs/captura.png)

## Qué hace

- **Carga STL** (binario o ASCII), **OBJ** y **3MF** arrastrándolos a la ventana o con «Abrir modelo 3D». ¿Sin archivo? «Probar con pieza de ejemplo».
- **Modo demo en tiempo real**: «Ver demo» (cabecera) carga la pieza de ejemplo, gira la cámara, cambia material y relleno con el total recalculándose en vivo y devuelve tus ajustes en ~13 s. Se para con un segundo clic, Esc o cualquier interacción; con «reducir movimiento» va paso a paso con «Siguiente»; no guarda nada y, para los lectores de pantalla, anuncia una sola vez al terminar.
- **Mide la pieza**: volumen, superficie, caja envolvente (X × Y × Z en mm) y número de triángulos.
- **Avisa** si la malla parece abierta o tiene las normales invertidas, si no cabe en tu cama (por defecto 220 × 220 × 250 mm) o si mide menos de 1 mm (¿exportada en metros o pulgadas?).
- **Visor 3D** con la pieza apoyada en la cama, rejilla de 10 mm, órbita, zoom (rueda, pellizco o teclas + y −) y «Restablecer vista».
- **Perfiles de impresora**: elige Bambu Lab A1 o P1S, Prusa MK4 o MINI+, Creality Ender-3 V3 o K1, Elegoo Neptune 4 (o «Personalizada») y se rellenan caudal, potencia y cama con valores de partida **orientativos**; al editar cualquiera de ellos vuelve a «Personalizada».
- **Lote**: presupuesta un pedido de varias piezas (bloque «06 Lote»): cada pieza se añade con los ajustes del momento (el lote se guarda en tu navegador y vuelve al recargar), la lista muestra volumen, peso, tiempo, copias (editables en la propia línea) e importe, y el total suma las líneas ya redondeadas a céntimos con el mismo modelo de coste que una pieza suelta (`src/quote/batch.ts`). «Copiar lote» y «PDF del lote» (con el IVA sobre la suma y varias páginas si hace falta) llevan todas las piezas.
- **Presupuesto en vivo**: material, relleno, perímetros, caudal, energía, margen y copias. Cualquier cambio recalcula al instante.
- **Copiar presupuesto** en texto plano, **Imprimir** una hoja limpia con la vista 3D y el desglose (con un lote en curso, «Imprimir lote» saca la tabla de todas las piezas y el total), o **Descargar PDF**: un presupuesto de una página (o de varias si es un lote grande) con el nombre y el logotipo de tu negocio, tus datos de contacto, número, fecha, validez, desglose e **IVA** (21 % por defecto, configurable). Los datos del negocio se rellenan una vez en el bloque plegable «Datos del negocio» y se guardan en tu navegador. Límites: A4 (una página; el PDF de un lote pasa a varias si hace falta), sin campo de cliente, y el PDF incrusta Noto Sans y JetBrains Mono (latino, griego y cirílico); chino, japonés y emojis salen como «?».
- **Español e inglés**: el idioma inicial sale de tu navegador (`navigator.language`), se cambia con el selector ES / EN de la cabecera y se recuerda. Textos, avisos, errores, números, moneda, fechas y PDF cambian de idioma (la moneda sigue siendo el euro).
- **Historial de presupuestos**: guarda cada presupuesto, o un lote entero, con pieza, cliente opcional, parámetros y resultado en tu navegador; reabre una pieza con sus parámetros o un lote entero en el bloque 06, bórralo o **expórtalo a CSV** (`;` y coma decimal en español, `,` y punto en inglés; protegido contra inyección de fórmulas). Hasta 100 (el máximo real depende del espacio libre del navegador: ≈ 1,1 kB por pieza); nunca guarda el archivo 3D.
- **Enlace para compartir los parámetros**: «Copiar enlace» pone material, precios, impresora, relleno, copias y demás en el hash de la URL (`#v=1&mat=PETG&…`); quien lo abre solo arrastra su pieza. Nunca lleva el archivo 3D, la pieza, el cliente ni los datos del negocio, y abrirlo no pisa los ajustes guardados de quien lo recibe.
- **App instalable y sin conexión (PWA)**: se instala desde el navegador y, tras la primera visita, se abre y calcula sin red; el PDF también, una vez descargado el generador (la primera vez que lo pides). Un service worker propio, sin dependencias, versiona la caché para no dejar la app vieja.
- Recuerda tus ajustes en este navegador (`localStorage`). Modo claro y oscuro automático.

## Cómo se calcula

Todas las fórmulas viven en [`src/quote/`](src/quote) como funciones puras y con tests. Es un **modelo simplificado** a propósito: sirve para presupuestar rápido, no sustituye al laminador.

### Geometría ([`src/stl/geometry.ts`](src/stl/geometry.ts))

| Magnitud | Fórmula |
|---|---|
| Volumen *V* | Suma de los tetraedros con signo que forma cada triángulo (*a*, *b*, *c*) con un punto de referencia: Σ *a* · (*b* × *c*) / 6, en valor absoluto. |
| Superficie *A* | Σ ‖(*b* − *a*) × (*c* − *a*)‖ / 2 |
| Caja | Mínimos y máximos de X, Y y Z. |
| ¿Malla cerrada? | Cada arista debe compartirse por exactamente dos triángulos y el volumen con signo no debe ser ≈ 0. Si es negativo, las normales están invertidas. Antes se sueldan los vértices a menos de 10⁻⁴ mm (más lejos del origen, 10⁻⁶ × la coordenada) para no dar falsos avisos por redondeos del exportador. |

Se asume que el STL y el OBJ están en **milímetros** (no guardan unidades); el 3MF sí las guarda y se convierten a mm. Para saber si cabe en la cama se permite girar la pieza 90° sobre Z.

### Presupuesto ([`src/quote/model.ts`](src/quote/model.ts))

```text
grosor de pared   = perímetros × ancho de línea                (2 × 0,45 mm)
cáscara           = mín(A × grosor de pared, V)
relleno           = relleno% × (V − cáscara)
volumen impreso   = cáscara + relleno                          (por copia)

peso (g)          = volumen impreso (cm³) × densidad (g/cm³)
coste material    = peso (kg) × precio (€/kg)
tiempo (h)        = volumen impreso / caudal (mm³/s) + 5 min    ← estimación, por copia
energía (kWh)     = potencia media (W) × tiempo (h) / 1000
coste energía     = energía × precio (€/kWh)

subtotal          = (coste material + coste energía) × copias
margen            = subtotal × margen%
TOTAL             = subtotal + margen
```

Cada importe (material, energía, margen) se redondea a céntimos y el subtotal y el total son la suma de esas líneas, como en una factura: lo que ves en el desglose siempre suma el total.

Valores por defecto (todos editables):

| Material | Densidad | Precio |
|---|---|---|
| PLA | 1,24 g/cm³ | 20 €/kg |
| PETG | 1,27 g/cm³ | 24 €/kg |
| ABS | 1,04 g/cm³ | 22 €/kg |
| TPU | 1,21 g/cm³ | 35 €/kg |

Relleno 20 % · 2 perímetros de 0,45 mm · caudal 8 mm³/s · sobrecarga 5 min por copia · 120 W · 0,15 €/kWh · margen 30 % · 1 copia.

**Ejemplo:** un cubo de 20 mm (V = 8 000 mm³, A = 2 400 mm²) en PLA con los valores por defecto → cáscara 2 160 mm³ + relleno 1 168 mm³ = 3 328 mm³ → 4,13 g → 0,08 € de material, 0,00 € de energía, 0,02 € de margen, 12 min de impresión estimada y 0,10 € en total.

**Límites honestos del modelo:** no tiene en cuenta soportes, balsa, purga, altura de capa ni la velocidad real de cada movimiento, y la cáscara se aproxima como área × grosor (sobreestima algo en piezas con muchos detalles finos). El tiempo es siempre una **estimación**; el laminador dará la cifra real.

## Privacidad

El STL, OBJ o 3MF se lee con la API de archivos del navegador y se procesa en tu equipo. No hay servidor, ni analítica, ni cookies: la web es estática (GitHub Pages) y **tu archivo no sale de tu navegador**. Si compartes un enlace con los parámetros, va solo en el *hash* de la dirección (que no se envía a ningún servidor) y nunca incluye el archivo, la pieza, el cliente ni tus datos del negocio. Los ajustes y los datos del negocio (incluido el logotipo, ya reducido) se guardan solo en el `localStorage` de tu navegador (igual que el historial de presupuestos, que no incluye el archivo 3D), y el PDF se genera también en tu navegador: nada se envía a ningún servidor.

## Uso en local

Requisitos: Node 22.12 o superior y npm.

```bash
git clone https://github.com/BertMarti/printquote.git
cd printquote
npm ci
npm run dev        # http://localhost:5173/printquote/
```

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo con recarga en caliente. |
| `npm test` | Tests unitarios (Vitest). |
| `npm run lint` | ESLint. |
| `npm run typecheck` | TypeScript estricto sobre `src/` y `tests/`. |
| `npm run build` | Comprueba tipos y genera la web estática en `dist/`. |
| `npm run preview` | Sirve `dist/` en <http://localhost:4173/printquote/>. |
| `npm run sample` | Regenera la pieza de ejemplo `public/samples/soporte-movil.stl`. |

## Stack

- **TypeScript** estricto y **Vite**. Sin frameworks de UI: DOM y CSS propios.
- **three.js** (con `OrbitControls`) para el visor.
- **Vitest** para tests y **ESLint** (flat config con `typescript-eslint`).
- **GitHub Actions**: CI en Ubuntu y Windows, y despliegue en **GitHub Pages**.
- Parser STL propio: distingue binario y ASCII por el contenido y el tamaño, no solo por la cabecera `solid`. Lee el ASCII byte a byte (sin picos de memoria) y tolera BOM, CR/LF mezclados y nombres de sólido con palabras clave.
- **OBJ y 3MF:** el OBJ (`v`/`f`, caras de más de 3 vértices trianguladas, también las cóncavas hasta 200 vértices (de ahí en adelante, en abanico y con aviso), e índices negativos) y el 3MF (ZIP leído a mano y descomprimido con `DecompressionStream`, sin dependencias, con un tope de 6 millones de triángulos; varios objetos, transformaciones de `item` y `component`, unidades, y componentes en otros `.model` como los de Bambu Studio) pasan por el mismo análisis geométrico y los mismos avisos que el STL. Un 3MF de 250 000 triángulos se lee en ~1 s.
- **PDF:** [`pdf-lib`](https://pdf-lib.js.org/) (MIT, JavaScript puro, sin dependencias nativas) dibuja el PDF e incrusta, con [`@pdf-lib/fontkit`](https://github.com/Hopding/fontkit) (MIT), Noto Sans y JetBrains Mono (licencia OFL, en `src/pdf/fonts/`, recortadas a latino, griego y cirílico; ~224 kB). Todo se carga solo al pulsar «Descargar PDF» (`import()` y `fetch`): no pesa en el JS inicial (la parte de PDF, ~1,1 MB sin comprimir, y las fuentes van en archivos aparte). El PDF solo lleva los glifos usados (~30 kB). El contenido se calcula aparte en una función pura (`src/pdf/document.ts`) y el IVA en `src/quote/tax.ts` (cuota redondeada a céntimos; el total con IVA es siempre base + cuota).
- **Idiomas:** diccionarios tipados en `src/i18n/` (`es.ts` de referencia y `en.ts`), sin dependencias; formato con `Intl.NumberFormat` / `Intl.DateTimeFormat` (`es-ES` y `en-GB`). Un test falla si a un idioma le falta una clave o usa otros `{marcadores}`, y otro comprueba que el HTML estático coincide con el diccionario. Los errores de lectura viajan como código + datos desde el Web Worker y se traducen en la interfaz.
- **Rendimiento:** el parseo y la geometría corren en un **Web Worker** (la interfaz no se congela con STL grandes; si el navegador no puede crear el worker, se hace en el hilo principal). three.js se carga bajo demanda: el JS inicial pesa ~78 kB (27 kB gzip; casi la mitad son los dos diccionarios de textos) y el visor y el PDF llegan en sus propios archivos.

## Estructura

```text
src/
  stl/        parsers STL, OBJ y 3MF (ZIP + XML), geometría (volumen, área, caja, aristas abiertas) y Web Worker
  quote/      modelo de coste, lote de piezas (`batch.ts`), materiales, perfiles de impresora, ajustes, IVA, datos del negocio, historial y CSV, enlace para compartir (`share.ts`), formato es-ES y presupuesto en texto
  pdf/        contenido del presupuesto en PDF (puro) y su dibujo con pdf-lib
  viewer/     visor three.js (cama, cámara, luces)
  sw.js       service worker (plantilla que el plugin de Vite copia a `dist/sw.js` con la versión y el precaché)
  ui/         controles, almacenamiento, hoja de impresión y arranque de la app
  styles.css  diseño «hoja técnica suiza», modo oscuro e impresión
tests/        pruebas unitarias y de interfaz (happy-dom); los STL de prueba se construyen en memoria
scripts/      generador de la pieza de ejemplo, plugin de la PWA, iconos y capturas (Chrome headless)
public/       favicon, iconos, manifiesto de la PWA y pieza de ejemplo original
.github/      CI, despliegue y plantilla de PR
```

## Diseño

«Hoja técnica suiza»: fondo papel `#f6f5f2`, tinta `#111`, líneas `#d9d6cf` y un único acento naranja filamento `#ff5a1f`. Retícula fina, esquinas rectas, sin sombras ni degradados y cifras monoespaciadas alineadas. Visor grande a la izquierda y ficha estrecha a la derecha; en móvil, uno debajo del otro.

Accesibilidad: todos los controles tienen etiqueta, la app se puede usar entera con teclado (↑/↓ ajustan los números, con Mayús de 10 en 10), el foco es visible y los textos cumplen contraste AA. El naranja nunca se usa como color de texto sobre fondo claro.

## Documentación

- [**Guía de uso**](docs/USO.md): cómo abrir un STL, OBJ o 3MF, leer los avisos, elegir impresora y ajustes, calibrarlos con tu laminador, rellenar los datos del negocio, descargar el PDF y cambiar el idioma.
- [**Registro de cambios**](CHANGELOG.md): qué trae cada versión (v0.1.0 y v0.2.0).
- [**Guía de contribución**](CONTRIBUTING.md): requisitos, comandos, ramas, commits, cómo añadir un material, un perfil de impresora, una clave de traducción o un formato de archivo, y dónde está cada fórmula.

## Contribuir

1. Lee [`CONTRIBUTING.md`](CONTRIBUTING.md), [`AGENTS.md`](AGENTS.md) (reglas, diseño y estructura) y [`MEMORY.md`](MEMORY.md) (estado actual).
2. Crea una rama desde `main`: `main` está protegida y todo entra por pull request.
3. Commits convencionales en español (`feat:`, `fix:`, `test:`, `docs:`…).
4. Antes de abrir el PR: `npm run lint && npm test && npm run build` en verde.
5. Rellena la plantilla del PR.

## Cómo se ha hecho

printquote se ha construido con un **equipo de agentes de IA** en el que cada agente trabaja en su rama y entrega por pull request, con un **lead** que coordina, **builder** que implementa, **qa** que revisa y **docs** que documenta:

- **v0.1.0 (MVP):** el lead y el builder, con Claude Code (Claude Opus); qa y docs, con Claude Code (Claude Sonnet).
- **v0.2.0:** todo el trabajo, con Claude Code (Claude Sonnet).
- La documentación estaba prevista para **OpenCode**, pero no pudo ejecutarse en modo autónomo, así que la hizo Claude Code.
- **Alberto** supervisa el trabajo, revisa cada pull request y es quien fusiona en `main`.

El reparto y las reglas del equipo están en [`AGENTS.md`](AGENTS.md) y la bitácora de decisiones, en [`MEMORY.md`](MEMORY.md).

## Licencia

[MIT](LICENSE). La pieza de ejemplo es un diseño original de este proyecto, con la misma licencia.

**Fuentes del PDF:** [Noto Sans](https://github.com/notofonts/latin-greek-cyrillic) (© The Noto Project Authors) y [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) (© The JetBrains Mono Project Authors), con licencia [SIL Open Font License 1.1](https://openfontlicense.org). Van recortadas en `src/pdf/fonts/` y las licencias completas se publican junto a la web, en [`/fonts/OFL-NotoSans.txt`](public/fonts/OFL-NotoSans.txt) y [`/fonts/OFL-JetBrainsMono.txt`](public/fonts/OFL-JetBrainsMono.txt).
