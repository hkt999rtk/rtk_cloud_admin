import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer as createViteServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, '..');
const artifactsDir = path.resolve(webRoot, '..', '.artifacts', 'browser-smoke');
const now = new Date('2026-05-13T12:00:00.000Z');

const customerMe = {
  authenticated: true,
  kind: 'customer',
  email: 'fleet.manager@example.com',
  active_org_id: 'org-acme',
  capabilities: ['customer.devices.read', 'customer.devices.provision', 'customer.devices.deactivate', 'customer.firmware.read', 'customer.stream.read'],
  memberships: [{
    organization_id: 'org-acme',
    organization: 'Acme Smart Camera',
    role: 'fleet_manager',
    tier: 'evaluation',
    evaluation_device_quota: 5,
    capabilities: ['customer.devices.read', 'customer.devices.provision', 'customer.devices.deactivate', 'customer.firmware.read', 'customer.stream.read'],
  }],
};

const platformMe = {
  authenticated: true,
  kind: 'platform_admin',
  email: 'platform.admin@example.com',
  capabilities: ['platform.audit.read', 'platform.sso.manage'],
  break_glass_enabled: true,
};

const devices = [
  {
    id: 'dev-1001',
    name: 'Lobby Cam 01',
    serial_number: 'RTK-LOBBY-001',
    organization: 'Acme Smart Camera',
    model: 'RTL-CAM-A1',
    firmware_version: '1.4.2',
    health: 'healthy',
    signal_quality: 'Good',
    readiness: 'activated',
    last_seen_at: '2026-05-13T11:55:00Z',
  },
  {
    id: 'dev-1002',
    name: 'Dock Door 07',
    serial_number: 'RTK-DOCK-007',
    organization: 'Acme Smart Camera',
    model: 'RTL-CAM-A1',
    firmware_version: '1.3.9',
    health: 'warning',
    signal_quality: 'Poor',
    readiness: 'activated',
    last_seen_at: '2026-05-13T10:42:00Z',
  },
  {
    id: 'dev-1003',
    name: 'Warehouse East',
    serial_number: 'RTK-WHS-003',
    organization: 'Acme Smart Camera',
    model: 'RTL-CAM-B2',
    firmware_version: '',
    health: 'critical',
    signal_quality: 'Fair',
    readiness: 'cloud_activation_pending',
    last_seen_at: '2026-05-12T17:08:00Z',
  },
];

const telemetryByDevice = {
  'dev-1001': {
    telemetry_status: 'available',
    health: 'healthy',
    active_stream_status: 'active',
    firmware_version: '1.4.2',
    signals: ['device.health.summary'],
    recent_events: [{
      event_type: 'device.health.summary',
      summary: 'Health normal',
      occurred_at: '2026-05-13T11:55:00Z',
    }],
  },
  'dev-1002': {
    telemetry_status: 'available',
    health: 'warning',
    active_stream_status: 'inactive',
    firmware_version: '1.3.9',
    signals: ['device.health.rssi_sample'],
    recent_events: [{
      event_type: 'device.health.rssi_sample',
      summary: 'Low RSSI',
      occurred_at: '2026-05-13T10:40:00Z',
    }],
  },
  'dev-1003': {
    telemetry_status: 'unavailable',
    unavailable_reason: 'Telemetry source unavailable for this device.',
    active_stream_status: 'unavailable',
    recent_events: [],
  },
};

const summary = {
  total_devices: 3,
  online_devices: 2,
  activated_devices: 2,
  pending_devices: 1,
  failed_devices: 0,
  open_operations: 2,
  customers: 1,
};

const fleetHealth = {
  source_status: 'available',
  source_message: 'Telemetry source available.',
  online_rate_7d_pct: 66.7,
  current: { healthy: 1, warning: 1, critical: 1 },
  trend: [
    { date: '2026-05-11', online_rate_pct: 62, alerts: 2 },
    { date: '2026-05-12', online_rate_pct: 68, alerts: 1 },
    { date: '2026-05-13', online_rate_pct: 66.7, alerts: 3 },
  ],
};

