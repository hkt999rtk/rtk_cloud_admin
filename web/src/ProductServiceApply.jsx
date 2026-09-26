import React,{useEffect,useRef,useState} from 'react';
import {translate} from './i18n/index.mjs';
import {managedCloudRequest,cloudWriteIntent} from './managed-clouds.mjs';
import {productServiceApplyAPI,fetchProductServiceApplyPreview,fetchProductServiceApplyJobs,fetchProductServiceApplyJob,fetchProductServiceApplyItems} from './cloud-products.mjs';
import {productServiceCapabilityLabel} from './product-service-catalog.mjs';

function previewText(items,catalog){return items?.length?items.map(code=>productServiceCapabilityLabel(code,catalog)).join(', '):'—';}
const terminal=new Set(['completed','cancelled','partial_failed','failed','expired']);

export function ProductServiceApply({cloudId,product,catalog,canStart=true}) {
  const [preview,setPreview]=useState(null),[job,setJob]=useState(null),[items,setItems]=useState(null);
  const [offset,setOffset]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
  const createIntent=useRef(null),actionIntent=useRef(null);
  const root=productServiceApplyAPI(cloudId,product.id);
  useEffect(()=>{let alive=true;
    fetchProductServiceApplyJobs(cloudId,product.id).then(jobs=>{if(alive&&jobs.length)setJob(jobs[0]);}).catch(()=>{if(alive)setError('Unable to load Product apply jobs.');});
    return()=>{alive=false;};
  },[cloudId,product.id]);
  useEffect(()=>{if(!job?.id)return;let alive=true;let timer;
    const load=async()=>{
      try {
        const [next,page]=await Promise.all([fetchProductServiceApplyJob(cloudId,product.id,job.id),fetchProductServiceApplyItems(cloudId,product.id,job.id,{offset})]);
        if(alive){setJob(next);setItems(page);setError('');}
      } catch {if(alive)setError('Product apply progress is temporarily unavailable.');}
      if(alive&&!terminal.has(job.state))timer=setTimeout(load,3000);
    };
    load();return()=>{alive=false;clearTimeout(timer);};
  },[cloudId,product.id,job?.id,offset,job?.state,refresh]);
  async function openPreview(){setBusy(true);setError('');setPreview(null);
    try {setPreview(await fetchProductServiceApplyPreview(cloudId,product.id));}
    catch(e){setError(e?.status===409?translate('Product or device grants changed. Refresh the preview.'):translate('Product apply preview is unavailable.'));}
    finally{setBusy(false);}
  }
  async function confirm(){if(!preview||busy)return;setBusy(true);setError('');
    const body={preview_token:preview.preview_token};
    const storageKey=`product-services-apply:${cloudId}:${product.id}`;
    let saved=null;try{saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');}catch{}
    const intent=cloudWriteIntent(createIntent.current||saved,'POST',root,body);
    createIntent.current=intent;try{sessionStorage.setItem(storageKey,JSON.stringify(intent));}catch{}
    try {const result=await managedCloudRequest(root,{method:'POST',body,key:intent.key});setJob(result.job);setOffset(0);setItems(null);setPreview(null);createIntent.current=null;try{sessionStorage.removeItem(storageKey);}catch{}}
    catch(e){setError(e?.status===409?translate('Product or device set changed. Refresh the preview.'):translate('Product apply job could not be started. Retry this confirmation.'));if(e?.status===409)setPreview(null);}
    finally{setBusy(false);}
  }
  async function action(name){if(!job?.id||busy)return;setBusy(true);setError('');
    const path=productServiceApplyAPI(cloudId,product.id,job.id)+'/'+name;
    const intent=cloudWriteIntent(actionIntent.current,'POST',path,{});actionIntent.current=intent;
    try{const result=await managedCloudRequest(path,{method:'POST',body:{},key:intent.key});setJob(result.job);actionIntent.current=null;}
    catch(e){setError(e?.status===409?translate('Job state changed. Refresh its progress.'):translate('The job action could not be completed. Retry.'));}
    finally{setBusy(false);}
  }
  const blocked=preview?.blockers?.length>0;
  return <section className="product-service-apply" aria-label={translate('Apply Product services to existing devices')}>
    <h3>{translate('Apply Product services to existing devices')}</h3>
    <p>{translate('Saving Product services creates a new authorization version. Existing devices keep their applied version until you explicitly apply it.')}</p>
    {!canStart&&<p role="status">{translate('Registry selection is not enabled yet. Product writes use legacy service choices.')}</p>}
    <button type="button" disabled={busy||!canStart} onClick={openPreview}>{translate('Preview all existing devices')}</button>
    {error&&<p role="alert">{translate(error)}</p>}
    {preview&&<div className="product-service-apply-preview" role="group" aria-label={translate('Impact preview')}>
      <p><strong>{translate('Target authorization version')} {preview.target_revision}</strong> · {preview.total_devices} {translate('devices')}</p>
      <p>{translate('Permissions to add')}: {previewText(preview.added_options,catalog)} ({preview.added_count})</p>
      <p>{translate('Permissions to remove')}: {previewText(preview.removed_options,catalog)} ({preview.removed_count})</p>
      {blocked?<><p role="alert">{translate('Resolve all blockers before starting the job.')}</p><ul>{preview.blockers.map((blocker,i)=><li key={`${blocker.device_id}-${i}`}>{blocker.device_id}: {translate(blocker.code)}</li>)}</ul></>:null}
      <div className="my-clouds-actions"><button type="button" disabled={busy||blocked||!canStart} onClick={confirm}>{translate('Apply to all existing devices')}</button><button type="button" disabled={busy} onClick={()=>setPreview(null)}>{translate('Cancel')}</button></div>
    </div>}
    {job&&<div className="product-service-apply-progress" role="status">
      <h4>{translate('Product apply job')} · {translate(job.state)}</h4>
      <p>{translate('Target authorization version')} {job.scope?.target_revision} · {job.completed}/{job.total} {translate('applied')} · {job.failed} {translate('failed')}</p>
      <div className="my-clouds-actions"><button type="button" disabled={busy} onClick={()=>setRefresh(value=>value+1)}>{translate('Refresh')}</button>{job.allowed_actions?.includes('pause')&&<button type="button" disabled={busy} onClick={()=>action('pause')}>{translate('Pause')}</button>}{job.allowed_actions?.includes('resume')&&<button type="button" disabled={busy} onClick={()=>action('resume')}>{translate('Resume')}</button>}{job.allowed_actions?.includes('retry')&&<button type="button" disabled={busy} onClick={()=>action('retry')}>{translate('Retry failed devices')}</button>}{job.allowed_actions?.includes('cancel')&&<button type="button" disabled={busy} onClick={()=>action('cancel')}>{translate('Cancel job')}</button>}{terminal.has(job.state)&&<a href={productServiceApplyAPI(cloudId,product.id,job.id)+'/result?format=csv'}>{translate('Download results')}</a>}</div>
      {items?.items?.length>0&&<div className="ui-table-scroll"><table><thead><tr><th>{translate('Device ID')}</th><th>{translate('Status')}</th><th>{translate('Reason')}</th></tr></thead><tbody>{items.items.map(item=><tr key={item.item_key}><td>{item.item_key}</td><td>{translate(item.state)}</td><td>{item.failure_code?translate(item.failure_code):'—'}</td></tr>)}</tbody></table></div>}
      {items?.pagination?.total>25&&<nav className="my-clouds-pagination" aria-label={translate('Result pages')}><button type="button" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-25))}>{translate('Previous')}</button><span>{Math.floor(offset/25)+1} / {Math.ceil(items.pagination.total/25)}</span><button type="button" disabled={offset+25>=items.pagination.total} onClick={()=>setOffset(offset+25)}>{translate('Next')}</button></nav>}
    </div>}
  </section>;
}
