import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const webRoot = path.resolve(new URL('..', import.meta.url).pathname);
const repoRoot = path.resolve(webRoot, '..');
const fixtureDir = process.env.E2E_FIXTURE_DIR || path.join(repoRoot, '.artifacts', 'e2e-fixtures', 'cloud-admin-e2e');
const databaseDir = await mkdtemp(path.join(os.tmpdir(), 'rtk-cloud-admin-e2e-'));
const fixture = spawn(process.execPath, [path.join(webRoot, 'scripts', 'e2e-fixture-server.mjs')], { env: { ...process.env, E2E_FIXTURE_DIR: fixtureDir, E2E_FIXTURE_PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
const fixturePort = Number(await firstLine(fixture.stdout));
const prometheusBaseURL = process.env.E2E_PROMETHEUS_MODE === 'unconfigured' ? '' : `http://127.0.0.1:${fixturePort}`;
const server = spawn('go', ['run', './cmd/server'], { cwd: repoRoot, env: { ...process.env, GOWORK: 'off', PORT: process.env.E2E_APP_PORT || '18082', DATABASE_PATH: path.join(databaseDir, 'e2e.db'), ACCOUNT_MANAGER_BASE_URL: `http://127.0.0.1:${fixturePort}`, VIDEO_CLOUD_BASE_URL: `http://127.0.0.1:${fixturePort}`, VIDEO_CLOUD_ADMIN_TOKEN: 'e2e-video-token', VIDEO_CLOUD_PROMETHEUS_BASE_URL: prometheusBaseURL, CLOUD_LOGGER_ENDPOINT: `http://127.0.0.1:${fixturePort}`, CLOUD_LOGGER_INGEST_TOKEN: 'e2e-log-token', CUSTOMER_PASSWORD_LOGIN_ENABLED: 'true' }, stdio: 'inherit' });

const cleanup = async () => {
  server.kill('SIGTERM');
  fixture.kill('SIGTERM');
  await rm(databaseDir, { recursive: true, force: true });
};
process.on('SIGINT', async () => { await cleanup(); process.exit(130); });
process.on('SIGTERM', async () => { await cleanup(); process.exit(143); });
server.on('exit', async (code) => { await cleanup(); process.exit(code || 0); });

async function firstLine(stream) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk) => { buffer += chunk.toString(); const index = buffer.indexOf('\n'); if (index >= 0) { stream.off('data', onData); try { resolve(buffer.slice(0, index)); } catch (error) { reject(error); } } };
    stream.on('data', onData);
    stream.on('error', reject);
  }).then((line) => JSON.parse(line).port);
}
