import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const manifestPath = new URL('../public/assets/chipset-packages/realtek-amebapro2.json', import.meta.url);

test('bundled AmebaPro2 resources contain only verified live links', async () => {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const resources = manifest.chipsets.flatMap((chipset) => chipset.resources || []);
  const titles = resources.map((resource) => resource.title);
  const videos = resources.filter((resource) => resource.type === 'video');

  assert.deepEqual(videos.map((video) => video.title), ['AMB82 Mini Maker Projects']);
  assert.ok(!titles.includes('Ameba FAQ'));
  assert.ok(!titles.includes('AMB82 Mini: Start Here!'));
  assert.ok(!titles.includes('AMB82 Mini Tutorials'));
  assert.ok(!titles.includes('AMB82 Mini 中文教程'));
});
