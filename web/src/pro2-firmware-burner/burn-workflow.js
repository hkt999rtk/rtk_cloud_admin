import { validateBurn } from './burner.js';

export async function runBurnWorkflow({ controller, transport, terminal, firmware, options, consoleBaud, openTerminal }) {
  validateBurn(firmware, options);
  await terminal.leave();
  await controller.burn(firmware, options);
  const result = { status: 'completed', verified: Boolean(options.verify), consoleOpen: false, warnings: [] };
  const requireConnection = () => { if (!transport.connected) throw new Error('UART is not connected.'); };
  try {
    if (options.reset) {
      requireConnection();
      transport.acquire('protocol');
      try { await transport.write('disc\n', 'protocol'); }
      finally {
        await transport.drainWrites();
        transport.acquire('idle');
      }
    }
    if (openTerminal) {
      requireConnection();
      await terminal.enter({ baudRate: consoleBaud, hardwareReset: false });
      result.consoleOpen = true;
    }
    if (options.reset && options.enterDownload) {
      requireConnection();
      await transport.hardwareReset();
    }
  } catch (error) {
    result.warnings.push(`Firmware burn completed; Reset/Console follow-up failed: ${error.message}`);
  }
  return result;
}