const streamStats = {
  source_status: 'available',
  source_message: 'WebRTC session events available.',
  success_rate_pct: 81.5,
  avg_duration_seconds: 312,
  active_sessions: 2,
  never_streamed_count: 1,
  by_mode: {
    webrtc: { success_rate_pct: 81.5, requests: 54 },
  },
  trend: [
    { date: '2026-05-11', requests: 18, success_rate_pct: 88 },
    { date: '2026-05-12', requests: 15, success_rate_pct: 74 },
    { date: '2026-05-13', requests: 21, success_rate_pct: 81 },
  ],
  trend_by_mode: [
    { date: '2026-05-11', mode: 'webrtc', success_rate_pct: 88 },
    { date: '2026-05-12', mode: 'webrtc', success_rate_pct: 74 },
    { date: '2026-05-13', mode: 'webrtc', success_rate_pct: 81 },
  ],
  worst_devices: [
    {
      device_id: 'dev-1002',
      device_name: 'Dock Door 07',
      mode_used: 'webrtc',
      success_rate_pct: 45,
      requests: 20,
      failures: 11,
      last_stream_at: '2026-05-13T10:41:00Z',
      readiness: 'activated',
    },
    {
      device_id: 'dev-1003',
      device_name: 'Warehouse East',
      mode_used: 'webrtc',
      success_rate_pct: 0,
      requests: 0,
      failures: 0,
      last_stream_at: null,
      readiness: 'cloud_activation_pending',
    },
  ],
};

const firmwareDistribution = {
  source_status: 'available',
  source_message: 'Firmware observation source available.',
  versions: [
    { version: '1.4.2', count: 1, pct: 33.3, is_latest: true },
    { version: '1.3.9', count: 1, pct: 33.3, is_latest: false },
    { version: 'unknown', count: 1, pct: 33.3, is_latest: false },
  ],
  campaigns: [{
    campaign_id: 'ota-2026-05',
    target_version: '1.4.2',
    policy: 'staged',
    state: 'active',
    applied: 1,
    pending: 1,
    failed: 1,
    total: 3,
    started_at: '2026-05-12T09:00:00Z',
    rollouts: [
      {
        device_id: 'dev-1001',
        device_name: 'Lobby Cam 01',
        current_version: '1.4.2',
        target_version: '1.4.2',
        rollout_status: 'applied',
        reason: 'Target version installed.',
        last_updated: '2026-05-13T10:00:00Z',
      },
      {
        device_id: 'dev-1002',
        device_name: 'Dock Door 07',
        current_version: '1.3.9',
        target_version: '1.4.2',
        rollout_status: 'pending',
        reason: 'Waiting for maintenance window.',
        last_updated: '2026-05-13T09:00:00Z',
      },
      {
        device_id: 'dev-1003',
        device_name: 'Warehouse East',
        current_version: 'unknown',
        target_version: '1.4.2',
        rollout_status: 'failed',
        reason: 'Device not ready.',
        last_updated: '2026-05-13T08:00:00Z',
      },
    ],
  }],
};

const platformHealth = [
  { name: 'Admin API', status: 'ok', detail: 'healthy', latency_ms: 12, last_checked_at: '2026-05-13T11:59:00Z' },
  { name: 'Video Cloud', status: 'demo', detail: 'demo service active', latency_ms: 35, last_checked_at: '2026-05-13T11:59:00Z' },
];

const platformOperations = [
  {
    id: 'op-1',
    type: 'DeviceProvisionSucceeded',
    state: 'succeeded',
    organization: 'Acme Smart Camera',
    device_name: 'Lobby Cam 01',
    updated_at: '2026-05-13T10:00:00Z',
    message: 'Provisioning completed.',
  },
  {
    id: 'op-2',
    type: 'DeviceDeactivateRequestedFailed',
    state: 'failed',
    organization: 'Acme Smart Camera',
    device_name: 'Dock Door 07',
    updated_at: '2026-05-13T09:30:00Z',
    message: 'Upstream rejected request.',
  },
];

