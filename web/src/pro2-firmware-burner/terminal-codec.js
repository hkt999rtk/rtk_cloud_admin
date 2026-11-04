// Integrated from uartfwburn 8608cad.
const ENDINGS = Object.freeze({ crlf: '\r\n', cr: '\r', lf: '\n' });

export function validateLineEnding(mode) {
  if (!Object.hasOwn(ENDINGS, mode)) throw new Error(`invalid line ending: ${mode}`);
  return mode;
}

export function normalizeTerminalInput(data, mode = 'crlf') {
  const ending = ENDINGS[validateLineEnding(mode)];
  return data.replace(/\r\n|\r|\n/g, ending);
}

export class StreamingTerminalDecoder {
  constructor() { this.reset(); }
  reset() { this.decoder = new TextDecoder('utf-8'); }
  decode(bytes) { return this.decoder.decode(bytes, { stream: true }); }
}
