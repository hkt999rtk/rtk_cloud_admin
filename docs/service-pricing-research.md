# Managed Cloud service pricing proposal

Research date: 2026-09-06. Status: draft for review; no active pricing plan,
database migration, charging policy or payment configuration is created by this
page. Customer UI: Billing > Service Pricing, `/console/clouds/{id}/billing/pricing`.

## Pricing basis

This is an initial retail proposal, not a measured profitability claim. Public
provider prices are useful anchors but exclude differences in support, SLAs,
regions, free allowances, committed-use discounts and platform overhead. A
planning conversion of USD 1 = TWD 32 is an explicit assumption, not a live FX
quote. The USD rate card preserves the original proposal amounts using that fixed
conversion (each original TWD price divided by 32), with up to five decimal
places for unit rates. Example totals are rounded to USD cents after calculation.
RTK proposed amounts are in USD before tax, with no recurring platform fee or
free usage allowance assumed. Private Cloud requires separate sizing and a quote.

RTK byte units are GiB (2^30 bytes) and KiB (2^10 bytes). Public GB/KB labels stay
as published; they are not silently treated as identical. Per-million prices
describe a proportional rate, not minimum purchase blocks. Aggregate a month's
usage before rounding money. Actual rounding, tax, rate activation, tenant
scope, validated metering and margin review belong in an approved Billing plan.

## Service inventory and proposed price

| Service | Proposed USD price | Existing source evidence | Billing readiness |
| --- | --- | --- | --- |
| MQTT publishes | 0.9375 / million messages | `rtk_video_cloud/internal/usage/event.go`, `mqtt_adapter.go`: `mqtt.publish_count`, unit `requests` | Generic usage metric exists; validate live ingestion and activate an approved rate first |
| MQTT deliveries | 0.9375 / million deliveries | Same registry: `mqtt.delivery_count`; bytes are also measured | Same as publishes; fan-out counts each delivery |
| IoT Shadow | 1.25 / million 1 KiB operation units | `rtk_cloud_contracts_doc/device_shadow.md`; `rtk_video_cloud/internal/deviceshadow/`, `internal/httpapi/device_shadow.go` | Service exists; no Shadow metric in the generic Billing registry |
| TURN relay | 0.03125 / GiB delivered | `rtk_cloud_contracts_doc/streaming.md`; `rtk_video_cloud/internal/turnregistry/` and coturn deployment | Need authoritative per-Cloud relay-byte facts; operational counters alone are insufficient |
| Video / firmware storage | 0.03125 / GiB-month | Clip metadata/blob storage and firmware catalog; `rtk_video_cloud/internal/clip/`, `internal/firmware/` | Need time-weighted per-Cloud object-byte facts |
| Object writes | 4.6875 / million operations | Clip and firmware upload/storage flows | Need successful object and multipart-operation facts |
| Object reads | 0.46875 / million operations | Clip retrieval and firmware download flows | Need per-Cloud origin read facts, including range requests |
| Media / firmware downloads | 0.03125 / GiB delivered | Clip retrieval, firmware download URLs, blob storage | Need delivery evidence at the actual data path, not URL issuance counts |
| Firmware OTA tasks | 3.125 / 1,000 device tasks | `rtk_video_cloud/internal/productota/`, `internal/httpapi/product_ota.go`, `rtk_cloud_contracts_doc/product_ota_migration.md` | Campaign/device state exists; dispatched task deduplication and Billing integration still needed |
| Device / application log ingestion | 0.3125 / GiB | `rtk_video_cloud/internal/logusage/usage.go`, `internal/devicelog/billing.go` | Per-Cloud byte/event totals exist; generic invoicing integration must be qualified |
| Log retention | 0.03125 / GiB-month | `logusage.RetentionGBMonth`: ingested bytes × retention days / 30 | Existing retention estimate, not measurement of compressed bytes physically retained |
| Other application data APIs | 0.9375 / million requests | `rtk_video_cloud/internal/httpapi/` | Requires explicit route classification and success-based per-Cloud usage facts |

