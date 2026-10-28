/** Resolve references for clipboard transport; this never authorizes or reads a path. */
export function absoluteNoteReference(reference: string, fromPath: string): string {
  if (/^(?:https?|data|blob|note-asset|file):/i.test(reference)) return reference;
  let decoded: string;
  try {
    decoded = decodeURIComponent(reference.split('#')[0]);
  } catch {
    decoded = reference.split('#')[0];
  }
  if (/^(?:[a-z]:[\\/]|[\\/])/i.test(decoded)) return decoded;
  const source = fromPath.replace(/\\/g, '/');
  const parts = source.split('/');
  const host = source.startsWith('//') ? parts[2] : '';
  const pathname = host
    ? '/' + parts.slice(3).map(encodeURIComponent).join('/')
    : '/' + parts.filter(Boolean).map(encodeURIComponent).join('/');
  const url = new URL(reference.replace(/\\/g, '/'), `file://${host}${pathname}`);
  const resolvedPath = decodeURIComponent(url.pathname);
  return url.hostname
    ? `//${url.hostname}${resolvedPath}`
    : /^\/[a-z]:/i.test(resolvedPath)
      ? resolvedPath.slice(1)
      : resolvedPath;
}
export const clipboardFileReference = (reference: string) =>
  /^(?:https?|data|blob|note-asset|file):/i.test(reference)
    ? reference
    : reference.split('/').map(encodeURIComponent).join('/').replace(/^\/\//, '%2F%2F');
