import test from 'node:test';
import assert from 'node:assert/strict';
import { sdkNavigationTarget } from './sdk-page.mjs';
const url = path => new URL(path, 'https://console.example');
test('SDK bridge stays within normal same-origin console routes', () => {
  assert.equal(sdkNavigationTarget(url('/console/clouds'),url('/console/chipset-sdk')),true);
  assert.equal(sdkNavigationTarget(url('/console/chipset-sdk'),url('/console/clouds')),true);
  assert.equal(sdkNavigationTarget(url('/console/chipset-sdk?cloudId=a'),url('/console/chipset-sdk?cloudId=b')),true);
  for (const path of ['/console/clouds/a/test-lab','/console/chipset-sdk/pro2/firmware-burner','/console/clouds/a/billing','/login','/admin','https://other.example/console/chipset-sdk']) {
    assert.equal(sdkNavigationTarget(url(path),url('/console/chipset-sdk')),false,path);
    assert.equal(sdkNavigationTarget(url('/console/chipset-sdk'),url(path)),false,path);
  }
  assert.equal(sdkNavigationTarget(url('/console/chipset-sdk'),url('/console/chipset-sdk#downloads')),false);
});

test('Docs and My Clouds share navigation without widening sensitive routes', () => {
  for (const [source,target] of [
    ['/console/clouds?cloudId=a','/console/developer-docs?cloudId=a'],
    ['/console/developer-docs','/console/clouds'],
    ['/console/developer-docs','/console/developer-docs/overview'],
  ]) assert.equal(sdkNavigationTarget(url(source),url(target)),true);
  for (const path of ['/console/clouds/a/test-lab','/console/clouds/a/settings','/console/clouds/a/billing','/console/chipset-sdk/pro2/firmware-burner','/admin','https://other.example/console/clouds']) {
    assert.equal(sdkNavigationTarget(url(path),url('/console/developer-docs')),false,path);
    assert.equal(sdkNavigationTarget(url('/console/developer-docs'),url(path)),false,path);
  }
});
