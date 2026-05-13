# Customer View Visual QA Checklist

Use this checklist when reviewing the Customer View redesign implementation
against the approved design assets in `docs/assets/webui-design/`.

## Global Customer View Shell

- Sidebar uses the Realtek Ops Console navy background and primary blue active
  nav state.
- Customer View navigation contains Overview, Devices, Firmware & OTA, and
  Stream Health only. Groups are deferred and must not appear in the first
  batch sidebar or as a placeholder page.
- Platform View switcher is visually separated from Customer View navigation.
- Header contains page title, active organization, relevant window control,
  last updated text, and refresh action.
- Cards, panels, buttons, filters, badges, and tables use 8px radius, fine
  borders, and low shadows.
- Customer View does not show platform-only panels or internal-only fields such
  as `video_cloud_devid`, raw upstream payloads, operation IDs, or
  `dead_lettered`.

## Fleet Health Overview

Reference: `docs/assets/webui-design/customer-overview.png`

- KPI strip shows Online, Online Rate, Needs Attention, and Active Streams.
- Fleet health trend chart is the primary large panel.
- Health distribution panel is visible and links to device filtering when
  supported.
- Recent Alerts table shows Time, Device, Signal, and Health.
- Attention Queue shows device, issue, since, and action.
- Service health, platform operations, and platform audit do not appear.

## Devices + Detail Drawer

Reference: `docs/assets/webui-design/customer-devices.png`

- Search and filters are visible above the table.
- Table columns are Device, Organization, Model, Firmware, Health, Status,
  Signal, Last Seen, and Actions.
- Selected row uses a pale blue highlight.
- Detail drawer opens on row selection and does not cover the full table on
  desktop.
- Drawer shows identity, health, firmware, source facts, RSSI, uptime, recent
  telemetry, active stream status, Provision, and Deactivate.
- Deactivate is styled as the cautious/destructive action.

## Firmware & OTA

Reference: `docs/assets/webui-design/customer-firmware-ota.png`

- KPI strip shows Latest Version, Devices Current, Pending Update, and Failed
  Rollout.
- Firmware Distribution shows version rows, counts, percentages, and latest
  marker.
- Rollout Campaign Summary shows target, policy, state, counts, and progress.
- Campaign table is read-only.
- Firmware Risk Queue is visible and includes unknown or behind firmware.
- No campaign create/edit flow is introduced.

## Stream Health

Reference: `docs/assets/webui-design/customer-stream-health.png`

- KPI strip shows Stream Success Rate, Avg Stream Duration, Active Sessions Now,
  and Devices Never Streamed.
- Success trend combines rate line and request volume bars.
- By Mode summary is visible.
- Per-device stream table is sorted by failure/attention priority.
- Devices Needing Stream Attention panel is visible.
- View device action opens or routes to the Devices detail flow.

## Responsive Checks

- At desktop width, sidebar stays fixed-width and tables remain readable.
- At tablet/mobile width, sidebar stacks above content.
- Tables scroll horizontally rather than clipping columns.
- Drawer fits within viewport and remains scrollable.
- Charts remain visible and do not overlap adjacent panels.
