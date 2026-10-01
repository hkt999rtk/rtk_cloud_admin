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

// Display request and task prices at a readable proportional denominator.
// The Billing API still supplies the exact price for one underlying unit.
export function displayEffectiveRate(rate) {
  const multiplier = rate.unit === 'requests' || rate.unit === 'units' ? 1_000_000 : rate.unit === 'tasks' ? 1_000 : 1;
  const unit = rate.unit === 'requests' ? '1 million requests' : rate.unit === 'units' ? '1 million operation units' : rate.unit === 'tasks' ? '1,000 device tasks' : rate.unit;
  return { amount: rate.unit_price_minor / 10 ** rate.unit_price_scale * multiplier, unit };
}

const effectiveRateNames = {
  'mqtt/publish_count': 'MQTT publishes',
  'mqtt/delivery_count': 'MQTT deliveries',
  'shadow/operation_units': 'IoT Shadow',
  'webrtc/turn_relay_gib': 'WebRTC TURN relay',
  'storage/clip_storage_gib_month': 'Video storage',
  'storage/clip_object_write': 'Video object writes',
  'storage/clip_object_read': 'Video object reads',
  'storage/clip_download_gib': 'Video media downloads',
  'ota/device_task': 'Firmware OTA tasks',
  'ota/successful_download_gib': 'OTA successful downloads',
  'ota/artifact_storage_gib_month': 'OTA artifact storage',
  'ota/artifact_write': 'OTA artifact writes',
  'logger/ingest_gib': 'Device and application logs',
  'logger/retained_gib_month': 'Log retention',
  // Display already-published legacy cards without rewriting their meter identity.
  'logger/retention_gib_month': 'Log retention',
  'api/data_request': 'Application API requests',
};

export function effectiveRateLabel(rate) {
  return effectiveRateNames[`${rate.service_code}/${rate.metric_code}`] || rate.description;
}

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
  { id: 'log-ingest', group: 'Device operations', name: 'Device and application logs', description: 'Ingest runtime logs for diagnosis.', priceStatus: 'research', unit: 'GiB ingested', readiness: 'Usage totals exist', rule: 'Count accepted, uncompressed log bytes including metadata. Rejected logs are not charged. Retention is charged separately; MQTT transport keeps its own message fee.', source: 'logs', comparison: 'CloudWatch São Paulo reference. RTK counts accepted log bytes, and the monthly source-to-invoice path requires qualification.' },
  { id: 'log-retention', group: 'Device operations', name: 'Log retention', description: 'Keep runtime logs available for review.', referenceUnit: 'GiB-month compressed archive', priceStatus: 'research', unit: 'GiB-month', readiness: 'Usage totals exist', rule: 'Sum accepted uncompressed log bytes × retained time within each UTC month / 30 days. Retained time runs from acceptance to recorded expiry; time crossing a month boundary is split between months. Rejected logs and compressed archive size are excluded.', source: 'logs', comparison: 'CloudWatch São Paulo proxy. RTK uses accepted uncompressed byte-time normalized by 30 days; AWS uses compressed archive bytes, so quantities differ.' },
  { id: 'api', group: 'Device operations', name: 'Application API requests', description: 'Other device and application data API calls.', referenceUnit: '1 million AWS REST requests', priceStatus: 'research', unit: '1 million requests', readiness: 'Metering pending', rule: 'Count successful data API requests only. Excludes Shadow, WebRTC signaling, OTA task dispatch and object operations already covered above. Console administration and authentication are included.', source: 'api', comparison: 'API Gateway São Paulo first paid tier. RTK counts only successful classified data routes.' },
];

const invalidCatalog = () => Object.assign(new Error('Invalid service pricing response'), { status: 502 });

export function mergeServicePricingCatalog(payload, cloudId, locale = 'en') {
  const catalog = payload?.catalog;
  const referenceDate = catalog?.reference_date;
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(referenceDate || '') ? new Date(`${referenceDate}T00:00:00Z`) : null;
  if (payload?.cloud_id !== cloudId || catalog?.currency !== 'TWD' || !parsedDate || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== referenceDate || !Array.isArray(catalog.rows) || catalog.rows.length !== servicePricing.length) throw invalidCatalog();
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

export function validateEffectivePricing(payload, cloudId) {
  const book = payload?.price_book;
  if (payload?.cloud_id !== cloudId || book?.currency !== 'TWD' ||
      !Number.isFinite(Date.parse(book.as_of)) ||
      !['not_priced', 'provisional', 'held_for_review'].includes(book.ota_eligibility)) throw invalidCatalog();
  for (const version of [book.current, book.upcoming]) {
    if (version === null) continue;
    if (!version || !version.id || version.currency !== 'TWD' || !Number.isFinite(Date.parse(version.effective_from)) ||
        !Array.isArray(version.rates) || version.rates.length === 0) throw invalidCatalog();
    const identities = new Set();
    for (const rate of version.rates) {
      const key = `${rate.service_code}\0${rate.metric_code}\0${rate.unit}`;
      if (!rate.service_code || !rate.metric_code || !rate.unit || !rate.description || identities.has(key) ||
          !Number.isSafeInteger(rate.unit_price_minor) || rate.unit_price_minor < 0 ||
          !Number.isInteger(rate.unit_price_scale) || rate.unit_price_scale < 0 || rate.unit_price_scale > 9 ||
          !['half_up', 'down', 'up'].includes(rate.rounding_mode)) throw invalidCatalog();
      identities.add(key);
    }
    if (version.tax_mode === 'invoice_total' &&
        (!Number.isInteger(version.invoice_tax_rate_basis_points) || version.invoice_tax_rate_basis_points < 0 ||
         version.invoice_tax_rate_basis_points > 10000 || !['half_up', 'down', 'up'].includes(version.invoice_tax_rounding_mode))) throw invalidCatalog();
  }
  return book;
}

export async function fetchEffectivePricing(cloudId, ownershipVersion, { signal, fetcher = fetch } = {}) {
  const response = await fetcher(billingAPI(cloudId, '/api/billing/pricing-effective'), { signal, cache: 'no-store' });
  if (!response.ok) throw Object.assign(new Error('Effective pricing unavailable'), { status: response.status });
  if (response.headers.get('X-Cloud-Ownership-Version') !== String(ownershipVersion)) throw Object.assign(new Error('Cloud ownership changed'), { status: 409 });
  return validateEffectivePricing(await response.json(), cloudId);
}

// Billing owns the rate switch; this timer only invalidates the displayed snapshot.
export function watchEffectivePricing(book, refresh, browser = globalThis) {
  const now = browser.Date.now();
  const today = new Date(now);
  let next = Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1);
  for (const value of [book?.upcoming?.effective_from, book?.current?.effective_until]) {
    const boundary = Date.parse(value);
    if (Number.isFinite(boundary) && boundary > now) next = Math.min(next, boundary);
  }
  let active = true;
  const refreshVisible = () => { if (active && browser.document.visibilityState !== 'hidden') refresh(); };
  // Longer months exceed the browser's signed 32-bit timeout limit.
  const timer = browser.setTimeout(refreshVisible, Math.min(next - now + 1, 2_147_483_647));
  browser.addEventListener('focus', refreshVisible);
  browser.document.addEventListener('visibilitychange', refreshVisible);
  return () => {
    active = false;
    browser.clearTimeout(timer);
    browser.removeEventListener('focus', refreshVisible);
    browser.document.removeEventListener('visibilitychange', refreshVisible);
  };
}
