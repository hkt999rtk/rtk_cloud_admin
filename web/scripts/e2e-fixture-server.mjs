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
const state = { brandClouds, users, members, devices, operations, logs, sessions, prometheus, chipsetProviders: [] };
let platformValidationAllowed = true;

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/api/v1/query' || url.pathname === '/api/v1/query_range') return prometheusResponse(res);
    if (url.pathname === '/v1/logs') return send(res, 200, { events: state.logs.map((event) => ({ event_id: `${event.operation_id}-${event.request_id}`, service: event.service, level: event.level, ts: event.timestamp, msg: event.message, trace_id: event.trace_id, request_id: event.request_id, operation_id: event.operation_id })) });
    if (url.pathname === '/v1/auth/login' && req.method === 'POST') return login(req, res);
    if (url.pathname === '/v1/me') return send(res, 200, customerProfile(req));
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
    if (url.pathname === '/v1/developer/chipsets' || url.pathname.startsWith('/v1/developer/chipsets/')) return handleDeveloperChipsets(req, res, url);
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
    };
    const session = identities[body.email];
    if (!session || session[0] !== body.password) return send(res, 401, { error: 'invalid credentials' });
    return send(res, 200, { user: { id: `${session[1]}-user`, email: body.email, name: body.email }, tokens: { access_token: `e2e-${session[1]}-token`, refresh_token: `e2e-${session[1]}-refresh`, expires_in: 3600 } });
  });
}

function customerProfile(req) {
  const role = String(req.headers.authorization || '').match(/e2e-([a-z_]+)-token/)?.[1] || 'customer';
  const capabilitySets = {
    platform_admin: ['platform.chipset_sdk.read', 'platform.chipset_sdk.edit', 'platform.chipset_sdk.publish'],
    platform_reader: ['platform.chipset_sdk.read'],
    developer: ['fleet.read'],
    customer: ['fleet.read'],
  };
  const capabilities = capabilitySets[role] || [];
  return {
    user: { id: `${role}-user`, email: `${role}@example.com`, name: `${role} E2E User` },
    organizations: state.brandClouds.map((brand) => ({ id: brand.id, name: brand.name, role: 'owner', tier: brand.tier, capabilities })),
    capabilities,
  };
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

async function handleChipsetProviders(req, res) {
  if (req.method === 'GET') return send(res, 200, { providers: state.chipsetProviders });
  if (req.method !== 'POST') return send(res, 405, { error: { code: 'method_not_allowed' } });
  if (!req.headers['idempotency-key']) return send(res, 400, { error: { code: 'idempotency_key_required' } });
  const body = await readBody(req);
  if (String(body.manifest_url || '').includes('not-allowed.example')) return send(res, 400, { error: { code: 'PROVIDER_HOST_NOT_ALLOWED' } });
  const provider = {
    id: `provider-${state.chipsetProviders.length + 1}`, name: body.name, manifest_url: body.manifest_url,
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
    Object.assign(provider, await readBody(req), { updated_at: new Date().toISOString() });
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
    if (provider.refresh_count > 1) {
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
