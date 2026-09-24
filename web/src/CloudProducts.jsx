import React, {useEffect,useRef,useState} from 'react';
import { PKIStatus } from './PKIStatus.jsx';
import {cloudURL,cloudWriteIntent,managedCloudRequest} from './managed-clouds.mjs';
import {fetchCloudProducts,fetchCloudServiceCatalog,productAPI,productURL,productError} from './cloud-products.mjs';
import './cloud-products.css';
import { Dialog, StatusBadge, CopyValue, displayLabel } from './ConsoleUI.jsx';

function Icon({name}) { return <i className={`fa-solid fa-${name}`} aria-hidden="true" />; }

export function CloudProducts({cloudId,productId='',onAccessLost}) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  const [offset,setOffset]=useState(0),[status,setStatus]=useState(''),[reload,setReload]=useState(0);
  const [form,setForm]=useState(null),[disable,setDisable]=useState(null),[busy,setBusy]=useState(false);
  const [catalog,setCatalog]=useState(null),[catalogError,setCatalogError]=useState('');
  const intent=useRef(null),writing=useRef(false),alive=useRef(true);
  const accessLost=useRef(onAccessLost);accessLost.current=onAccessLost;
  useEffect(()=>{alive.current=true; return ()=>{alive.current=false;};},[]);
  useEffect(()=>{
    const controller=new AbortController(); let timer;
    setData(null);setError('');setLoading(true);setCatalog(null);setCatalogError('');
    const load=async()=>{
      try {
        const next=await fetchCloudProducts(cloudId,productId,{offset,status,signal:controller.signal});
        if(controller.signal.aborted) return;
        setData(next);setError('');
        try {setCatalog(await fetchCloudServiceCatalog(cloudId,{signal:controller.signal}));setCatalogError('');}
        catch(catalogFailure) {if(!controller.signal.aborted){setCatalog(null);setCatalogError(productError(catalogFailure));}}
        // Authority comes from each fresh Product response. Remove controls and
        // stale edit state when a role/scope changes while this tab stays open.
        setForm(current=>current && (current.id ? !next.products.some(p=>p.id===current.id && p.allowed_actions?.includes('edit')) : !next.can_create) ? null : current);
        setDisable(current=>current && !next.products.some(p=>p.id===current.id && p.allowed_actions?.includes('disable')) ? null : current);
      } catch(err) {
        if(!controller.signal.aborted) {setData(null);setForm(null);setDisable(null);setError(productError(err));if([401,403,404].includes(err.status))accessLost.current?.(err);}
      } finally {
        if(!controller.signal.aborted) {setLoading(false);timer=setTimeout(load,10000);}
      }
    };
    load();
    const focus=()=>{clearTimeout(timer);controller.abort();setReload(v=>v+1);};
    window.addEventListener('focus',focus);
    return ()=>{controller.abort();clearTimeout(timer);window.removeEventListener('focus',focus);};
  },[cloudId,productId,offset,status,reload]);
  function edit(p) {
    intent.current=null;setDisable(null);
    if(!p && (!catalog?.options.some(option=>option.code==='mqtt'&&option.selectable))) {setCatalogError('MQTT is not registered and ready. A new Product cannot be created yet.');return;}
    setForm(p?{id:p.id,name:p.name,profile_key:p.profile_key,product_model:p.product_model||'',category:p.category,service_options:p.service_options,original_services:p.service_options,log_retention_days:p.log_retention_days||7}:
      {id:'',name:'',profile_key:'',product_model:'',category:'ip_camera',service_options:['mqtt'],original_services:[],log_retention_days:7});
  }
  async function write(event) {
    event.preventDefault();if(writing.current)return;
    const servicesChanged=!form?.id||JSON.stringify([...form.service_options].sort())!==JSON.stringify([...form.original_services].sort());
    if(!disable&&servicesChanged&&!catalog){setCatalogError('Service catalog is unavailable. Refresh before changing service grants.');return;}
    const body=disable?{}:{name:form.name,product_model:form.product_model,category:form.category,...(servicesChanged?{service_options:form.service_options,...(catalog?.product_writes_enabled?{catalog_revision:catalog.catalog_revision}:{})}:{}),...(form.service_options.includes('device_logging')?{log_retention_days:form.log_retention_days}:{}),...(!form.id?{profile_key:form.profile_key}:{})};
    const path=disable?productAPI(cloudId,disable.id)+'/disable':productAPI(cloudId,form.id);
    const method=disable||!form.id?'POST':'PATCH';
    const next=cloudWriteIntent(intent.current,method,path,body);intent.current=next;
    writing.current=true;setBusy(true);setError('');
    try {
      await managedCloudRequest(next.path,{method:next.method,body:next.body,key:next.key});
      if(alive.current){setForm(null);setDisable(null);intent.current=null;setReload(v=>v+1);}
    } catch(err) {
      if(alive.current){setError(productError(err));if([401,403,404].includes(err.status)){setData(null);setForm(null);setDisable(null);accessLost.current?.(err);}}
    } finally {writing.current=false;if(alive.current)setBusy(false);}
  }
  return <section className="my-clouds-panel cloud-products" data-testid="cloud-products">
    <div className="my-clouds-card-head"><h2 className="heading-with-icon"><Icon name="boxes-stacked" />{productId?'Product overview':'Products'}</h2>{!productId && data?.can_create && <button className="primary-button icon-text" disabled={busy||!catalog?.options.some(option=>option.code==='mqtt'&&option.selectable)} onClick={()=>edit(null)}><Icon name="plus" />Create Product</button>}</div>
    <p>Manage product models, enabled services and device access.</p>
    {productId && <nav aria-label="Product location"><a href={cloudURL(cloudId)}>Back to this cloud</a></nav>}
    {!productId && <label className="product-status-filter"><span className="icon-text"><Icon name="filter" />Product status</span><select aria-label="Product status" disabled={busy} value={status} onChange={e=>{setStatus(e.target.value);setOffset(0);setForm(null);setDisable(null);}}><option value="">All statuses</option><option value="active">Active</option><option value="disabled">Disabled</option></select></label>}
    {error && <div role="alert">{error} <button onClick={()=>setReload(v=>v+1)}>Refresh Products</button></div>}
    {catalogError && <div role="alert">{catalogError} <button onClick={()=>setReload(v=>v+1)}>Refresh service catalog</button></div>}
    {loading && <p role="status">Loading Products…</p>}
    {form && <Dialog title={form.id ? "Edit product" : "Create product"} busy={busy} onClose={()=>setForm(null)}>{error && <p role="alert">{error}</p>}<form onSubmit={write} data-testid="product-form">
      <p>Product keys are permanent. Names and models can be updated later.</p>
      <label>Product name<input aria-label="Product name" required maxLength={255} disabled={busy} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
      <label>Product key<input aria-label="Product key" required maxLength={120} disabled={busy||!!form.id} value={form.profile_key} onChange={e=>setForm({...form,profile_key:e.target.value})}/></label>
      <label>Product model<input aria-label="Product model" maxLength={255} disabled={busy} value={form.product_model} onChange={e=>setForm({...form,product_model:e.target.value})}/></label>
      <label>Category<select aria-label="Product category" disabled={busy} value={form.category} onChange={e=>setForm({...form,category:e.target.value})}><option value="ip_camera">IP camera</option><option value="mqtt_device">MQTT device</option><option value="generic">Generic device</option></select></label>
      <fieldset disabled={busy}><legend>{catalog?.product_writes_enabled?'Service options — MQTT is required for new Products':'Service options — choose at least one'}</legend>{[...(catalog?.options||[]),...form.service_options.filter(code=>!catalog?.options.some(option=>option.code===code)).map(code=>({code,display_name:displayLabel(code),selectable:false,unavailable_reason:'not_registered'}))].map(option=><label key={option.code}><input type="checkbox" checked={form.service_options.includes(option.code)} disabled={busy||(!option.selectable&&!form.service_options.includes(option.code))||(catalog?.product_writes_enabled&&option.code==='mqtt'&&form.service_options.includes('mqtt'))||!catalog} onChange={e=>setForm({...form,service_options:e.target.checked?[...form.service_options,option.code]:form.service_options.filter(code=>code!==option.code)})}/>{option.display_name}{!option.selectable&&` (${option.unavailable_reason||'unavailable'})`}{option.requires?.length>0&&` — requires ${option.requires.join(', ')}`}</label>)}</fieldset>
      {form.service_options.includes('device_logging')&&<label>Device log retention<select aria-label="Device log retention" value={form.log_retention_days} onChange={e=>setForm({...form,log_retention_days:Number(e.target.value)})}>{(catalog?.options.find(option=>option.code==='device_logging')?.log_retention_days||[7,30,90]).map(days=><option key={days} value={days}>{days} days</option>)}</select><small>Changes apply to newly accepted logs.</small></label>}
      <div className="my-clouds-actions"><button type="submit" disabled={busy||!form.service_options.length}>{busy?'Saving…':'Save Product'}</button><button type="button" disabled={busy} onClick={()=>setForm(null)}>Cancel</button></div>
    </form></Dialog>}
    {disable && <form onSubmit={write} role="group" aria-label="Confirm Product disable"><h3>Disable {disable.name}?</h3><p>This disables the Product; it does not delete its devices, firmware or history, and does not make the cloud empty.</p><button disabled={busy} type="submit">Confirm Product disable</button><button disabled={busy} type="button" onClick={()=>setDisable(null)}>Cancel</button></form>}
    {data?.products.length===0 && <p>No Products in your authorized scope.</p>}
    {data?.products.length > 0 && <div className="ui-table-scroll"><table><caption>{productId ? 'Product configuration' : 'Products in your authorized scope'}</caption><thead><tr><th>Product</th><th>Status</th><th>Model / category</th><th>Services</th><th>Access</th><th>Actions</th></tr></thead><tbody>{data.products.map(p=><tr key={p.id}><td><a href={productURL(cloudId,p.id)}>{p.name}</a><small>{productId ? <CopyValue value={p.profile_key} label="product key"/> : p.profile_key}</small></td><td><StatusBadge value={p.status}/><PKIStatus value={p.pki_status}/></td><td>{p.product_model||'Not specified'}<small>{displayLabel(p.category)}</small></td><td>{p.service_options.map(displayLabel).join(', ')||'None'}{p.log_retention_days&&<small>Logs: {p.log_retention_days} days</small>}</td><td>{displayLabel(p.my_role||'Cloud-scoped access')}</td><td><div className="my-clouds-actions">{p.allowed_actions?.includes('edit') && <button disabled={busy} onClick={()=>edit(p)}>Edit Product</button>}{p.status==='active' && p.allowed_actions?.includes('disable') && <button disabled={busy} onClick={()=>{intent.current=null;setForm(null);setDisable(p);}}>Disable Product</button>}</div></td></tr>)}</tbody></table></div>}
    {!productId && data?.pagination && <nav className="my-clouds-pagination" aria-label="Product pages"><button disabled={busy||offset===0} onClick={()=>{setOffset(Math.max(0,offset-25));setForm(null);setDisable(null);}}>Previous Products</button><span>{data.pagination.total} authorized Products · Page {Math.floor(offset/25)+1}</span><button disabled={busy||offset+25>=data.pagination.total} onClick={()=>{setOffset(offset+25);setForm(null);setDisable(null);}}>Next Products</button></nav>}
  </section>;
}
