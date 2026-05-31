import assert from 'node:assert/strict';
import test from 'node:test';
import { auditCoverageCopy, ssoProtocolLabel } from './platform-view.mjs';

test('ssoProtocolLabel presents OIDC as supported and SAML as not implemented', () => {
  assert.equal(ssoProtocolLabel('oidc'), 'OIDC');
  assert.equal(ssoProtocolLabel('saml'), 'SAML not implemented');
  assert.equal(ssoProtocolLabel('ldap'), 'Unsupported protocol: ldap');
  assert.equal(ssoProtocolLabel(''), 'OIDC');
});

test('auditCoverageCopy documents current write-side limits', () => {
  const copy = auditCoverageCopy();
  assert.match(copy, /Current write coverage/);
  assert.match(copy, /not implemented/);
});
