import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chipsetResourceLinks, collectChipsetVideos, VIDEO_TOPICS, VIDEO_SDKS, VIDEO_KINDS, youtubeResource } from './chipset-videos.mjs';

const manifestPath = new URL('../public/assets/chipset-packages/realtek-amebapro2.json', import.meta.url);

test('bundled AmebaPro2 resources contain only verified live links', async () => {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const resources = manifest.chipsets.flatMap(chipset => chipsetResourceLinks(chipset));
  const videos = resources.filter((resource) => resource.type === 'video');

  const unavailable = ['PLEQfNjOZQRyP1dyegDVYqgw53_AORspMK', 'PLEQfNjOZQRyPnmXCuRqE1f5au2HT4E9CP', 'PLEQfNjOZQRyOxXFV7X_2fIcnd_J6VBmyM', '/welcome-to-ameba-faq/1748'];
  for (const resource of resources) assert.ok(!unavailable.some(value => resource.url.includes(value)), resource.url);
  for (const video of videos) {
    assert.ok(youtubeResource(video.url), video.url);
    assert.ok(video.title && video.summary && video.metadata.video.channel);
    assert.ok(['official', 'community'].includes(video.source));
    assert.ok(video.languages.length > 0);
    assert.ok(Number.isFinite(Date.parse(video.verified_at)));
    assert.ok(Object.hasOwn(VIDEO_TOPICS, video.metadata.video.topic));
    assert.ok(Object.hasOwn(VIDEO_SDKS, video.metadata.video.sdk));
    assert.ok(Object.hasOwn(VIDEO_KINDS, video.metadata.video.kind));
  }
  assert.equal(new Set(videos.map(video => youtubeResource(video.url).key)).size, videos.length);
  const boardVideos = collectChipsetVideos(manifest.chipsets[0], 'amb82-mini');
  assert.equal(boardVideos.filter(video => video.kind !== 'playlist').length, 12);
  assert.equal(boardVideos.filter(video => video.source === 'community').length, 3);
  assert.equal(boardVideos.filter(video => video.sdk === 'unknown').length, 2);
  assert.equal(boardVideos.filter(video => video.kind === 'playlist').length, 1);
});
