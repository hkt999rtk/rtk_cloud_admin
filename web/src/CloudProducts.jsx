import { translate, formatLocale, activeLocale } from './i18n/index.mjs';
import React, {useEffect,useRef,useState} from 'react';
import { PKIStatus } from './PKIStatus.jsx';
import {cloudURL,cloudWriteIntent,managedCloudRequest} from './managed-clouds.mjs';
import {fetchCloudProducts,fetchCloudServiceCatalog,productAPI,productURL,productError} from './cloud-products.mjs';
import {productServiceAvailability,productServiceChoices} from './product-service-catalog.mjs';
import './cloud-products.css';
import { Dialog, StatusBadge, CopyValue, displayLabel } from './ConsoleUI.jsx';

function Icon({name}) { return <i className={`fa-solid fa-${name}`} aria-hidden="true" />; }

function ProductionRuns({cloudId, product}) {
  const path=productAPI(cloudId,product.id)+'/production-runs';
  const [runs,setRuns]=useState([]),[endpoint,setEndpoint]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[credential,setCredential]=useState('');
  const [factoryId,setFactoryId]=useState(''),[batchId,setBatchId]=useState(''),[quantity,setQuantity]=useState(1),[hours,setHours]=useState(24);
  const writing=useRef(false);
  const createIntent=useRef(null);
  const load=async()=>{try{const result=await managedCloudRequest(path);setRuns(result.production_runs||[]);setEndpoint(result.enrollment_url||'');setError('');}catch{setError('Unable to load production runs. Retry.');}};
  useEffect(()=>{let active=true;managedCloudRequest(path).then(result=>{if(active){setRuns(result.production_runs||[]);setEndpoint(result.enrollment_url||'');}}).catch(()=>{if(active)setError('Unable to load production runs. Retry.');});return()=>{active=false;};},[path]);
  async function create(event){event.preventDefault();if(writing.current)return;writing.current=true;setBusy(true);setError('');
    try{
      const body={factory_id:factoryId,batch_id:batchId,allowed_quantity:Number(quantity),valid_hours:Number(hours)};
      const storageKey=`factory-run-intent:${cloudId}:${product.id}`;
      let saved=null;
      try{saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');}catch{}
      const intent=cloudWriteIntent(createIntent.current||saved,'POST',path,body);
      createIntent.current=intent;
      try{sessionStorage.setItem(storageKey,JSON.stringify(intent));}catch{}
      const result=await managedCloudRequest(path,{method:'POST',body,key:intent.key});
      createIntent.current=null;
      try{sessionStorage.removeItem(storageKey);}catch{}
      setCredential(result.factory_jwt||'');setRuns(current=>[result.production_run,...current.filter(item=>item.id!==result.production_run.id)]);setBatchId('');
    }
    catch{setError('Unable to create a production run. Check your permissions and Product status.');}
    finally{writing.current=false;setBusy(false);}
  }
  async function stop(run){if(writing.current)return;writing.current=true;setBusy(true);setError('');
    try{const result=await managedCloudRequest(path+'/'+run.id+'/stop',{method:'POST'});setRuns(current=>current.map(item=>item.id===run.id?result.production_run:item));}
    catch{setError('Unable to stop the production run. Retry.');}
    finally{writing.current=false;setBusy(false);}
  }
  return <section className="cloud-product-enrollment" aria-labelledby="production-runs-heading">
    <h3 id="production-runs-heading">{translate('Factory production runs')}</h3>
    {endpoint?<p>{translate('Factory enrollment URL:')} <CopyValue value={endpoint} label={translate('Factory enrollment URL')}/></p>:<p role="status">{translate('The public factory enrollment URL is not configured yet.')}</p>}
    <p>{translate('The platform issues a separate factory client certificate for each factory and Cloud. Send a factory-generated CSR to the platform operator; keep its private key at the factory.')}</p>
    <p>{translate('A device private key stays on the device. Send its CSR, device ID and a production-run JWT from the authorized factory gateway using mTLS.')}</p>
    {error&&<p role="alert">{translate(error)} <button type="button" onClick={load}>{translate('Retry')}</button></p>}
    {credential&&<div className="factory-token" role="status"><strong>{translate('Save this production-run JWT now. It is shown only once.')}</strong><textarea readOnly value={credential} aria-label={translate('Production-run JWT')}/><button type="button" onClick={()=>setCredential('')}>{translate('I have saved this authorization')}</button></div>}
    {endpoint&&product.status==='active'&&product.pki_status==='ready'&&<form className="factory-run-form" onSubmit={create}>
      <label>{translate('Factory ID')}<input required pattern="[a-z0-9][a-z0-9-]{0,63}" value={factoryId} onChange={e=>setFactoryId(e.target.value)} disabled={busy}/></label>
      <label>{translate('Batch ID')}<input required pattern="[a-z0-9][a-z0-9-]{0,63}" value={batchId} onChange={e=>setBatchId(e.target.value)} disabled={busy}/></label>
      <label>{translate('Maximum devices')}<input required type="number" min="1" value={quantity} onChange={e=>setQuantity(e.target.value)} disabled={busy}/></label>
      <label>{translate('Authorization duration in hours (1–168)')}<input required type="number" min="1" max="168" value={hours} onChange={e=>setHours(e.target.value)} disabled={busy}/></label>
      <button type="submit" disabled={busy}>{translate('Create production run')}</button>
    </form>}
    <h4>{translate('Production runs')}</h4>
    {!runs.length?<p>{translate('No production runs yet.')}</p>:<div className="ui-table-scroll"><table><thead><tr><th>{translate('Batch ID')}</th><th>{translate('Factory ID')}</th><th>{translate('Status')}</th><th>{translate('Issued / maximum')}</th><th>{translate('Expires')}</th><th>{translate('Actions')}</th></tr></thead><tbody>{runs.map(run=><tr key={run.id}><td>{run.batch_id}</td><td>{run.factory_id}</td><td>{translate(run.status==='active'?'Active':run.status==='disabled'?'Disabled':run.status)}</td><td>{run.issued_quantity} / {run.allowed_quantity}</td><td>{run.valid_until?new Date(run.valid_until).toLocaleString(formatLocale()):'—'}</td><td>{run.status==='active'&&<button type="button" disabled={busy} onClick={()=>stop(run)}>{translate('Stop signing')}</button>}</td></tr>)}</tbody></table></div>}
  </section>;
}

function DeviceEnrollmentGuide({cloudId, product}) {
  return <section className="cloud-product-enrollment" aria-labelledby="device-enrollment-heading">
    <h3 id="device-enrollment-heading"><Icon name="certificate" />{translate("Sign a device certificate")}</h3>
    <p>{translate("Each ready Product uses its own certificate issuer. Factory devices use a shared enrollment service; the production-run authorization selects this Cloud and Product.")}</p>
    {(product.status !== 'active' || product.pki_status !== 'ready') && <p role="status">{translate("Certificate signing requires an active Product and a ready certificate authority.")}</p>}
    <dl>
      <dt>{translate("Cloud ID")}</dt><dd><CopyValue value={cloudId} label="Cloud ID"/></dd>
      <dt>{translate("Product ID")}</dt><dd><CopyValue value={product.id} label="Product ID"/></dd>
      <dt>{translate("Enrollment API")}</dt><dd><code>POST /v1/factory/enroll</code></dd>
    </dl>
    <p>{translate("The factory enrollment URL and production runs are shown below when the public gateway is ready.")}</p>
    <ol>
      <li>{translate("An authorized user with device-management permission creates a production run for this Cloud and Product, then securely delivers its short-lived authorization to the approved factory gateway.")}</li>
      <li>{translate("Generate the private key and CSR on the device. Keep the private key on the device; the CSR subject must match its Device ID.")}</li>
      <li>{translate("From the authorized factory gateway, submit request_id, devid and csr_pem with the production-run JWT as a Bearer token. If sent, service_options must match the production run.")}</li>
      <li>{translate("Install the returned device certificate and chain with the matching private key. Device activation and account binding are separate steps.")}</li>
    </ol>
    <p>{translate("A CSR alone cannot authorize certificate issuance. For development devices, use Cloud Test Lab instead of the factory endpoint.")}</p>
    <p><strong>{translate("Formal mass-production flow")}</strong> — {translate("Cloud Test Lab is a simplified development test and must not be used for mass production.")}</p>
    <a href={`/assets/developer-docs/assets/factory-enrollment-formal${activeLocale()==='en'?'':'.'+activeLocale()}.html`}>{translate("View the factory enrollment sequence diagram")}</a>
    <a href={`/console/developer-docs/credential-setup?cloudId=${encodeURIComponent(cloudId)}`}>{translate("Read device credential setup")}</a>
  </section>;
}

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
    if(!p && !productServiceChoices(catalog).some(option=>option.code==='mqtt'&&option.selectable)) {setCatalogError('MQTT is not registered and ready. A new Product cannot be created yet.');return;}
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
    <div className="my-clouds-card-head"><h2 className="heading-with-icon"><Icon name="boxes-stacked" />{productId?translate("Product overview"):translate("Products")}</h2>{!productId && data?.can_create && <button className="primary-button icon-text" disabled={busy||!productServiceChoices(catalog).some(option=>option.code==='mqtt'&&option.selectable)} onClick={()=>edit(null)}><Icon name="plus" />{translate("Create Product")}</button>}</div>
    <p>{translate("Manage product models, enabled services and device access.")}</p>
    {productId && <nav aria-label={translate("Product location")}><a href={cloudURL(cloudId)}>{translate("Back to this cloud")}</a></nav>}
    {!productId && <label className="product-status-filter"><span className="icon-text"><Icon name="filter" />{translate("Product status")}</span><select aria-label={translate("Product status")} disabled={busy} value={status} onChange={e=>{setStatus(e.target.value);setOffset(0);setForm(null);setDisable(null);}}><option value="">{translate("All statuses")}</option><option value="active">{translate("Active")}</option><option value="disabled">{translate("Disabled")}</option></select></label>}
    {error && <div role="alert">{translate(error)} <button onClick={()=>setReload(v=>v+1)}>{translate("Refresh Products")}</button></div>}
    {catalogError && <div role="alert">{catalogError} <button onClick={()=>setReload(v=>v+1)}>{translate("Refresh service catalog")}</button></div>}
    {catalog && <section aria-label={translate("Registered features")}><h3>{translate("Registered features")} ({catalog.options.length})</h3><p>{catalog.product_writes_enabled?translate("Selectable features can be added to a Product."):translate("Registry selection is not enabled yet. Product writes use legacy service choices.")}</p>{catalog.options.length ? <ul>{catalog.options.map(option=><li key={option.code}>{translate(option.display_name)} ({option.code}) — {translate(productServiceAvailability(option))}{option.requires?.length ? translate(" — requires {{value0}}", { value0: option.requires.join(', ') }) : ''}</li>)}</ul> : <p>{translate("No services are registered in this environment.")}</p>}</section>}
    {loading && <p role="status">{translate("Loading Products…")}</p>}
    {form && <Dialog title={form.id ? "Edit product" : "Create product"} busy={busy} onClose={()=>setForm(null)}>{error && <p role="alert">{translate(error)}</p>}<form onSubmit={write} data-testid="product-form">
      <p>{translate("Product keys are permanent. Names and models can be updated later.")}</p>
      <label>{translate("Product name")}<input aria-label={translate("Product name")} required maxLength={255} disabled={busy} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
      <label>{translate("Product key")}<input aria-label={translate("Product key")} required maxLength={120} disabled={busy||!!form.id} value={form.profile_key} onChange={e=>setForm({...form,profile_key:e.target.value})}/></label>
      <label>{translate("Product model")}<input aria-label={translate("Product model")} maxLength={255} disabled={busy} value={form.product_model} onChange={e=>setForm({...form,product_model:e.target.value})}/></label>
      <label>{translate("Category")}<select aria-label={translate("Product category")} disabled={busy} value={form.category} onChange={e=>setForm({...form,category:e.target.value})}><option value="ip_camera">{translate("IP camera")}</option><option value="mqtt_device">{translate("MQTT device")}</option><option value="generic">{translate("Generic device")}</option></select></label>
      <fieldset disabled={busy}><legend>{catalog?.product_writes_enabled?translate("Service options — MQTT is required for new Products"):translate("Service options — choose at least one")}</legend><p>{translate("{{count}} of 64 selected",{count:form.service_options.length})}</p>{productServiceChoices(catalog,form.service_options).map(option=><label key={option.code}><input type="checkbox" checked={form.service_options.includes(option.code)} disabled={busy||(!option.selectable&&!form.service_options.includes(option.code))||(catalog?.product_writes_enabled&&option.code==='mqtt'&&form.service_options.includes('mqtt'))||(!form.service_options.includes(option.code)&&form.service_options.length>=64)||!catalog} onChange={e=>setForm({...form,service_options:e.target.checked?[...form.service_options,option.code]:form.service_options.filter(code=>code!==option.code)})}/>{translate(option.display_name)}{!option.selectable&&` (${translate(productServiceAvailability(option))})`}{option.requires?.length>0&&translate(" — requires {{value0}}", { value0: option.requires.join(', ') })}</label>)}</fieldset>
      {form.service_options.includes('device_logging')&&<label>{translate("Device log retention")}<select aria-label={translate("Device log retention")} value={form.log_retention_days} onChange={e=>setForm({...form,log_retention_days:Number(e.target.value)})}>{(catalog?.options.find(option=>option.code==='device_logging')?.log_retention_days||[7,30,90]).map(days=><option key={days} value={days}>{days} {translate("days")}</option>)}</select><small>{translate("Changes apply to newly accepted logs.")}</small></label>}
      <div className="my-clouds-actions"><button type="submit" disabled={busy||!form.service_options.length}>{busy?translate("Saving…"):translate("Save Product")}</button><button type="button" disabled={busy} onClick={()=>setForm(null)}>{translate("Cancel")}</button></div>
    </form></Dialog>}
    {disable && <form onSubmit={write} role="group" aria-label={translate("Confirm Product disable")}><h3>{translate("Disable")} {disable.name}?</h3><p>{translate("This disables the Product; it does not delete its devices, firmware or history, and does not make the cloud empty.")}</p><button disabled={busy} type="submit">{translate("Confirm Product disable")}</button><button disabled={busy} type="button" onClick={()=>setDisable(null)}>{translate("Cancel")}</button></form>}
    {data?.products.length===0 && <p>{translate("No Products in your authorized scope.")}</p>}
    {productId && data?.products[0] && <><DeviceEnrollmentGuide cloudId={cloudId} product={data.products[0]}/><ProductionRuns cloudId={cloudId} product={data.products[0]}/></>}
    {data?.products.length > 0 && <div className="ui-table-scroll"><table><caption>{productId ? translate("Product configuration") : translate("Products in your authorized scope")}</caption><thead><tr><th>{translate("Product")}</th><th>{translate("Status")}</th><th>{translate("Model / category")}</th><th>{translate("Services")}</th><th>{translate("Access")}</th><th>{translate("Actions")}</th></tr></thead><tbody>{data.products.map(p=><tr key={p.id}><td><a href={productURL(cloudId,p.id)}>{p.name}</a><small>{productId ? <CopyValue value={p.profile_key} label="product key"/> : p.profile_key}</small></td><td><StatusBadge value={p.status}/><PKIStatus value={p.pki_status}/></td><td>{p.product_model||translate("Not specified")}<small>{displayLabel(p.category)}</small></td><td>{p.service_options.map(displayLabel).join(', ')||translate("None")}{p.log_retention_days&&<small>{translate("Logs:")} {p.log_retention_days} {translate("days")}</small>}</td><td>{displayLabel(p.my_role||'Cloud-scoped access')}</td><td><div className="my-clouds-actions">{p.allowed_actions?.includes('edit') && <button disabled={busy} onClick={()=>edit(p)}>{translate("Edit Product")}</button>}{p.status==='active' && p.allowed_actions?.includes('disable') && <button disabled={busy} onClick={()=>{intent.current=null;setForm(null);setDisable(p);}}>{translate("Disable Product")}</button>}</div></td></tr>)}</tbody></table></div>}
    {!productId && data?.pagination && <nav className="my-clouds-pagination" aria-label={translate("Product pages")}><button disabled={busy||offset===0} onClick={()=>{setOffset(Math.max(0,offset-25));setForm(null);setDisable(null);}}>{translate("Previous Products")}</button><span>{data.pagination.total} {translate("authorized Products · Page")} {Math.floor(offset/25)+1}</span><button disabled={busy||offset+25>=data.pagination.total} onClick={()=>{setOffset(offset+25);setForm(null);setDisable(null);}}>{translate("Next Products")}</button></nav>}
  </section>;
}
