import assert from 'node:assert/strict';
import test from 'node:test';
import { formatSDKBytes, sdkArtifactFormat, sdkArtifacts, sdkDocumentationURL } from './sdk-catalog.mjs';

test('SDK artifact presentation keeps the five package formats distinct', () => {
  assert.equal(sdkArtifactFormat('android'), 'Android AAR package');
  assert.equal(sdkArtifactFormat('ios'), 'SwiftPM source archive');
  assert.equal(sdkArtifactFormat('freertos-pro2'), 'Device-demo source bundle');
  assert.equal(formatSDKBytes(1536), '1.5 KB');
  assert.equal(formatSDKBytes(1024 * 1024), '1.0 MB');
});

test('SDK catalog appends the complete bundle and builds same-Portal docs links', () => {
  const artifacts = sdkArtifacts({ packages: [{ slug: 'android' }], complete_bundle: { slug: 'all' } });
  assert.deepEqual(artifacts.map(({ slug }) => slug), ['android', 'all']);
  assert.equal(sdkDocumentationURL('https://portal.example/manual/sdk', 'android'), 'https://portal.example/manual/sdk/packages/android');
  assert.equal(sdkDocumentationURL('https://portal.example/manual/sdk', 'all'), 'https://portal.example/manual/sdk');
});
