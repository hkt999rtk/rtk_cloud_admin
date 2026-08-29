import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import i18n, {
  DEFAULT_LOCALE,
  FORMAT_LOCALE,
  SUPPORTED_LOCALES,
  formatCurrency,
  formatDateTime,
  formatNumber,
  translate,
} from './i18n/index.mjs';

test('service console initializes with English as its only supported locale', () => {
  assert.equal(DEFAULT_LOCALE, 'en');
  assert.equal(FORMAT_LOCALE, 'en-US');
  assert.deepEqual(SUPPORTED_LOCALES, ['en']);
  assert.equal(i18n.language, 'en');
  assert.equal(translate('i18n.smoke'), 'English');
  assert.equal(translate('Missing English source message'), 'Missing English source message');
});

test('i18n supports interpolation, plurals, and en-US formatting', () => {
  assert.equal(translate('deviceCount', { count: 1 }), '1 device');
  assert.equal(translate('deviceCount', { count: 2 }), '2 devices');
  assert.equal(formatNumber(12345.6, { maximumFractionDigits: 1 }), '12,345.6');
  assert.match(formatCurrency(1250, 'TWD', { maximumFractionDigits: 0 }), /1,250/);
  assert.match(formatDateTime('2026-08-29T00:00:00Z', { timeZone: 'UTC', year: 'numeric' }), /2026/);
});

test('production Web UI contains no CJK copy outside legacy data aliases', () => {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const files = fs.readdirSync(root, { recursive: true })
    .filter((file) => /\.(?:jsx|mjs)$/.test(file) && !file.endsWith('.test.mjs'));
  const allowedLegacyAliases = [
    '北美', '南美', '歐洲', '非洲', '亞洲', '亞太', '大洋洲', '澳紐', '台灣', '臺灣',
    '即時觀看', '影像服務', '錄影與保存', '設備回報', '韌體更新',
  ];
  for (const file of files) {
    let source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const alias of allowedLegacyAliases) source = source.replaceAll(alias, '');
    assert.doesNotMatch(source, /[\u3400-\u9fff]/u, `${file} contains untranslated CJK UI copy`);
    assert.doesNotMatch(source, /[，：（）「」；。／～]/u, `${file} contains untranslated CJK punctuation`);
  }
});
