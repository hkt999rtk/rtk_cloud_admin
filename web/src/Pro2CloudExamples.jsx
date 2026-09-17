import React,{useEffect,useState} from 'react';
import './pro2-examples.css';
import {examplesCatalog,exampleDownload,PRO2_EXAMPLES_PATH} from './pro2-examples.mjs';
import {PRO2_FIRMWARE_BURNER_PATH} from './Pro2FirmwareBurner.jsx';
const exampleIcons = {mqtt:'fa-message',webrtc_test_video:'fa-film',webrtc_camera:'fa-camera'};
const validationLabels = {build:'Build',host:'Host tests',hardware:'Hardware',cloud:'Cloud'};
export function Pro2CloudExamples(){
 const [catalog,setCatalog]=useState(null),[error,setError]=useState(''),[accepted,setAccepted]=useState(false),[busy,setBusy]=useState(false),[attempt,setAttempt]=useState(0);
 useEffect(()=>{const c=new AbortController();setError('');setCatalog(null);setAccepted(false);examplesCatalog('',c.signal).then(setCatalog).catch(e=>{if(!c.signal.aborted)setError(e.message)});return()=>c.abort()},[attempt]);
 async function download(id){setBusy(true);setError('');try{const t=await exampleDownload(catalog,id);const a=document.createElement('a');a.href=t.url;a.rel='noreferrer noopener';a.download=t.artifact.filename;a.click()}catch(e){setError(e.message)}finally{setBusy(false)}}
 return <section className="page-content pro2-examples-page" data-testid="pro2-cloud-examples">
 <a href="/console/chipset-sdk">← ChipSet &amp; SDK</a><div className="page-intro"><div><p className="eyebrow">AMEBA PRO2 · VIDEO ONLY</p><h2 className="pro2-icon-heading"><i className="fa-solid fa-cloud" aria-hidden="true"/> Cloud Examples</h2><p>Build, burn and test MQTT messaging, synthetic H.264 video, or a live camera.</p></div></div>
 <section className="panel"><h3 className="pro2-icon-heading"><i className="fa-solid fa-shield-halved" aria-hidden="true"/> Developer evaluation release</h3><p>Website firmware contains isolated test settings and cannot connect to your Cloud. To test your Cloud, download your device certificate in Developer UI and rebuild locally with your own settings.</p><p><i className="fa-solid fa-lock pro2-inline-icon" aria-hidden="true"/> Plaintext filesystem keys and embedded key arrays are for development only. Production private keys must use the PRO2 protected zone; that integration is not implemented here.</p></section>
 {error&&<p role="alert">{error} <button onClick={()=>setAttempt(n=>n+1)}>Reload release</button></p>}
 {!catalog&&!error&&<p role="status">Loading examples…</p>}
 {catalog&&<><section className="panel pro2-release" aria-label="Release package">
   <div className="pro2-release-info">
     <div className="pro2-release-heading">
       <div><p className="eyebrow">RELEASE PACKAGE</p><h3>Release {catalog.version}</h3></div>
       <span className="pro2-release-badge">Developer preview</span>
     </div>
     <p className="pro2-release-description">One release. Three ready-to-build cloud examples.</p>
     <dl className="pro2-release-dependencies">
       {Object.entries(catalog.dependencies).map(([key,value])=><div key={key}>
         <dt>{{amebapro2_sdk:'AmebaPro2 SDK',rtk_ameba_webrtc:'RTK WebRTC',gcc:'GCC toolchain',newlib:'newlib'}[key]||key}</dt>
         <dd title={value}>{key==='rtk_ameba_webrtc'?<code>{value.slice(0,12)}</code>:value}</dd>
       </div>)}
     </dl>
     <p className="pro2-release-source"><i className="fa-solid fa-code-branch" aria-hidden="true"/> Source revision <code title={catalog.source_commit}>{catalog.source_commit.slice(0,12)}</code></p>
   </div>
   <aside className="pro2-release-download">
     <span className="pro2-release-icon" aria-hidden="true"><i className="fa-solid fa-box-archive"/></span>
     <h4>Source &amp; documentation</h4>
     <p>All three examples and offline guides in one package.</p>
     <label className="pro2-release-consent"><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/><span>I accept these evaluation terms.</span></label>
     <button className="primary-button" disabled={!accepted||busy} onClick={()=>download('source')}><i className="fa-solid fa-arrow-down" aria-hidden="true"/> Download source &amp; documentation</button>
   </aside>
   <details className="pro2-release-terms"><summary><span><i className="fa-solid fa-file-contract pro2-inline-icon" aria-hidden="true"/> Evaluation terms</span><span className="pro2-release-terms-version">{catalog.terms_version}</span></summary><pre>{catalog.terms}</pre></details>
 </section>
 <div className="chipset-resource-grid">{catalog.examples.map(x=><article className="panel pro2-example-card" key={x.id}>
   <div className="pro2-example-heading"><span className="pro2-example-icon"><i className={`fa-solid ${exampleIcons[x.id]}`} aria-hidden="true"/></span><div><p className="eyebrow">{x.id}</p><h3>{x.title}</h3></div></div>
   <p>{x.description}</p>
   <p className="pro2-example-detail"><i className="fa-solid fa-microchip" aria-hidden="true"/><span>{x.board}</span></p>
   <p className="pro2-example-detail"><i className="fa-solid fa-camera" aria-hidden="true"/><span>Sensor: {x.sensor}</span></p>
   <p className="pro2-example-detail"><i className="fa-solid fa-memory" aria-hidden="true"/><span>Full non-TrustZone flash image · offset 0x{x.flash_offset.toString(16)}</span></p>
   <ul className="pro2-example-validation" aria-label="Validation status">{Object.entries(x.validation).map(([key,value])=><li key={key}>
     <i className={`fa-solid ${value.startsWith('PASS')?'fa-circle-check pro2-status-pass':'fa-clock'}`} aria-hidden="true"/>
     <span><strong>{validationLabels[key]||key}</strong> · {value==='NOT_RUN'?'Not yet tested':value}</span>
   </li>)}</ul>
   <div className="cloud-sdk-actions">
     <a className="ghost-button" href={`/console/developer-docs/protwo-cloud-examples#${x.id.replaceAll('_','-')}`}><i className="fa-solid fa-book-open" aria-hidden="true"/> Read guide</a>
     <button disabled={!accepted||busy} onClick={()=>download(x.firmware_id)}><i className="fa-solid fa-download" aria-hidden="true"/> Download bin</button>
     <button disabled={!accepted||busy} onClick={()=>download(x.checksum_id)}><i className="fa-solid fa-fingerprint" aria-hidden="true"/> SHA-256</button>
     <a className="primary-button" href={`${PRO2_FIRMWARE_BURNER_PATH}?example=${encodeURIComponent(x.id)}&version=${encodeURIComponent(catalog.version)}`}><i className="fa-solid fa-bolt" aria-hidden="true"/> Burn this example</a>
   </div>
 </article>)}</div></>}

 </section>
}
