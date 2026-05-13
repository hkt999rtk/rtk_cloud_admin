export function shouldShowBreakGlass(me) {
  return Boolean(me?.break_glass_enabled);
}

export function isPlatformOnlySSOSettingsRoute(route) {
  return route === 'platform-sso';
}
