---
title: Documentation Map
description: Choose a firmware, App or Backend learning path and browse the complete
  document collection.
category: Start here
keywords:
- start
- learning path
- firmware
- App
- Backend
- contents
language: en
applies_to: Developer Docs Core + P0 + P1 source edition
last_verified: '2026-09-04'
verification: Navigation and local search checks; service qualification is page-specific
---

# Documentation Map

## Choose your path

| Developer | Suggested sequence |
| --- | --- |
| Device firmware | Prerequisites → Cloud/device setup → Credential setup → MQTT Quickstart → Shadow Quickstart → Two-principal example → State model → Credential recovery |
| App | Prerequisites → Credential setup → Authentication → Two-principal example → API examples → State model → Debugging |
| Backend | Prerequisites → Cloud/device setup → Backend guide → HTTP interface → API examples → Conflict recipes → Connection limits |

Start with [Before You Start](before-you-start.en.md). The two quickstarts teach individual protocol interactions; [the App and Device example](app-device-example.en.md) connects them. Enrollment is required only when your authorized test identities/device are not already prepared.

## Browse by task

### Start here

- [Cloud Service Overview](overview.en.md) — Understand MQTT messaging, Shadow state, and the roles of devices and applications.
- [Before You Start](before-you-start.en.md) — Prepare a test device, authorized identities, endpoints, and command-line tools.
- [Set Up Your First Cloud and Device](setup-cloud-device.en.md) — Create a Product, resolve a device claim, and verify activation before requesting runtime credentials.
- [Device and App Credential Setup](credential-setup.en.md) — Generate a local app key and CSR, obtain a certificate, and distinguish factory device identity from runtime tokens.

### Tutorials

- [Quickstart: Connect and Exchange Messages](mqtt-quickstart.en.md) — Publish a JSON message and receive it through a second authenticated MQTT connection.
- [Quickstart: Synchronize Device State](shadow-quickstart.en.md) — Request power on from an app and confirm the device reports the applied state.
- [End-to-End App and Device Example](app-device-example.en.md) — Run independent application and device clients and verify desired-to-reported convergence.

### Concepts

- [Device Shadow Concepts](shadow-concepts.en.md) — Understand desired and reported state, delta, names, merge rules, and versions.
- [Designing Your Device State Model](state-model.en.md) — Design compatible desired and reported state, named Shadows, failure reporting and concurrent writers.
- [Device Presence and Lifecycle](device-presence.en.md) — Distinguish account readiness, MQTT connectivity, owner transport and application health.


### Build integrations

- [Authentication and Access Control](authentication.en.md) — Obtain runtime tokens and map their metadata into MQTT and Shadow HTTP credentials.
- [MQTT Connection Guide](mqtt-connection.en.md) — Configure client identity and recovery without assuming durable offline delivery.
- [Backend Integration Guide](backend-integration.en.md) — Choose an authorized backend identity and perform signed Shadow operations without borrowing device credentials.
- [Using Shadows over MQTT and HTTP](shadow-interfaces.en.md) — Perform Shadow operations using exact MQTT topics or signed HTTP requests.
- [Integration Recipes](integration-recipes.en.md) — Recover from offline periods, resolve conflicts, and keep reported state truthful.
- [Device Ownership and Sharing](ownership-sharing.en.md) — Understand account binding, authorized sharing and resale without confusing them with device identity.


### Operate and troubleshoot

- [Credential Renewal and Connection Recovery](credential-recovery.en.md) — Renew runtime credentials and restore subscriptions and state after expiry or network loss.
- [Debugging an Integration](debugging.en.md) — Locate the first failing protocol layer and prepare a useful sanitized support report.
- [Troubleshooting and Compatibility](troubleshooting.en.md) — Diagnose failures by protocol layer and understand RTK Shadow compatibility boundaries.
- [Integration Test Kit](integration-test-kit.en.md) — Run read-only MQTT Shadow probes and an opt-in simulated control exercise, then qualify lifecycle and failure cases.


### Reference

- [MQTT Topics and Message Reference](mqtt-topics.en.md) — Separate application-defined messages, device transport envelopes, and reserved Shadow topics.
- [Shadow API and Message Reference](shadow-reference.en.md) — Look up Shadow paths, topic suffixes, document fields, limits, and errors.
- [API and Message Examples](api-examples.en.md) — Inspect complete illustrative token and Shadow messages, including field omission and correlation rules.
- [Connection Settings and Service Limits](connection-settings.en.md) — Distinguish contract limits, observed dev broker settings, and features requiring environment qualification.
- [Compatibility and Release Notes](compatibility-releases.en.md) — Track qualified client evidence, RTK namespace differences and documentation changes.

## How to use this collection

Tutorials contain goals, prerequisites, sequences, runnable steps and expected outcomes. Concepts explain design choices. Integration guides explain mechanisms. References own exact protocol fields and limits; examples illustrate them without redefining them. Operations chapters explain recovery and diagnostics.

Use the chapter groups on desktop or the grouped chapter selector on mobile. Search covers every published page locally. Source design documents, maintainer notes and runtime credentials are excluded from the website index. Page URLs remain stable when their navigation group changes.

## Version and qualification

Each page states applicable snapshots and the kind of verification performed. A local sample test is not a live environment qualification. Read [Compatibility and Release Notes](compatibility-releases.en.md) before relying on a client/version combination. Streaming/WebRTC, OTA and Telemetry ingestion remain future batches; SDK downloads remain in [ChipSet & SDK](/console/chipset-sdk).
