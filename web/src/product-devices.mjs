import {productAPI,productURL} from './cloud-products.mjs';
import {managedCloudRequest} from './managed-clouds.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function deviceAPI(cloud,product,device='') {
 if(!uuid.test(product)|| (device&&!uuid.test(device))) throw new Error('Invalid device scope');
 return productAPI(cloud,product)+'/devices'+(device?'/'+device:'');
}
export function deviceURL(cloud,product,device) {
 if(!uuid.test(device))throw new Error('Invalid device ID');
 return productURL(cloud,product)+'/devices/'+device;
}
export async function fetchProductDevices(cloud,product,device='',{offset=0,q='',signal}={}) {
 const query=new URLSearchParams({limit:'25',offset:String(offset),...(q?{q}:{})});
 const result=await managedCloudRequest(deviceAPI(cloud,product,device)+(device?'':'?'+query),{signal});
 const devices=device?[result.device]:result.devices;
 const seen=new Set();
 if(!Array.isArray(devices)||devices.some(d=>{if(!d||!uuid.test(d.id)||d.brand_cloud_id!==cloud||d.product_id!==product||(device&&d.id!==device)||seen.has(d.id))return true;seen.add(d.id);return false;}))throw {status:502};
 if(!device&&(!result.pagination||result.pagination.limit!==25||result.pagination.offset!==offset||!Number.isSafeInteger(result.pagination.total)||result.pagination.total<0||devices.length>25||(devices.length>0&&result.pagination.total<offset+devices.length)))throw {status:502};
 return {...result,devices};
}
export function deviceError(e) {
 if(e?.status===401)return 'Your session expired. Sign in again.';
 if([403,404].includes(e?.status))return 'Device access is unavailable or has been revoked.';
 if(e?.status===409)return 'The device or cloud changed. Refresh before retrying.';
 if([400,422].includes(e?.status))return 'Check the device name and model.';
 return 'Device data is unavailable. Refresh to retry.';
}
