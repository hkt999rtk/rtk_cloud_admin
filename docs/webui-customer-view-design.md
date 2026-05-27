# Customer View WebUI Design

Status: approved concept.

Date: 2026-05-09

Audience:

- `rtk_cloud_admin` frontend developers
- product / QA reviewers for Customer View

Related documents:

- [SPEC.md](SPEC.md)
- [ROLES.md](ROLES.md)
- [admin-dashboard-redesign.md](admin-dashboard-redesign.md)
- [backend-api-gap-audit.md](backend-api-gap-audit.md)

## Summary

This document records the approved Customer View WebUI design direction for
RTK Cloud Admin. The visual direction is **Realtek Ops Console**: a dense,
calm B2B operations console based on the Realtek Connect+ palette from
`webtest.mgmeet.io`.

The first design batch covers:

- Fleet Health Overview
- Devices with Detail Drawer
- Firmware & OTA
- Stream Health

Platform View redesign and Groups are not part of this batch. Groups must not
appear in the first-batch Customer View sidebar.

## Approved Concepts

### Fleet Health Overview

![Fleet Health Overview](assets/webui-design/customer-overview.png)

### Devices + Detail Drawer

![Devices + Detail Drawer](assets/webui-design/customer-devices.png)

### Firmware & OTA

![Firmware & OTA](assets/webui-design/customer-firmware-ota.png)

### Stream Health

![Stream Health](assets/webui-design/customer-stream-health.png)

## Design Goals

Customer View is for Tier 2 Fleet Managers and Read-only Observers. It should
help users answer operational questions quickly:

- Is the fleet healthy now?
- Which devices need attention?
- Which devices are behind on firmware?
- Are video streams working for end users?

The UI must feel like a daily operations tool, not a marketing page. Prioritize
scan speed, comparison, filtering, and drill-down paths.

## Design Tokens

Use the existing React/Vite frontend and CSS. Do not add a new design system
package for this design pass.

| Token | Value | Usage |
| --- | --- | --- |
| Primary blue | `#0068B7` | Selected nav, active segmented controls, primary links, chart lines, focused states |
| Navy | `#25384C` | Sidebar background, headings, high-emphasis text |
| Pale blue | `#E4F4FA` | Selected row backgrounds, quiet highlights, icon tiles |
| Page wash | `#F4F9FB` | App background and low-emphasis panels |
| Border | `#E5E9EF` | Panels, tables, filter controls, dividers |
| Muted text | `#5F6B78` | Labels, helper text, secondary metadata |
| White | `#FFFFFF` | Main cards, tables, drawer panels |

Typography:

- Use Inter first, then system sans-serif fallback.
- Keep headings compact and work-focused.
- Avoid oversized hero-scale type inside dashboard panels.
- Table and control text must be deliberately sized, not browser-default.

Shape and surface:

- Use 8px radius for cards, filters, buttons, segmented controls, and panels.
- Use fine borders over heavy shadows.
- Avoid nested cards unless the inner surface is a genuine table, drawer block,
  chart area, or repeated row group.

Status color usage:

- Healthy / success: green badge or indicator.
- Warning / pending / attention: amber badge or indicator.
- Critical / failed / destructive: red badge or indicator.
- Unknown / unavailable: neutral gray badge or indicator.

## App Shell

The Customer View shell uses a fixed left sidebar and a full-height work area.

Sidebar:

- Brand label: `Connect+ Ops`.
- Customer View nav items: `Overview`, `Devices`, `Firmware & OTA`,
  `Stream Health`.
- Active nav item uses primary blue fill.
- Platform View switcher is visually separated from Customer View navigation.
- Platform View content must not appear inside Customer View pages.

Main header:

- Page title at the top-left of the content area.
- Organization selector near the title, using the active organization name.
- Window controls where relevant, usually `7d` / `30d`.
- Last updated timestamp and refresh affordance on the right.

Customer-safe field policy:

- Customer View API payloads must not include `video_cloud_devid`.
- Customer View API payloads must not include raw upstream payloads.
- Customer View API payloads must not include operation IDs or internal
  upstream operation IDs.
- Customer View API payloads must not include `dead_lettered` or platform-only
  lifecycle vocabulary.
- Use customer-readable labels and contract-backed display names.

## Fleet Health Overview

Purpose: give the operator a single-glance answer to whether the fleet is
healthy now and whether it has been healthy recently.

Required layout:

- KPI strip with `Online`, `Online Rate`, `Needs Attention`, and
  `Active Streams`.
- Large fleet health trend chart with online rate plus warning / critical
  trend lines.
- Health distribution panel with Healthy, Warning, Critical, Unknown.
- Recent Alerts table with Time, Device, Signal, Health.
- Attention Queue panel sorted by operational impact.

