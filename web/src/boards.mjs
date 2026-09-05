export const CHIPSET_RESOURCES_PATH = '/console/chipset-sdk';
export function boardPath(chipsetId, boardKey) {
  return `${CHIPSET_RESOURCES_PATH}/${encodeURIComponent(chipsetId)}/boards/${encodeURIComponent(boardKey)}`;
}
export function boardRoute(pathname = '') {
  const match = pathname.match(/^\/console\/chipset-sdk\/([^/]+)\/boards\/([^/]+)\/?$/);
  if (!match) return null;
  try { return { chipsetId: decodeURIComponent(match[1]), boardKey: decodeURIComponent(match[2]) }; }
  catch { return { chipsetId: '', boardKey: '' }; }
}
export function boardSDKs(chipset, boardKey) {
  return (chipset?.sdk_releases || []).filter(release => release.supported_board_keys?.includes(boardKey));
}
export function boardAssetPath(value, kind = 'model') {
  const extension = kind === 'poster' ? '(webp|png)' : 'glb';
  return typeof value === 'string' && new RegExp(`^/assets/boards/[a-z0-9-]+/v[0-9]+/[a-z0-9-]+\\.${extension}$`).test(value) ? value : '';
}
