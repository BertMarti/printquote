# Desarrollo de printquote

Esta página reúne la información técnica del proyecto. La guía para personas usuarias está en [USO.md](USO.md); las normas para contribuir están en [CONTRIBUTING.md](../CONTRIBUTING.md).

## Índice

1. [Cómo se calcula](#cómo-se-calcula)
2. [Uso en local](#uso-en-local)
3. [Stack](#stack)
4. [Estructura](#estructura)
5. [Diseño](#diseño)
6. [Seguridad](#seguridad)
7. [Documentación](#documentación)
8. [Contribuir](#contribuir)
9. [Cómo se ha hecho](#cómo-se-ha-hecho)
10. [Funciones detalladas](#funciones-detalladas)
11. [Licencia y fuentes](#licencia-y-fuentes)

## Cómo se calcula

El modelo es deliberadamente simplificado: sirve para presupuestar rápido y no sustituye al laminador.

### Geometría

La geometría se calcula en [`../src/stl/geometry.ts`](../src/stl/geometry.ts).

| Magnitud | Fórmula |
|---|---|
| Volumen *V* | Suma de los tetraedros con signo de cada triángulo, Σ *a* · (*b* × *c*) / 6, en valor absoluto. |
| Superficie *A* | Σ ‖(*b* − *a*) × (*c* − *a*)‖ / 2. |
| Caja | Mínimos y máximos de X, Y y Z. |
| Malla cerrada | Cada arista debe compartirse por dos triángulos y el volumen con signo no debe ser aproximadamente cero. Si es negativo, las normales están invertidas. |

Antes del análisis se sueldan vértices a menos de 10⁻⁴ mm, o 10⁻⁶ veces la coordenada más grande lejos del origen. STL y OBJ se interpretan en milímetros; 3MF convierte sus unidades a milímetros. Para comprobar si cabe en la cama se permite girar la pieza 90° sobre Z.

### Presupuesto

Las fórmulas están en [`../src/quote/model.ts`](../src/quote/model.ts).

```text
grosor de pared   = perímetros × ancho de línea                (2 × 0,45 mm)
cáscara           = mín(A × grosor de pared, V)
relleno           = relleno% × (V − cáscara)
volumen impreso   = cáscara + relleno                          (por copia)

peso (g)          = volumen impreso (cm³) × densidad (g/cm³)
coste material    = peso (kg) × precio (€/kg)
tiempo (h)        = volumen impreso / caudal (mm³/s) + 5 min   (estimación, por copia)
energía (kWh)     = potencia media (W) × tiempo (h) / 1000
coste energía     = energía × precio (€/kWh)

subtotal          = (coste material + coste energía) × copias
margen            = subtotal × margen%
TOTAL             = subtotal + margen
```

Cada importe de material, energía y margen se redondea a céntimos. El subtotal y el total suman esas líneas ya redondeadas, como una factura.

Valores iniciales: PLA 1,24 g/cm³ y 20 €/kg; PETG 1,27 y 24 €/kg; ABS 1,04 y 22 €/kg; TPU 1,21 y 35 €/kg. También parten de 20 % de relleno, 2 perímetros de 0,45 mm, 8 mm³/s, 5 minutos por copia, 120 W, 0,15 €/kWh, 30 % de margen y una copia.

Ejemplo de referencia: un cubo de 20 mm (V = 8 000 mm³, A = 2 400 mm²) en PLA produce 3 328 mm³ impresos, 4,13 g, 12 minutos de impresión estimada y 0,10 € de total.

El modelo no incluye soportes, balsa, purga, altura de capa ni la velocidad real de cada movimiento. La cáscara aproxima superficie por grosor y puede sobreestimar piezas con muchos detalles. El tiempo es siempre una estimación.

El cálculo completo, con el ejemplo del soporte de móvil, está en [la sección 11 de la guía de uso](USO.md#11-cómo-se-calcula-con-un-ejemplo-completo).

## Uso en local

Requiere Node 20.19 o superior y npm; se recomienda Node 22.12, que es con el que se prueba en el CI (con [nvm](https://github.com/nvm-sh/nvm), `nvm install && nvm use` en la carpeta del proyecto lee `.nvmrc`). `npm run dev` y `npm run build` comprueban antes la versión y, si no vale, dicen qué instalar.

```bash
git clone https://github.com/BertMarti/printquote.git
cd printquote
npm ci
npm run dev        # http://localhost:5173/printquote/
```

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo con recarga en caliente. |
| `npm test` | Tests unitarios y de interfaz con Vitest (en una Raspberry Pi tarda varios minutos: añade `-- --maxWorkers=2` si va justa de memoria). |
| `npm run lint` | Ejecuta ESLint. |
| `npm run typecheck` | Comprueba TypeScript estricto. |
| `npm run build` | Comprueba tipos y genera `dist/`. |
| `npm run preview` | Sirve la compilación local. |
| `npm run sample` | Regenera la pieza de ejemplo. |

## Stack

- TypeScript estricto y Vite, sin framework de UI: DOM y CSS propios.
- three.js con `OrbitControls` para el visor.
- Vitest y ESLint con `typescript-eslint`.
- GitHub Actions para CI en Ubuntu y Windows y despliegue en GitHub Pages.
- Parsers propios para STL, OBJ y 3MF; el ZIP y XML del 3MF se leen sin dependencias adicionales.
- `pdf-lib` y `@pdf-lib/fontkit` para el PDF, cargados bajo demanda con `import()`.
- Diccionarios tipados en `../src/i18n/` y formatos con `Intl.NumberFormat` e `Intl.DateTimeFormat`.
- El parseo y la geometría usan Web Worker; three.js y el generador PDF se cargan bajo demanda.

## Estructura

```text
src/
  stl/        parsers STL, OBJ y 3MF, geometría y Web Worker
  quote/      modelo de coste, lotes, materiales, perfiles, IVA, historial y compartir
  pdf/        contenido puro del presupuesto y dibujo con pdf-lib
  viewer/     visor three.js, cama, cámara y luces
  sw.js       plantilla del service worker
  ui/         controles, almacenamiento, hoja de impresión y arranque
  styles.css  diseño, modo oscuro e impresión
scripts/      pieza de ejemplo, PWA, iconos y capturas
public/       favicon, iconos, manifiesto y pieza de ejemplo
.github/      CI, despliegue y plantilla de PR
```

## Diseño

La interfaz sigue una «hoja técnica suiza»: fondo papel `#f6f5f2`, tinta `#111111`, líneas `#d9d6cf` y un único acento naranja filamento `#ff5a1f`. Usa retícula fina, esquinas rectas, ausencia de sombras y degradados, y cifras monoespaciadas alineadas. El visor es grande a la izquierda y la ficha estrecha a la derecha; en móvil se apilan.

El modo oscuro responde a `prefers-color-scheme`. Los controles tienen etiqueta, la interfaz se puede usar con teclado, el foco es visible y el contraste es AA. El naranja no se usa como texto sobre fondo claro. Todo texto visible procede de los diccionarios español/inglés y los tiempos se rotulan como estimaciones.

## Seguridad

- **CSP**: `scripts/csp-plugin.ts` añade al compilar un `<meta http-equiv="Content-Security-Policy">` a `index.html` (todo `'self'`, sin `unsafe-inline` ni `unsafe-eval`; `img-src` con `data:` y `blob:`; `worker-src 'self'`). En `npm run dev` no se pone, porque Vite inyecta estilos en línea. Si añades un script, estilo o recurso de otro origen, la CSP lo bloqueará: revísala. Incluye **Trusted Types** (`require-trusted-types-for 'script'`, `trusted-types printquote`): nada de `innerHTML` con cadenas, y las URL de workers o del service worker pasan por `scriptUrl()` (`src/trusted-types.ts`). Comprueba el build con `npm run build && npm run test:integracion` (Chrome o Chromium sin cabeza; falla con cualquier violación, error de consola, worker que no arranca, PDF que no sale o service worker inactivo).
- **Límites** (`src/stl/limits.ts`): 300 MB por archivo y 6 300 000 triángulos para STL, OBJ y 3MF; las líneas `v`/`f` de un OBJ no pueden pasar de 4 MB y cada entrada del ZIP de un 3MF, de 400 MB descomprimida. Se comprueban en la interfaz y otra vez en el worker.
- **Web Worker**: el modelo se lee fuera del hilo principal; si llega otro archivo mientras tanto, el análisis anterior se cancela (`StlAnalyzer.cancel`). El worker informa del progreso (`src/stl/progress.ts`) y la interfaz muestra barra y «Cancelar» si tarda más de 400 ms.
- **DOM**: los datos de la persona (nombres de archivo, datos del negocio) se escriben con `textContent`, nunca con `innerHTML`.
- **CI**: gitleaks sobre todo el historial, `npm audit --omit=dev --audit-level=high` y Dependabot semanal.

Las instrucciones para comunicar vulnerabilidades están en [`../SECURITY.md`](../SECURITY.md).

## Documentación

- [Guía de uso](USO.md): uso de la aplicación, avisos, calibración, PDF, lotes, historial y privacidad.
- [Guía de contribución](../CONTRIBUTING.md): requisitos, comandos, ramas, fórmulas, formatos, traducciones y perfiles.
- [Registro de cambios](../CHANGELOG.md): novedades de cada versión.
- [Reglas del proyecto](../AGENTS.md): diseño, contratos y flujo de trabajo del equipo.
- [Memoria de trabajo](../MEMORY.md): estado y decisiones acumuladas.

## Contribuir

Lee [`../CONTRIBUTING.md`](../CONTRIBUTING.md), [`../AGENTS.md`](../AGENTS.md) y [`../MEMORY.md`](../MEMORY.md). Crea una rama desde `main`, no hagas commits directos, usa commits convencionales en español y abre un pull request. Antes de abrirlo, ejecuta `npm run lint && npm test && npm run build`. Los cambios visibles se anotan en `../CHANGELOG.md`.

## Cómo se ha hecho

printquote se ha construido con un equipo de agentes de IA que trabaja por ramas y pull requests: un lead coordina, builder implementa, qa revisa y docs documenta.

- v0.1.0: lead y builder con Claude Code (Claude Opus); qa y docs con Claude Code (Claude Sonnet).
- v0.2.0: todo el trabajo con Claude Code (Claude Sonnet).
- La documentación estaba prevista para OpenCode, pero no pudo ejecutarse en modo autónomo y la hizo Claude Code.
- Alberto supervisa, revisa los pull requests y fusiona en `main`.

## Funciones detalladas

- **Lectura:** carga STL binario y ASCII, OBJ y 3MF; detecta el formato por contenido, admite unidades de 3MF, transformaciones, componentes y polígonos OBJ grandes con aviso.
- **Parsers:** el STL distingue binario y ASCII por contenido y tamaño, lee ASCII byte a byte y tolera BOM y finales de línea mixtos. OBJ admite caras trianguladas, índices negativos y objetos/grupos unidos. 3MF lee ZIP y XML sin dependencias, admite compresión deflate o sin comprimir y aplica las transformaciones de objetos y componentes.
- **Geometría:** calcula volumen, superficie, caja, aristas abiertas, normales invertidas y si la pieza cabe en la cama.
- **Presupuesto:** material, relleno, perímetros, caudal, energía, margen, copias y redondeo por líneas.
- **Lotes:** conserva ajustes por pieza, permite editar copias, persiste el lote, lo copia, imprime, exporta a PDF y lo reabre desde el historial.
- **Visor:** muestra la pieza sobre una cama con rejilla, órbita, zoom con rueda, gestos o teclado y restablecimiento de vista.
- **Impresión y PDF:** genera texto, hoja de impresión y PDF con datos del negocio, logotipo, número, validez, desglose e IVA; un lote puede ocupar varias páginas.
- **PDF y fuentes:** el contenido se calcula en funciones puras y el dibujo carga `pdf-lib`, fontkit y las fuentes solo al pedir el PDF. Noto Sans y JetBrains Mono cubren latino, griego y cirílico; otros alfabetos no cubiertos aparecen como `?`.
- **Historial:** guarda presupuestos y lotes, restaura sus parámetros y exporta CSV con protección contra inyección de fórmulas.
- **Historial y almacenamiento:** admite hasta 100 presupuestos, con un límite práctico condicionado por el almacenamiento del navegador. No guarda geometría; un lote puede conservar hasta 50 piezas.
- **Compartir:** codifica material, precios, impresora, relleno, caudal, energía, margen, copias y cama en el hash de la URL; no incluye archivo, pieza, cliente ni datos del negocio, y al abrirlo no pisa lo guardado.
- **Idiomas:** interfaz, avisos, errores, notas de perfiles, números, fechas, texto copiado, hoja y PDF en español e inglés; la moneda siempre es el euro.
- **PWA:** aplicación instalable con service worker propio, precaché de la interfaz y la pieza de ejemplo, caché bajo demanda del visor y el PDF, y actualización versionada.
- **Demo:** recorrido guiado de unos 13 segundos que carga la pieza de ejemplo, gira la cámara, cambia material y relleno, restaura los ajustes y no escribe en almacenamiento ni en la URL. Se detiene con interacción y ofrece pasos manuales cuando se prefiere reducir movimiento.

## Licencia y fuentes

El proyecto se publica bajo la [licencia MIT](../LICENSE). La pieza de ejemplo es un diseño original del proyecto y tiene la misma licencia.

El PDF usa Noto Sans y JetBrains Mono, con licencia [SIL Open Font License 1.1](https://openfontlicense.org). Sus licencias se publican junto a la web en [`../public/fonts/`](../public/fonts/).
