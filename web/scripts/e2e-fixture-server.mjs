import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const fixtureDir = process.env.E2E_FIXTURE_DIR;
const port = Number(process.env.E2E_FIXTURE_PORT || 0);
const mode = process.env.E2E_SCENARIO_MODE || 'normal';
const prometheusMode = process.env.E2E_PROMETHEUS_MODE || mode;
if (!fixtureDir) throw new Error('E2E_FIXTURE_DIR is required');

const [brandClouds, users, members, devices, operations, logs, sessions, prometheus] = await Promise.all([
  load('brand-clouds.json'), load('brand-cloud-users.json'), load('brand-cloud-members.json'), load('devices.json'),
  load('operations.json'), load('service-logs.json'), load('sessions.json'), load('prometheus-series.json'),
]);
const state = { brandClouds, users, members, devices, operations, logs, sessions, prometheus, jobs: [], reports: [], sources: [], transfers: [], chipsetProviders: [], idempotency: new Map(), requestLog: [] };
let platformValidationAllowed = true;

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    state.requestLog.push({ method: req.method, path: url.pathname, cloud: req.headers['x-brand-cloud-id'] || '' });
    if (url.pathname === '/__e2e__/state' && req.method === 'GET') return send(res, 200, { mode, requests: state.requestLog.slice(-500), jobs: state.jobs, reports: state.reports, sources: state.sources, transfers: state.transfers });
    if (url.pathname === '/__e2e__/state/reset' && req.method === 'POST') { state.jobs = []; state.reports = []; state.sources = []; state.transfers = []; state.chipsetProviders = []; state.idempotency.clear(); state.requestLog = []; return send(res, 200, { reset: true }); }
    if (url.pathname === '/api/v1/query' || url.pathname === '/api/v1/query_range') return prometheusResponse(res);
    if (url.pathname === '/v1/logs') return send(res, 200, { events: state.logs.map((event) => ({ event_id: `${event.operation_id}-${event.request_id}`, service: event.service, level: event.level, ts: event.timestamp, msg: event.message, trace_id: event.trace_id, request_id: event.request_id, operation_id: event.operation_id })) });
    if (url.pathname === '/v1/auth/login' && req.method === 'POST') return login(req, res);
    if (url.pathname === '/v1/me') return send(res, 200, customerProfile(req));
    if (url.pathname === '/v1/orgs' && req.method === 'GET') return send(res, 200, { organizations: customerProfile(req).organizations });
    const authenticatedUpstreamRequest = Boolean(req.headers.authorization);
    const platformValidationRequest = url.pathname === '/v1/admin/brand-clouds'
      && req.method === 'GET'
      && String(req.headers.authorization || '').includes('e2e-platform_admin-token');
    if (platformValidationRequest && platformValidationAllowed) platformValidationAllowed = false;
    const shouldFailAuthenticatedRequest = authenticatedUpstreamRequest && !(platformValidationRequest && !platformValidationAllowed);
    if (shouldFailAuthenticatedRequest && mode === 'unavailable') return send(res, 503, { error: 'fixture unavailable' });
    if (shouldFailAuthenticatedRequest && mode === 'unauthorized') return send(res, 401, { error: 'unauthorized' });
    if (shouldFailAuthenticatedRequest && mode === 'forbidden') return send(res, 403, { error: 'forbidden' });
    if (url.pathname === '/v1/admin/brand-clouds' && req.method === 'GET') return send(res, 200, { brand_clouds: state.brandClouds });
    if (url.pathname === '/v1/admin/brand-clouds' && req.method === 'POST') return createBrandCloud(req, res);
    if (url.pathname === '/v1/admin/chipset-providers') return handleChipsetProviders(req, res);
    if (url.pathname.startsWith('/v1/admin/chipset-providers/')) return handleChipsetProvider(req, res, url);
    if (url.pathname === '/v1/admin/devices' && req.method === 'GET') return send(res, 200, { devices: state.devices });
    if (url.pathname === '/v1/admin/operations' && req.method === 'GET') return send(res, 200, { operations: state.operations || [] });
    if (url.pathname === '/v1/admin/sso/providers/status' && req.method === 'GET') return send(res, 200, { providers: state.brandClouds.map((brand) => ssoFor(brand.id)) });
    if (url.pathname.startsWith('/v1/orgs/')) return handleCustomerResource(req, res, url);
    if (url.pathname === '/v1/developer/chipsets' || url.pathname.startsWith('/v1/developer/chipsets/')) return handleDeveloperChipsets(req, res, url);
    if (url.pathname.startsWith('/v1/developer/')) return handleDeveloperResource(req, res, url);
    if (url.pathname.startsWith('/v1/ota/')) return handleOTA(req, res, url);
    if (['/enum_firmware', '/query_firmware_rollout', '/query_firmware_campaign'].includes(url.pathname)) return send(res, 200, url.pathname === '/enum_firmware' ? { firmware: [{ version: 'v3.8.0', model: 'RTK-CAM-A' }] } : url.pathname === '/query_firmware_campaign' ? { campaigns: [] } : { rollouts: [] });
    if (url.pathname === '/api/fleet/stream-stats' || url.pathname === '/api/fleet/health-summary') return send(res, 200, { source_status: mode === 'stale' ? 'stale' : 'available', source_freshness: mode === 'stale' ? '2020-01-01T00:00:00Z' : new Date().toISOString(), total: 2, healthy: 1, warning: 1, devices: [] });
    if (url.pathname === '/get_camera_info' && req.method === 'POST') return readBody(req).then((body) => send(res, 200, { status: 'ok', info: { current_transport: 'mqtt', firmware_version: 'v3.8.0', devid: body.devid } }));
    if (url.pathname === '/query_camera_activate' && req.method === 'POST') return readBody(req).then((body) => send(res, 200, { status: 'ok', devices: (body.devices || []).map(() => '1') }));
    if (url.pathname.startsWith('/api/devices/') && url.pathname.endsWith('/telemetry')) return send(res, 200, { source_status: 'available', telemetry: { online: true, health: 'healthy' } });
    if (url.pathname === '/v1/health') return send(res, 200, { status: 'ok' });
    const match = url.pathname.match(/^\/v1\/admin\/(brand-clouds|orgs)\/([^/]+)(.*)$/);
    if (match) return handleResource(req, res, match[1], decodeURIComponent(match[2]), match[3]);
    return send(res, 404, { error: 'not found' });
  } catch (error) {
    return send(res, 500, { error: error.message });
  }
});

