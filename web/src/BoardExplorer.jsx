import React, { useEffect, useRef, useState } from 'react';
import { boardAssetPath, boardPath, boardSDKs, CHIPSET_RESOURCES_PATH } from './boards.mjs';
import { PRO2_FIRMWARE_BURNER_PATH } from './Pro2FirmwareBurner.jsx';
import './boards.css';

const emptyComponents = [];

export function BoardCards({ chipset }) {
  if (!chipset.boards?.length) return null;
  return <section className="chipset-boards" aria-label={`${chipset.name} boards`}>
    <h4>Boards</h4><div className="board-card-grid">{chipset.boards.map(board => <article className="board-card" key={board.board_key}>
      {boardAssetPath(board.model?.poster_path, 'poster') ? <img src={board.model.poster_path} alt={`${board.name} appearance model`} width="192" height="192" loading="lazy" /> : <div className="board-card-placeholder" aria-hidden="true">Board</div>}
      <div><h5>{board.name}</h5><p>{board.summary}</p>{chipset.id ? <a className="ghost-button" href={boardPath(chipset.id, board.board_key)}>Explore board <span aria-hidden="true">↗</span></a> : <small>Available after publication</small>}</div>
    </article>)}</div>
  </section>;
}

export function BoardPage({ route, data, loading, ResourceLinks }) {
  const chipset = data?.chipsets?.find(item => item.id === route.chipsetId);
  const board = chipset?.boards?.find(item => item.board_key === route.boardKey);
  const releases = boardSDKs(chipset, route.boardKey);
  useEffect(() => {
    if (!board) return;
    const title = document.title;
    document.title = `${board.name} · ${chipset.name} · Realtek Connect+`;
    return () => { document.title = title; };
  }, [board, chipset]);
  const back = <a className="board-back" href={CHIPSET_RESOURCES_PATH}>← Chip &amp; SDK</a>;
  if (loading && !data) return <section className="page-content board-page">{back}<p role="status">Loading board…</p></section>;
  if (!board || data?.source_status === 'unavailable') return <section className="page-content board-page">{back}<section className="panel"><h2>{data?.source_status === 'unavailable' ? 'Board resources are temporarily unavailable' : 'Board not available'}</h2><p>{data?.source_status === 'unavailable' ? 'Try again later, or return to Chip & SDK.' : 'This board may no longer be published. Browse the currently available chipsets and boards.'}</p></section></section>;
  return <section className="page-content board-page" data-testid="board-page">
    {back}
    <header className="board-page-heading"><div><p className="eyebrow">{chipset.vendor} · Development board</p><h2>{board.name}</h2><div className="board-identity"><span>{chipset.name}</span>{chipset.ic_model ? <span>IC · {chipset.ic_model}</span> : null}{board.dimensions ? <span>{board.dimensions.length_mm} × {board.dimensions.width_mm} mm</span> : null}</div><p>{board.summary}</p></div><span className={`status-badge ${chipset.stale ? 'warning' : 'good'}`}>{chipset.stale ? 'Last saved snapshot' : 'Current'}</span></header>
    {chipset.stale ? <p className="board-stale-note" role="status">The provider’s latest sync failed. These are the last successfully published board resources.</p> : null}
    <BoardExplorer key={`${chipset.id}:${board.board_key}`} board={board} />
    <div className="board-details-grid">
      <section className="panel board-specifications" aria-labelledby="board-specs-heading"><p className="eyebrow">At a glance</p><h3 id="board-specs-heading">Board specifications</h3><dl>{board.specs?.map(spec => <div key={spec.label}><dt>{spec.label}</dt><dd>{spec.value}</dd></div>)}</dl></section>
      <section className="panel board-sdk-resources" aria-labelledby="board-sdk-heading"><p className="eyebrow">Start building</p><h3 id="board-sdk-heading">Compatible SDKs</h3>{releases.length ? releases.map(release => <section className="sdk-release" key={`${release.name}:${release.version}`}><div className="sdk-release-title"><div><strong>{release.name} · {release.version}</strong>{release.summary ? <small>{release.summary}</small> : null}</div>{release.recommended ? <span className="status-badge good">Recommended</span> : null}</div><ResourceLinks resources={release.endpoints} compact /></section>) : <p>No SDK is linked to this board in the published provider snapshot.</p>}
        {chipset.ic_model === 'RTL8735B' ? <a className="ghost-button board-burner-link" href={PRO2_FIRMWARE_BURNER_PATH}>Open PRO2 Firmware Burner <span aria-hidden="true">↗</span></a> : null}
      </section>
    </div>
    {board.resources?.length ? <section className="panel board-documents"><h3>Guides, hardware &amp; availability</h3><ResourceLinks resources={board.resources} /></section> : null}
    <p className="chipset-provider-attribution">Information provided by {chipset.provider_name || chipset.vendor}</p>
  </section>;
}