const platformDashboard = {
  summary,
  kpis: [
    { id: 'tenants', label: 'Tenants', value: 1, source_status: 'configured' },
    { id: 'devices_online', label: 'Devices Online', value: 1, secondary_label: 'online_rate_pct', secondary_value: 50, source_status: 'configured' },
    { id: 'open_operations', label: 'Open Operations', value: 1, source_status: 'configured' },
    { id: 'scrape_targets_down', label: 'Scrape Targets Down', value: 0, source_status: 'configured' },
  ],
  service_scrape_health: [
    { id: 'app', name: 'App', status: 'ok', targets_up: 4, targets_down: 0, targets_total: 4, source_status: 'configured' },
    { id: 'host', name: 'Host', status: 'ok', targets_up: 5, targets_down: 0, targets_total: 5, source_status: 'configured' },
    { id: 'data', name: 'Data', status: 'ok', targets_up: 2, targets_down: 0, targets_total: 2, source_status: 'configured' },
    { id: 'broker', name: 'Broker', status: 'ok', targets_up: 2, targets_down: 0, targets_total: 2, source_status: 'configured' },
    { id: 'gateway', name: 'Gateway', status: 'ok', targets_up: 2, targets_down: 0, targets_total: 2, source_status: 'configured' },
  ],
  operation_risk: {
    open_operations: 1,
    failed_operations: 1,
    dead_lettered_operations: 0,
    source_status: 'configured',
  },
  sources: {
    prometheus: { source_status: 'configured', checked_at: '2026-05-13T11:59:00Z' },
    admin_read_models: { source_status: 'configured', checked_at: '2026-05-13T11:59:00Z' },
  },
  panel_sources: {
    kpis: { source_status: 'configured', checked_at: '2026-05-13T11:59:00Z' },
    service_scrape_health: { source_status: 'configured', checked_at: '2026-05-13T11:59:00Z' },
    operation_risk: { source_status: 'configured', checked_at: '2026-05-13T11:59:00Z' },
  },
  prometheus: {
    queries: [
      { id: 'runtime_request_rate', source_status: 'configured', series: [{ labels: { service: 'api' }, value: 18.4 }] },
      { id: 'runtime_5xx_rate', source_status: 'configured', series: [{ labels: { service: 'api' }, value: 0 }] },
      { id: 'runtime_avg_latency_seconds', source_status: 'configured', series: [{ labels: { service: 'api' }, value: 0.08 }] },
      { id: 'app_up', source_status: 'configured', series: [{ labels: { job: 'cloud_admin_app' }, value: 1 }] },
      { id: 'crossservice_consumer_backlog', source_status: 'configured', series: [{ labels: { service: 'crossservice' }, value: 4 }] },
      { id: 'crossservice_dead_letters', source_status: 'configured', series: [{ labels: { service: 'crossservice' }, value: 0 }] },
      { id: 'crossservice_publish_errors', source_status: 'configured', series: [{ labels: { service: 'crossservice' }, value: 0 }] },
      { id: 'crossservice_consume_errors', source_status: 'configured', series: [{ labels: { service: 'crossservice' }, value: 0 }] },
      { id: 'business_video_devices_online', source_status: 'configured', series: [{ labels: { job: 'metricsexporter' }, value: 1 }] },
      { id: 'business_blob_utilization_percent', source_status: 'configured', series: [{ labels: { job: 'metricsexporter' }, value: 37 }] },
      { id: 'business_exporter_success', source_status: 'configured', series: [{ labels: { job: 'metricsexporter' }, value: 1 }] },
      { id: 'business_quota_requests', source_status: 'configured', series: [{ labels: { service: 'account-manager' }, value: 2 }] },
      { id: 'business_eval_signups_24h', source_status: 'configured', series: [{ labels: { service: 'account-manager' }, value: 3 }] },
      { id: 'infra_cpu_utilization_percent', source_status: 'configured', series: [{ labels: { role: 'api' }, value: 42 }] },
      { id: 'infra_memory_utilization_percent', source_status: 'configured', series: [{ labels: { role: 'api' }, value: 61 }] },
      { id: 'infra_disk_utilization_percent', source_status: 'configured', series: [{ labels: { role: 'api' }, value: 55 }] },
    ],
  },
};

const customers = [{
  organization_id: 'org-acme',
  organization: 'Acme Smart Camera',
  tier: 'evaluation',
  status: 'active',
}];

const audit = [{
  id: 'audit-1',
  actor: 'platform.admin@example.com',
  action: 'operation.viewed',
  target: 'op-1',
  created_at: '2026-05-13T10:05:00Z',
}];

