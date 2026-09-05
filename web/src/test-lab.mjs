import { cloudAPI, cloudURL, isCloudID } from './managed-clouds.mjs';

// Keep native selectors simple while incrementally loading the API's pages.
export async function loadLabOptions(fetchPage, key, signal, onItems) {
  const items = new Map();
  for (let offset = 0; !signal.aborted;) {
    const result = await fetchPage(offset);
    if (signal.aborted) return;
    for (const item of result[key]) items.set(item.id, item);
    onItems([...items.values()]);
    offset += result.pagination.limit;
    if (!result[key].length || offset >= result.pagination.total) return;
  }
}

export function testLabURL(cloud, product = '', device = '') {
  if ((product && !isCloudID(product)) || (device && (!product || !isCloudID(device)))) throw new Error('Invalid test scope');
  const query = new URLSearchParams();
  if (product) query.set('product_id', product);
  if (device) query.set('device_id', device);
  return `${cloudURL(cloud)}/test-lab${query.size ? `?${query}` : ''}`;
}

export function testLabContextURL(cloud, product, device, account = '') {
  if (!isCloudID(product) || !isCloudID(device)) throw new Error('Select a Product and device');
  if (account && !isCloudID(account)) throw new Error('Invalid test account');
  return `${cloudAPI(cloud)}/test-lab/context?${new URLSearchParams({ product_id: product, device_id: device, ...(account ? {account_id:account}: {}) })}`;
}

export function parseTestPayload(text) {
  if (new TextEncoder().encode(text).length > 8192) throw new Error('Payload exceeds the 8 KiB lab limit');
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Payload must be a JSON object');
  return value;
}

export function shadowTopic(devid, name = '', operation = 'get') {
  if (!/^[A-Za-z0-9:_-]{1,128}$/.test(devid) || (name && !/^[$A-Za-z0-9:_-]{1,64}$/.test(name)) || !['get', 'update', 'delete'].includes(operation)) throw new Error('Invalid shadow target');
  return `$vc/devices/${devid}/shadow${name ? `/name/${name}` : ''}/${operation}`;
}

export function validatePublishTopic(topic) {
  if (!topic || new TextEncoder().encode(topic).length > 256 || /[+#\u0000-\u001f]/.test(topic) || topic.startsWith('_bc/') || topic.startsWith('$')) throw new Error('Use a non-reserved exact topic; publish wildcards are not allowed');
  return topic;
}

export function labOperationError(operation, status) {
  if (status === 404 && ['shadow_get', 'shadow_delete'].includes(operation)) {
    return {
      message: 'This Shadow does not exist yet. Use Update desired to create it.',
      outcome: 'not_found',
      shadowNotFound: true,
      releaseContext: false,
    };
  }
  return {
    message: `Operation failed${status ? ` (HTTP ${status})` : ''}. Check access, device availability and service configuration.`,
    outcome: 'failed',
    shadowNotFound: false,
    releaseContext: [401, 403, 404, 410].includes(status),
  };
}

// Some broker listeners expose their tenant mountpoint in delivered topics.
// Normalize only this authenticated Cloud; never accept another device/tenant.
export function labIncomingTopic(topic, cloud, devid) {
  if (!isCloudID(cloud) || !/^[A-Za-z0-9:_-]{1,128}$/.test(devid) || typeof topic !== 'string') return null;
  const prefix = `_bc/${cloud}/`;
  const logical = topic.startsWith(prefix) ? topic.slice(prefix.length) : topic;
  if (logical === `devices/${devid}/up/messages`) return logical;
  const root = `$vc/devices/${devid}/shadow/`;
  if (logical.startsWith(root) && /^(?:name\/[$A-Za-z0-9:_-]{1,64}\/)?(?:get|update|delete)\/(?:accepted|rejected|delta|documents)$/.test(logical.slice(root.length))) return logical;
  return null;
}

// Export only a small evidence allowlist. Arbitrary errors, payloads, SDP,
// endpoints and credential objects are never copied into the report.
export function diagnosticReport(context, events) {
  const keys = ['environment', 'brand_cloud_id', 'product_id', 'device_id', 'device_status', 'runtime_ready', 'blocked_reason'];
  const safe = Object.fromEntries(keys.filter(key => Object.hasOwn(context || {}, key)).map(key => [key, context[key]]));
  return { schema_version: 1, generated_at: new Date().toISOString(), context: safe,
    events: events.slice(-500).map(({ time, operation, outcome, status }) => ({ time, operation, outcome, ...(Number.isInteger(status) ? { status } : {}) })) };
}

export function labBlockedMessage(reason) {
  return {
    test_account_required: 'Loading test access from your Console login. Reload if it is unavailable.',
    binding_required: 'Bind this test device to the authorized User Account before testing.',
    provision_required: 'This device is bound but cloud provisioning is not complete. Start or retry Provision from Bound devices.',
    runtime_authorization_unavailable: 'Live tests are unavailable: the device-scoped credential exchange and broker revocation integration are not ready. No live connection has been made.',
    read_only_role: 'Your read-only role does not grant device control or media playback.',
    device_mapping_missing: 'This registry device has no valid Video Cloud identity mapping.',
    device_disabled: 'This device is disabled.',
  }[reason] || 'Live testing is unavailable for this device.';
}
