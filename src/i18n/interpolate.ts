export type Params = Readonly<Record<string, string | number>>;

/** Sustituye los `{marcadores}` de una plantilla; un marcador sin valor se deja tal cual. */
export function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}