await mkdir(artifactsDir, { recursive: true });

const vite = await createViteServer({
  root: webRoot,
  server: {
    host: '127.0.0.1',
    middlewareMode: true,
  },
  appType: 'spa',
  logLevel: 'error',
});

const httpServer = createServer((request, response) => vite.middlewares(request, response));
await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
const { port } = httpServer.address();
const baseURL = `http://127.0.0.1:${port}`;

let browser;
try {
  browser = await chromium.launch();
} catch (error) {
  browser = await chromium.launch({ channel: 'chrome' }).catch(() => {
    throw error;
  });
}

try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await installApiMocks(page);
  await page.clock.setFixedTime(now);
  const consoleIssues = collectConsoleIssues(page);

  await runDesktopSmoke(page);
  await runMobileSmoke(context);

  if (consoleIssues.length) {
    throw new Error(`Console issues detected:\n${consoleIssues.join('\n')}`);
  }

  console.log(`Browser smoke passed. Screenshots: ${artifactsDir}`);
} finally {
  await browser?.close();
  await vite.close();
  await new Promise((resolve) => httpServer.close(resolve));
}

async function installApiMocks(page) {
  await page.route('**/api/**', async (route, request) => {
    const url = new URL(request.url());
    const framePath = request.frame()?.url() ? new URL(request.frame().url()).pathname : '/console/overview';
    const isPlatformFrame = framePath.startsWith('/admin');
    const pathName = url.pathname;

    if (pathName === '/api/me') {
      return route.fulfill({ json: isPlatformFrame ? platformMe : customerMe });
    }
    if (pathName === '/api/summary' || pathName === '/api/admin/summary') return route.fulfill({ json: summary });
    if (pathName === '/api/customers' || pathName === '/api/admin/customers') return route.fulfill({ json: customers });
    if (pathName === '/api/devices' || pathName === '/api/admin/devices') return route.fulfill({ json: devices });
    if (pathName === '/api/fleet/health-summary') return route.fulfill({ json: fleetHealth });
    if (pathName === '/api/fleet/stream-stats') return route.fulfill({ json: streamStats });
    if (pathName === '/api/fleet/firmware-distribution') return route.fulfill({ json: firmwareDistribution });
    if (pathName === '/api/admin/platform-dashboard') return route.fulfill({ json: platformDashboard });
    if (pathName === '/api/admin/service-health') return route.fulfill({ json: platformHealth });
    if (pathName === '/api/admin/operations') return route.fulfill({ json: platformOperations });
    if (pathName === '/api/admin/audit') return route.fulfill({ json: audit });
    if (pathName === '/api/admin/sso/providers') return route.fulfill({ json: { providers: [] } });
    if (pathName.startsWith('/api/devices/') && pathName.endsWith('/telemetry')) {
      const deviceID = pathName.split('/')[3];
      return route.fulfill({ json: telemetryByDevice[deviceID] || {
        telemetry_status: 'unavailable',
        unavailable_reason: 'No telemetry sample found.',
        recent_events: [],
      } });
    }

    return route.fulfill({ status: 404, json: { error: `Unhandled browser smoke API: ${pathName}` } });
  });
}

function collectConsoleIssues(page) {
  const issues = [];
  page.on('console', (message) => {
    if (!['error', 'warning'].includes(message.type())) return;
    issues.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    issues.push(`pageerror: ${error.message}`);
  });
  return issues;
}

