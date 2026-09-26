import { cloudAPI, cloudURL, managedCloudRequest } from './managed-clouds.mjs';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const legacyProductOptions = [
  {code:'mqtt',display_name:'MQTT',selectable:true,requires:[]},
  {code:'video_streaming',display_name:'Video streaming',selectable:true,requires:[]},
  {code:'video_storage',display_name:'Video storage',selectable:true,requires:[]},
];
export async function fetchCloudServiceCatalog(cloudId,{signal}={}) {
  const result=await managedCloudRequest(cloudAPI(cloudId)+'/service-options',{signal});
  if(!Number.isSafeInteger(result?.catalog_revision)||result.catalog_revision<1||!Array.isArray(result?.options)||result.options.some(option=>!option||typeof option.code!=='string'||typeof option.display_name!=='string'||typeof option.selectable!=='boolean'||(option.requires!==undefined&&!Array.isArray(option.requires)))) throw {status:502};
  // Keep legacy writes separate from the live catalog during the rollout.
  return {...result,options:result.options.map(option=>({...option,requires:option.requires||[]})),legacy_options:legacyProductOptions};
}
export function productAPI(cloudId, productId='') {
  if (productId && !uuid.test(productId)) throw new Error('Invalid Product ID');
  return cloudAPI(cloudId)+'/products'+(productId ? '/'+productId : '');
}
export function productURL(cloudId,productId) {
  if (!uuid.test(productId)) throw new Error('Invalid Product ID');
  return cloudURL(cloudId)+'/products/'+productId;
}
export function productServiceApplyAPI(cloudId,productId,jobId='') {
  if(!uuid.test(productId) || (jobId && !/^job-[0-9a-f]{24}$/.test(jobId))) throw new Error('Invalid Product apply scope');
  return productAPI(cloudId,productId)+'/service-apply-jobs'+(jobId?'/'+jobId:'');
}
export async function fetchProductServiceApplyPreview(cloudId,productId,{signal}={}) {
  const result=await managedCloudRequest(productAPI(cloudId,productId)+'/service-apply-preview',{signal});
  if(!result||typeof result.preview_token!=='string'||!Number.isSafeInteger(result.target_revision)||result.target_revision<1||!Number.isSafeInteger(result.total_devices)||result.total_devices<0||!Array.isArray(result.blockers)) throw {status:502};
  return result;
}
export async function fetchProductServiceApplyJobs(cloudId,productId,{signal}={}) {
  const result=await managedCloudRequest(productServiceApplyAPI(cloudId,productId),{signal});
  if(!Array.isArray(result?.jobs)) throw {status:502};
  return result.jobs;
}
export async function fetchProductServiceApplyJob(cloudId,productId,jobId,{signal}={}) {
  const result=await managedCloudRequest(productServiceApplyAPI(cloudId,productId,jobId),{signal});
  if(result?.job?.id!==jobId||result.job?.type!=='product_services_apply') throw {status:502};
  return result.job;
}
export async function fetchProductServiceApplyItems(cloudId,productId,jobId,{offset=0,signal}={}) {
  const query=new URLSearchParams({limit:'25',offset:String(offset)});
  const result=await managedCloudRequest(productServiceApplyAPI(cloudId,productId,jobId)+'/items?'+query,{signal});
  if(!Array.isArray(result?.items)||result.pagination?.offset!==offset||!Number.isSafeInteger(result.pagination?.total)) throw {status:502};
  return result;
}
export function productInvitationDestination(result) {
  const cloud=result?.invitation?.brand_cloud_id, product=result?.invitation?.product_id;
  if(!uuid.test(cloud||'')) return '/console/clouds';
  return uuid.test(product||'')?productURL(cloud,product):cloudURL(cloud);
}
export async function fetchCloudProducts(cloudId, productId, {offset=0,status='',signal}={}) {
  const query = new URLSearchParams({limit:'25',offset:String(offset)});
  if(status) query.set('status',status);
  const result=await managedCloudRequest(productAPI(cloudId,productId)+(productId?'':'?'+query),{signal});
  const items=productId?[result.product]:result.products;
  if(!Array.isArray(items) || items.some(p=>!p || !uuid.test(p.id) || p.brand_cloud_id!==cloudId || (productId && p.id!==productId))) throw {status:502};
  if(!productId && (!result.pagination || result.pagination.offset!==offset || result.pagination.limit!==25 || !Number.isSafeInteger(result.pagination.total) || result.pagination.total<0)) throw {status:502};
  return {...result,products:items};
}
export function productError(error) {
  if(error?.status===401) return 'Your session expired. Sign in again.';
  if([403,404].includes(error?.status)) return 'Product access is unavailable or has been revoked.';
  if(error?.status===409) return 'The Product conflicts with current cloud state. Refresh before retrying; a previous request may already have completed.';
  if([400,422].includes(error?.status)) return 'Check the Product name, key, category and service options.';
  return 'Product data is temporarily unavailable. Refresh to retry.';
}
