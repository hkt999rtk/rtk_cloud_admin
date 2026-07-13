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
const state = { brandClouds, users, members, devices, operations, logs, sessions, prometheus };

const server = createServer(async (req, res) => {
  try {
    if (mode === 'unavailable') return send(res, 503, { error: 'fixture unavailable' });
    if (mode === 'unauthorized') return send(res, 401, { error: 'unauthorized' });
    if (mode === 'forbidden') return send(res, 403, { error: 'forbidden' });
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/api/v1/query' || url.pathname === '/api/v1/query_range') return prometheusResponse(res);
    if (url.pathname === '/v1/logs') return send(res, 200, { events: state.logs.map((event) => ({ event_id: `${event.operation_id}-${event.request_id}`, service: event.service, level: event.level, ts: event.timestamp, msg: event.message, trace_id: event.trace_id, request_id: event.request_id, operation_id: event.operation_id })) });
    if (url.pathname === '/v1/auth/login' && req.method === 'POST') return login(req, res);
    if (url.pathname === '/v1/admin/brand-clouds' && req.method === 'GET') return send(res, 200, { brand_clouds: state.brandClouds });
    if (url.pathname === '/v1/admin/brand-clouds' && req.method === 'POST') return createBrandCloud(req, res);
    if (url.pathname === '/v1/admin/devices' && req.method === 'GET') return send(res, 200, { devices: state.devices });
    if (url.pathname === '/v1/admin/operations' && req.method === 'GET') return send(res, 200, { operations: state.operations || [] });
    if (url.pathname === '/v1/admin/sso/providers/status' && req.method === 'GET') return send(res, 200, { providers: state.brandClouds.map((brand) => ssoFor(brand.id)) });
    if (url.pathname === '/v1/health') return send(res, 200, { status: 'ok' });
    if (url.pathname === '/v1/me') return send(res, 200, { user: { id: 'customer-user', email: 'customer@example.com', name: 'E2E Customer' }, organizations: state.brandClouds.map((brand) => ({ id: brand.id, name: brand.name, role: 'owner', tier: brand.tier })) });
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
    const session = state.sessions.find((item) => item.email === body.email);
    if (!session || session.password !== body.password) return send(res, 401, { error: 'invalid credentials' });
    return send(res, 200, { user: { id: session.kind === 'platform_admin' ? 'platform-admin' : 'customer-user', email: session.email, name: session.email }, tokens: { access_token: `e2e-${session.kind}-token`, refresh_token: `e2e-${session.kind}-refresh`, expires_in: 3600 } });
  });
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
  const value = prometheusMode === 'empty' ? [] : [{ metric: { job: 'e2e', service: 'cloud-admin', namespace: 'e2e', role: 'api' }, value: [String(Date.now() / 1000), prometheusMode === 'stale' ? '0' : '1'] }];
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
