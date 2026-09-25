# Managed Cloud service pricing proposal

Research date: 2026-09-06. TWD proposal updated: 2026-09-25. Status: draft for review; no active pricing plan,
database migration, charging policy or payment configuration is created by this
page. Customer UI: Billing > Service Pricing, `/console/clouds/{id}/billing/pricing`.

## Pricing basis

This is an initial retail proposal, not a measured profitability claim. Public
provider prices are useful anchors but exclude differences in support, SLAs,
regions, free allowances, committed-use discounts and platform overhead. The
TWD rate card converts the 2026-09-06 USD retail draft at a fixed planning rate
of US$1 = NT$32. The rate was chosen for a reproducible proposal, with the
[Bank of Taiwan 2026-09-24 USD spot quote](https://rate.bot.com.tw/xrt/quote/ltm/USD?Lang=en-US)
retained as context; it is not a payment-time exchange rate. Unit prices can
have decimal precision, but TWD invoices and balances are rounded integer NT$
amounts after monthly aggregation. Proposed amounts are before tax, with no
recurring platform fee or free usage allowance assumed. Private Cloud requires
separate sizing and a quote.

RTK byte units are GiB (2^30 bytes) and KiB (2^10 bytes). Public GB/KB labels stay
as published; they are not silently treated as identical. Per-million prices
describe a proportional rate, not minimum purchase blocks. Aggregate a month's
usage before rounding money. Actual rounding, tax, rate activation, tenant
scope, validated metering and margin review belong in an approved Billing plan.

## Service inventory and proposed price

| Service | 2026-09-06 USD draft | 2026-09-24 TWD proposal | Existing source evidence | Billing readiness |
| --- | ---: | ---: | --- | --- |
| MQTT publishes | US$1.00 / million | NT$32 / million messages | `rtk_video_cloud/internal/usage/event.go`, `mqtt_adapter.go`: `mqtt.publish_count`, unit `requests` | Generic usage metric exists; validate live ingestion and activate an approved rate first |
| MQTT deliveries | US$1.00 / million | NT$32 / million deliveries | Same registry: `mqtt.delivery_count`; bytes are also measured | Same as publishes; fan-out counts each delivery |
| IoT Shadow | US$1.25 / million | NT$40 / million 1 KiB operation units | `rtk_cloud_contracts_doc/device_shadow.md`; `rtk_video_cloud/internal/deviceshadow/`, `internal/httpapi/device_shadow.go` | Service exists; no Shadow metric in the generic Billing registry |
| TURN relay | US$0.03 / GiB | NT$0.96 / GiB delivered | `rtk_cloud_contracts_doc/streaming.md`; `rtk_video_cloud/internal/turnregistry/` and coturn deployment | Need authoritative per-Cloud relay-byte facts; operational counters alone are insufficient |
| Video clip storage | US$0.03 / GiB-month | NT$0.96 / GiB-month | Clip metadata/blob storage, `rtk_video_cloud/internal/clip/` | Need time-weighted per-Cloud object-byte facts |
| Clip object writes | US$4.50 / million | NT$144 / million operations | Clip upload/storage flow | Need successful clip object-operation facts |
| Clip object reads | US$0.40 / million | NT$12.8 / million operations | Clip retrieval flow | Need per-Cloud clip origin-read facts |
| Clip media downloads | US$0.03 / GiB | NT$0.96 / GiB delivered | Clip retrieval and blob storage | Need clip delivery evidence at the actual data path |
| OTA device tasks | [AWS Jobs benchmark](https://aws.amazon.com/iot-device-management/pricing/) US$3.00 / 1,000 | NT$96 / 1,000 first assignments | `rtk_video_cloud/internal/productota/`; canonical [OTA contract](../../rtk_cloud_contracts_doc/ota_delivery_and_billing.md) | Local durable first-assignment receipt and outbox are implemented; staging qualification and rate activation remain |
| OTA successful downloads | Provider delivery cost is not an equivalent device-completion price | NT$0.96 / GiB of verified logical artifact length | Authenticated `downloaded` event tied to deployment and exact artifact SHA/size | Local receipt and outbox are implemented; staging CDN reconciliation remains; no charge for URL issuance, failed transfer or Range retry |
| OTA artifact storage | Akamai Object Storage infrastructure anchor, not a managed-service retail quote | NT$0.96 / GiB-month | Physical object byte-time through confirmed deletion, including revoked or disabled Products | Local object ledger, inventory and sealed monthly fact are implemented; staging qualification remains |
| OTA artifact writes | Object-store operation anchor, not a managed-service retail quote | NT$144 / million successful object creations | Confirmed private-origin object creation | Local receipt, outbox and crash reconciliation are implemented; staging qualification remains |
| Device / application log ingestion | US$0.30 / GiB | NT$9.6 / GiB | `rtk_video_cloud/internal/logusage/usage.go`, `internal/devicelog/billing.go` | Per-Cloud byte/event totals exist; generic invoicing integration must be qualified |
| Log retention | US$0.03 / GiB-month | NT$0.96 / GiB-month | `logusage.RetentionGBMonth`: ingested bytes × retention days / 30 | Existing retention estimate, not measurement of compressed bytes physically retained |
| Other application data APIs | US$1.00 / million | NT$32 / million requests | `rtk_video_cloud/internal/httpapi/` | Requires explicit route classification and success-based per-Cloud usage facts |

MQTT is explicitly the first metered service in the canonical
`rtk_cloud_contracts_doc/billing_usage.md`. Do not label every implemented service
as ready for charging. The live audit preceding this change found no configured
pricing versions and no Billing usage facts for the inspected Cloud at that time; the static
proposal must not imply otherwise or pretend to reflect that Cloud's usage.

## Public benchmarks and rationale

- [AWS IoT Core](https://aws.amazon.com/iot-core/pricing/): Ireland's example
  charges USD 1/million MQTT message units for the first billion; units are 5 KB
  and publishes and deliveries are separate. Canada Central's Shadow example
  charges USD 1.25/million 1 KB operation units. Connectivity in the N. Virginia
  example is USD 0.08/million connection-minutes. Proposed RTK MQTT NT$32 and Shadow
  NT$40 per million use the fixed planning conversion. RTK's current raw MQTT counters
  cannot reproduce per-message 5 KB rounding, so the proposal deliberately
  charges raw messages with payload traffic included. Validate large-message
  unit economics and payload limits before approval. Connections are included.
- [AWS Kinesis Video Streams](https://aws.amazon.com/kinesis/video-streams/pricing/):
  US East lists USD 0.03/active signaling channel-month, USD 2.25/million
  signaling messages and USD 0.12/1,000 TURN minutes, with internet transfer
  extra. RTK proposes no separate signaling/channel charge and NT$0.96/GiB TURN
  egress including relay processing. Minutes and bytes are different meters;
  a price ranking is inappropriate without bitrate and fan-out assumptions.
- [Cloudflare R2](https://developers.cloudflare.com/r2/pricing/): Standard
  storage USD 0.015/GB-month, Class A USD 4.50/million, Class B USD 0.36/million,
  zero internet egress. RTK's NT$0.96/144/12.8 storage/write/read proposals sit
  at or above these unit cost anchors. Class A covers more than writes. Unlike R2,
  this proposal separately prices managed file delivery.
- [Akamai Cloud](https://www.akamai.com/cloud/pricing): Object Storage lists
  USD 0.02/GB-month with a USD 5 minimum below 250 GB; first 1 TB/month object
  egress is included, then USD 0.005/GB. Core compute egress over allowance is
  USD 0.005/GB; distributed regions USD 0.01/GB. These are infrastructure
  anchors, not complete RTK service costs. A NT$0.96/GiB relay/download proposal
  leaves nominal room over bandwidth cost, but shared compute, retries, peak
  capacity and support still require a measured margin check.
- [AWS IoT Device Management](https://aws.amazon.com/iot-device-management/pricing/):
  Device Jobs' first 250,000 remote actions cost USD 0.003 each in its example.
  For 1,000 actions the benchmark is USD 3; propose NT$96. Count
  the first durable assignment for each campaign/device, not repeated
  notification attempts or polling. OTA customer charges add verified logical
  downloads, physical artifact storage and successful object creations; OTA
  object GETs and raw CDN egress remain internal provider costs.
- [Akamai Object Storage pricing](https://techdocs.akamai.com/cloud-computing/docs/object-storage-pricing)
  informs infrastructure cost only. Its
  [object access logs](https://techdocs.akamai.com/cloud-computing/docs/logs-for-object-storage)
  do not cover reads, so they cannot prove device downloads. CDN
  [DataStream fields](https://techdocs.akamai.com/datastream2/reference/data-set-parameters-api)
  support cost and anomaly reconciliation, but their request/Range records
  are not the customer successful-download meter. The customer meter uses
  an authenticated exact-artifact `downloaded` event.
- [CloudWatch](https://aws.amazon.com/cloudwatch/pricing/): US East examples
  use USD 0.50/GB log ingestion and USD 0.03/GB-month archived. Propose NT$9.6
  ingestion and NT$0.96 retention for the more focused device/app log service.
  AWS archived bytes are compressed; RTK's existing retention estimate is not,
  so the bases differ. This is not a claim of equivalent search or analytics.
- [API Gateway](https://aws.amazon.com/api-gateway/pricing/): the HTTP API
  example charges USD 1/million for the first 300 million calls, excluding
  possible backend and transfer costs. Propose NT$32/million other successful
  application data API calls; exclude operations covered by another tariff.

## Avoid duplicate charges

1. MQTT uses publish and delivery counters. Do not add `publish_bytes` or
   `delivery_bytes` as a second fee under this proposal. Keep-alives are included.
2. Shadow is separate state processing; when transported over MQTT, broker
   publish/delivery fees still apply. HTTP Shadow calls have no extra API fee.
3. WebRTC has no extra signaling fee; MQTT transport is charged when used.
   Direct P2P media uses no relay transfer. TURN egress and file delivery are
   disjoint byte categories. Count bytes sent to every recipient once.
4. Logs have ingestion and retention charges, not the object storage tariffs.
   Their MQTT transport still has its message charge when used.
5. Generic API charges exclude Shadow, WebRTC signaling, OTA dispatch and object
   operations. Console administration and authentication remain included.
6. Example on the page uses 1M publishes + 5M deliveries + 1M HTTP Shadow units:
   32 + 160 + 40 = NT$232 before tax. It is illustrative, not fetched usage.
7. OTA uses four customer meters: first device assignment, first verified
   artifact download, stored OTA byte-time, and successful OTA object creation.
   Do not apply clip object-read or clip delivery rates to OTA; Akamai CDN
   edge bytes, cache status and Range requests serve internal cost review.

## UI verification

The page leads with a prominent TWD monthly example total and its three usage
inputs, followed by service rates and counting rules. The estimate is explicitly
illustrative and must never be presented as actual Cloud spend.

Check tab navigation, direct `/billing/pricing` loading, browser history, group
filters, reference links and mobile overflow. The pricing proposal uses the same
Cloud owner authorization as Billing but does not require accounting endpoints
to succeed. Returning to account views fetches real Billing data again.
