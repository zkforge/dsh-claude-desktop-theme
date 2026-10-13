/** Display a host file relative to the session's working directory on either platform. */
export function relativeFilePath(path: string, cwd: string): string {
  const normalize = (value: string) => value.replaceAll('\\', '/').replace(/\/+$/u, '');
  const file = normalize(path);
  const root = normalize(cwd);
  const windows = /^[A-Za-z]:\//u.test(root) || root.startsWith('//');
  const key = (value: string) => windows ? value.toLowerCase() : value;
  // Relative host paths already have the requested form. Different volumes
  // have no relative path, so retain the host path in that case.
  if (!file.startsWith('/') && !/^[A-Za-z]:\//u.test(file)) return file;
  const target = file.split('/');
  const base = root.split('/');
  if (key(target[0]!) !== key(base[0]!)) return file;
  if (windows && root.startsWith('//') && (key(target[2] ?? '') !== key(base[2] ?? '') || key(target[3] ?? '') !== key(base[3] ?? ''))) return file;
  let shared = 0;
  while (shared < target.length && shared < base.length && key(target[shared]!) === key(base[shared]!)) shared++;
  return [...base.slice(shared).filter(Boolean).map(() => '..'), ...target.slice(shared)].join('/') || '.';
}
