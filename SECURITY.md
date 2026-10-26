# Seguridad

printquote es una web estática: el archivo 3D se lee **en tu navegador** y nunca se sube a ningún servidor. No hay cuentas, ni cookies, ni analítica. En el `localStorage` de tu navegador se guardan los ajustes, el idioma, los datos del negocio (incluido el logotipo), los perfiles de «Mis impresoras» y «Mis materiales», el historial de presupuestos, el lote en curso y la marca de que ya has visto la bienvenida. El archivo 3D no se guarda.

## Versiones con soporte

Tiene soporte la versión publicada en <https://bertmarti.github.io/printquote/> (la 1.x, rama `main`).

## Cómo avisar de una vulnerabilidad

No abras una issue pública. Usa **[«Report a vulnerability»](https://github.com/BertMarti/printquote/security/advisories/new)** (aviso privado de GitHub) con:

- qué ocurre y cómo reproducirlo (si es un archivo STL/OBJ/3MF, adjunta uno mínimo o el script que lo genera);
- navegador y sistema;
- el impacto que crees que tiene.

Intentaré responder en una semana. Es un proyecto personal: no hay recompensas.

## Qué se considera vulnerabilidad

- Ejecutar código o inyectar HTML a partir de un archivo 3D, del nombre del archivo, del enlace para compartir (`#v=1&…`) o del historial guardado.
- Un archivo que congele o cuelgue la pestaña saltándose los límites (300 MB, 6 300 000 triángulos, ZIP de 3MF de más de 400 MB descomprimido).
- Que algún dato salga del navegador.

## Medidas actuales

- Política de seguridad de contenidos (CSP) en `index.html` sin `unsafe-inline` ni `unsafe-eval`, con Trusted Types (una única política que solo admite scripts del propio sitio dentro de `/printquote/`). El CI la comprueba en Chrome con el build real.
- Lectura del modelo en un Web Worker con límites de tamaño y de triángulos.
- Textos de la persona usuaria (nombres de archivo, datos del negocio) siempre con `textContent`, nunca `innerHTML`; CSV protegido contra inyección de fórmulas.
- CI con gitleaks (secretos en todo el historial) y `npm audit`; Dependabot semanal.
