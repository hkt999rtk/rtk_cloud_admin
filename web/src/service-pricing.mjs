import { billingAPI } from './cloud-billing.mjs';

// Non-price display metadata. Owner-scoped amounts and provider benchmarks are
// returned by the Billing pricing-references API, never shipped in public JS.
export const pricingGroups = ['All services', 'IoT and messaging', 'Live video', 'Storage and delivery', 'Device operations'];
export const pricingSources = {
  iot: { name: 'AWS IoT Core São Paulo price list', url: 'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSIoT/current/sa-east-1/index.csv' },
  transfer: { name: 'AWS Data Transfer São Paulo price list', url: 'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/current/sa-east-1/index.csv' },
  s3: { name: 'AWS S3 São Paulo price list', url: 'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/sa-east-1/index.csv' },
  cloudfront: { name: 'AWS CloudFront price list', url: 'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudFront/current/index.csv' },
  video: { name: 'AWS Kinesis Video Streams TURN pricing', url: 'https://aws.amazon.com/kinesis/video-streams/pricing/' },
  jobs: { name: 'AWS IoT Device Management São Paulo price list', url: 'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/IoTDeviceManagement/current/sa-east-1/index.csv' },
  logs: { name: 'AWS CloudWatch São Paulo price list', url: 'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/sa-east-1/index.csv' },
  api: { name: 'AWS API Gateway São Paulo price list', url: 'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonApiGateway/current/sa-east-1/index.csv' },
};

