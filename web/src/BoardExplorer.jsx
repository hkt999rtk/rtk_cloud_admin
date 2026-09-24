import { translate } from './i18n/index.mjs';
import React, { useEffect, useRef, useState } from 'react';
import { boardAssetPath, boardPath, boardSDKs, CHIPSET_RESOURCES_PATH } from './boards.mjs';
import { PRO2_FIRMWARE_BURNER_PATH } from './Pro2FirmwareBurner.jsx';
import './boards.css';
import { ChipsetVideos } from './ChipsetVideos.jsx';

const emptyComponents = [];

export function BoardCards({ chipset }) {
  if (!chipset.boards?.length) return null;
  return <section className="chipset-boards" aria-label={translate("{{value0}} boards", { value0: chipset.name })}>
    <h4>{translate("Boards")}</h4><div className="board-card-grid">{chipset.boards.map(board => <article className="board-card" key={board.board_key}>
      {boardAssetPath(board.model?.poster_path, 'poster') ? <img src={board.model.poster_path} alt={translate("{{value0}} appearance model", { value0: board.name })} width="192" height="192" loading="lazy" /> : <div className="board-card-placeholder" aria-hidden="true">{translate("Board")}</div>}
      <div><h5>{board.name}</h5><p>{translate(board.summary)}</p>{chipset.id ? <a className="ghost-button" href={boardPath(chipset.id, board.board_key)}>{translate("Explore board")} <span aria-hidden="true">↗</span></a> : <small>{translate("Available after publication")}</small>}</div>
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
  const back = <a className="board-back" href={CHIPSET_RESOURCES_PATH}>{translate("← Chip & SDK")}</a>;
  if (loading && !data) return <section className="page-content board-page">{back}<p role="status">{translate("Loading board…")}</p></section>;
  if (!board || data?.source_status === 'unavailable') return <section className="page-content board-page">{back}<section className="panel"><h2>{data?.source_status === 'unavailable' ? translate("Board resources are temporarily unavailable") : translate("Board not available")}</h2><p>{data?.source_status === 'unavailable' ? translate("Try again later, or return to Chip & SDK.") : translate("This board may no longer be published. Browse the currently available chipsets and boards.")}</p></section></section>;
  return <section className="page-content board-page" data-testid="board-page">
    {back}
    <header className="board-page-heading"><div><p className="eyebrow">{chipset.vendor} {translate("· Development board")}</p><h2>{board.name}</h2><div className="board-identity"><span>{chipset.name}</span>{chipset.ic_model ? <span>{translate("IC ·")} {chipset.ic_model}</span> : null}{board.dimensions ? <span>{board.dimensions.length_mm} × {board.dimensions.width_mm} {translate("mm")}</span> : null}</div><p>{translate(board.summary)}</p></div><span className={`status-badge ${chipset.stale ? 'warning' : 'good'}`}>{chipset.stale ? translate("Last saved snapshot") : translate("Current")}</span></header>
    {chipset.stale ? <p className="board-stale-note" role="status">{translate("The provider’s latest sync failed. These are the last successfully published board resources.")}</p> : null}
    <BoardExplorer key={`${chipset.id}:${board.board_key}`} board={board} />
    <div className="board-details-grid">
      <section className="panel board-specifications" aria-labelledby="board-specs-heading"><p className="eyebrow">{translate("At a glance")}</p><h3 id="board-specs-heading">{translate("Board specifications")}</h3><dl>{board.specs?.map(spec => <div key={spec.label}><dt>{translate(spec.label)}</dt><dd>{spec.value}</dd></div>)}</dl></section>
      <section className="panel board-sdk-resources" aria-labelledby="board-sdk-heading"><p className="eyebrow">{translate("Start building")}</p><h3 id="board-sdk-heading">{translate("Compatible SDKs")}</h3>{releases.length ? releases.map(release => <section className="sdk-release" key={`${release.name}:${release.version}`}><div className="sdk-release-title"><div><strong>{release.name} · {release.version}</strong>{release.summary ? <small>{translate(release.summary)}</small> : null}</div>{release.recommended ? <span className="status-badge good">{translate("Recommended")}</span> : null}</div><ResourceLinks resources={release.endpoints.filter(resource => resource.type !== 'video')} compact /></section>) : <p>{translate("No SDK is linked to this board in the published provider snapshot.")}</p>}
        {chipset.ic_model === 'RTL8735B' ? <a className="ghost-button board-burner-link" href={PRO2_FIRMWARE_BURNER_PATH}>{translate("Open PRO2 Firmware Burner")} <span aria-hidden="true">↗</span></a> : null}
      </section>
    </div>
    <ChipsetVideos key={`${chipset.id}:${board.board_key}`} chipset={chipset} boardKey={board.board_key} />
    {board.resources?.some(resource => resource.type !== 'video') ? <section className="panel board-documents"><h3>{translate("Guides, hardware & availability")}</h3><ResourceLinks resources={board.resources.filter(resource => resource.type !== 'video')} /></section> : null}
    <p className="chipset-provider-attribution">{translate("Information provided by")} {chipset.provider_name || chipset.vendor}</p>
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
  return <section className="board-explorer panel" aria-label={translate("Interactive board explorer")}>
    <div className="board-stage-column">
      <div className="board-stage" data-viewer-status={status}>
        <div className="board-stage-label"><span className="board-live-dot" aria-hidden="true" />{status === 'ready' ? translate("Interactive 3D") : translate("Board preview")}</div>
        {posterPath ? <img className="board-poster" src={posterPath} alt={translate("{{value0}} appearance model, including the camera and external antenna", { value0: board.name })} width="960" height="960" hidden={status === 'ready'} /> : null}
        <div className="board-canvas-host" ref={host} aria-label={translate("{{value0}} 3D model", { value0: board.name })} hidden={status !== 'ready'} />
        {status !== 'ready' ? <div className="board-viewer-message" role="status">{status === 'loading' ? <span>{translate("Loading 3D model…")}</span> : <><strong>{status === 'unavailable' ? translate("3D preview is not available for this board.") : translate("3D preview could not start.")}</strong><span>{status === 'error' ? translate("You can still explore the parts, specifications and guides below.") : translate("Explore the available board information below.")}</span>{modelPath ? <button type="button" className="ghost-button" onClick={() => {setSelectedKey('');setRetry(value => value + 1);}}>{translate("Retry 3D preview")}</button> : null}</>}</div> : null}
      </div>
      <div className="board-view-controls" aria-label={translate("3D view controls")}><div>{['Front', 'Back', 'Reset'].map(label => <button className="ghost-button" type="button" disabled={status !== 'ready'} onClick={() => view(label.toLowerCase())} key={label}>{label === 'Reset' ? translate("Reset view") : label}</button>)}</div><div><button className="ghost-button" type="button" disabled={status !== 'ready'} aria-label={translate("Zoom out")} onClick={() => viewer.current?.zoom(1.2)}>−</button><button className="ghost-button" type="button" disabled={status !== 'ready'} aria-label={translate("Zoom in")} onClick={() => viewer.current?.zoom(1 / 1.2)}>+</button></div></div>
      <p className="board-interaction-hint">{translate("Drag to rotate · Scroll or pinch to zoom · Select a part to explore")}</p>
      {board.model?.note ? <p className="board-model-note">{board.model.note}</p> : null}
    </div>
    <aside className="board-parts"><p className="eyebrow">{translate("Explore the hardware")}</p><h3>{translate("Meet the board")}</h3><p>{translate("Select a part on the model or in the list.")}</p>
      <div className="board-part-description" aria-live="polite" aria-atomic="true"><strong>{selected?.name || board.name}</strong><p>{selected?.description || translate("Rotate the board to see both sides. The camera, connections and controls each have a story to tell.")}</p></div>
      <div className="board-parts-list" role="group" aria-label={translate("Board components")}>{components.map((component,index) => <button key={component.key} type="button" className="board-part" aria-pressed={selectedKey === component.key} onClick={() => select(component.key)}><span className="board-part-number" aria-hidden="true">{String(index+1).padStart(2,'0')}</span><span>{component.name}</span><span aria-hidden="true">↗</span></button>)}</div>
    </aside>
  </section>;
}