server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  process.stdout.write(JSON.stringify({ port: address.port }) + '\n');
});

async function load(name) {
  return JSON.parse(await readFile(path.join(fixtureDir, name), 'utf8'));
}

function login(req, res) {
  return readBody(req).then((body) => {
    const identities = {
      'platform.admin@example.com': ['e2e-platform-password', 'platform_admin'],
      'platform.reader@example.com': ['e2e-platform-reader-password', 'platform_reader'],
      'customer@example.com': ['e2e-customer-password', 'customer'],
      'developer@example.com': ['e2e-developer-password', 'developer'],
      'operations@example.com': ['e2e-operations-password', 'operations'],
      'observer@example.com': ['e2e-observer-password', 'observer'],
      'outsider@example.com': ['e2e-outsider-password', 'outsider'],
    };
    const session = identities[body.email];
    if (!session || session[0] !== body.password) return send(res, 401, { error: 'invalid credentials' });
    return send(res, 200, { user: { id: `${session[1]}-user`, email: body.email, name: body.email }, tokens: { access_token: `e2e-${session[1]}-token`, refresh_token: `e2e-${session[1]}-refresh`, expires_in: 3600 } });
  });
}

function customerProfile(req) {
  const token = String(req.headers.authorization || '');
  const role = roleFromRequest(req);
  const capabilitySets = {
    platform_admin: ['platform.chipset_sdk.read', 'platform.chipset_sdk.edit', 'platform.chipset_sdk.publish'],
    platform_reader: ['platform.chipset_sdk.read'],
    developer: ['fleet.read', 'sku.read', 'sku.manage', 'sku.policy.manage', 'firmware.release.read', 'firmware.release.manage', 'ota.plan.read', 'ota.plan.manage', 'reports.read', 'reports.create', 'team.read', 'team.manage', 'provisioning.read', 'provisioning.create'],
    operations: ['fleet.read', 'fleet.device.manage', 'fleet.batch.manage', 'fleet.batch.read', 'ota.plan.read', 'ota.plan.manage', 'reports.read', 'team.read', 'provisioning.read'],
    observer: ['fleet.read', 'sku.read', 'firmware.release.read', 'ota.plan.read', 'reports.read', 'team.read', 'provisioning.read'],
    customer: ['fleet.read', 'sku.read', 'firmware.release.read', 'ota.plan.read', 'reports.read', 'team.read', 'provisioning.read'],
    outsider: [],
  };
  const capabilities = capabilitySets[role] || [];
  const visibleClouds = role === 'outsider' ? [] : role === 'customer' ? state.brandClouds.slice(0, 1) : state.brandClouds;
  const clouds = visibleClouds.map((brand) => ({ id: brand.id, name: brand.name, role: role === 'operations' ? 'Operations' : role === 'observer' ? 'Observer' : 'Developer / Release', tier: brand.tier, status: brand.status, capabilities }));
  return { user: { id: `${role}-user`, email: `${role}@example.com`, name: `${role} E2E User` }, organizations: clouds, capabilities };
}

