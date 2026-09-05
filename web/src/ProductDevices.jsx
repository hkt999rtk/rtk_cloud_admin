import React,{useEffect,useRef,useState} from 'react';
import { Dialog, StatusBadge, CopyValue, displayLabel } from './ConsoleUI.jsx';
import {productURL} from './cloud-products.mjs';
import {cloudWriteIntent,managedCloudRequest} from './managed-clouds.mjs';
import {deviceAPI,deviceURL,fetchProductDevices,deviceError} from './product-devices.mjs';
import {testLabURL} from './test-lab.mjs';

export function ProductDevices({cloudId,productId,deviceId='',onAccessLost}) {
 const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const [offset,setOffset]=useState(0),[q,setQ]=useState(''),[search,setSearch]=useState(''),[reload,setReload]=useState(0);
 const [form,setForm]=useState(null),[busy,setBusy]=useState(false);
 const alive=useRef(true),writing=useRef(false),intent=useRef(null),lost=useRef(onAccessLost);lost.current=onAccessLost;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{
  const controller=new AbortController();let timer;
  setData(null);setError('');setLoading(true);
  const load=async()=>{
   try {
    const next=await fetchProductDevices(cloudId,productId,deviceId,{offset,q,signal:controller.signal});
    if(controller.signal.aborted)return;
    setData(next);setError('');setForm(old=>old&&!next.devices.some(d=>d.id===deviceId&&d.allowed_actions?.includes('edit'))?null:old);
   }catch(e){if(!controller.signal.aborted){setData(null);setForm(null);setError(deviceError(e));if([401,403,404].includes(e.status))lost.current?.(e);}}
   finally{if(!controller.signal.aborted){setLoading(false);timer=setTimeout(load,10000);}}
  };
  load();const focus=()=>{clearTimeout(timer);controller.abort();setReload(v=>v+1);};window.addEventListener('focus',focus);
  return()=>{controller.abort();clearTimeout(timer);window.removeEventListener('focus',focus);};
 },[cloudId,productId,deviceId,offset,q,reload]);
 async function save(e){
  e.preventDefault();if(writing.current)return;
  const next=cloudWriteIntent(intent.current,'PATCH',deviceAPI(cloudId,productId,deviceId),form);intent.current=next;
  writing.current=true;setBusy(true);setError('');
  try{await managedCloudRequest(next.path,{method:next.method,body:next.body,key:next.key});if(alive.current){setForm(null);intent.current=null;setReload(v=>v+1);}}
  catch(err){if(alive.current){setError(deviceError(err));if([401,403,404].includes(err.status)){setData(null);setForm(null);lost.current?.(err);}}}
  finally{writing.current=false;if(alive.current)setBusy(false);}
 }
 return <section className="my-clouds-panel" data-testid="product-devices">
  <h2>{deviceId?'Device details':'Devices'}</h2><p>Only devices in this Product and your current authorized scope are shown.</p>
  <a href={testLabURL(cloudId,productId,deviceId)}>Open Cloud Test Lab</a>
  {deviceId?<a href={productURL(cloudId,productId)}>Back to Product devices</a>:<form onSubmit={e=>{e.preventDefault();setOffset(0);setQ(search.trim());}}><label>Search devices<input aria-label="Search devices" value={search} maxLength={200} onChange={e=>setSearch(e.target.value)}/></label><button>Search devices</button></form>}
  {error&&<div role="alert">{error} <button onClick={()=>setReload(v=>v+1)}>Refresh devices</button></div>}
  {loading&&<p role="status">Loading devices…</p>}
  {form&&<Dialog title="Edit device display" busy={busy} onClose={()=>setForm(null)}>{error&&<p role="alert">{error}</p>}<form onSubmit={save}><p>Only the display name and model change. Hardware identity, Product binding and activation data are preserved.</p><label>Device name<input aria-label="Device name" value={form.name} required maxLength={255} disabled={busy} onChange={e=>setForm({...form,name:e.target.value})}/></label><label>Device model<input aria-label="Device model" value={form.model} maxLength={255} disabled={busy} onChange={e=>setForm({...form,model:e.target.value})}/></label><button disabled={busy}>{busy?'Saving…':'Save device'}</button> <button type="button" disabled={busy} onClick={()=>setForm(null)}>Cancel</button></form></Dialog>}
  {data?.devices.length===0&&<p>No devices match your authorized Product scope.</p>}
  {data?.devices.length > 0 && (deviceId ? <div>{data.devices.map(d=><article key={d.id}><h3>{d.name}</h3><dl><dt>Device ID</dt><dd><CopyValue value={d.id} label="device ID"/></dd><dt>Status</dt><dd><StatusBadge value={d.status}/></dd><dt>Category</dt><dd>{displayLabel(d.category)}</dd><dt>Model</dt><dd>{d.model||'Not specified'}</dd><dt>Serial number</dt><dd><CopyValue value={d.serial_number} label="serial number"/></dd><dt>Last seen</dt><dd>{d.last_seen_at||'Not reported'}</dd></dl>{d.allowed_actions?.includes('edit')&&<button disabled={busy} onClick={()=>{intent.current=null;setForm({name:d.name,model:d.model||''});}}>Edit device display</button>}</article>)}</div> : <div className="ui-table-scroll"><table><caption>Devices in this product</caption><thead><tr><th>Device</th><th>Status</th><th>Model</th><th>Serial number</th><th>Last seen</th></tr></thead><tbody>{data.devices.map(d=><tr key={d.id}><td><a href={deviceURL(cloudId,productId,d.id)}>{d.name}</a><small>{displayLabel(d.category)}</small></td><td><StatusBadge value={d.status}/></td><td>{d.model||'Not specified'}</td><td>{d.serial_number||'Not reported'}</td><td>{d.last_seen_at||'Not reported'}</td></tr>)}</tbody></table></div>)}
  {!deviceId&&data?.pagination&&<nav aria-label="Device pages" className="my-clouds-pagination"><button disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-25))}>Previous devices</button><span>{data.pagination.total} authorized devices · Page {Math.floor(offset/25)+1}</span><button disabled={offset+25>=data.pagination.total} onClick={()=>setOffset(offset+25)}>Next devices</button></nav>}
 </section>;
}
