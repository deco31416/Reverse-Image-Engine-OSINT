const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function inferPersonIdentity(value: string): Record<string, string> {
  const term = value.trim().replace(/\s+/g, ' ');
  if (!term) return {};
  if (term.startsWith('@')) {
    const username = term.slice(1);
    if (!username || /[\s@]/.test(username)) throw new Error('Escribe un usuario válido, por ejemplo @lauragomez.');
    return { username };
  }
  if (term.includes('@')) {
    if (!emailPattern.test(term)) throw new Error('Escribe un correo válido, por ejemplo nombre@correo.com.');
    return { email: term };
  }
  if (/^\+?[\d\s().-]+$/.test(term)) {
    const digits = term.replace(/\D/g, '').length;
    if (digits < 7 || digits > 15) throw new Error('Escribe un teléfono válido, con su indicativo si lo conoces.');
    return { telefono: term.replace(/[^\d+]/g, '') };
  }
  return { nombre: term };
}

export function getPersonSearchIdentity(form: FormData): Record<string, string> {
  const primary = form.get('searchTerm');
  const identity = inferPersonIdentity(typeof primary === 'string' ? primary : '');
  // Explicit, optional fields take precedence over the inferred main value.
  for (const key of ['nombre', 'apellido', 'username', 'email', 'telefono', 'alias', 'ciudad']) {
    const value = form.get(key);
    if (typeof value === 'string' && value.trim()) identity[key] = value.trim();
  }
  if (identity.email && !emailPattern.test(identity.email)) throw new Error('Revisa el correo de Más opciones.');
  return identity;
}

export function validatePersonSearchInput(form: FormData): void {
  const identity = getPersonSearchIdentity(form);
  const hasIdentity = ['nombre', 'apellido', 'username', 'email', 'telefono', 'alias'].some(key => Boolean(identity[key]));
  const file = form.get('imageFile');
  const hasFile = typeof file === 'object' && file !== null && file.size > 0;
  const hasImage = hasFile || Boolean(String(form.get('imageUrl') || '').trim()) || Boolean(String(form.get('datasecAssetId') || '').trim());
  if (!hasIdentity && !hasImage) throw new Error('Escribe un nombre, usuario, correo o teléfono para empezar.');
}