function BoardExplorer({ board }) {
  const host = useRef(null), viewer = useRef(null);
  const [status, setStatus] = useState('loading');
  const [retry, setRetry] = useState(0);
  const [selectedKey, setSelectedKey] = useState('');
  const components = board.components || emptyComponents;
  const selected = components.find(component => component.key === selectedKey);
  const modelPath = boardAssetPath(board.model?.asset_path);
  const posterPath = boardAssetPath(board.model?.poster_path, 'poster');
  useEffect(() => {
    let active = true;
    setStatus(modelPath ? 'loading' : 'unavailable');
    if (!modelPath) return;
    import('./board-viewer.mjs').then(({ createBoardViewer }) => {
      if (!active) return;
      viewer.current = createBoardViewer(host.current, modelPath, components.map(component => component.key), {
        onReady: () => { if (active) setStatus('ready'); },
        onError: () => { if (active) setStatus('error'); },
        onSelect: key => { if (active) setSelectedKey(key); },
      });
    }).catch(() => { if (active) setStatus('error'); });
    return () => { active = false; viewer.current?.dispose(); viewer.current = null; };
  }, [modelPath, retry, components]);
  function select(key) { setSelectedKey(key); viewer.current?.select(key); }
  function view(side) { viewer.current?.view(side); setSelectedKey(''); }
  return <section className="board-explorer panel" aria-label="Interactive board explorer">
    <div className="board-stage-column">
      <div className="board-stage" data-viewer-status={status}>
        <div className="board-stage-label"><span className="board-live-dot" aria-hidden="true" />{status === 'ready' ? 'Interactive 3D' : 'Board preview'}</div>
        {posterPath ? <img className="board-poster" src={posterPath} alt={`${board.name} appearance model, including the camera and external antenna`} width="960" height="960" hidden={status === 'ready'} /> : null}
        <div className="board-canvas-host" ref={host} aria-label={`${board.name} 3D model`} hidden={status !== 'ready'} />
        {status !== 'ready' ? <div className="board-viewer-message" role="status">{status === 'loading' ? <span>Loading 3D model…</span> : <><strong>{status === 'unavailable' ? '3D preview is not available for this board.' : '3D preview could not start.'}</strong><span>{status === 'error' ? 'You can still explore the parts, specifications and guides below.' : 'Explore the available board information below.'}</span>{modelPath ? <button type="button" className="ghost-button" onClick={() => {setSelectedKey('');setRetry(value => value + 1);}}>Retry 3D preview</button> : null}</>}</div> : null}
      </div>
      <div className="board-view-controls" aria-label="3D view controls"><div>{['Front', 'Back', 'Reset'].map(label => <button className="ghost-button" type="button" disabled={status !== 'ready'} onClick={() => view(label.toLowerCase())} key={label}>{label === 'Reset' ? 'Reset view' : label}</button>)}</div><div><button className="ghost-button" type="button" disabled={status !== 'ready'} aria-label="Zoom out" onClick={() => viewer.current?.zoom(1.2)}>−</button><button className="ghost-button" type="button" disabled={status !== 'ready'} aria-label="Zoom in" onClick={() => viewer.current?.zoom(1 / 1.2)}>+</button></div></div>
      <p className="board-interaction-hint">Drag to rotate · Scroll or pinch to zoom · Select a part to explore</p>
      {board.model?.note ? <p className="board-model-note">{board.model.note}</p> : null}
    </div>
    <aside className="board-parts"><p className="eyebrow">Explore the hardware</p><h3>Meet the board</h3><p>Select a part on the model or in the list.</p>
      <div className="board-part-description" aria-live="polite" aria-atomic="true"><strong>{selected?.name || board.name}</strong><p>{selected?.description || 'Rotate the board to see both sides. The camera, connections and controls each have a story to tell.'}</p></div>
      <div className="board-parts-list" role="group" aria-label="Board components">{components.map((component,index) => <button key={component.key} type="button" className="board-part" aria-pressed={selectedKey === component.key} onClick={() => select(component.key)}><span className="board-part-number" aria-hidden="true">{String(index+1).padStart(2,'0')}</span><span>{component.name}</span><span aria-hidden="true">↗</span></button>)}</div>
    </aside>
  </section>;
}
