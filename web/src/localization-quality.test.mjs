import assert from 'node:assert/strict';
import test from 'node:test';
import { documentationQualityErrors, isLanguageNeutral, translationQualityErrors } from '../localization/quality.mjs';

test('localization preserves UART options and baud units without requiring a Chinese replacement', () => {
  for (const source of ['CR', 'LF', 'CRLF', 'SHA-256', 'Web Serial', '1,000,000 baud']) {
    assert.equal(isLanguageNeutral(source), true, source);
    assert.deepEqual(translationQualityErrors(source, source), []);
  }
  assert.equal(isLanguageNeutral('Download firmware'), false);
  assert.match(translationQualityErrors('1,000,000 baud', '1,000,000 位元組/秒').join('\n'), /changed technical quantity/);
});

test('localization catches technical identifiers lost in prose and diagrams', () => {
  assert.match(translationQualityErrors('verify.py --exercise', '驗證.py ——練習').join('\n'), /missing executable identifier/);
  assert.match(translationQualityErrors('state.desired.power=on', 'state.desired.power=開啟').join('\n'), /missing executable identifier/);
  for (const field of ['desired.power=on', 'reported.power=on', 'state.power=on']) {
    assert.match(translationQualityErrors(field, field.replace('on', '開啟')).join('\n'), /missing executable identifier/);
  }
  assert.match(translationQualityErrors('--exercise', '--exercise-disabled').join('\n'), /missing executable identifier/);
  assert.match(translationQualityErrors('SUBSCRIBE R/update/accepted', 'SUBSCRIBE R/更新/已接受').join('\n'), /missing executable identifier/);
  assert.match(translationQualityErrors('Account Manager login', '客戶經理登入').join('\n'), /missing technical name/);
  assert.match(translationQualityErrors('MQTT Broker', 'MQTT 經紀人').join('\n'), /broker translated as a person/);
  assert.match(translationQualityErrors('Boards', '董事會').join('\n'), /board translated as a committee/);
  assert.deepEqual(translationQualityErrors('Use MQTT and verify.py --exercise.', '使用 MQTT 與 verify.py --exercise。'), []);
});

test('documentation protects inline code separately from executable examples', () => {
  const source = 'Shadow `update/accepted` confirms an update.\n\n```json\n{"state":{"desired":{"power":"on"}}}\n```';
  assert.match(documentationQualityErrors(source, 'Shadow `更新/已接受` 確認更新。').join('\n'), /inline code differs/);
  assert.deepEqual(documentationQualityErrors(source, 'Shadow `update/accepted` 確認更新。\n\n```json\n{"state":{"desired":{"power":"on"}}}\n```'), []);
  assert.match(translationQualityErrors('Resolve device claim', '解決裝置索賠').join('\n'), /known mistranslation/);
});