export const servicePricing = [
  { id: 'mqtt-publish', group: 'IoT and messaging', name: 'MQTT publishes', description: 'Messages accepted from devices or applications.', referenceUnit: '1 million AWS 5 KB message units', priceStatus: 'research', unit: '1 million messages', readiness: 'Usage meter exists', rule: 'Count each accepted publish once. Payload traffic is included; no separate MQTT bandwidth fee.', source: 'iot', comparison: 'São Paulo, first paid tier. AWS rounds by 5 KB units; RTK counts raw accepted publishes, so large messages are not equivalent.' },
  { id: 'mqtt-delivery', group: 'IoT and messaging', name: 'MQTT deliveries', description: 'Messages delivered to subscribers.', referenceUnit: '1 million AWS 5 KB message units', priceStatus: 'research', unit: '1 million deliveries', readiness: 'Usage meter exists', rule: 'One publish to five subscribers counts as one publish plus five deliveries. Each broker delivery is counted.', source: 'iot', comparison: 'São Paulo, first paid tier. AWS also charges publish and delivery separately; its 5 KB units differ from RTK raw deliveries.' },
  { id: 'shadow', group: 'IoT and messaging', name: 'IoT Shadow', description: 'Read, update, delete and list device state.', referenceUnit: '1 million AWS 1 KB operation units', priceStatus: 'research', unit: '1 million operation units', readiness: 'Metering pending', rule: 'Successful operations, rounded up in 1 KiB record or response units. MQTT transport, when used, is counted separately.', source: 'iot', comparison: 'São Paulo reference. AWS lists 1 KB units; equivalence to RTK 1 KiB units is unverified.' },
  { id: 'turn', group: 'Live video', name: 'WebRTC TURN relay', description: 'Live media sent through the cloud relay.', referenceUnit: 'GiB AWS internet transfer', priceStatus: 'research', unit: 'GiB delivered', readiness: 'Metering pending', rule: 'Count bytes sent by TURN to recipients, including each viewer. Relay processing is included. No extra minute or download charge on these bytes. Direct P2P media is free.', source: 'transfer', comparison: 'São Paulo transfer-only proxy. AWS Kinesis Video Streams also bills TURN minutes, which cannot be converted to GiB without bitrate and viewer count.' },
  { id: 'storage', group: 'Storage and delivery', name: 'Video storage', description: 'Stored clips and snapshots.', priceStatus: 'research', unit: 'GiB-month', readiness: 'Metering pending', rule: 'Average stored video bytes over time, prorated by retention. OTA artifacts and logs have separate meters.', source: 's3', comparison: 'São Paulo hot-storage reference. Actual RTK clip byte-time metering still needs qualification.' },
  { id: 'object-write', group: 'Storage and delivery', name: 'Video object writes', description: 'Upload clips and snapshots.', referenceUnit: '1 million S3 PUT requests', priceStatus: 'research', unit: '1 million write operations', readiness: 'Metering pending', rule: 'Count successful video object writes. OTA artifact writes have a separate meter; upload bandwidth is included.', source: 's3', comparison: 'São Paulo reference. Provider PUT requests and successful RTK business writes are related but not identical events.' },
  { id: 'object-read', group: 'Storage and delivery', name: 'Video object reads', description: 'Read video media from storage.', referenceUnit: '1 million S3 GET requests', priceStatus: 'research', unit: '1 million read operations', readiness: 'Metering pending', rule: 'Count successful video object GET and HEAD requests. OTA origin reads and CDN requests are internal costs, not customer read fees.', source: 's3', comparison: 'São Paulo GET reference. RTK includes successful clip HEAD operations, so counted operations differ.' },
  { id: 'download', group: 'Storage and delivery', name: 'Video media downloads', description: 'Cloud-to-app video file delivery.', referenceUnit: 'GiB AWS internet transfer', priceStatus: 'research', unit: 'GiB delivered', readiness: 'Metering pending', rule: 'Count outgoing video media bytes, including retries. OTA uses its separate successful-download meter.', source: 'transfer', comparison: 'São Paulo direct internet egress proxy. Clip delivery bytes need a separate validated RTK fact.' },
  { id: 'ota', group: 'Device operations', name: 'Firmware OTA tasks', description: 'Assign an update task to a target device.', referenceUnit: '1,000 AWS remote actions', priceStatus: 'approved-pending', unit: '1,000 device tasks', readiness: 'Qualification pending', rule: 'Count the first durable assignment per campaign and device, whether it starts from a notification or device poll. Retries add no task fee.', source: 'jobs', comparison: 'AWS Device Jobs São Paulo first paid tier. RTK bills first durable device assignment; the approved OTA price stays separate from this reference.' },
  { id: 'ota-successful-download', group: 'Device operations', name: 'OTA successful downloads', description: 'Firmware artifact verified by a target device.', referenceUnit: 'GiB CDN edge transfer', priceStatus: 'approved-pending', unit: 'GiB verified', readiness: 'Qualification pending', rule: 'Count the release artifact size once on the first authenticated downloaded report for each deployment and exact artifact. Failed transfers, URL grants and Range retries add no customer bytes.', source: 'cloudfront', comparison: 'Selected CloudFront Asian delivery regions outside China. Raw CDN bytes and retries differ from RTK first verified logical download.' },
  { id: 'ota-artifact-storage', group: 'Device operations', name: 'OTA artifact storage', description: 'Firmware objects retained in private storage.', priceStatus: 'approved-pending', unit: 'GiB-month', readiness: 'Qualification pending', rule: 'Integrate actual object bytes over UTC time until physical deletion, including revoked or disabled artifacts. Release metadata alone is insufficient.', source: 's3', comparison: 'São Paulo hot-storage reference. Approved RTK price uses physical OTA object byte-time.' },
  { id: 'ota-artifact-write', group: 'Device operations', name: 'OTA artifact writes', description: 'Successful creation of firmware objects.', referenceUnit: '1 million S3 PUT requests', priceStatus: 'approved-pending', unit: '1 million writes', readiness: 'Qualification pending', rule: 'Count one committed object creation by immutable object key or version. Failed PUTs and retries without a new object are excluded.', source: 's3', comparison: 'São Paulo reference. Provider PUT requests also include events that are not RTK successful object creations.' },
  { id: 'log-ingest', group: 'Device operations', name: 'Device and application logs', description: 'Ingest runtime logs for diagnosis.', priceStatus: 'research', unit: 'GiB ingested', readiness: 'Usage totals exist', rule: 'Use accepted, uncompressed log bytes including metadata. Retention is charged separately. MQTT transport, when used, retains its message fee.', source: 'logs', comparison: 'CloudWatch São Paulo reference. RTK has ingestion totals, but generic invoice integration still needs qualification.' },
  { id: 'log-retention', group: 'Device operations', name: 'Log retention', description: 'Keep runtime logs available for review.', referenceUnit: 'GiB-month compressed archive', priceStatus: 'research', unit: 'GiB-month', readiness: 'Usage totals exist', rule: 'Use recorded log bytes × configured retention days / 30. This proposal follows the existing retention estimate, not compressed archive size.', source: 'logs', comparison: 'CloudWatch São Paulo proxy. RTK uses accepted uncompressed bytes × configured days / 30, so billable quantities differ.' },
  { id: 'api', group: 'Device operations', name: 'Application API requests', description: 'Other device and application data API calls.', referenceUnit: '1 million AWS REST requests', priceStatus: 'research', unit: '1 million requests', readiness: 'Metering pending', rule: 'Count successful data API requests only. Excludes Shadow, WebRTC signaling, OTA task dispatch and object operations already covered above. Console administration and authentication are included.', source: 'api', comparison: 'API Gateway São Paulo first paid tier. RTK counts only successful classified data routes.' },
];

