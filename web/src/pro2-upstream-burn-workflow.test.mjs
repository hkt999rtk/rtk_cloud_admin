import test from 'node:test';
import assert from 'node:assert/strict';
import { runBurnWorkflow } from './pro2-firmware-burner/burn-workflow.js';
import { options } from './pro2-firmware-burner/upstream-tests/helpers.js';

function setup(overrides = {}) {
  const events = [];
  const transport = {
    connected: true, owner: 'idle',
    acquire(owner) { events.push(`owner:${owner}`); this.owner = owner; },
    async write(text, owner) { assert.equal(owner, this.owner); events.push(text); },
    async drainWrites() { events.push('drain'); },
    async hardwareReset() { events.push('hardware'); }
  };
  const terminal = {
    async leave() { events.push('leave'); },
    async enter(value) { events.push(value); }
  };
  const controller = { async burn() { events.push('burn'); } };
  const args = { controller, transport, terminal, firmware: Uint8Array.of(1), options: options(), consoleBaud: 9600, openTerminal: false, ...overrides };
  return { events, args, transport, terminal, controller };
}

for (const reset of [false, true]) for (const openTerminal of [false, true]) {
  test(`successful workflow reset=${reset}, console=${openTerminal}`, async () => {
    const { args, events } = setup({ options: options({ reset, enterDownload: true, verify: true }), openTerminal });
    assert.deepEqual(await runBurnWorkflow(args), { status: 'completed', verified: true, consoleOpen: openTerminal, warnings: [] });
    assert.deepEqual(events, ['leave', 'burn', ...(reset ? ['owner:protocol', 'disc\n', 'drain', 'owner:idle'] : []), ...(openTerminal ? [{ baudRate: 9600, hardwareReset: false }] : []), ...(reset ? ['hardware'] : [])]);
  });
}

for (const error of [new Error('wire failed'), new DOMException('cancelled', 'AbortError')]) {
  test(`burn failure ${error.name} never resets or opens console`, async () => {
    const { args, events, controller } = setup({ options: options({ reset: true, enterDownload: true }), openTerminal: true });
    controller.burn = async () => { events.push('burn'); throw error; };
    await assert.rejects(runBurnWorkflow(args), value => value === error);
    assert.deepEqual(events, ['leave', 'burn']);
  });
}

test('validation precedes terminal leave and all UART effects', async () => {
  const { args, events } = setup({ options: options({ offset: 1, verify: true }) });
  await assert.rejects(runBurnWorkflow(args), /offset/);
  assert.deepEqual(events, []);
});

test('soft reset works without opt-in control lines and without console', async () => {
  const { args, events } = setup({ options: options({ reset: true, enterDownload: false }) });
  const result = await runBurnWorkflow(args);
  assert.equal(result.verified, false);
  assert.deepEqual(events, ['leave', 'burn', 'owner:protocol', 'disc\n', 'drain', 'owner:idle']);
});

for (const phase of ['disc', 'console', 'hardware']) {
  test(`${phase} failure preserves burn result, warns and stops remaining post-actions`, async () => {
    const { args, events, transport, terminal } = setup({ options: options({ reset: true, enterDownload: true, verify: true }), openTerminal: true });
    const fail = async () => { events.push(`failed:${phase}`); throw new Error(`${phase} unavailable`); };
    if (phase === 'disc') transport.write = fail;
    if (phase === 'console') terminal.enter = fail;
    if (phase === 'hardware') transport.hardwareReset = fail;
    const result = await runBurnWorkflow(args);
    assert.equal(result.status, 'completed');
    assert.equal(result.verified, true);
    assert.equal(result.consoleOpen, phase === 'hardware');
    assert.match(result.warnings.join(), new RegExp(`${phase} unavailable`));
    assert.equal(transport.owner, 'idle');
    assert.equal(events.includes('hardware'), false);
    if (phase === 'disc') assert.equal(events.some(e => typeof e === 'object'), false);
  });
}