MQTT is explicitly the first metered service in the canonical
`rtk_cloud_contracts_doc/billing_usage.md`. Do not label every implemented service
as ready for charging. The live audit preceding this change found no configured
pricing versions and no Billing usage facts for the inspected Cloud; the static
proposal must not imply otherwise or pretend to reflect that Cloud's usage.

## Public benchmarks and rationale

- [AWS IoT Core](https://aws.amazon.com/iot-core/pricing/): Ireland's example
  charges USD 1/million MQTT message units for the first billion; units are 5 KB
  and publishes and deliveries are separate. Canada Central's Shadow example
  charges USD 1.25/million 1 KB operation units. Connectivity in the N. Virginia
  example is USD 0.08/million connection-minutes. Suggested MQTT USD 0.9375 and Shadow
  USD 1.25 stay near these small-message anchors. RTK's current raw MQTT counters
  cannot reproduce per-message 5 KB rounding, so the proposal deliberately
  charges raw messages with payload traffic included. Validate large-message
  unit economics and payload limits before approval. Connections are included.
- [AWS Kinesis Video Streams](https://aws.amazon.com/kinesis/video-streams/pricing/):
  US East lists USD 0.03/active signaling channel-month, USD 2.25/million
  signaling messages and USD 0.12/1,000 TURN minutes, with internet transfer
  extra. RTK proposes no separate signaling/channel charge and USD 0.03125/GiB TURN
  egress including relay processing. Minutes and bytes are different meters;
  a price ranking is inappropriate without bitrate and fan-out assumptions.
- [Cloudflare R2](https://developers.cloudflare.com/r2/pricing/): Standard
  storage USD 0.015/GB-month, Class A USD 4.50/million, Class B USD 0.36/million,
  zero internet egress. RTK's USD 0.03125/4.6875/0.46875 storage/write/read proposals round
  above these unit cost anchors. Class A covers more than writes. Unlike R2,
  this proposal separately prices managed file delivery.
- [Akamai Cloud](https://www.akamai.com/cloud/pricing): Object Storage lists
  USD 0.02/GB-month with a USD 5 minimum below 250 GB; first 1 TB/month object
  egress is included, then USD 0.005/GB. Core compute egress over allowance is
  USD 0.005/GB; distributed regions USD 0.01/GB. These are infrastructure
  anchors, not complete RTK service costs. A USD 0.03125/GiB relay/download proposal
  leaves nominal room over bandwidth cost, but shared compute, retries, peak
  capacity and support still require a measured margin check.
- [AWS IoT Device Management](https://aws.amazon.com/iot-device-management/pricing/):
  Device Jobs' first 250,000 remote actions cost USD 0.003 each in its example.
  For 1,000 actions the benchmark is USD 3; propose USD 3.125. Count
  the first dispatch of each device task, not repeated retry attempts. Charge
  firmware storage, reads and actual delivery bytes separately.
- [CloudWatch](https://aws.amazon.com/cloudwatch/pricing/): US East examples
  use USD 0.50/GB log ingestion and USD 0.03/GB-month archived. Propose USD 0.3125
  ingestion and USD 0.03125 retention for the more focused device/app log service.
  AWS archived bytes are compressed; RTK's existing retention estimate is not,
  so the bases differ. This is not a claim of equivalent search or analytics.
- [API Gateway](https://aws.amazon.com/api-gateway/pricing/): the HTTP API
  example charges USD 1/million for the first 300 million calls, excluding
  possible backend and transfer costs. Propose USD 0.9375/million other successful
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
   0.9375 + 4.6875 + 1.25 = USD 6.875, displayed as USD 6.88 before tax. It is illustrative, not fetched usage.

## UI verification

Check tab navigation, direct `/billing/pricing` loading, browser history, group
filters, reference links and mobile overflow. The pricing proposal uses the same
Cloud owner authorization as Billing but does not require accounting endpoints
to succeed. Returning to account views fetches real Billing data again.
