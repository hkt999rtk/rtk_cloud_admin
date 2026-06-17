export function ssoProtocolLabel(protocol) {
  const normalized = String(protocol || 'oidc').toLowerCase();
  if (normalized === 'oidc') return 'OIDC';
  if (normalized === 'saml') return 'SAML not implemented';
  return `Unsupported protocol: ${protocol}`;
}

export function auditCoverageCopy() {
  return 'Local operator actions captured by the Go BFF. Current write coverage includes SSO, session, and lifecycle request records; audit export and full upstream audit mirroring are not implemented.';
}

export function grafanaEmbedState(status) {
  if (!status?.enabled) {
    return { ready: false, iframeURL: '', message: status?.source_message || 'Grafana is not configured.' };
  }
  if (status.source_status !== 'configured') {
    return { ready: false, iframeURL: '', message: status.source_message || 'Grafana is unavailable.' };
  }
  const iframeURL = String(status.iframe_url || '');
  if (!iframeURL.startsWith('/api/admin/grafana/')) {
    return { ready: false, iframeURL: '', message: 'Grafana iframe URL is not available through the Admin Console.' };
  }
  return { ready: true, iframeURL, message: '' };
}

export function formatResourcePercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'Unavailable';
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

export function formatThroughputBPS(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'Unavailable';
  const number = Number(value);
  const abs = Math.abs(number);
  if (abs >= 1_000_000_000) return `${(number / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 })} Gb/s`;
  if (abs >= 1_000_000) return `${(number / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 })} Mb/s`;
  if (abs >= 1_000) return `${(number / 1_000).toLocaleString(undefined, { maximumFractionDigits: 1 })} Kb/s`;
  return `${number.toLocaleString(undefined, { maximumFractionDigits: 1 })} b/s`;
}

export function resourceStatusLabel(status) {
  const labels = {
    critical: 'Critical',
    warning: 'Warning',
    degraded: 'Degraded',
    ok: 'OK',
    configured: 'Configured',
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
  if (normalized === 'ok' || normalized === 'configured') return 'ok';
  if (normalized === 'unmonitored' || normalized === 'unavailable' || normalized === 'unconfigured') return 'unavailable';
  return 'unknown';
}

export function workloadStatusLabel(status) {
  const labels = {
    crashloop: 'CrashLoopBackOff',
    pending: 'Pending',
    degraded: 'Degraded',
    ok: 'OK',
    unmonitored: 'Unmonitored',
    unavailable: 'Unavailable',
    unconfigured: 'Unconfigured',
  };
  return labels[String(status || '').toLowerCase()] || 'Unknown';
}

export function workloadStatusTone(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'crashloop' || normalized === 'critical') return 'critical';
  if (normalized === 'pending' || normalized === 'warning') return 'warning';
  if (normalized === 'degraded') return 'degraded';
  if (normalized === 'ok' || normalized === 'configured') return 'ok';
  if (normalized === 'unmonitored' || normalized === 'unavailable' || normalized === 'unconfigured') return 'unavailable';
  return 'unknown';
}
