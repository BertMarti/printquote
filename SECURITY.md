# Seguridad

printquote es una web estática: el archivo 3D se lee **en tu navegador** y nunca se sube a ningún servidor. No hay cuentas, ni cookies, ni analítica; los ajustes, los datos del negocio y el historial se guardan solo en el `localStorage` de tu navegador.

## Versiones con soporte

Solo la versión publicada en <https://bertmarti.github.io/printquote/> (rama `main`).

## Cómo avisar de una vulnerabilidad

No abras una issue pública. Usa **[«Report a vulnerability»](https://github.com/BertMarti/printquote/security/advisories/new)** (aviso privado de GitHub) con:

- qué ocurre y cómo reproducirlo (si es un archivo STL/OBJ/3MF, adjunta uno mínimo o el script que lo genera);
- navegador y sistema;
- el impacto que crees que tiene.

Intentaré responder en una semana. Es un proyecto personal: no hay recompensas.

## Qué se considera vulnerabilidad

- Ejecutar código o inyectar HTML a partir de un archivo 3D, del nombre del archivo, del enlace para compartir (`#v=1&…`) o del historial guardado.
- Un archivo que congele o cuelgue la pestaña saltándose los límites (300 MB, 6 000 000 de triángulos, ZIP de 3MF de más de 400 MB descomprimido).
- Que algún dato salga del navegador.

## Medidas actuales

- Política de seguridad de contenidos (CSP) en `index.html` sin `unsafe-inline` ni `unsafe-eval`.
- Lectura del modelo en un Web Worker con límites de tamaño y de triángulos.
- Textos de la persona usuaria (nombres de archivo, datos del negocio) siempre con `textContent`, nunca `innerHTML`; CSV protegido contra inyección de fórmulas.
- CI con gitleaks (secretos en todo el historial) y `npm audit`; Dependabot semanal.
