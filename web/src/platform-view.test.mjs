import assert from 'node:assert/strict';
import test from 'node:test';
import {
  auditCoverageCopy,
  formatResourcePercent,
  formatThroughputBPS,
  grafanaEmbedState,
  platformDashboardHealth,
  resourceStatusLabel,
  resourceStatusTone,
  workloadStatusLabel,
  workloadStatusTone,
  ssoProtocolLabel,
} from './platform-view.mjs';

test('ssoProtocolLabel presents OIDC as supported and SAML as not implemented', () => {
  assert.equal(ssoProtocolLabel('oidc'), 'OIDC');
  assert.equal(ssoProtocolLabel('saml'), 'SAML not implemented');
  assert.equal(ssoProtocolLabel('ldap'), 'Unsupported protocol: ldap');
  assert.equal(ssoProtocolLabel(''), 'OIDC');
});

test('resource helpers format throughput values', () => {
  assert.equal(formatThroughputBPS(null), 'Unavailable');
  assert.equal(formatThroughputBPS(undefined), 'Unavailable');
  assert.equal(formatThroughputBPS(950), '950 b/s');
  assert.equal(formatThroughputBPS(1200), '1.2 Kb/s');
  assert.equal(formatThroughputBPS(4_800_000), '4.8 Mb/s');
  assert.equal(formatThroughputBPS(2_100_000_000), '2.1 Gb/s');
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
  assert.equal(resourceStatusLabel('degraded'), 'Degraded');
  assert.equal(resourceStatusLabel('configured'), 'Configured');
  assert.equal(resourceStatusLabel('unmonitored'), 'Unmonitored');
  assert.equal(resourceStatusTone('critical'), 'critical');
  assert.equal(resourceStatusTone('warning'), 'warning');
  assert.equal(resourceStatusTone('degraded'), 'degraded');
  assert.equal(resourceStatusTone('configured'), 'ok');
  assert.equal(resourceStatusTone('unmonitored'), 'unavailable');
  assert.equal(resourceStatusTone('ok'), 'ok');
});

test('platform dashboard health does not report Healthy without a configured metrics source', () => {
  assert.deepEqual(
    platformDashboardHealth({ sourceStatus: 'configured', targetsDown: 0, workloadsDegraded: 0, failedOperations: 0 }),
    { label: 'Healthy', tone: 'ok' },
  );
  for (const sourceStatus of ['unavailable', 'unconfigured', 'stale', 'empty', undefined]) {
    assert.deepEqual(
      platformDashboardHealth({ sourceStatus, targetsDown: 0, workloadsDegraded: 0, failedOperations: 0 }),
      { label: 'Attention', tone: 'warning' },
    );
  }
  assert.deepEqual(
    platformDashboardHealth({ sourceStatus: 'configured', targetsDown: 1, workloadsDegraded: 0, failedOperations: 0 }),
    { label: 'Attention', tone: 'warning' },
  );
});

test('grafanaEmbedState accepts only configured same-origin iframe URLs', () => {
  assert.deepEqual(
    grafanaEmbedState({ enabled: true, source_status: 'configured', iframe_url: '/api/admin/grafana/d/rtk-lke-staging/overview?orgId=1&kiosk' }),
    { ready: true, iframeURL: '/api/admin/grafana/d/rtk-lke-staging/overview?orgId=1&kiosk', message: '' },
  );
  assert.deepEqual(
    grafanaEmbedState({ enabled: true, source_status: 'configured', iframe_url: 'https://grafana.example/d/x' }),
    { ready: false, iframeURL: '', message: 'Grafana iframe URL is not available through the Admin Console.' },
  );
  assert.deepEqual(
    grafanaEmbedState({ enabled: false, source_status: 'unconfigured' }),
    { ready: false, iframeURL: '', message: 'Grafana is not configured.' },
  );
  assert.deepEqual(
    grafanaEmbedState({ enabled: true, source_status: 'unavailable', source_message: 'Grafana source is unavailable.' }),
    { ready: false, iframeURL: '', message: 'Grafana source is unavailable.' },
  );
});

test('workload helpers map k8s status to stable labels and tones', () => {
  assert.equal(workloadStatusLabel('crashloop'), 'CrashLoopBackOff');
  assert.equal(workloadStatusLabel('pending'), 'Pending');
  assert.equal(workloadStatusLabel('degraded'), 'Degraded');
  assert.equal(workloadStatusLabel('ok'), 'OK');
  assert.equal(workloadStatusTone('crashloop'), 'critical');
  assert.equal(workloadStatusTone('pending'), 'warning');
  assert.equal(workloadStatusTone('degraded'), 'degraded');
  assert.equal(workloadStatusTone('ok'), 'ok');
  assert.equal(workloadStatusTone('unavailable'), 'unavailable');
});