const invalidCatalog = () => Object.assign(new Error('Invalid service pricing response'), { status: 502 });

export function mergeServicePricingCatalog(payload, cloudId, locale = 'en') {
  const catalog = payload?.catalog;
  if (payload?.cloud_id !== cloudId || catalog?.currency !== 'TWD' || !/^\d{4}-\d{2}-\d{2}$/.test(catalog.reference_date || '') || !Array.isArray(catalog.rows) || catalog.rows.length !== servicePricing.length) throw invalidCatalog();
  const rates = new Map();
  for (const rate of catalog.rows) {
    if (rates.has(rate.id) || !servicePricing.some(row => row.id === rate.id) || !Number.isFinite(rate.reference_price) || rate.reference_price <= 0 || (rate.price !== null && (!Number.isFinite(rate.price) || rate.price <= 0)) || typeof rate.benchmark !== 'string' || !rate.benchmark.trim() || (locale !== 'en' && (typeof rate.benchmark_localized !== 'string' || !rate.benchmark_localized.trim()))) throw invalidCatalog();
    rates.set(rate.id, rate);
  }
  const rows = servicePricing.map(row => {
    const rate = rates.get(row.id);
    if (!rate || (row.priceStatus === 'approved-pending') !== (rate.price !== null)) throw invalidCatalog();
    return { ...row, price: rate.price, referencePrice: rate.reference_price, benchmark: locale === 'en' ? rate.benchmark : rate.benchmark_localized };
  });
  const fxNote = locale === 'en' ? catalog.fx_note : catalog.fx_note_localized;
  if (typeof fxNote !== 'string' || !fxNote.trim()) throw invalidCatalog();
  return { currency: catalog.currency, referenceDate: catalog.reference_date, fxNote, rows };
}

export async function fetchServicePricing(cloudId, ownershipVersion, locale, { signal, fetcher = fetch } = {}) {
  const response = await fetcher(billingAPI(cloudId, '/api/billing/pricing-references'), {
    signal,
    cache: 'no-store',
    headers: { 'X-RTK-Locale': locale },
  });
  if (!response.ok) throw Object.assign(new Error('Service pricing unavailable'), { status: response.status });
  if (response.headers.get('X-Cloud-Ownership-Version') !== String(ownershipVersion)) throw Object.assign(new Error('Cloud ownership changed'), { status: 409 });
  return mergeServicePricingCatalog(await response.json(), cloudId, locale);
}
