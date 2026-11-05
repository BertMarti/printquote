/** Formatos razonables para los datos de contacto del cliente. El formulario avisa, pero nunca bloquea. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PHONE_RE = /^[0-9 +().-]+$/;

export function isValidEmail(value: string): boolean {
  return value === '' || EMAIL_RE.test(value);
}

export function isValidPhone(value: string): boolean {
  if (value === '') return true;
  if (!PHONE_RE.test(value) || (value.match(/\+/g) ?? []).length > 1 || value.includes('+') && !value.startsWith('+')) return false;
  const digits = value.replace(/\D/g, '');
  return digits.length >= 6 && digits.length <= 20;
}

/** Una línea, sin controles, con espacios agrupados y limitada para historial y PDF. */
export function cleanContact(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
