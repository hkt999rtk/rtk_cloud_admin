import { handoffRoute, handoffAcceptPath } from './owner-handoff.mjs';
import { preferredCloudID } from './cloud-preference.mjs';
const CUSTOMER_FALLBACK = '/console/clouds';
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
    if (!isAllowedConsolePath(parsed.pathname) && !isAllowedAdminPath(parsed.pathname) && !isAllowedDeveloperInvitationPath(parsed.pathname)) return '';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch (_) {
    return '';
  }
}

export function loginNextFromLocation(location) {
  const params = new URLSearchParams(location?.search || '');
  return normalizeLoginNext(params.get('next') || '');
}

export function isPlatformLoginNext(value) {
  const next = normalizeLoginNext(value);
  return Boolean(next && isAllowedAdminPath(new URL(next, 'https://connect.local').pathname));
}

export function protectedPathFromLocation(location) {
  const pathname = location?.pathname || '/';
  const search = location?.search || '';
  const hash = location?.hash || '';
  return `${pathname}${search}${hash}`;
}

export function removeQueryParameterFromAddress(location, history, parameter) {
  const params = new URLSearchParams(location?.search || '');
  if (!params.has(parameter)) return false;
  params.delete(parameter);
  const search = params.toString();
  const nextAddress = `${location?.pathname || '/'}${search ? `?${search}` : ''}${location?.hash || ''}`;
  history.replaceState(history.state, '', nextAddress);
  return true;
}

export function loginPathFor(nextPath) {
  const next = normalizeLoginNext(nextPath);
  return next ? `/login?next=${encodeURIComponent(next)}` : '/login';
}

export function destinationForSession(me, nextPath, rememberedCloudID = '') {
  if (!me?.authenticated) return loginPathFor(nextPath);
  const fallback = customerDestination(me, rememberedCloudID);
  const next = normalizeLoginNext(nextPath);
  if (next) {
    const pathname = new URL(next, 'https://connect.local').pathname;
    // A handoff participant need not be a cloud member. The scoped BFF still
    // authorizes source/target identity before revealing any operation details.
    if (handoffRoute(pathname)) return next;
    if (isGlobalDeveloperPath(pathname)) return next;
    if (pathname === '/console/clouds' || pathname === '/console/clouds/') return next;
    const scoped = pathname.match(/^\/console\/clouds\/([^/]+)(?:\/|$)/);
    if (scoped) return (me.memberships || []).some((m) => (m.organization_id || m.id) === scoped[1]) ? next : fallback;
  }
  if (me.kind === 'platform_admin') {
    return next && (isAllowedAdminPath(new URL(next, 'https://connect.local').pathname) || isAllowedDeveloperInvitationPath(new URL(next, 'https://connect.local').pathname))
      ? next
      : preferredCloudID(me, rememberedCloudID) ? fallback : PLATFORM_FALLBACK;
  }
  return next && isAllowedDeveloperInvitationPath(new URL(next, 'https://connect.local').pathname)
    ? next
    : fallback;
}

function customerDestination(me, rememberedCloudID) {
  const cloudID = preferredCloudID(me, rememberedCloudID);
  return cloudID ? `${CUSTOMER_FALLBACK}/${cloudID}` : CUSTOMER_FALLBACK;
}

function isAllowedAdminPath(pathname) {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

function isAllowedConsolePath(pathname) {
  return pathname === '/console' || pathname.startsWith('/console/');
}

function isAllowedDeveloperInvitationPath(pathname) {
  return pathname === '/brand-cloud-member-invitation/accept' || pathname === handoffAcceptPath;
}

function isGlobalDeveloperPath(pathname) {
  return pathname === '/console/chipset-sdk'
    || pathname.startsWith('/console/chipset-sdk/')
    || pathname === '/console/developer-docs'
    || pathname.startsWith('/console/developer-docs/');
}
