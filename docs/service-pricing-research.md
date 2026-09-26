# Managed Cloud service pricing reference research

Research date: 2026-09-06. Highest-reference review: 2026-09-26. Status: reference research; no active pricing plan,
database migration, charging policy or payment configuration is created by this
page. Customer UI: Billing > Service Pricing, `/console/clouds/{id}/billing/pricing`.

The numeric research catalog is embedded in the Cloud Admin BFF at
`internal/app/service-pricing-reference.json` and exposed only through
`GET /api/developer/brand-clouds/{id}/billing/pricing-references`. Every request
rechecks the logged-in Cloud owner and `billing_account.read` capability, returns
the ownership version and `Cache-Control: no-store`, and does not require the
accounting service to be available. The four OTA values in this response are
**approved but inactive**; this endpoint is not an effective Billing rate card.
The client verifies the ownership version and complete meter set before showing
any amounts, and shows no price table if the request fails.

## Pricing basis

This is reference research, not a measured profitability claim or an effective
Billing rate card. The 2026-09-26 decision takes the highest eligible price
among the previous RTK draft and the official provider candidates reviewed
below for each comparable meter, or the closest explicitly labeled cost proxy
where the provider and RTK meters differ. The candidate set is the current AWS Price
List for US East, Ireland, Tokyo and São Paulo, CloudFront published delivery
regions in its global pay-as-you-go table (eight delivery groups outside China),
and the Cloudflare R2/Akamai standard-storage references already
collected; it is not a claim of the world's highest provider price. The
conversion uses the fixed planning rate US$1 = NT$32, with the
[Bank of Taiwan 2026-09-24 USD spot quote](https://rate.bot.com.tw/xrt/quote/ltm/USD?Lang=en-US)
retained as context; it is not a payment-time exchange rate. Unit prices can
have decimal precision, but TWD invoices and balances are rounded integer NT$
amounts after monthly aggregation. Display references are rounded **up** to
NT$0.01. Prices are before tax, with no
recurring platform fee or free usage allowance assumed. Private Cloud requires
separate sizing and a quote.

RTK byte units are GiB (2^30 bytes) and KiB (2^10 bytes). AWS [S3 storage GB](https://aws.amazon.com/s3/pricing/)
and [CloudFront transfer GB](https://aws.amazon.com/pt/blogs/aws-brasil/ensaios-sobre-transferencia-de-dados-na-aws-parte-3/)
are billed as GiB despite their labels; [CloudWatch's current pricing examples](https://aws.amazon.com/cloudwatch/pricing/)
likewise convert KB to GB with two divisions by 1,024 and TB to GB by 1,024.
Cloudflare [explicitly distinguishes decimal GB from GiB](https://developers.cloudflare.com/r2/platform/limits/). CloudWatch's
compressed archive basis still needs a final meter review before commercial
approval. Per-million prices
describe a proportional rate, not minimum purchase blocks. Aggregate a month's
usage before rounding money. Actual rounding, tax, rate activation, tenant
scope, validated metering and margin review belong in an approved Billing plan.

## Service inventory and highest reference price

| Service | Previous TWD draft | 2026-09-26 highest reference | Approved OTA price | Winning benchmark and qualification |
| --- | ---: | ---: | --- | --- |
| MQTT publishes | NT$32 / million | **NT$48 / million** | — | AWS IoT Core São Paulo US$1.50 / million 5 KB units; RTK counts accepted raw publishes. |
| MQTT deliveries | NT$32 / million | **NT$48 / million** | — | Same AWS rate; RTK counts each broker subscriber delivery. |
| IoT Shadow | NT$40 / million RTK 1 KiB draft units | **NT$60 / million AWS 1 KB units** | — | AWS IoT Core São Paulo US$1.875 / million 1 KB units. Equivalence to RTK's planned 1 KiB meter is unverified; RTK rate approval is pending. |
| TURN relay | NT$0.96 / GiB | **NT$4.80 / GiB transfer proxy** | — | AWS São Paulo internet egress US$0.150 / GB; AWS TURN minute fees are not convertible to GiB without bitrate/fan-out. Relay-byte facts pending. |
| Video clip storage | NT$0.96 / GiB-month | **NT$1.30 / GiB-month** | — | AWS S3 Standard São Paulo US$0.0405 / GiB-month; physical byte-time meter pending. |
| Clip object writes | NT$144 / million | **NT$224 / million** | — | AWS S3 São Paulo US$0.007 / 1,000 PUTs; successful business-write fact pending. |
| Clip object reads | NT$12.80 / million | **NT$17.92 / million** | — | AWS S3 São Paulo US$0.0056 / 10,000 GETs; clip origin-read fact pending. |
| Clip media downloads | NT$0.96 / GiB | **NT$4.80 / GiB** | — | AWS São Paulo direct internet egress US$0.150 / GB; actual clip-delivery fact pending. |
| OTA device tasks | NT$96 / 1,000 | **NT$144 / 1,000** | **NT$96 / 1,000** | AWS Device Jobs São Paulo US$0.0045 / remote action; approved RTK first-assignment price unchanged. |
| OTA successful downloads | NT$0.96 / GiB | **NT$3.84 / GiB CDN proxy** | **NT$0.96 / GiB** | CloudFront Asia US$0.120 / GiB edge egress; raw CDN bytes differ from first authenticated exact-artifact completion. |
| OTA artifact storage | NT$0.96 / GiB-month | **NT$1.30 / GiB-month** | **NT$0.96 / GiB-month** | AWS S3 Standard São Paulo; approved RTK physical-byte-time price unchanged. |
| OTA artifact writes | NT$144 / million | **NT$224 / million** | **NT$144 / million** | AWS S3 São Paulo PUT; approved RTK successful-object-create price unchanged. |
| Device / application log ingestion | NT$9.60 / GiB | **NT$28.80 / GiB** | — | AWS CloudWatch Standard São Paulo US$0.90 / billed GB; generic invoice integration pending. |
| Log retention | NT$0.96 / GiB-month | **NT$1.31 / GiB-month proxy** | — | AWS CloudWatch São Paulo US$0.0408 / compressed GB-month; RTK uses accepted bytes × configured days / 30. Not equivalent. |
| Other application data APIs | NT$32 / million | **NT$136 / million** | — | AWS API Gateway REST São Paulo US$4.25 / million requests; RTK route classification and successful-request meter pending. |

MQTT is explicitly the first metered service in the canonical
`rtk_cloud_contracts_doc/billing_usage.md`. Do not label every implemented service
as ready for charging. Staging qualified an earlier NT$32/million MQTT version;
the reference recalculation does not amend that version, and production state
must be read from its own Billing database. The static research table never
represents a particular Cloud's effective price or usage.

## Current meter evidence and remaining work

Provider prices above do not establish that RTK has a billable quantity. Keep
these implementation anchors with the research table so a later rate-card
decision can trace each customer meter to an actual source:

| Meter group | Current repository evidence | Readiness boundary |
| --- | --- | --- |
| MQTT publish and delivery | `rtk_video_cloud/internal/usage/event.go` and `mqtt_adapter.go` define `mqtt.publish_count` and `mqtt.delivery_count`. | Generic usage facts exist; use the environment's effective Billing version, not this research value. |
| Shadow | `rtk_cloud_contracts_doc/device_shadow.md`, `rtk_video_cloud/internal/deviceshadow/`, `internal/httpapi/device_shadow.go`. | Shadow operation billing projection is not in the generic Billing registry. |
| TURN relay | `rtk_cloud_contracts_doc/streaming.md`, `rtk_video_cloud/internal/turnregistry/` and coturn deployment. | Authoritative Product/Cloud relay-byte facts still need qualification. |
| Clip storage, writes, reads and delivery | `rtk_video_cloud/internal/clip/` and its storage/retrieval paths. | Time-weighted object bytes, successful operations and bytes sent to clients need separate validated facts. |
| OTA assignment, verified download, storage and write | `rtk_video_cloud/internal/productota/`, Billing's `ProposedOTARates()`, and the [OTA contract](../../rtk_cloud_contracts_doc/ota_delivery_and_billing.md). | Local receipts/outbox and the sealed storage fact exist; CDN reconciliation, protected-environment qualification and effective Billing version remain. |
| Device/application logs | `rtk_video_cloud/internal/logusage/usage.go` and `internal/devicelog/billing.go`. | Per-Cloud ingress totals and `RetentionGBMonth` estimate exist; generic invoicing and true stored-byte basis remain to be qualified. |
| Other application APIs | `rtk_video_cloud/internal/httpapi/`. | Explicit billable route classification and successful-call facts are still needed. |

## Candidate-source ledger and ranking

The AWS Price List files below are official, current CSV snapshots checked on
2026-09-26. The comparison takes the **highest first paid tier in the four
inspected regions** for the same service class; it does not extrapolate to
uninspected regions or treat historical examples as current rates. The earlier
US East/Ireland examples, Cloudflare and Akamai remain candidates where their
unit and storage class match. The resulting figures are provider reference
anchors, never RTK customer charges without a separate commercial decision.

| Category | Winning official source, native rate and rate identity | Conversion and important exclusions |
| --- | --- | --- |
| MQTT and Shadow | [AWS IoT Core São Paulo](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSIoT/current/sa-east-1/index.csv), published 2026-09-11: `SAE1-Messages` SKU `XRCVMWV6BBB3Y8JH` US$1.50/million; Shadow SKU `S2GQNFFHAWM53FV8` US$1.875/million AWS 1 KB operation units. | ×32 = NT$48/60 per million native AWS units. Excludes AWS Sidewalk/LoRaWAN special message classes. [AWS rounds Shadow records to 1 KB](https://aws.amazon.com/iot-core/pricing/) and MQTT messages to 5 KB; RTK's proposed Shadow unit is 1 KiB and MQTT counts raw messages. |
| Device Jobs | [AWS IoT Device Management São Paulo](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/IoTDeviceManagement/current/sa-east-1/index.csv), published 2026-09-11, SKU `43TTE7CU2DNN9B7G`: US$0.0045/remote action first 250,000. | ×1,000×32 = NT$144/1,000. RTK OTA's approved NT$96/1,000 is separate. |
| Direct media bytes | [AWS Data Transfer São Paulo](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/current/sa-east-1/index.csv), published 2026-09-16, SKU `QKTPK3975YUWDU3Q`, rate code suffix `Q3Z75P77EN`: US$0.150/GB first 10 TB to Internet. | [AWS billing guidance](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/useconsolidatedbilling-effective.html) uses 1 TB = 1,024 GB for transfer; ×32 = NT$4.80/GiB planning reference for direct clip/TURN egress. AWS [Kinesis Video Streams TURN](https://aws.amazon.com/kinesis/video-streams/pricing/) also costs US$0.12/1,000 relay minutes plus transfer; minutes cannot be converted without bitrate/fan-out. |
| Hot object storage and operations | [AWS S3 Standard São Paulo](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/sa-east-1/index.csv), published 2026-09-26: `SAE1-TimedStorage-ByteHrs` US$0.0405/GB-month; `SAE1-Requests-Tier1` US$0.007/1,000 PUT; `SAE1-Requests-Tier2` US$0.0056/10,000 GET. | S3 says its GB is GiB. ×32 and ceil cent = NT$1.30/GiB-month, NT$224/million writes, NT$17.92/million reads. `Class A/B` and PUT/GET categories are only proxies for successful RTK operations. |
| CDN edge bytes | [CloudFront pay-as-you-go](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/) and [official current CSV](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudFront/current/index.csv), published 2026-09-16: `AP-DataTransfer-Out-Bytes` US$0.120/GB in Taiwan and nearby Asian edge locations, after first 1 TB free. | AWS [explains CloudFront GB means GiB](https://aws.amazon.com/pt/blogs/aws-brasil/ensaios-sobre-transferencia-de-dados-na-aws-parte-3/); ×32 = NT$3.84/GiB. Raw CDN egress and OTA verified logical download are different quantities. |
| Logs | [CloudWatch São Paulo](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/sa-east-1/index.csv), published 2026-09-22: Standard custom ingest SKU `AW4EB5RGNN8S75Q8` US$0.90/GB; compressed archive SKU `A2U5G2V8PAN8BBGE` US$0.0408/GB-month. | [AWS pricing examples](https://aws.amazon.com/cloudwatch/pricing/) use binary GB; ×32 = NT$28.80/GiB ingest and ceil cent NT$1.31/GiB-month archive planning proxy. RTK retention uses original accepted bytes × configured days/30, not AWS compressed archive bytes. |
| Other APIs | [API Gateway REST São Paulo](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonApiGateway/current/sa-east-1/index.csv), published 2026-09-21, SKU `BMW863HSCDQTKKDT`: US$4.25/million requests. | ×32 = NT$136/million. AWS REST and HTTP APIs have distinct prices; RTK charges only successful classified data routes under the proposal. |

Other published candidates were kept in the comparison rather than silently
discarded. Their native units and purchase terms differ, so the table below
does not turn them into RTK customer rates:

| Candidate | Published native rates checked | Ranking decision |
| --- | --- | --- |
| [Cloudflare R2 Standard](https://developers.cloudflare.com/r2/pricing/) | Storage US$0.015/GB-month, Class A US$4.50/million, Class B US$0.36/million, internet egress free. | Below the selected hot-storage, write, read and delivery anchors after unit conversion; Cloudflare rounds usage to whole billing units. |
| [Cloudflare R2 Infrequent Access](https://developers.cloudflare.com/r2/pricing/) | Class A US$9/million, Class B US$0.90/million, retrieval US$0.01/GB. | Excluded from hot-object request ranking because retrieval and minimum-duration terms differ. |
| [Akamai Object Storage](https://techdocs.akamai.com/cloud-computing/docs/object-storage-pricing) | São Paulo storage overage US$0.028/GB-month; Jakarta network overage US$0.015/GB; new Class A US$0.005/1,000 and Class B US$0.00040/1,000. | Storage and network candidates are below the selected anchors. Object request fees are not billable before 2026-10-01, so their future prices are excluded. The US$5/month base includes 250 GB and is a bundle, not a comparable per-GB tier. |

Free tiers, enterprise discounts, fixed-price bundles, and obsolete
architecture examples are not ranked as unit prices.

Akamai [object access logs](https://techdocs.akamai.com/cloud-computing/docs/logs-for-object-storage)
do not cover reads, so they cannot prove device downloads. CDN
[DataStream fields](https://techdocs.akamai.com/datastream2/reference/data-set-parameters-api)
support cost and anomaly reconciliation, not the OTA customer
successful-download meter. The latter uses the authenticated exact-artifact
`downloaded` report. The approved OTA download NT$0.96/GiB is below the
CloudFront reference NT$3.84/GiB before requests/retries, so actual contracted
CDN cost and margin must be reviewed before activation.

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
6. The old static NT$232 example combined research prices and has been removed
   from customer UI. A later estimator may use only the Cloud's active Billing
   price version and should label hypothetical quantities separately from usage.
7. OTA uses four customer meters: first device assignment, first verified
   artifact download, stored OTA byte-time, and successful OTA object creation.
   Do not apply clip object-read or clip delivery rates to OTA; Akamai CDN
   edge bytes, cache status and Range requests serve internal cost review.

## UI verification

The interim authenticated page must distinguish highest research references
from OTA's approved but inactive unit prices. The target page additionally
reads the Cloud's active Billing price version and labels actual/effective,
approved/upcoming, and research reference amounts separately. It must not show
a made-up monthly total as the Cloud's spend.

Check tab navigation, direct `/billing/pricing` loading, browser history, group
filters, reference links and mobile overflow. Anonymous users receive 401 and
non-owner Cloud members receive 403 from the pricing API. The current research
page uses the same Cloud owner authorization as Billing and fails closed if its
pricing response is missing, stale, malformed or unavailable. Accounting
outages do not block the separate research endpoint. The build removes numeric
benchmark translations from public JavaScript and scans all generated
`web/dist` text assets for protected price strings and the server-only catalog.
Both visible reference-check dates come from the authorized catalog response;
no date or amount is shown while that response is unavailable. Approved and
reference amounts cannot be recovered from anonymous app or localization assets. This
research endpoint never establishes an effective price; the later effective-rate
page must read the Cloud's active Billing rate version and cannot substitute
reference values for an active tariff.
