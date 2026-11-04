import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const contract = JSON.parse(readFileSync(new URL('./pro2-firmware-burner/upstream-tests/fixtures/original-exe-nor-contract.json', import.meta.url)));

test('golden NOR cases are bound to the original PE with independent static provenance', () => {
  assert.equal(contract.artifactSha256, '03ba152e57800dfccffee39c4e4f3f89d11055a58eaa01b6175d8eadb0f610b7');
  for (const id of ['handshake', 'erase_sector', 'erase_chip', 'hash_pro2', 'xmodem_crc', 'xmodem_nak', 'xmodem_limits', 'final_ok']) {
    const entry = contract.cases.find(value => value.id === id);
    assert.ok(entry, `missing case ${id}`);
    assert.ok(entry.sourceEvidenceIds.length > 0, `missing provenance for ${id}`);
    assert.equal(entry.authority, 'static-derived', 'static facts must not claim runtime observation');
    assert.ok(entry.expected);
  }
});

test('unresolved offset and hardware semantics remain explicit', () => {
  for (const id of ['nonzero-pro2-hash-offset', 'hardware-validation']) {
    assert.equal(contract.unknowns.find(value => value.id === id)?.status, 'unresolved');
  }
});