async function runDesktopSmoke(page) {
  await page.setViewportSize({ width: 1440, height: 1000 });

  await gotoAndAssert(page, '/console/overview', 'Fleet Health Overview');
  await expectText(page, 'Online Rate');
  await expectText(page, 'Needs Attention');
  await expectText(page, 'Active Streams');
  await screenshot(page, 'desktop-overview.png');

  await gotoAndAssert(page, '/signup', 'Sign up');
  await expectText(page, 'evaluation-tier');
  await expectText(page, 'Create account');
  await gotoAndAssert(page, '/signup/check-email?email=fleet.manager%40example.com', 'Check your email');
  await expectText(page, 'Resend');
  await gotoAndAssert(page, '/verify', 'Verify email');
  await expectText(page, 'Waiting for verification link');
  await screenshot(page, 'desktop-public-auth.png');

  await gotoAndAssert(page, '/console/devices?device=dev-1002', 'Devices');
  await expectText(page, 'Dock Door 07');
  await expectText(page, 'Actions');
  await expectText(page, 'Inspect');
  await expectText(page, 'Provision device');
  await screenshot(page, 'desktop-devices-drawer.png');

  await gotoAndAssert(page, '/console/firmware-ota', 'Firmware & OTA');
  await page.getByRole('button', { name: /ota-2026-05/i }).click();
  await expectText(page, 'Campaign Detail');
  await expectText(page, 'Warehouse East');
  await screenshot(page, 'desktop-firmware.png');

  await gotoAndAssert(page, '/console/stream-health', 'Stream Health');
  await expectText(page, 'Worst devices');
  await page.getByRole('button', { name: /Dock Door 07/i }).click();
  await expectText(page, 'Provision device');
  await screenshot(page, 'desktop-stream-open-device.png');

  await gotoAndAssert(page, '/admin', 'Platform Dashboard');
  await expectText(page, 'Scrape Targets Down');
  await expectText(page, 'Service & Scrape Health');
  await expectText(page, 'Tenant & Device Footprint');
  await expectText(page, 'Runtime Health');
  await expectText(page, 'Infrastructure Health');
  await screenshot(page, 'desktop-platform-dashboard.png');

  await gotoAndAssert(page, '/admin/ops', 'Operations');
  await expectText(page, 'Lifecycle operations');
  await expectText(page, 'Provisioning succeeded');
  await expectText(page, 'Raw type: DeviceProvisionSucceeded');
  await screenshot(page, 'desktop-platform-operations.png');

  await gotoAndAssert(page, '/admin/sso', 'SSO Providers');
  await expectText(page, 'OIDC is the first supported protocol');
  await screenshot(page, 'desktop-platform-sso.png');

  await gotoAndAssert(page, '/admin/audit', 'Audit Log');
  await expectText(page, 'Current write coverage');
  await screenshot(page, 'desktop-platform-audit.png');
}

async function runMobileSmoke(browserContext) {
  const page = await browserContext.newPage();
  await installApiMocks(page);
  const consoleIssues = collectConsoleIssues(page);
  await page.clock.setFixedTime(now);
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoAndAssert(page, '/console/devices', 'Devices');
  await expectText(page, 'Overview');
  await expectText(page, 'Stream Health');
  await page.getByLabel('Compact device list').waitFor({ state: 'visible', timeout: 5000 });

  const tableVisible = await page.locator('.device-table-panel table').isVisible();
  const compactVisible = await page.locator('.mobile-device-list').isVisible();
  if (tableVisible || !compactVisible) {
    throw new Error('Mobile Devices view must hide the full table and show compact rows.');
  }
  await screenshot(page, 'mobile-devices.png');

  await gotoAndAssert(page, '/admin', 'Platform Dashboard');
  await expectText(page, 'Tenant & Device Footprint');
  await screenshot(page, 'mobile-platform-dashboard.png');

  await gotoAndAssert(page, '/signup', 'Sign up');
  await expectText(page, 'Create account');
  await screenshot(page, 'mobile-public-signup.png');

  if (consoleIssues.length) {
    throw new Error(`Mobile console issues detected:\n${consoleIssues.join('\n')}`);
  }
  await page.close();
}

async function gotoAndAssert(page, routePath, expectedTitle) {
  await page.goto(`${baseURL}${routePath}`, { waitUntil: 'networkidle' });
  if (page.url() !== `${baseURL}${routePath}`) {
    throw new Error(`Unexpected URL after navigation: ${page.url()}`);
  }
  await expectText(page, expectedTitle);
  const rootText = await page.locator('#root').innerText();
  if (!rootText.trim()) {
    throw new Error(`Blank app shell at ${routePath}`);
  }
  if (/Internal server error|vite|webpack|ReferenceError|TypeError/.test(rootText)) {
    throw new Error(`Framework/runtime overlay detected at ${routePath}`);
  }
}

async function expectText(page, text) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: 5000 });
}

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(artifactsDir, name), fullPage: false });
}
