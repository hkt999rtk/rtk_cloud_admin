---
title: Compatibility and Release Notes
description: Track qualified client evidence, RTK namespace differences and documentation
  changes.
category: Reference
keywords:
- AWS
- migration
- versions
- release
- qualification
language: en
applies_to: RTK contracts 9b1ed887912e; Account Manager 54b37b9c407d; Video Cloud
  30fbb9a26155; Admin bbaf62f7d6b5
last_verified: '2026-09-04'
verification: Source review and local checks; live environment qualification pending
---

# Compatibility and Release Notes

## Scope and evidence levels

This page records the reviewed RTK contract and documentation package, not a claim that every AWS client or deployed environment is certified. Applicable source snapshots appear in each page's metadata. Distinguish source review, local parser/policy tests, browser tests and a live broker/service run.

| Client or interface | Evidence in this edition | Not established |
| --- | --- | --- |
| Python 3.13 / paho-mqtt 2.1.0 | Sample policy tests and callback API construction | Live RTK MQTT interoperability for this new sample |
| Python 3.10+ | Intended sample syntax/runtime minimum | Execution on every supported Python minor/platform |
| curl / Mosquitto command-line examples | Command syntax and source review | A pinned, cross-platform live qualification matrix |
| Admin browser reader | Desktop Chromium and Pixel 7 viewport link/search/download checks | Every browser, physical handset or assistive technology |
| RTK client SDKs | Links to maintained ChipSet & SDK packages | Version-independent compatibility merely because a package exists |
| AWS service/Device SDKs | Contract mapping described below | Blanket binary/API compatibility or an AWS account credential |

Obtain SDK package versions and their release evidence through [ChipSet & SDK](/console/chipset-sdk). Do not label an unexecuted matrix row “passed.” Target-environment quota, capability denial, revocation timing and full live onboarding remain explicit qualification work.

## RTK and AWS-style mapping

| Concern | RTK integration |
| --- | --- |
| State, recursive merge, delta, versions | AWS-style public document model; follow this edition's exact limits and omission rules |
| Thing identity | `thingName` maps to RTK runtime `devid`, not an arbitrary AWS IoT thing |
| MQTT topics | `$vc/devices/{devid}/shadow/...`; `$aws/things/...` is not an alias |
| HTTP | Custom returned `iotDataEndpoint`, SigV4 service `iotdevicegateway`, returned region and session credentials |
| Tenant routing | Derived from authorization; do not inject internal namespace prefixes |
| Named listing | HTTP list route; no MQTT list operation |
| Legacy RTK Shadow paths | `/api/devices/{devid}/shadow` and `/shadows` are not public compatibility routes |

## Migration example

For named Shadow `tutorial`, change the topic builder at the protocol boundary:

```text
AWS-style: $aws/things/device-1/shadow/name/tutorial/update
RTK:       $vc/devices/device-1/shadow/name/tutorial/update
```

Apply the same root mapping to get/delete and all exact accepted/rejected/delta/documents subscriptions. Do not replace arbitrary strings inside JSON state or assume the SDK's automatic topic builder can be configured. If it cannot, use a supported adapter/client. MQTT authentication must also change to the RTK response metadata; a topic rewrite alone is insufficient.

For HTTP clients, configure the endpoint/region/session credentials returned by RTK and preserve canonical method, path, query and signing headers. Use `GET /things/device-1/shadow?name=tutorial` to validate the target. Do not send these credentials to the default AWS endpoint or treat them as AWS account keys.

Before switching, compare GET omission semantics, null removals, accepted patch shape, notification snapshots, correlation, conflicts, delete/recreate and reconnect behavior using [API examples](api-examples.en.md). Keep the old integration recoverable until authorized target-environment tests pass.

## Documentation release record

| Date / edition | Changes | Publication state |
| --- | --- | --- |
| 2026-09-04 / Core | Twelve MQTT/Shadow chapters, Mermaid diagrams and local full-text search | Previously delivered core edition |
| 2026-09-04 / P0 | Onboarding, credential setup, separate App/Device example, Backend guide, observed dev settings | Working-tree addition; not a service release |
| 2026-09-04 / P1 | Message fixtures, credential recovery runner, state modeling, debugging, compatibility; grouped navigation and role-based reading paths | Working-tree addition; deployment not implied |

No service API, topic, credential policy or permission is changed by these documentation editions. The P0/P1 labels are authoring milestones, not semantic service versions.

## Lifecycle and test-kit addition — 2026-09-04

Added Ownership and Sharing, Device Presence and Lifecycle, and Integration Test Kit. The package adds read-only probes and an explicit opt-in simulator exercise. This is a documentation/package addition, not a service release or live qualification. Deployment remains pending.

## Architecture diagram review — 2026-09-04

Eight additional block diagrams explain credential use, Backend responsibilities, MQTT topic families, Shadow state and interfaces, state partitioning, recovery components and diagnostic boundaries. Nine guides embed them; quickstarts link to the appropriate architecture guide. Existing protocol behavior and page URLs are unchanged.

## Maintaining this record

For each future change record date, contract/service/client version, changed behavior, affected pages/examples, migration steps, validation evidence and actual deployment status. A documentation correction must not silently become a promise of a service capability. Preserve existing page URLs and redirect deliberately when retiring a page. The [documentation map](documentation-map.en.md) identifies each chapter's role and reading order.
