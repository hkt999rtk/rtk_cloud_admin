export function ssoProtocolLabel(protocol) {
  const normalized = String(protocol || 'oidc').toLowerCase();
  if (normalized === 'oidc') return 'OIDC';
  if (normalized === 'saml') return 'SAML not implemented';
  return `Unsupported protocol: ${protocol}`;
}

export function auditCoverageCopy() {
  return 'Local operator actions captured by the Go BFF. Current write coverage includes SSO, break-glass, session, and lifecycle request records; audit export and full upstream audit mirroring are not implemented.';
}