function roleFromRequest(req) {
  return String(req.headers.authorization || '').match(/e2e-([a-z_]+)-token/)?.[1] || 'customer';
}

function cloudDevices(orgID) {
  return (state.devices || []).filter((device) => String(device.organization_id || device.organization || '').includes(orgID === 'brand-e2e-02' ? '02' : '01')).map((device, index) => ({
    id: device.id || `device-${orgID}-${index + 1}`,
    organization_id: orgID,
    name: device.name || `E2E Device ${index + 1}`,
    category: device.category || 'camera',
    model: device.model || 'RTK-CAM-A',
    serial_number: device.serial_number || `SERIAL-${index + 1}`,
    video_cloud_devid: device.video_cloud_devid || `video-${index + 1}`,
    status: device.status || 'online',
    readiness: device.readiness || 'ready',
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    device_item_profile_id: device.device_item_profile_id || `sku-${orgID === 'brand-e2e-02' ? 'beta' : 'alpha'}`,
    metadata: { region: orgID === 'brand-e2e-02' ? 'eu' : 'na', firmware_version: index % 2 ? 'v3.7.0' : 'v3.8.0', group_id: `group-${orgID}` },
  }));
}

function profileFor(orgID, id = `sku-${orgID === 'brand-e2e-02' ? 'beta' : 'alpha'}`) {
  return { id, brand_cloud_id: orgID, profile_key: id, display_name: `E2E ${id} Camera`, status: 'active', category: 'camera', model: 'RTK-CAM-A', service_options: ['stream', 'record'], claim_policy: {}, provisioning_policy: {}, metadata_defaults: {}, metadata_schema: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
}

async function handleChipsetProviders(req, res) {
  if (req.method === 'GET') return send(res, 200, { providers: state.chipsetProviders });
  if (req.method !== 'POST') return send(res, 405, { error: { code: 'method_not_allowed' } });
  if (!req.headers['idempotency-key']) return send(res, 400, { error: { code: 'idempotency_key_required' } });
  const body = await readBody(req);
  if (String(body.manifest_url || '').includes('not-allowed.example')) return send(res, 400, { error: { code: 'PROVIDER_HOST_NOT_ALLOWED' } });
  const provider = {
    id: `provider-${state.chipsetProviders.length + 1}`,
    name: body.name,
    manifest_url: body.manifest_url,
    status: 'draft', manifest_version: '', chipset_count: 0, sdk_release_count: 0,
    stale: false, unavailable: true, validation_error: '', refresh_count: 0,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  state.chipsetProviders.push(provider);
  return send(res, 201, { provider, chipsets: [], audit_result: 'accepted' });
}

async function handleChipsetProvider(req, res, url) {
  const match = url.pathname.match(/^\/v1\/admin\/chipset-providers\/([^/]+)(?:\/(publish|unpublish|refresh))?$/);
  if (!match) return send(res, 404, { error: { code: 'not_found' } });
  const provider = state.chipsetProviders.find((item) => item.id === decodeURIComponent(match[1]));
  if (!provider) return send(res, 404, { error: { code: 'not_found' } });
  const action = match[2];
  if (req.method === 'GET' && !action) return send(res, 200, { provider, chipsets: providerChipsets(provider) });
  if (!req.headers['idempotency-key']) return send(res, 400, { error: { code: 'idempotency_key_required' } });
  if (req.method === 'PATCH' && !action) {
    if (provider.status === 'published') return send(res, 409, { error: { code: 'conflict' } });
    const body = await readBody(req);
    provider.name = body.name;
    provider.manifest_url = body.manifest_url;
    provider.updated_at = new Date().toISOString();
    return send(res, 200, { provider, audit_result: 'accepted' });
  }
  if (req.method !== 'POST' || !action) return send(res, 405, { error: { code: 'method_not_allowed' } });
  if (action === 'publish') {
    provider.status = 'published'; provider.unavailable = false; provider.stale = false;
    provider.manifest_version = '1'; provider.snapshot_version = '1.0.0'; provider.chipset_count = 1; provider.sdk_release_count = 2;
    provider.last_successful_refresh_at = new Date().toISOString(); provider.refresh_count = 0;
  } else if (action === 'unpublish') {
    provider.status = 'unpublished';
  } else if (action === 'refresh') {
    provider.refresh_count += 1;
    if (provider.refresh_count >= 2) {
      provider.stale = true; provider.validation_error = 'provider fetch failed';
      return send(res, 502, { error: { code: 'PROVIDER_FETCH_FAILED' } });
    }
    provider.snapshot_version = '2.0.0'; provider.stale = false; provider.validation_error = '';
    provider.last_successful_refresh_at = new Date().toISOString();
  }
  provider.updated_at = new Date().toISOString();
  return send(res, 200, { provider, audit_result: 'accepted' });
}

function handleDeveloperChipsets(req, res, url) {
  if (req.method !== 'GET') return send(res, 405, { error: { code: 'method_not_allowed' } });
  const chipsets = state.chipsetProviders.filter((provider) => provider.status === 'published' && !provider.unavailable).flatMap(providerChipsets);
  const match = url.pathname.match(/^\/v1\/developer\/chipsets\/([^/]+)$/);
  if (!match) return send(res, 200, { chipsets });
  const chipset = chipsets.find((item) => item.id === decodeURIComponent(match[1]));
  return chipset ? send(res, 200, { chipset }) : send(res, 404, { error: { code: 'not_found' } });
}

function providerChipsets(provider) {
  if (!provider.snapshot_version) return [];
  return [{
    id: `${provider.id}-amebapro2`, provider_name: provider.name, chipset_key: 'realtek-amebapro2', vendor: 'Realtek', name: 'AmebaPro2', family: 'Ameba',
    description: 'AmebaPro2 ChipSet information and SDK resources.', stale: provider.stale, last_successful_refresh_at: provider.last_successful_refresh_at,
    sdk_releases: [
      { name: 'Ameba Arduino Pro2', version: provider.snapshot_version, summary: 'Arduino SDK and examples for AmebaPro2.', recommended: true, supported_models: ['AMB82-Mini'], endpoints: [
        { type: 'github', title: 'Ameba Arduino Pro2 GitHub', url: 'https://github.com/Ameba-AIoT/ameba-arduino-pro2' },
        { type: 'documentation', title: 'AmebaPro2 documentation', url: 'https://www.amebaiot.com/en/amebapro2/' },
      ] },
      { name: 'ambpro2 SDK', version: 'main', summary: 'FreeRTOS-based AmebaPro2 SDK.', recommended: false, supported_models: [], endpoints: [
        { type: 'sdk', title: 'Get ambpro2 SDK', url: 'https://github.com/Freertos-kvs-LTS/ambpro2_sdk' },
      ] },
    ],
  }];
}

async function handleCustomerResource(req, res, url) {
  const match = url.pathname.match(/^\/v1\/orgs\/([^/]+)(.*)$/);
  if (!match) return send(res, 404, { error: 'not found' });
  const orgID = decodeURIComponent(match[1]);
  const suffix = match[2];
  if (!['brand-e2e-01', 'brand-e2e-02'].includes(orgID)) return send(res, 403, { error: 'organization forbidden' });
  const devices = mode === 'empty' ? [] : cloudDevices(orgID);
  if (mode === 'slow' && req.method !== 'GET') await new Promise((resolve) => setTimeout(resolve, 350));
  if (suffix === '/fleet/devices' && req.method === 'GET') {
    const query = url.searchParams;
    const filtered = devices.filter((device) => !query.get('q') || JSON.stringify(device).toLowerCase().includes(query.get('q').toLowerCase()));
    const limit = Math.min(Number(query.get('limit') || 100), 250);
    const offset = Number(query.get('offset') || 0);
    return send(res, 200, { devices: filtered.slice(offset, offset + limit), pagination: { limit, offset, total: filtered.length }, query: { server_side: true } });
  }
  if (suffix === '/fleet/summary' && req.method === 'GET') return send(res, 200, { total: devices.length, by_status: { online: devices.length }, by_sku: { [`sku-${orgID === 'brand-e2e-02' ? 'beta' : 'alpha'}`]: devices.length }, by_model: { 'RTK-CAM-A': devices.length }, by_firmware: { 'v3.8.0': devices.length }, by_region: { [orgID === 'brand-e2e-02' ? 'eu' : 'na']: devices.length }, service_enabled: {}, by_sku_region: {}, by_sku_firmware: {}, updated_at: mode === 'stale' ? '2020-01-01T00:00:00Z' : new Date().toISOString() });
  if (suffix === '/devices' && req.method === 'GET') return send(res, 200, { devices });
  const deviceMatch = suffix.match(/^\/devices\/([^/]+)$/);
  if (deviceMatch && req.method === 'GET') {
    const device = devices.find((item) => item.id === decodeURIComponent(deviceMatch[1]));
    return device ? send(res, 200, { device }) : send(res, 404, { error: 'device not found' });
  }
  if (deviceMatch && req.method === 'PATCH') {
    if (mode === 'partial_failure' && decodeURIComponent(deviceMatch[1]).endsWith('003')) return send(res, 502, { error: 'fixture device update failed' });
    const device = devices.find((item) => item.id === decodeURIComponent(deviceMatch[1]));
    return device ? send(res, 200, { device: { ...device, ...(await readBody(req)) } }) : send(res, 404, { error: 'device not found' });
  }
  if (suffix === '/device-item-profiles' && req.method === 'GET') return send(res, 200, { device_item_profiles: mode === 'empty' ? [] : [profileFor(orgID)] });
  if (suffix === '/device-item-profiles' && req.method === 'POST') {
    const body = await readBody(req);
    const profile = { ...profileFor(orgID, body.profile_key || `sku-${orgID}-created`), ...body };
    return send(res, 201, { device_item_profile: profile });
  }
  const profileMatch = suffix.match(/^\/device-item-profiles\/([^/]+)$/);
  if (profileMatch && req.method === 'GET') return send(res, 200, { device_item_profile: profileFor(orgID, decodeURIComponent(profileMatch[1])) });
  if (profileMatch && req.method === 'PATCH') {
    const body = await readBody(req);
    return send(res, 200, { device_item_profile: { ...profileFor(orgID, decodeURIComponent(profileMatch[1])), ...body } });
  }
  const profileDisableMatch = suffix.match(/^\/device-item-profiles\/([^/]+)\/disable$/);
  if (profileDisableMatch && req.method === 'POST') return send(res, 200, { device_item_profile: { ...profileFor(orgID, decodeURIComponent(profileDisableMatch[1])), status: 'disabled' } });
  if (suffix === '/device-groups' && req.method === 'GET') return send(res, 200, { device_groups: [{ id: `group-${orgID}`, organization_id: orgID, name: 'E2E Operations Group', device_count: devices.length }] });
  if (suffix === '/device-groups' && req.method === 'POST') { const body = await readBody(req); return send(res, 201, { group: { id: `group-${orgID}-created`, organization_id: orgID, ...body, device_count: 0 } }); }
  const groupMatch = suffix.match(/^\/device-groups\/([^/]+)$/);
  if (groupMatch && ['PATCH', 'DELETE'].includes(req.method)) return send(res, 200, { group: { id: decodeURIComponent(groupMatch[1]), organization_id: orgID, name: 'E2E Operations Group', device_count: devices.length } });
  if (suffix === '/tags' && req.method === 'GET') return send(res, 200, { tags: [{ tag: 'e2e', count: devices.length }] });
  if (suffix === '/access/check' && req.method === 'GET') {
    const permission = url.searchParams.get('permission') || '';
    const role = roleFromRequest(req);
    const allowed = role === 'developer' || (role === 'operations' && ['registry_device.read', 'registry_device.manage'].includes(permission));
    return send(res, 200, { allowed, permission, scope_type: url.searchParams.get('scope_type'), scope_id: url.searchParams.get('scope_id') });
  }
  if (suffix === '/roles' && req.method === 'GET') return send(res, 200, { roles: [{ id: 'role-owner', name: 'Developer / Release', capabilities: ['sku.manage', 'ota.plan.manage'] }, { id: 'role-operations', name: 'Operations', capabilities: ['fleet.device.manage', 'fleet.batch.manage'] }, { id: 'role-observer', name: 'Observer', capabilities: ['fleet.read'] }] });
  if (suffix === '/permissions' && req.method === 'GET') return send(res, 200, { permissions: [] });
  if (suffix === '/role-assignments' && req.method === 'GET') return send(res, 200, { assignments: [] });
  if (suffix === '/role-assignments' && req.method === 'POST') { const body = await readBody(req); return send(res, 201, { role_assignment: { id: `assignment-${Date.now()}`, organization_id: orgID, ...body } }); }
  const assignmentMatch = suffix.match(/^\/role-assignments\/([^/]+)$/);
  if (assignmentMatch && req.method === 'DELETE') return send(res, 204, {});
  const lifecycleMatch = suffix.match(/^\/devices\/([^/]+)\/(provision|deactivate)$/);
  if (lifecycleMatch && req.method === 'POST') {
    if (mode === 'partial_failure' && lifecycleMatch[1].endsWith('003')) return send(res, 502, { error: 'fixture device action failed' });
    return send(res, 202, { operation: { id: `operation-${Date.now()}`, state: 'queued', device_id: decodeURIComponent(lifecycleMatch[1]), action: lifecycleMatch[2] } });
  }
  return send(res, 404, { error: 'not found' });
}

async function handleDeveloperResource(req, res, url) {
  if (url.pathname === '/v1/developer/brand-cloud-owner-transfers/accept' && req.method === 'POST') {
    const body = await readBody(req);
    const transfer = state.transfers.find((item) => item.token === body.token);
    if (!transfer || transfer.status !== 'pending' || new Date(transfer.expires_at) <= new Date()) return send(res, 410, { code: 'OWNER_TRANSFER_EXPIRED', message: 'Owner transfer token is invalid or expired.' });
    transfer.status = 'accepted';
    return send(res, 200, { owner_transfer: transfer });
  }
  const match = url.pathname.match(/^\/v1\/developer\/brand-clouds(?:\/([^/]+))?(.*)$/);
  if (!match) return send(res, 404, { error: 'not found' });
  const cloudID = match[1] ? decodeURIComponent(match[1]) : '';
  const suffix = match[2] || '';
  const clouds = state.brandClouds.map((brand) => ({ ...brand, role: 'owner', capabilities: customerProfile(req).organizations.find((item) => item.id === brand.id)?.capabilities || [] }));
  if (!cloudID && req.method === 'GET') return send(res, 200, { brand_clouds: clouds, pagination: { limit: 25, offset: 0, total: clouds.length }, developer_cloud_limit: 5 });
  if (!clouds.some((brand) => brand.id === cloudID)) return send(res, 403, { code: 'MEMBERSHIP_REQUIRED', message: 'Current developer is not a member of this Brand Cloud.' });
  if (!suffix && req.method === 'GET') return send(res, 200, { brand_cloud: clouds.find((brand) => brand.id === cloudID), membership: { organization_id: cloudID, brand_cloud_user_id: 'customer-user', role: 'owner', capabilities: clouds.find((brand) => brand.id === cloudID).capabilities } });
  if (suffix === '/members' && req.method === 'GET') return send(res, 200, { members: state.members.filter((member) => member.organization_id === cloudID), pagination: { limit: 25, offset: 0, total: state.members.filter((member) => member.organization_id === cloudID).length } });
  if (suffix === '/members/invitations' && req.method === 'POST') {
    const body = await readBody(req);
    const key = String(req.headers['idempotency-key'] || '');
    const replay = key && state.idempotency.get(`invite:${cloudID}:${key}`);
    if (replay) return send(res, 201, { member: replay, idempotent_replay: true });
    const member = { organization_id: cloudID, brand_cloud_user_id: `invited-${Date.now()}`, email: body.email, role: body.role || 'Observer', capabilities: [] };
    state.members.push(member);
    if (key) state.idempotency.set(`invite:${cloudID}:${key}`, member);
    return send(res, 201, { member });
  }
  const memberMatch = suffix.match(/^\/members\/([^/]+)(?:\/(disable|enable))?$/);
  if (memberMatch) {
    const member = state.members.find((item) => item.brand_cloud_user_id === decodeURIComponent(memberMatch[1]) && item.organization_id === cloudID);
    if (!member) return send(res, 404, { error: 'member not found' });
    if (memberMatch[2] === 'disable') member.disabled_at = new Date().toISOString();
    if (memberMatch[2] === 'enable') delete member.disabled_at;
    if (req.method === 'PATCH') Object.assign(member, await readBody(req));
    if (req.method === 'DELETE') member.disabled_at = new Date().toISOString();
    return send(res, 200, { member });
  }
  if (suffix === '/owner-transfer' && req.method === 'POST') {
    const body = await readBody(req);
    const key = String(req.headers['idempotency-key'] || '');
    const replay = key && state.idempotency.get(`transfer:${cloudID}:${key}`);
    if (replay) return send(res, 202, { owner_transfer: replay, idempotent_replay: true });
    const transfer = { id: `transfer-${Date.now()}`, token: `owner-token-${cloudID}-${body.target_email}`, brand_cloud_id: cloudID, target_email: body.target_email, status: 'pending', expires_at: new Date(Date.now() + (mode === 'expired' ? -1 : 86_400_000)).toISOString() };
    state.transfers.push(transfer);
    if (key) state.idempotency.set(`transfer:${cloudID}:${key}`, transfer);
    return send(res, 202, { owner_transfer: transfer });
  }
  const transferMatch = suffix.match(/^\/owner-transfer\/([^/]+)(?:\/cancel)?$/);
  if (transferMatch) { const transfer = state.transfers.find((item) => item.id === decodeURIComponent(transferMatch[1]) && item.brand_cloud_id === cloudID); if (!transfer) return send(res, 404, { error: 'transfer not found' }); if (suffix.endsWith('/cancel')) transfer.status = 'canceled'; return send(res, 200, { owner_transfer: transfer }); }
  return send(res, 404, { error: 'not found' });
}

async function handleOTA(req, res, url) {
  if (req.method === 'GET') return send(res, 200, { items: [{ id: 'release-e2e-1', release_id: 'release-e2e-1', sku_id: 'sku-brand-e2e-01', version: 'v3.8.0', state: 'published' }] });
  return send(res, 202, { status: 'accepted', id: `ota-${Date.now()}`, state: 'queued' });
}

async function createBrandCloud(req, res) {
  const body = await readBody(req);
  const id = `brand-e2e-created-${state.brandClouds.length + 1}`;
  const brand = { id, name: body.name || 'E2E Created Cloud', role: 'platform_admin', organization_kind: 'brand_cloud', status: body.status || 'active', tier: 'evaluation', evaluation_device_quota: 10, metadata: { ...(body.metadata || {}), run_id: state.prometheus.run_id, setup_status: 'ready' } };
  state.brandClouds.push(brand);
  return send(res, 201, { brand_cloud: brand });
}

async function handleResource(req, res, root, id, suffix) {
  if (root === 'orgs' && suffix === '/sso-provider') return send(res, 200, { provider: ssoFor(id) });
  if (root !== 'brand-clouds') return send(res, 404, { error: 'not found' });
  const brand = state.brandClouds.find((item) => item.id === id);
  if (!brand) return send(res, 404, { error: 'brand cloud not found' });
  if (suffix === '' && req.method === 'GET') return send(res, 200, { brand_cloud: brand });
  if (suffix === '' && req.method === 'PATCH') {
    Object.assign(brand, await readBody(req));
    return send(res, 200, { brand_cloud: brand });
  }
  if (suffix === '/members' && req.method === 'POST') {
    if (process.env.E2E_FAIL_ACTION === 'member-assign') return send(res, 502, { error: 'fixture member assignment failure' });
    const body = await readBody(req);
    const user = state.users.find((item) => item.id === body.brand_cloud_user_id);
    const member = { organization_id: id, user_id: body.brand_cloud_user_id, brand_cloud_user_id: body.brand_cloud_user_id, email: user?.email || '', role: body.role || 'owner' };
    state.members.push(member);
    return send(res, 201, { member });
  }
  if (suffix === '/users' && req.method === 'GET') return send(res, 200, { brand_cloud_users: state.users.filter((user) => user.brand_cloud_id === id) });
  if (suffix === '/users' && req.method === 'POST') {
    const body = await readBody(req);
    const user = { id: `bcu-created-${state.users.length + 1}`, brand_cloud_id: id, email: body.email, display_name: body.display_name || 'E2E Created User', email_verified: false, signup_pending_verification: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    state.users.push(user);
    return send(res, 201, { action: 'created', brand_cloud_user: user, brand_cloud_member: { organization_id: id, brand_cloud_user_id: user.id, email: user.email, role: body.role || 'member' } });
  }
  const userAction = suffix.match(/^\/users\/([^/]+)(?:\/(disable|enable|approve))?$/);
  if (userAction) {
    const user = state.users.find((item) => item.id === decodeURIComponent(userAction[1]));
    if (!user) return send(res, 404, { error: 'user not found' });
    if (userAction[2] === 'disable') user.disabled_at = new Date().toISOString();
    if (userAction[2] === 'enable') delete user.disabled_at;
    if (userAction[2] === 'approve') user.signup_pending_verification = false;
    if (req.method === 'DELETE') user.disabled_at = new Date().toISOString();
    return send(res, 200, { brand_cloud_user: user });
  }
  return send(res, 404, { error: 'not found' });
}

function ssoFor(id) {
  const configured = id === state.brandClouds[0]?.id;
  return { organization_id: id, organization: state.brandClouds.find((brand) => brand.id === id)?.name || '', provider_id: configured ? 'sso-e2e-001' : '', issuer: configured ? 'https://idp.e2e.example' : '', client_id: configured ? 'e2e-client' : '', verified_domains: configured ? ['e2e.example'] : [], enabled: configured, configured, status: configured ? 'enabled' : 'not_configured', last_validated_at: configured ? new Date().toISOString() : '' };
}

function prometheusResponse(res) {
  if (prometheusMode === 'unavailable') return send(res, 503, { error: 'prometheus unavailable' });
  const value = prometheusMode === 'empty' ? [] : [{ metric: { job: 'e2e', service: 'cloud-admin', namespace: 'e2e', role: 'api' }, value: [String(Date.now() / 1000), prometheusMode === 'stale' ? '999999' : '1'] }];
  return send(res, 200, { status: 'success', data: { resultType: 'vector', result: value } });
}

function readBody(req) {
  return new Promise((resolve, reject) => { let data = ''; req.on('data', (chunk) => { data += chunk; }); req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (error) { reject(error); } }); req.on('error', reject); });
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

process.on('SIGTERM', () => server.close(() => process.exit(0)));
