# Hoja de ruta

## Hecho el 24/10/2026

Trabajo de la rama `mejoras-2026-10-24` comprobado contra el código actual:

- Dependencias actualizadas con `npm audit fix`; Vite queda en 8.3.5 en el lockfile.
- Límites comunes para STL, OBJ y 3MF en `src/stl/limits.ts`: 300 MB por archivo y 6 300 000 triángulos. OBJ añade un máximo de 4 MB por línea `v` o `f`.
- Si llega otro archivo durante un análisis, `StlAnalyzer.cancel` termina el análisis anterior y se procesa el último archivo.
- `scripts/csp-plugin.ts` añade la CSP al `<meta>` solo en el build. Se verificó en Chromium sin violaciones.
- CI incorpora gitleaks y `npm audit`; Dependabot está configurado; el despliegue separa los permisos de lectura, Pages e identidad.
- `SECURITY.md` documenta el modelo de seguridad y el canal privado para vulnerabilidades.
- El estado vacío ofrece «Elegir archivo» y el visor tiene título adecuado para interacción táctil.
- El visor se reencuadra al cambiar de tamaño si la persona no ha movido la cámara.
- `README.md` está orientado a usuarios e incluye `docs/img/banner.svg`; la información técnica está en `docs/DESARROLLO.md`.
- Vitest usa `testTimeout: 30_000` en `vite.config.ts`.

## Hecho el 25/10/2026 (fase 2, v0.9.0)

- Dependabot revisado: #61, #62 y #63 fusionadas; #64 (TypeScript 7) y #65 (@types/node 26) cerradas con `ignore`.
- Primera visita guiada, ayuda contextual, perfiles propios, copia de ajustes en JSON y «Borrar mis datos».
- PDF para el cliente final (cliente, notas, sin costes internos por defecto).
- Validación con aviso de todo lo leído de `localStorage` (origen compartido).
- `countOpenEdges`/`weldVertices` sin `Map` y cancelación sin Worker.

## Hecho el 26/10/2026 (fase 3, v0.10.0)

- Prueba de integración en Chromium sin cabeza (`npm run test:integracion`, también en el CI): `#ejemplo` desde `dist/` bajo `/printquote/`, sin violaciones de CSP ni Trusted Types, sin errores de consola, worker, visor, PDF y service worker.
- El worker informa del progreso; barra accesible y botón «Cancelar» (abrir otro archivo sigue cancelando).
- Trusted Types en la CSP con una política mínima (`trusted-types printquote`) para el worker y el service worker.
- `docs/captura.png` y `public/og.png` regeneradas con la interfaz actual.
- Lotes guardados con v0.6 (sin `surfaceMm2`) se vuelven a abrir: área deducida del resultado guardado, sin guardar geometría.
- Dependabot #67 (`@types/node` 22.20.5) fusionada.

## Hecho el 26/10/2026 (fase 5, v1.0.0)

- Versión 1.0.0 con una sola fuente (`package.json` → `define` de Vite → `src/version.ts`): colofón al final de la ficha (versión, licencia MIT y enlace al código) y pie del PDF.
- Repaso de calidad 1.0 con revisión cruzada (GPT-5.6 Luna) y comprobación de cada hallazgo: logotipo PNG con medidas enormes rechazado (bomba de descompresión en el PDF), aviso si lo importado no se puede guardar, historial sin importes negativos, y `docs/USO.md`/`SECURITY.md` fieles al PDF de 0.9 y a lo que se guarda en el navegador.
- Sin issues abiertas, sin PRs de Dependabot y sin alertas abiertas.

## Después de la 1.0

Nada de esto deja a medias lo que ve el usuario; son mejoras y comprobaciones que necesitan hardware, personas o más tiempo.

1. Probar OBJ y 3MF reales procedentes de laminadores, además de los modelos construidos en `tests/`, y documentar cualquier diferencia reproducible.
2. Probar con lector de pantalla real el campo de copias, los anuncios, la barra de progreso y las hojas de impresión en Firefox y Safari.
3. Revisar la descarga del PDF y la hoja de impresión en distintos visores y en una impresora real.
4. Volver a probar TypeScript 7 cuando `typescript-eslint` lo admita (quitar el `ignore` de `.github/dependabot.yml`).
5. Subir `@types/node` a la vez que el mínimo de `engines` cuando se deje Node 22.
6. Progreso más fino en 3MF (hoy salta de 10 % a 50 % durante la descompresión y la lectura del XML) y durante la ordenación de aristas.
7. Ampliar la prueba de integración a móvil (390 px) y a un archivo grande con «Cancelar» (hoy se comprueba con un script aparte).
8. Tope de vértices en OBJ y 3MF (hoy solo hay tope de triángulos y de tamaño de archivo): un archivo de 300 MB con millones de vértices y ninguna cara puede agotar la memoria del worker antes de decir «sin caras». Se recupera con el aviso `err.worker` (la página sigue funcionando), por eso es de severidad baja.
9. Rechazar con un mensaje claro las piezas con medidas absurdas (coordenadas cerca del máximo de `float32`): hoy dan importes astronómicos pero finitos.

## Ideas

- Añadir una migración explícita del esquema del lote persistido cuando exista un cambio que la justifique.
- Mejorar la triangulación de polígonos OBJ cóncavos muy grandes, cuyo caso actual tiene coste alto.
- Estudiar el coste del chunk del visor y del PDF sin sacrificar la carga bajo demanda.
- Añadir un campo de cliente al PDF si hay una necesidad de negocio concreta.
