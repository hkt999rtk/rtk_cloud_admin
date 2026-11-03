# PRO2 browser firmware burner

The Developer Console integrates the JavaScript NOR/UART flow from uartfwburn 8608cad (previously 81f808f). Core modules live in `web/src/pro2-firmware-burner`; `runtime.js` adapts this flow to Console firmware sources, UI, and localization. No native executables are required.

Sector erase uses the masked start and byte length, requires a complete OK response, and rejects mask-boundary crossings. XMODEM checksum negotiation preserves the selected NOR payload size. Hash commands include the newline terminator and use the original 20 ms wait rather than 20 seconds. The original-EXE contract fixture and regression tests retain the byte-level baseline.

Validate options before changing UART ownership. PRO2 device verification at nonzero offset is rejected because its ROM semantics remain unconfirmed. Zero-offset full-image burning remains available, and disabling device verification is reported explicitly.

Cancellation drains pending writes, keeps ownership until cleanup completes, and does not automatically reset or open the terminal. After successful burning, Reset sends `disc\n`; optional hardware reset requires explicit DTR/RTS control. Console reopening is independent. Post-action errors are reported separately from the successful write/verification result. File reads, manual connection actions, and post-actions are serialized to avoid overlapping jobs.

## Validation

- `cd web && npm test`: 308 JavaScript tests passed.
- `cd web && npm run build`: build, localization, and public asset checks passed.
- `cd web && npx playwright test e2e/pro2-burn-protocol.spec.mjs e2e/pro2-examples.spec.mjs --project=chromium --project=mobile`: exercises 12 fake-UART workflow scenarios on each browser target, plus firmware URL/local selection.

The fake-port scenarios cover all reset/console combinations, checksum negotiation, verified transfer, invalid nonzero offset, cancellation, hash mismatch, read failure/reconnection, file/post-action locks, and manual reset/baud ownership. These checks do not establish physical board/ROM/adapter compatibility; no physical firmware burn was performed.
