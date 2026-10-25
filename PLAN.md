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

## Siguiente

1. Añadir una prueba de integración en Chromium sin cabeza que cargue `#ejemplo` desde `dist/` bajo `/printquote/` y compruebe que la CSP no registra violaciones.
2. Hacer que el worker informe del progreso al analizar archivos grandes, manteniendo el análisis cancelable.
3. Evaluar Trusted Types para las superficies DOM que construyan contenido dinámico, sin relajar la CSP.
4. Regenerar `docs/captura.png` y `public/og.png` con `scripts/captura.mjs` después de los cambios de interfaz y revisar las dos dimensiones documentadas por el script.
5. Probar OBJ y 3MF reales procedentes de laminadores, además de los modelos construidos en `tests/`, y documentar cualquier diferencia reproducible.
6. Probar con lector de pantalla real el campo de copias, los anuncios y las hojas de impresión en Firefox y Safari.
7. Revisar la descarga del PDF y la hoja de impresión en distintos visores y en una impresora real.

8. Volver a probar TypeScript 7 cuando `typescript-eslint` lo admita (quitar el `ignore` de `.github/dependabot.yml`).
9. Subir `@types/node` a la vez que el mínimo de `engines` cuando se deje Node 22.
10. Regenerar `docs/captura.png` y `public/og.png` con la interfaz de 0.9.0 (estado vacío con primeros pasos).

## Ideas

- Recuperar lotes guardados con el esquema antiguo que no conserva `surfaceMm2`, si puede hacerse sin guardar geometría.
- Añadir una migración explícita del esquema del lote persistido cuando exista un cambio que la justifique.
- Mejorar la triangulación de polígonos OBJ cóncavos muy grandes, cuyo caso actual tiene coste alto.
- Estudiar el coste del chunk del visor y del PDF sin sacrificar la carga bajo demanda.
- Añadir un campo de cliente al PDF si hay una necesidad de negocio concreta.
