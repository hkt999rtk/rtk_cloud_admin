export const VIDEO_TOPICS = Object.freeze({
  getting_started: 'Getting started', streaming: 'Video streaming',
  recording_imaging: 'Recording & image tuning', ai: 'AI development',
  model_conversion: 'Model conversion', projects: 'Community projects',
});
export const VIDEO_SDKS = Object.freeze({ arduino: 'Arduino', freertos: 'FreeRTOS', general: 'General', unknown: 'SDK not confirmed' });
export const VIDEO_KINDS = Object.freeze({ tutorial: 'Tutorial', demo: 'Project demo', playlist: 'Playlist' });

// Parse only supported HTTPS YouTube links; the manifest URL remains the fallback
// for other video providers. Strip tracking and playlist context from single videos.
export function youtubeResource(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  const host = url.hostname;
  const isYouTube = ['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host);
  let videoId;
  if (host === 'youtu.be') videoId = url.pathname.slice(1);
  else if (isYouTube && url.pathname === '/watch') videoId = url.searchParams.get('v');
  else if (isYouTube && /^\/(shorts|embed)\/[^/]+$/.test(url.pathname)) videoId = url.pathname.split('/')[2];
  if (/^[\w-]{11}$/.test(videoId || '')) return { key: `video:${videoId}`, kind: 'video', url: `https://www.youtube.com/watch?v=${videoId}`, thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` };
  const list = isYouTube && url.pathname === '/playlist' && url.searchParams.get('list');
  if (list && /^[\w-]+$/.test(list)) return { key: `playlist:${list}`, kind: 'playlist', url: `https://www.youtube.com/playlist?list=${list}` };
  return null;
}

export function chipsetResourceLinks(chipset = {}, boardKey) {
  const boards = (chipset.boards || []).filter(board => boardKey === undefined || board.board_key === boardKey);
  const releases = (chipset.sdk_releases || []).filter(release => boardKey === undefined || release.supported_board_keys?.includes(boardKey));
  return [...(chipset.resources || []), ...boards.flatMap(board => board.resources || []), ...releases.flatMap(release => release.endpoints || [])];
}

export function collectChipsetVideos(chipset, boardKey) {
  const seen = new Set();
  return chipsetResourceLinks(chipset, boardKey).filter(resource => resource.type === 'video').flatMap(resource => {
    const youtube = youtubeResource(resource.url);
    const key = youtube?.key || resource.url;
    if (seen.has(key)) return [];
    seen.add(key);
    const metadata = resource.metadata?.video || {};
    return [{ ...resource, key, url: youtube?.url || resource.url, thumbnail: youtube?.thumbnail,
      topic: Object.hasOwn(VIDEO_TOPICS, metadata.topic) ? metadata.topic : '',
      sdk: Object.hasOwn(VIDEO_SDKS, metadata.sdk) ? metadata.sdk : 'unknown',
      kind: youtube?.kind === 'playlist' ? 'playlist' : ['tutorial', 'demo'].includes(metadata.kind) ? metadata.kind : '',
      channel: typeof metadata.channel === 'string' ? metadata.channel : '',
    }];
  });
}

export function videoSearchText(resource) {
  const metadata = resource.metadata?.video || {};
  return [resource.title, resource.summary, resource.url, resource.source, ...(resource.languages || []), metadata.channel,
    VIDEO_TOPICS[metadata.topic], VIDEO_SDKS[metadata.sdk], VIDEO_KINDS[metadata.kind]].filter(Boolean).join(' ').toLowerCase();
}

export function filterVideos(videos, { query = '', topic = 'all', sdk = 'all', language = 'all' } = {}) {
  const needle = query.trim().toLowerCase();
  return videos.filter(video => (!needle || videoSearchText(video).includes(needle))
    && (topic === 'all' || video.topic === topic)
    && (sdk === 'all' || video.sdk === sdk)
    && (language === 'all' || video.languages?.includes(language)));
}
