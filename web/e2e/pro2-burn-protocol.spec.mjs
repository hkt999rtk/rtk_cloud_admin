import {test, expect} from '@playwright/test';
import {login} from './fixtures/session.mjs';
// Browser fake-port protocol/workflow cases ported from uartfwburn 8608cad.
const runCases = async () => {
  const $ = id => document.getElementById(id);
  const results = [];
  const check = (value, message) => { if (!value) throw new Error(message); };
  const wait = async (predicate, message) => {
    const deadline = Date.now() + 8000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(`timeout: ${message}: ${$('message').textContent}`);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  };
  const data = Uint8Array.from({ length: 1025 }, (_, i) => i & 255);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const originalRequest = navigator.serial.requestPort;
  const originalConfirm = window.confirm;
  window.confirm = () => true;
  let active;
  const makePort = config => {
    const events = [];
    let input;
    let pendingBaud = null;
    const emit = value => input.enqueue(typeof value === 'string' ? encoder.encode(value) : value);
    const port = {
      events, packets: 0, releaseDisc: null,
      async open({ baudRate }) {
        if (this.readable || this.writable) throw new Error('port already open');
        events.push({ open: baudRate });
        this.readable = new ReadableStream({ start(controller) { input = controller; } });
        this.writable = new WritableStream({ async write(bytes) {
          const text = decoder.decode(bytes);
          if (bytes[0] === 2 && bytes.length > 1024) {
            port.packets++; events.push({ packet: bytes.length });
            if (config.disconnect) input.error(new Error('simulated USB disconnect'));
            else if (!config.cancel) emit(Uint8Array.of(6));
          } else if (bytes[0] === 4 && bytes.length === 4) { events.push('EOT'); emit(Uint8Array.of(6, 79, 75)); }
          else if (bytes[0] === 24) events.push('CAN');
          else {
            events.push(text);
            if (text === 'ping\n') emit('ping');
            else if (text.startsWith('ucfg ')) {
              pendingBaud = Number(text.split(' ')[1]);
              if (pendingBaud === baudRate) { pendingBaud = null; emit('OK'); }
            } else if (text.startsWith('seras ') || text.startsWith('ceras ')) emit('OK');
            else if (text.startsWith('fwd ')) emit(Uint8Array.of(config.nak ? 21 : 67));
            else if (text.startsWith('hashq ')) {
              const response = new Uint8Array(70); response.set(encoder.encode('hashs ')); response.set(digest, 6);
              if (config.hashMismatch) response[6] ^= 1;
              emit(response);
            } else if (text === 'disc\n' && config.holdDisc) await new Promise(resolve => { port.releaseDisc = resolve; });
          }
        } });
        if (config.manualBaudGate && baudRate === 230400 && !this.gatedBaud) {
          this.gatedBaud = true;
          await new Promise(resolve => { this.releaseBaud = resolve; });
        }
        if (pendingBaud === baudRate) { pendingBaud = null; queueMicrotask(() => emit('OK')); }
      },
      async close() {
        if (this.readable?.locked || this.writable?.locked) throw new Error('stream is locked');
        events.push('close'); this.readable = null; this.writable = null;
      },
      async setSignals(value) {
        events.push({ signals: value }); emit('Download Image');
        if (config.manualResetGate && !this.gatedReset) {
          this.gatedReset = true;
          await new Promise(resolve => { this.releaseReset = resolve; });
        }
      }
    };
    return port;
  };
  navigator.serial.requestPort = async () => active;
  const choose = (id, value) => { $(id).value = value; $(id).dispatchEvent(new Event('change', { bubbles: true })); };
  const tick = () => new Promise(resolve => setTimeout(resolve, 20));
  try {
    for (const config of [
      { name: 'reset off / console off', reset: false, console: false },
      { name: 'soft reset / console off', reset: true, console: false },
      { name: 'reset off / console on', reset: false, console: true, verify: true },
      { name: 'soft reset / console on', reset: true, console: true, erase: 'sector', nak: true },
      { name: 'hardware reset independent of console', reset: true, console: false, controls: true },
      { name: 'file and post-action locks reject double clicks', reset: true, console: true, fileGate: true, holdDisc: true },
      { name: 'nonzero offset verification stops before UART', offset: '0x1000', verify: true },
      { name: 'cancel does not complete or reset', cancel: true, reset: true, console: true },
      { name: 'hash mismatch stops reset and console', hashMismatch: true, verify: true, reset: true, console: true },
      { name: 'manual reset cannot overlap a burn', manualResetGate: true, controls: true },
      { name: 'manual baud change cannot overlap a burn', manualBaudGate: true },
      { name: 'USB read failure stops reset and console', disconnect: true, reset: true, console: true }
    ]) {
      active = makePort(config);
      $('connect').click();
      await wait(() => !$('open-burn').disabled, 'connect');
      for (const mode of ['crlf', 'cr', 'lf']) choose('line-ending', mode);
      choose('console-baud', '115200');
      $('open-burn').click();
      const file = new File([data], 'flash_is.bin', { type: 'application/octet-stream' });
      const transfer = new DataTransfer(); transfer.items.add(file); $('firmware').files = transfer.files;
      $('firmware').dispatchEvent(new Event('change', { bubbles: true }));
      await wait(() => !$('burn').disabled, 'checksum');
      choose('download-baud', '1000000');
      choose('offset', config.offset || '0x0');
      choose('erase', config.erase || 'none');
      $('enter-download').checked = Boolean(config.controls); $('enter-download').dispatchEvent(new Event('change'));
      $('reset').checked = Boolean(config.reset);
      check(!$('reset').disabled, 'soft reset must be available without control lines');
      $('verify').checked = Boolean(config.verify);
      $('open-terminal').checked = Boolean(config.console);
      if (config.manualResetGate) {
        $('reset-device').click(); await wait(() => Boolean(active.releaseReset), 'manual reset gate');
        check($('burn').disabled && $('firmware').disabled, 'manual reset operation lock');
        $('burn').dispatchEvent(new MouseEvent('click'));
        active.releaseReset(); await wait(() => !$('firmware').disabled, 'manual reset complete');
        check(!active.events.some(e => typeof e === 'string' && e.startsWith('fwd ')), 'burn blocked during manual reset');
      }
      if (config.manualBaudGate) {
        choose('console-baud', '230400'); await wait(() => Boolean(active.releaseBaud), 'manual baud gate');
        check($('burn').disabled && $('firmware').disabled, 'manual baud operation lock');
        $('burn').dispatchEvent(new MouseEvent('click'));
        active.releaseBaud(); await wait(() => !$('firmware').disabled, 'manual baud complete');
        check(!active.events.some(e => typeof e === 'string' && e.startsWith('fwd ')), 'burn blocked during manual baud change');
      }
      let releaseFile;
      if (config.fileGate) {
        const nativeRead = file.arrayBuffer.bind(file);
        file.arrayBuffer = async () => { await new Promise(resolve => { releaseFile = resolve; }); return nativeRead(); };
      }
      const start = active.events.length;
      $('burn').click();
      if (config.fileGate) {
        await wait(() => Boolean(releaseFile), 'file gate');
        check($('burn').disabled && $('firmware').disabled && $('disconnect').disabled && $('cancel').disabled, 'lock before file load');
        $('burn').dispatchEvent(new MouseEvent('click'));
        releaseFile();
      }
      if (config.cancel) { await wait(() => active.packets > 0, 'cancel phase'); $('cancel').click(); }
      if (config.holdDisc) {
        await wait(() => Boolean(active.releaseDisc), 'post-action gate');
        check($('burn').disabled && $('console-baud').disabled && $('line-ending').disabled && $('cancel').disabled, 'post-action lock');
        $('burn').dispatchEvent(new MouseEvent('click'));
        active.releaseDisc();
      }
      await wait(() => !$('firmware').disabled, 'workflow complete');
      await tick();
      const events = active.events.slice(start);
      const state = $('task-card').dataset.state;
      const message = $('message').textContent;
      const failed = config.cancel || config.hashMismatch || config.disconnect || config.offset;
      check(state === (config.cancel ? 'cancelled' : failed ? 'failed' : config.console ? 'terminal' : 'completed'), `${config.name} state ${state}`);
      const discCount = events.filter(e => e === 'disc\n').length;
      check(discCount === (!failed && config.reset ? 1 : 0), `${config.name} reset count`);
      if (config.offset) check(events.length === 0, 'invalid range must leave console/UART untouched');
      else check(events.filter(e => typeof e === 'string' && e.startsWith('fwd ')).length === 1, 'only one job');
      if (config.cancel) check(events.filter(e => e === 'CAN').length === 1, 'one cancellation notification');
      if (!failed) {
        check(message.includes(config.verify ? 'Device verification completed.' : 'Device verification was not run.'), 'honest verification text');
        check(active.packets === 2, '1025 bytes needs two 1K packets');
        if (config.controls && config.reset) {
          const pulse = events.slice(events.indexOf('disc\n') + 1).filter(e => e.signals).map(e => e.signals);
          check(JSON.stringify(pulse) === JSON.stringify([{ dataTerminalReady: false, requestToSend: false }, { dataTerminalReady: false, requestToSend: true }, { dataTerminalReady: false, requestToSend: false }]), 'reset signal polarity');
        } else if (!config.controls) check(!events.some(e => e.signals), 'no implicit hardware control');
      }
      results.push({ name: config.name, state, message, packets: active.packets, discCount });
      // Exercise normal user recovery after a failed read before disconnecting.
      if (config.disconnect) {
        const oldReadable = active.readable; const oldWritable = active.writable;
        $('connect').click(); await wait(() => !$('open-burn').disabled, 'reconnect failed port');
        check(!oldReadable.locked && !oldWritable.locked, 'old failed streams released');
        $('disconnect').click(); await wait(() => !$('connect').disabled, 'disconnect restored connection');
      } else { $('disconnect').click(); await wait(() => !$('connect').disabled, 'disconnect'); }
    }
    return { passed: results.length, results };
  } finally { navigator.serial.requestPort = originalRequest; window.confirm = originalConfirm; }
}
;
test('[UI-CA-PRO2-002] PRO2 NOR protocol and recovery @smoke', async ({page}) => {
 test.setTimeout(120000);
 await page.addInitScript(() => Object.defineProperty(navigator, 'serial', {configurable: true, value: {addEventListener(){}, removeEventListener(){}, requestPort: async () => {throw new Error('test port not configured')}}}));
 await login(page, 'developer');
 await page.goto('/console/chipset-sdk/pro2/firmware-burner');
 await expect(page.locator('#connect')).toBeVisible();
 const result = await page.evaluate(runCases);
 expect(result.passed).toBe(12);
});
