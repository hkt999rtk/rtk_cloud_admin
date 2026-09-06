import test from 'node:test';
import assert from 'node:assert/strict';
import { youtubeResource, chipsetResourceLinks, collectChipsetVideos, filterVideos, videoSearchText } from './chipset-videos.mjs';
import { filterChipsets } from './chipset-sdk.mjs';

const video = (id, metadata = {}, extra = {}) => ({ type: 'video', title: id, url: `https://www.youtube.com/watch?v=${id}`, languages: ['en'], metadata: { video: metadata }, ...extra });
const setup = video('_rLiih5RkXY', { topic: 'getting_started', sdk: 'arduino', kind: 'tutorial', channel: 'Ameba AIoT' }, { summary: 'Install the board package', source: 'official' });
const conversion = video('0XJleMGfyEw', { topic: 'model_conversion', sdk: 'general', kind: 'tutorial', channel: '模型工作室' }, { languages: ['zh-TW'] });
const project = video('7rfmXPqyLF0', { topic: 'projects', sdk: 'unknown', kind: 'demo', channel: 'rkuo2000' });
const chipset = {
  name: 'AmebaPRO2', resources: [setup],
  boards: [{ board_key: 'amb82-mini', resources: [conversion, project, { ...setup, url: 'https://youtu.be/_rLiih5RkXY?t=20' }] }, { board_key: 'other', resources: [video('npLSz1yfByw')] }],
  sdk_releases: [{ name: 'Arduino', supported_board_keys: ['amb82-mini'], endpoints: [setup] }, { name: 'Other', supported_board_keys: ['other'], endpoints: [video('FxFV8E9Jyo4')] }],
};

test('YouTube links normalize video aliases and preserve distinct playlist identities', () => {
  const expected = youtubeResource(setup.url);
  for (const url of ['https://youtu.be/_rLiih5RkXY?t=12', 'https://youtube.com/watch?v=_rLiih5RkXY&list=abc', 'https://m.youtube.com/watch?v=_rLiih5RkXY', 'https://www.youtube.com/shorts/_rLiih5RkXY', 'https://www.youtube.com/embed/_rLiih5RkXY']) assert.deepEqual(youtubeResource(url), expected);
  assert.equal(expected.url, setup.url);
  assert.equal(expected.thumbnail, 'https://i.ytimg.com/vi/_rLiih5RkXY/hqdefault.jpg');
  assert.deepEqual(youtubeResource('https://www.youtube.com/playlist?list=PLI17puzq38jI&feature=shared'), { key: 'playlist:PLI17puzq38jI', kind: 'playlist', url: 'https://www.youtube.com/playlist?list=PLI17puzq38jI' });
  for (const url of [undefined, '', 'not a URL', 'http://youtu.be/_rLiih5RkXY', 'javascript:alert(1)', 'https://youtube.com.evil.test/watch?v=_rLiih5RkXY', 'https://user:pass@youtube.com/watch?v=_rLiih5RkXY', 'https://youtube.com:8443/watch?v=_rLiih5RkXY', 'https://youtu.be/short', 'https://youtu.be/_rLiih5RkXY/extra', 'https://youtube.com/shorts/short', 'https://youtube.com/watch', 'https://youtube.com/playlist', 'https://youtube.com/playlist?list=%3Cscript%3E', 'https://youtube.com/@Ameba-AIoT']) assert.equal(youtubeResource(url), null, url);
});

test('Video collection preserves curated order and scopes board and SDK resources', () => {
  assert.equal(chipsetResourceLinks(chipset).length, 7);
  assert.equal(chipsetResourceLinks(chipset, 'amb82-mini').length, 5);
  assert.deepEqual(collectChipsetVideos(chipset).map(item => item.title), ['_rLiih5RkXY', '0XJleMGfyEw', '7rfmXPqyLF0', 'npLSz1yfByw', 'FxFV8E9Jyo4']);
  assert.deepEqual(collectChipsetVideos(chipset, 'amb82-mini').map(item => item.title), ['_rLiih5RkXY', '0XJleMGfyEw', '7rfmXPqyLF0']);
  assert.equal(collectChipsetVideos(chipset, 'amb82-mini')[0].channel, 'Ameba AIoT');
  assert.deepEqual(chipsetResourceLinks(), []);
  assert.deepEqual(collectChipsetVideos({ boards: [{}], sdk_releases: [{}] }), []);
  assert.deepEqual(collectChipsetVideos({ sdk_releases: [{}] }, 'missing'), []);
});

test('Legacy and non-YouTube video resources retain links without inventing metadata', () => {
  const resources = [{ type: 'documentation', url: 'https://example.com/doc' }, { type: 'video', title: 'Legacy', url: 'https://example.com/video' }, video('sFYnj4_Xq7A', { topic: '__proto__', sdk: 'future', kind: 'future', channel: 123 }), { type: 'video', title: 'Playlist', url: 'https://youtube.com/playlist?list=PLI17puzq38jI' }];
  const result = collectChipsetVideos({ resources });
  assert.equal(result.length, 3);
  assert.equal(result[0].url, resources[1].url);
  assert.equal(result[0].thumbnail, undefined);
  assert.equal(result[0].sdk, 'unknown');
  assert.equal(result[0].kind, '');
  assert.equal(result[1].topic, '');
  assert.equal(result[1].channel, '');
  assert.equal(result[2].kind, 'playlist');
  assert.equal(videoSearchText({}), '');
});

test('Video filters combine query, topic, SDK and language without changing order', () => {
  const videos = collectChipsetVideos(chipset, 'amb82-mini');
  assert.deepEqual(filterVideos(videos), videos);
  for (const query of [' AMEBA ', 'board package', 'official', 'Getting started', 'Arduino', 'Tutorial', 'youtube.com']) assert.ok(filterVideos(videos, { query }).some(video => video.title === '_rLiih5RkXY'), query);
  assert.deepEqual(filterVideos(videos, { query: '模型', topic: 'model_conversion', sdk: 'general', language: 'zh-TW' }).map(v => v.title), ['0XJleMGfyEw']);
  assert.equal(filterVideos(videos, { sdk: 'freertos' }).length, 0);
  assert.equal(filterVideos(videos, { topic: 'projects' }).length, 1);
  assert.equal(filterVideos(videos, { topic: 'ai' }).length, 0);
  assert.equal(filterVideos(videos, { language: 'zh-CN' }).length, 0);
  assert.equal(filterVideos([{ title: 'Legacy' }], { language: 'en' }).length, 0);
  assert.equal(filterVideos(videos, { query: 'absent' }).length, 0);
  for (const query of ['模型工作室', 'Model conversion', 'rkuo2000', 'Project demo', 'zh-TW']) assert.equal(filterChipsets([chipset], query).length, 1, query);
});
