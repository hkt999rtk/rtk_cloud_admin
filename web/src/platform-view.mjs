export function ssoProtocolLabel(protocol) {
  const normalized = String(protocol || 'oidc').toLowerCase();
  if (normalized === 'oidc') return 'OIDC';
  if (normalized === 'saml') return 'SAML not implemented';
  return `Unsupported protocol: ${protocol}`;
}

export function auditCoverageCopy() {
  return 'Local operator actions captured by the Go BFF. Current write coverage includes SSO, break-glass, session, and lifecycle request records; audit export and full upstream audit mirroring are not implemented.';
}

export function formatResourcePercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'Unavailable';
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

export function resourceStatusLabel(status) {
  const labels = {
    critical: 'Critical',
    warning: 'Warning',
    degraded: 'Degraded',
    ok: 'OK',
    unmonitored: 'Unmonitored',
    unavailable: 'Unavailable',
    unconfigured: 'Unconfigured',
  };
  return labels[String(status || '').toLowerCase()] || 'Unknown';
}

export function resourceStatusTone(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'critical') return 'critical';
  if (normalized === 'warning') return 'warning';
  if (normalized === 'degraded') return 'degraded';
  if (normalized === 'ok') return 'ok';
  if (normalized === 'unmonitored' || normalized === 'unavailable' || normalized === 'unconfigured') return 'unavailable';
  return 'unknown';
}