Behavior notes:

- `7d` is the default time window; `30d` is available.
- Production data must come from authoritative telemetry/read-model APIs. Do
  not ship demo-derived or readiness-derived trend data for server validation.
- Health distribution segments and alert rows should navigate to a filtered
  Devices view when the backend/frontend path supports it.
- Service health, open platform operations, and platform audit content stay out
  of this page.

## Devices + Detail Drawer

Purpose: provide the daily scan, filter, and drill-down workflow for device
fleet issues.

Required layout:

- Search input for device name, serial number, or model.
- Filter controls for Health, Status, Signal, and Firmware.
- High-density table with columns:
  - Device
  - Organization
  - Model
  - Firmware
  - Health
  - Status
  - Signal
  - Last Seen
  - Actions
- Selected row uses a pale blue highlight.
- Right-side detail drawer opens from a selected row.

Detail drawer content:

- Device identity: name, serial number, model, organization.
- Current health summary and contributing signals.
- Firmware version and updated timestamp.
- Readiness / source facts timeline, including account registry, cloud
  activation, transport online, and device facts where available.
- RSSI 7d sparkline.
- Uptime 7d sparkline.
- Recent telemetry events.
- Active stream status.
- `Provision` and `Deactivate` actions, with destructive styling only for
  deactivate.

Behavior notes:

- Customer users must not see out-of-org devices.
- Platform admin data must not leak through the Customer View device drawer or
  customer API payloads.
- In production mode, readiness badges and fleet counts must use the API's
  source-attributed readiness projection: Account Manager owns registry and
  lifecycle operations, while Video Cloud owns activation and current transport.
  Demo/cache facts must remain visibly local projections.
- Filters must preserve table scan speed and avoid card-wall layouts.
- Read-only Observer sessions must be enforced by the backend before any
  provision or deactivate action is accepted.

## Firmware & OTA

Purpose: show firmware distribution, rollout progress, and devices at firmware
risk without introducing platform-only write workflows.

Required layout:

- KPI strip with `Latest Version`, `Devices Current`, `Pending Update`, and
  `Failed Rollout`.
- Firmware distribution panel with version rows, count, percent of fleet, and
  latest marker.
- Rollout Campaign Summary with target version, policy, state, applied,
  pending, failed, skipped, total, and start timestamp.
- Read-only campaign table.
- Firmware Risk Queue with device, current version, health, and last seen.

Behavior notes:

- Clicking a firmware version should navigate to the Devices page with that
  firmware pre-filtered when supported.
- Campaign creation, tenant-wide write actions, and policy editing are not part
  of this Customer View design batch.
- Unknown firmware should be visible and sortable as an operational risk.
- Production firmware distribution must use observed firmware and rollout facts
  from Video Cloud or the normalized telemetry read model, not generated sample
  versions.

## Stream Health

Purpose: answer whether device video streams are working for end users.

Required layout:

- KPI strip with `Stream Success Rate`, `Avg Stream Duration`,
  `Active Sessions Now`, and `Devices Never Streamed`.
- `7d` / `30d` window control.
- Main trend chart showing stream success rate and request volume.
- By Mode summary, initially focused on WebRTC.
- Per-device stream table sorted by failure rate descending.
- Devices Needing Stream Attention panel with concise issue labels.

Per-device stream table columns:

- Device
- Mode Used
- Success Rate
- Total Requests
- Last Stream
- Status

Behavior notes:

- Attention items should use customer-readable causes such as low success rate,
  never streamed, offline risk, or intermittent signal.
- The design should support opening the selected device in the Devices detail
  drawer once route/state wiring is implemented.
- Production stream metrics must use WebRTC session event data from Video Cloud
  or an equivalent normalized read model, not local demo-derived estimates.

## Implementation Notes

- Keep the implementation inside the existing React/Vite app.
- Reuse current API contracts and the backend fields already documented in
  `backend-api-gap-audit.md`.
- Backend API scope must be tightened where needed to return customer-safe DTOs
  for Customer View routes.
- Do not add a new UI component framework.
- Preserve URL-backed routes for directly linkable console views.
- Do not include Groups in the first-batch sidebar or page set.
- Treat the four approved images in this document as the visual source of truth
  for Customer View implementation.

## Review Checklist

- Customer View pages use the Realtek Ops Console palette and density.
- All pages keep the left sidebar + main work area structure.
- Customer View does not contain Platform View content.
- Customer-safe field policy is followed.
- Customer View network payloads are customer-safe, not just visually hidden in
  the React components.
- The four designed pages map to existing or planned Customer View API
  contracts.
- No WebUI implementation is included in this design-spec change.
