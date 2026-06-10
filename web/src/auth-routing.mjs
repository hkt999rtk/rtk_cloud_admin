const CUSTOMER_FALLBACK = '/console/overview';
const PLATFORM_FALLBACK = '/admin';

export function isSafeLoginNext(value) {
  return Boolean(normalizeLoginNext(value));
}

export function normalizeLoginNext(value) {
  if (!value || typeof value !== 'string') return '';
  const next = value.trim();
  if (!next.startsWith('/') || next.startsWith('//')) return '';
  try {
    const parsed = new URL(next, 'https://connect.local');
    if (parsed.origin !== 'https://connect.local') return '';
    if (!isAllowedConsolePath(parsed.pathname) && !isAllowedAdminPath(parsed.pathname)) return '';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch (_) {
    return '';
  }
}

export function loginNextFromLocation(location) {
  const params = new URLSearchParams(location?.search || '');
  return normalizeLoginNext(params.get('next') || '');
}

export function protectedPathFromLocation(location) {
  const pathname = location?.pathname || '/';
  const search = location?.search || '';
  const hash = location?.hash || '';
  return `${pathname}${search}${hash}`;
}

export function loginPathFor(nextPath) {
  const next = normalizeLoginNext(nextPath);
  return next ? `/login?next=${encodeURIComponent(next)}` : '/login';
}

export function destinationForSession(me, nextPath) {
  if (!me?.authenticated) return loginPathFor(nextPath);
  const next = normalizeLoginNext(nextPath);
  if (me.kind === 'platform_admin') {
    return next && isAllowedAdminPath(new URL(next, 'https://connect.local').pathname)
      ? next
      : PLATFORM_FALLBACK;
  }
  return next && isAllowedConsolePath(new URL(next, 'https://connect.local').pathname)
    ? next
    : CUSTOMER_FALLBACK;
}

export function passwordLoginOrderForNext(nextPath) {
  const next = normalizeLoginNext(nextPath);
  if (next && isAllowedAdminPath(new URL(next, 'https://connect.local').pathname)) {
    return ['platform', 'customer'];
  }
  return ['customer', 'platform'];
}

function isAllowedAdminPath(pathname) {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

function isAllowedConsolePath(pathname) {
  return pathname === '/console' || pathname.startsWith('/console/');
}
