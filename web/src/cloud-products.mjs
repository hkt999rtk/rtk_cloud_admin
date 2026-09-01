import { cloudAPI, cloudURL, managedCloudRequest } from './managed-clouds.mjs';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const productServices = [['mqtt','MQTT'],['video_streaming','Video streaming'],['video_storage','Video storage']];
export function productAPI(cloudId, productId='') {
  if (productId && !uuid.test(productId)) throw new Error('Invalid Product ID');
  return cloudAPI(cloudId)+'/products'+(productId ? '/'+productId : '');
}
export function productURL(cloudId,productId) {
  if (!uuid.test(productId)) throw new Error('Invalid Product ID');
  return cloudURL(cloudId)+'/products/'+productId;
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
