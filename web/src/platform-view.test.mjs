import assert from 'node:assert/strict';
import test from 'node:test';
import {
  auditCoverageCopy,
  formatResourcePercent,
  resourceStatusLabel,
  resourceStatusTone,
  ssoProtocolLabel,
} from './platform-view.mjs';

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

test('resource helpers format unavailable and percentage values', () => {
  assert.equal(formatResourcePercent(null), 'Unavailable');
  assert.equal(formatResourcePercent(undefined), 'Unavailable');
  assert.equal(formatResourcePercent(71), '71%');
  assert.equal(formatResourcePercent(71.234), '71.2%');
});

test('resource helpers map row status to stable labels and tones', () => {
  assert.equal(resourceStatusLabel('critical'), 'Critical');
  assert.equal(resourceStatusLabel('warning'), 'Warning');
  assert.equal(resourceStatusLabel('unmonitored'), 'Unmonitored');
  assert.equal(resourceStatusTone('critical'), 'critical');
  assert.equal(resourceStatusTone('warning'), 'warning');
  assert.equal(resourceStatusTone('unmonitored'), 'unavailable');
  assert.equal(resourceStatusTone('ok'), 'ok');
});
