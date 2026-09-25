import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

test('PRO2 terms translations remain tied to the reviewed English draft', async () => {
  const english = await readFile(new URL('./legal/sdk_terms.en.md', import.meta.url));
  assert.equal(createHash('sha256').update(english).digest('hex'), '552080bd4b0604a5f9d5c2647ed017b74bfe666c427401947f8138c4716db132');
  for (const [locale, heading] of [['zh-TW', '有限評估授權'], ['zh-CN', '有限评估授权']]) {
    const localized = await readFile(new URL(`./legal/sdk_terms.${locale}.md`, import.meta.url), 'utf8');
    assert.ok(localized.includes(heading), `${locale} terms body is missing`);
    assert.ok(localized.includes('## 14.'), `${locale} terms body is incomplete`);
  }
});
