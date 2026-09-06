import React, { useId, useState } from 'react';
import { collectChipsetVideos, filterVideos, VIDEO_TOPICS, VIDEO_SDKS, VIDEO_KINDS } from './chipset-videos.mjs';
import './chipset-videos.css';

export function ChipsetVideos({ chipset, boardKey, preview = false }) {
  const id = useId();
  const [expanded, setExpanded] = useState(!preview);
  const [filters, setFilters] = useState({ query: '', topic: 'all', sdk: 'all', language: 'all' });
  const resources = collectChipsetVideos(chipset, boardKey);
  const videos = resources.filter(video => video.kind !== 'playlist');
  const playlists = resources.filter(video => video.kind === 'playlist');
  const matches = filterVideos(videos, filters);
  const languages = [...new Set(videos.flatMap(video => video.languages || []))].sort();
  const visible = expanded ? matches : videos.slice(0, 3);
  const Heading = preview ? 'h4' : 'h3';
  const CardHeading = preview ? 'h5' : 'h4';
  function update(name, value) { setFilters(current => ({ ...current, [name]: value })); }
  if (!resources.length) return null;
  return <section className={`chipset-videos${preview ? ' chipset-videos-preview' : ' panel'}`} aria-labelledby={`${id}-heading`}>
    <div className="chipset-videos-heading"><div><Heading id={`${id}-heading`}>Development videos</Heading><p>Learn with official tutorials and community projects. Check the SDK guides for current setup instructions.</p></div>{videos.length > 0 ? <span className="chipset-video-total">{videos.length} videos</span> : null}</div>
    {expanded && videos.length > 0 ? <div className="chipset-video-filters">
      <label>Search videos<input className="input" type="search" value={filters.query} onChange={event => update('query', event.target.value)} placeholder="Title, topic or channel" /></label>
      <label>Topic<select className="input" value={filters.topic} onChange={event => update('topic', event.target.value)}><option value="all">All topics</option>{Object.entries(VIDEO_TOPICS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
      <label>SDK<select className="input" value={filters.sdk} onChange={event => update('sdk', event.target.value)}><option value="all">All SDKs</option>{Object.entries(VIDEO_SDKS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
      <label>Language<select className="input" value={filters.language} onChange={event => update('language', event.target.value)}><option value="all">All languages</option>{languages.map(language => <option value={language} key={language}>{language}</option>)}</select></label>
    </div> : null}
    <div id={`${id}-videos`}>
      {expanded && videos.length > 0 ? <p className="chipset-video-results" role="status">{matches.length} of {videos.length} videos</p> : null}
      <div className="chipset-video-grid">{visible.map(video => <VideoCard key={video.key} video={video} Heading={CardHeading} />)}</div>
      {expanded && videos.length > 0 && !matches.length ? <div className="chipset-video-empty"><p>No matching videos. Try another topic, SDK or language.</p><button type="button" className="ghost-button" onClick={() => setFilters({ query: '', topic: 'all', sdk: 'all', language: 'all' })}>Clear filters</button></div> : null}
    </div>
    {preview && videos.length > 3 ? <button className="ghost-button chipset-video-expand" type="button" aria-expanded={expanded} aria-controls={`${id}-videos`} onClick={() => setExpanded(value => !value)}>{expanded ? 'Show featured videos' : `View all ${videos.length} videos`}</button> : null}
    {playlists.length ? <div className="chipset-video-playlists"><strong>Explore playlists</strong>{playlists.map(playlist => <a key={playlist.key} href={playlist.url} target="_blank" rel="noopener noreferrer">{playlist.title} <span aria-hidden="true">↗</span></a>)}</div> : null}
  </section>;
}

function VideoCard({ video, Heading }) {
  const [imageFailed, setImageFailed] = useState(false);
  return <article className="chipset-video-card">
    <a className="chipset-video-watch" href={video.url} target="_blank" rel="noopener noreferrer" aria-label={`Watch ${video.title}`}>
      <div className="chipset-video-thumbnail">{video.thumbnail && !imageFailed ? <img src={video.thumbnail} loading="lazy" width="480" height="360" alt="" onError={() => setImageFailed(true)} /> : <span className="chipset-video-placeholder" aria-hidden="true">▶</span>}<span className="chipset-video-watch-label">{video.thumbnail ? 'YouTube' : 'Watch video'} <span aria-hidden="true">↗</span></span></div>
      <Heading>{video.title}</Heading>
    </a>
    <div className="chipset-video-body">
      {video.summary ? <p>{video.summary}</p> : null}
      {video.channel ? <p className="chipset-video-channel">{video.channel}</p> : null}
      <div className="chipset-video-tags">{video.source ? <span className={`resource-source ${video.source}`}>{video.source === 'official' ? 'Official' : 'Community'}</span> : null}{video.kind ? <span>{VIDEO_KINDS[video.kind]}</span> : null}{video.topic ? <span>{VIDEO_TOPICS[video.topic]}</span> : null}<span>{VIDEO_SDKS[video.sdk]}</span>{video.languages?.map(language => <span key={language}>{language}</span>)}</div>
      {video.verified_at ? <small className="chipset-video-verified">Reviewed <time dateTime={video.verified_at}>{video.verified_at.slice(0, 10)}</time></small> : null}
    </div>
  </article>;
}
