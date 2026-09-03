import { isCloudID } from './managed-clouds.mjs';

export const CLOUD_PREFERENCE_COOKIE = 'rtk_last_cloud_id';
export const CLOUD_PREFERENCE_MAX_AGE = 365 * 24 * 60 * 60;

export function readCloudPreference(cookieHeader = '') {
  for (const part of String(cookieHeader).split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== CLOUD_PREFERENCE_COOKIE) continue;
    try {
      const value = decodeURIComponent(part.slice(separator + 1).trim());
      return isCloudID(value) ? value : '';
    } catch (_) {
      return '';
    }
  }
  return '';
}

export function membershipCloudIDs(me) {
  const seen = new Set();
  return (me?.memberships || []).flatMap((membership) => {
    const id = membership?.organization_id || membership?.id || '';
    if (!isCloudID(id) || seen.has(id)) return [];
    seen.add(id);
    return [id];
  });
}

export function preferredCloudID(me, rememberedCloudID = '') {
  const ids = membershipCloudIDs(me);
  return rememberedCloudID && ids.includes(rememberedCloudID) ? rememberedCloudID : ids[0] || '';
}

export function cloudPreferenceCookie(cloudID, { secure = false, maxAge = CLOUD_PREFERENCE_MAX_AGE } = {}) {
  if (!isCloudID(cloudID)) return '';
  return `${CLOUD_PREFERENCE_COOKIE}=${encodeURIComponent(cloudID)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function rememberCloudPreference(cloudID, documentRef = globalThis.document, locationRef = globalThis.location) {
  if (!documentRef) return false;
  const value = cloudPreferenceCookie(cloudID, { secure: locationRef?.protocol === 'https:' });
  if (!value) return false;
  documentRef.cookie = value;
  return true;
}

export function forgetCloudPreference(documentRef = globalThis.document, locationRef = globalThis.location) {
  if (!documentRef) return false;
  documentRef.cookie = `${CLOUD_PREFERENCE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${locationRef?.protocol === 'https:' ? '; Secure' : ''}`;
  return true;
}
