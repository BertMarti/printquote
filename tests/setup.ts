// Los navegadores de las personas usuarias declaran su idioma; el entorno de pruebas (Node,
// happy-dom) dice «en-US». Las pruebas parten del español (idioma de referencia) salvo que
// pidan otro: así no dependen de la máquina en la que se ejecutan.
for (const scope of [globalThis as { navigator?: Navigator }]) {
  if (scope.navigator) {
    Object.defineProperty(scope.navigator, 'language', { value: 'es-ES', configurable: true });
    Object.defineProperty(scope.navigator, 'languages', { value: ['es-ES', 'es'], configurable: true });
  }
}
