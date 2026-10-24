---
name: anadir-formato-o-limite
description: Úsala para añadir un formato de modelo 3D o modificar de forma segura un límite de lectura y memoria.
---

# Añadir un formato o un límite

Sigue primero la sección «Añadir un formato de archivo» de `CONTRIBUTING.md`; esta guía concreta sus puntos y no los sustituye.

## Formato nuevo

1. Crea el lector en `src/stl/<formato>.ts`. Debe recibir un `Uint8Array`, devolver un `Mesh` con posiciones en milímetros y lanzar `ModelParseError` con una clave `err.*` cuando no pueda leer la entrada.
2. Añade las claves del error a `src/i18n/es.ts` y `src/i18n/en.ts`. Añade también `format.<valor>` en los dos diccionarios para la etiqueta de la interfaz.
3. Actualiza `src/stl/types.ts` con el valor de `MeshFormat`.
4. Actualiza `src/stl/model.ts`: `MODEL_EXTENSIONS`, `Kind`, `detectKind` y `parseModel`. La detección por contenido manda; la extensión solo desempata entre textos.
5. Actualiza el atributo `accept` del `<input id="file-input">` en `index.html` con la extensión y el tipo MIME. Revisa también los textos de formatos en los diccionarios.
6. Añade `tests/<formato>.test.ts` con datos construidos en memoria y casos válidos, detección y errores. Usa los helpers de `tests/helpers/`, en particular los de malla o ZIP cuando proceda. Añade la prueba de interfaz en `tests/ui-formats.test.ts`.
7. Actualiza la sección 3 de `docs/USO.md`, el README si enumera formatos y `CHANGELOG.md`.

## Límite nuevo o cambiado

1. Localiza el límite común en `src/stl/limits.ts` y sus usos en interfaz, análisis, worker y parser. Mantén `MAX_FILE_BYTES` y `MAX_TRIANGLES` aplicados a todos los formatos.
2. Para un tope de triángulos, rechaza la entrada antes de reservar memoria. OBJ también debe respetar su límite de línea; 3MF debe conservar los topes de ZIP y de entrada descomprimida.
3. Añade o ajusta casos de frontera y de exceso en `tests/`, usando los helpers de `tests/helpers/`. Comprueba tanto el camino del parser como el análisis en worker cuando el cambio lo afecte.
4. Si cambia un mensaje, añade sus claves `err.*` a `src/i18n/es.ts` y `src/i18n/en.ts`. Si cambia la conducta visible, actualiza `docs/USO.md`, el README y `CHANGELOG.md`.
5. Ejecuta `npm run typecheck`, `npm test`, `npm run lint` y `npm run build` antes del pull request.

No introduzcas dependencias nuevas para un parser sin justificarlo en «Decisiones» de `MEMORY.md`. Mantén el análisis en el navegador y no guardes ni subas la geometría del modelo.
