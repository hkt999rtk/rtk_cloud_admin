import React, {useEffect,useRef,useState} from 'react';
import {cloudURL,cloudWriteIntent,managedCloudRequest} from './managed-clouds.mjs';
import {fetchCloudProducts,productAPI,productURL,productServices,productError} from './cloud-products.mjs';
import './cloud-products.css';

export function CloudProducts({cloudId,productId='',onAccessLost}) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  const [offset,setOffset]=useState(0),[status,setStatus]=useState(''),[reload,setReload]=useState(0);
  const [form,setForm]=useState(null),[disable,setDisable]=useState(null),[busy,setBusy]=useState(false);
  const intent=useRef(null),writing=useRef(false),alive=useRef(true);
  const accessLost=useRef(onAccessLost);accessLost.current=onAccessLost;
  useEffect(()=>{alive.current=true; return ()=>{alive.current=false;};},[]);
  useEffect(()=>{
    const controller=new AbortController(); let timer;
    setData(null);setError('');setLoading(true);
    const load=async()=>{
      try {
        const next=await fetchCloudProducts(cloudId,productId,{offset,status,signal:controller.signal});
        if(controller.signal.aborted) return;
        setData(next);setError('');
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
    setForm(p?{id:p.id,name:p.name,profile_key:p.profile_key,product_model:p.product_model||'',category:p.category,service_options:p.service_options}:
      {id:'',name:'',profile_key:'',product_model:'',category:'ip_camera',service_options:['mqtt']});
  }
  async function write(event) {
    event.preventDefault();if(writing.current)return;
    const body=disable?{}:{name:form.name,product_model:form.product_model,category:form.category,service_options:form.service_options,...(!form.id?{profile_key:form.profile_key}:{})};
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
    <div className="my-clouds-card-head"><h2>{productId?'Product overview':'Products'}</h2>{!productId && data?.can_create && <button disabled={busy} onClick={()=>edit(null)}>Create Product</button>}</div>
    <p>Each Product has a permanent Product key and stays in this Brand Cloud after it is created.</p>
    {productId && <nav aria-label="Product location"><a href={cloudURL(cloudId)}>Back to this cloud</a></nav>}
    {!productId && <label>Product status<select aria-label="Product status" disabled={busy} value={status} onChange={e=>{setStatus(e.target.value);setOffset(0);setForm(null);setDisable(null);}}><option value="">All statuses</option><option value="active">Active</option><option value="disabled">Disabled</option></select></label>}
    {error && <div role="alert">{error} <button onClick={()=>setReload(v=>v+1)}>Refresh Products</button></div>}
    {loading && <p role="status">Loading Products…</p>}
    {form && <form onSubmit={write} data-testid="product-form">
      <h3>{form.id?'Edit Product':'Create Product in this cloud'}</h3>
      <label>Product name<input aria-label="Product name" required maxLength={255} disabled={busy} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
      <label>Product key<input aria-label="Product key" required maxLength={120} disabled={busy||!!form.id} value={form.profile_key} onChange={e=>setForm({...form,profile_key:e.target.value})}/></label>
      <label>Product model<input aria-label="Product model" maxLength={255} disabled={busy} value={form.product_model} onChange={e=>setForm({...form,product_model:e.target.value})}/></label>
      <label>Category<select aria-label="Product category" disabled={busy} value={form.category} onChange={e=>setForm({...form,category:e.target.value})}><option value="ip_camera">IP camera</option><option value="mqtt_device">MQTT device</option><option value="generic">Generic device</option></select></label>
      <fieldset disabled={busy}><legend>Service options — choose at least one</legend>{productServices.map(([id,label])=><label key={id}><input type="checkbox" checked={form.service_options.includes(id)} onChange={e=>setForm({...form,service_options:e.target.checked?[...form.service_options,id]:form.service_options.filter(v=>v!==id)})}/>{label}</label>)}</fieldset>
      <div className="my-clouds-actions"><button type="submit" disabled={busy||!form.service_options.length}>{busy?'Saving…':'Save Product'}</button><button type="button" disabled={busy} onClick={()=>setForm(null)}>Cancel</button></div>
    </form>}
    {disable && <form onSubmit={write} role="group" aria-label="Confirm Product disable"><h3>Disable {disable.name}?</h3><p>This disables the Product; it does not delete its devices, firmware or history, and does not make the cloud empty.</p><button disabled={busy} type="submit">Confirm Product disable</button><button disabled={busy} type="button" onClick={()=>setDisable(null)}>Cancel</button></form>}
    {data?.products.length===0 && <p>No Products in your authorized scope.</p>}
    <div className="cloud-product-items">{data?.products.map(p=><article key={p.id} className="my-clouds-panel"><h3>{productId?p.name:<a href={productURL(cloudId,p.id)}>{p.name}</a>}</h3><p>{p.profile_key} · {p.status}</p><dl><dt>Model</dt><dd>{p.product_model||'—'}</dd><dt>Category</dt><dd>{p.category}</dd><dt>My Product role</dt><dd>{p.my_role||'Cloud-scoped access'}</dd><dt>Services</dt><dd>{p.service_options.join(', ')||'None'}</dd></dl><div className="my-clouds-actions">{p.allowed_actions?.includes('edit') && <button disabled={busy} onClick={()=>edit(p)}>Edit Product</button>}{p.status==='active' && p.allowed_actions?.includes('disable') && <button disabled={busy} onClick={()=>{intent.current=null;setForm(null);setDisable(p);}}>Disable Product</button>}</div></article>)}</div>
    {!productId && data?.pagination && <nav className="my-clouds-pagination" aria-label="Product pages"><button disabled={busy||offset===0} onClick={()=>{setOffset(Math.max(0,offset-25));setForm(null);setDisable(null);}}>Previous Products</button><span>{data.pagination.total} authorized Products · Page {Math.floor(offset/25)+1}</span><button disabled={busy||offset+25>=data.pagination.total} onClick={()=>{setOffset(offset+25);setForm(null);setDisable(null);}}>Next Products</button></nav>}
  </section>;
}
