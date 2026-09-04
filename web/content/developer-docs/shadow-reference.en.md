---
title: "Shadow API and Message Reference"
description: "Look up Shadow paths, topic suffixes, document fields, limits, and errors."
category: "Reference"
keywords: ["409", "413", "429", "clientToken", "version", "8 KiB", "name"]
language: "en"
applies_to: "RTK Cloud contracts snapshot 9b1ed887912e; service snapshot 30fbb9a26155"
last_verified: "2026-09-04"
verification: "Source review and local tests; live environment qualification pending"
---

# Shadow API and Message Reference

## Identity and routes

| Item | Contract |
| --- | --- |
| `devid` / `thingName` | 1–128 characters, `[A-Za-z0-9:_-]+` |
| Named Shadow | 1–64 characters, `[$A-Za-z0-9:_-]+` |
| Unnamed MQTT root | `$vc/devices/{devid}/shadow` |
| Named MQTT root | `$vc/devices/{devid}/shadow/name/{shadowName}` |
| Read | `GET /things/{thingName}/shadow?name={shadowName}` |
| Update/create | `POST /things/{thingName}/shadow?name={shadowName}` |
| Delete | `DELETE /things/{thingName}/shadow?name={shadowName}` |
| List named | `GET /api/things/shadow/ListNamedShadowsForThing/{thingName}` |

Omit `name` to select the unnamed Shadow. URL-encode names and IDs. List accepts `pageSize` from 1 to 100 and an opaque `nextToken`. The old `/api/devices/{devid}/shadow` and `/api/devices/{devid}/shadows` routes are not public compatibility routes.

## MQTT suffixes

Append these suffixes to the selected root. Clients publish requests and subscribe to responses/notifications; the service sends the latter.

| Request suffix | Response suffixes | Other notifications |
| --- | --- | --- |
| `/get` | `/get/accepted`, `/get/rejected` | — |
| `/update` | `/update/accepted`, `/update/rejected` | `/update/delta`, `/update/documents` |
| `/delete` | `/delete/accepted`, `/delete/rejected` | — |

Subscribe to exact topics before requesting. DELETE ignores the MQTT payload. There is no MQTT list operation in this contract; use HTTP for named-Shadow listing.

## Update request

```json
{
  "state": {"desired": {"power": "on"}},
  "version": 7,
  "clientToken": "tutorial-app-on"
}
```

`state` is the update container. Supply `desired`, `reported`, or both for a state change; an empty state object is also accepted. `version` and `clientToken` are optional. In this example, version 7 is illustrative: substitute the current GET version or omit it for an unconditional patch. Clients do not write delta, metadata, or timestamps.

| Field or rule | Meaning |
| --- | --- |
| Object patch | Recursive merge; omitted properties remain |
| Property `null` | Remove that property |
| `desired:null` / `reported:null` | Remove the section |
| Array | Replace atomically; null elements invalid |
| `version` | Compare-and-update guard; mismatch returns 409 |
| `clientToken` | Correlation string, at most 64 UTF-8 bytes; not deduplication |

## Response documents

| Response | Content |
| --- | --- |
| GET accepted | Current state, metadata, version, epoch timestamp; empty sections omitted |
| UPDATE accepted | Accepted desired/reported patch and relevant metadata; not the whole document |
| UPDATE delta | Complete current difference in top-level `state`, desired metadata, version, timestamp |
| UPDATE documents | `previous` and `current` snapshots, each containing state/metadata/version; envelope timestamp |
| DELETE accepted | `{}` |
| Rejected | `code`, `message`, epoch `timestamp`, and a valid request `clientToken` when applicable |

For example, a delta event uses `state.power`, whereas a full GET uses `state.delta.power`. Metadata mirrors property structure without a `children` wrapper. Public state documents have no `updated_at`. Treat `clientToken` as response-specific rather than assuming every message echoes it.

Illustrative rejected response:

```json
{"code":409,"message":"Version conflict","timestamp":1788480000,"clientToken":"tutorial-app-on"}
```

## Limits and errors

| Limit | Value |
| --- | --- |
| Desired/reported state size | 8 KiB, generated metadata excluded; merged stored state revalidated |
| State nesting | At most eight levels |
| Encoding | Valid UTF-8 JSON |
| `clientToken` | At most 64 UTF-8 bytes |
| Named list page size | 1–100 |
| Delete version continuity | 48-hour tombstone window |
| Request rate and in-flight capacity | Deployment-defined; do not hard-code an undocumented universal number |

| Code | Developer action |
| --- | --- |
| 400 | Correct JSON, name, state shape, or invalid array/null usage |
| 401 | Re-authenticate or correct SigV4 signing/expiry |
| 403 | Correct principal, target device, capability, or policy |
| 404 | Read target is missing; first UPDATE creates a Shadow |
| 409 | GET latest, reconcile, then retry only if still appropriate |
| 413 | Reduce state or request size; consider merged state size |
| 415 | Correct content type or unsupported encoding |
| 429 | Reduce concurrency/rate and back off |
| 500 / 503 | Treat as transient service failure; read before retrying an uncertain mutation |

MQTT application errors arrive on rejected topics with `code`; broker failures are a separate layer. HTTP errors include status, JSON, and compatibility headers. See [interface sequences](shadow-interfaces.en.md) and [failure sequences](troubleshooting.en.md).

## Delivery and concurrency

Mutations have increasing versions per Shadow. The canonical notification contract is at least once, ordered by version per Shadow; duplicates are permitted. It is not an exactly-once delivery promise or a guarantee that a disconnected subscriber receives every event. Different Shadows have independent ordering. HTTP mutation success does not wait for notification delivery. For same-version events, track the event type and request correlation independently.
