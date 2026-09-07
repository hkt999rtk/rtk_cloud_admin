import React,{useEffect,useRef,useState} from 'react';
import {examplesCatalog,exampleDownload,fetchExampleFirmware} from './pro2-examples.mjs';
export function Pro2RemoteFirmware({rootRef}){
 const params=new URLSearchParams(location.search),id=params.get('example'),version=params.get('version');
 const [catalog,setCatalog]=useState(null),[error,setError]=useState(''),[accepted,setAccepted]=useState(false),[progress,setProgress]=useState(''),[busy,setBusy]=useState(false),[attempt,setAttempt]=useState(0);
 const active=useRef(null);
 const [uartBusy,setUartBusy]=useState(false);
 const [runtimeReady,setRuntimeReady]=useState(false);
 useEffect(()=>{const node=rootRef.current;const update=()=>{setUartBusy(node.dataset.uartBusy==='true');setRuntimeReady(node.dataset.burnerReady==='true')};const observer=new MutationObserver(update);observer.observe(node,{attributes:true,attributeFilter:['data-uart-busy','data-burner-ready']});update();return()=>observer.disconnect()},[]);
 function emit(detail){rootRef.current?.dispatchEvent(new CustomEvent('pro2-firmware-source',{detail}))}
 useEffect(()=>{if(!id||!version)return;const c=new AbortController();setError('');setAccepted(false);examplesCatalog(version,c.signal).then(setCatalog).catch(e=>{if(!c.signal.aborted)setError(e.message)});return()=>c.abort()},[id,version,attempt]);
 useEffect(()=>{const local=()=>{active.current?.abort();active.current=null;setBusy(false);setProgress('Using local firmware.');setError('')};const input=rootRef.current.querySelector('#firmware');input.addEventListener('change',local);return()=>{input.removeEventListener('change',local);active.current?.abort()}},[]);
 const example=catalog?.examples.find(x=>x.id===id);
 async function download(){
  active.current?.abort();const c=new AbortController();active.current=c;setBusy(true);setError('');setProgress('Preparing download…');emit({file:null,busy:true});
  try{
   const t=await exampleDownload(catalog,example.firmware_id,c.signal);
   const expected=catalog.artifacts.find(a=>a.id===example.firmware_id);
   if(!expected||['id','sha256','filename','size_bytes','kind'].some(k=>t.artifact[k]!==expected[k]))throw new Error('Release metadata changed. Reload the release.');
   const file=await fetchExampleFirmware(t,{signal:c.signal,onProgress:(n,total)=>setProgress(`Downloading ${Math.floor(n*100/total)}%`)});
   if(active.current!==c)return;
   emit({file,busy:false,metadata:example});setProgress('Downloaded and SHA-256 verified. Connect UART and confirm the burn when ready.');
  }catch(e){if(active.current!==c)return;emit({file:null,busy:false});setError(e.name==='AbortError'?'Download canceled.':e.message)}
  finally{if(active.current===c){active.current=null;setBusy(false)}}
 }
 if(!id||!version)return null;
 return <section className="panel" aria-label="Website firmware"><h3>Website firmware · {example?.title||id} · {version}</h3><p>Isolated test firmware: cannot connect to your Cloud. Use a locally rebuilt image for your own device credentials.</p>
 {error&&<p role="alert">{error} <button onClick={()=>setAttempt(n=>n+1)}>Reload release</button></p>}
 {catalog&&!example&&<p role="alert">This example is not in the selected release.</p>}
 {example&&<><details><summary>Evaluation terms · {catalog.terms_version}</summary><pre style={{whiteSpace:'pre-wrap'}}>{catalog.terms}</pre></details><label><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/> I accept these evaluation terms.</label><p><button disabled={!accepted||busy||uartBusy||!runtimeReady} onClick={download}>Download / retry firmware</button> <button disabled={!busy} onClick={()=>active.current?.abort()}>Cancel download</button></p></>}
 <p role="status">{progress}</p><p>You can also choose a local file in the firmware panel below.</p></section>
}
