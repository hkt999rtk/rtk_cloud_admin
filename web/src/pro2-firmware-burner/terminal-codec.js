// Integrated from uartfwburn commit 81f808f; UI copy adapted for the Developer Console.
const ENDINGS = Object.freeze({ crlf: '\r\n', cr: '\r', lf: '\n' });

export function normalizeTerminalInput(data, mode = 'crlf') {
  const ending = ENDINGS[mode];
  if (!ending) throw new Error(`invalid line ending: ${mode}`);
  return data.replace(/\r\n|\r|\n/g, ending);
}
export class StreamingTerminalDecoder {
  constructor() { this.reset(); }
  reset() { this.decoder = new TextDecoder('utf-8'); }
  decode(bytes) { return this.decoder.decode(bytes, { stream: true }); }
}
