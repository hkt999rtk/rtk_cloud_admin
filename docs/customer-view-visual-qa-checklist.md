# Customer View Visual QA Checklist

Use this checklist when reviewing the Customer View redesign implementation
against the approved design assets in `docs/assets/webui-design/`.

## Global Customer View Shell

- Sidebar uses the Realtek Ops Console navy background and primary blue active
  nav state.
- Customer View navigation contains Overview, Devices, Firmware & OTA, and
  Stream Health only. Groups are deferred and must not appear in the first
  batch sidebar, mobile navigation, route list, or as a placeholder page.
- Platform View switcher is visually separated from Customer View navigation and
  remains role/route gated.
- Header contains page title, active organization, relevant window control,
  last updated text, and refresh action.
- Organization selector lists only `/api/me.memberships`, switches through
  `/api/me/active-org`, and clears org-specific filters after a successful
  switch.
- Cards, panels, buttons, filters, badges, and tables use 8px radius, fine
  borders, and low shadows.
- Customer View does not show platform-only panels or internal-only fields such
  as `video_cloud_devid`, raw upstream payloads, operation IDs, or
  `dead_lettered`.
- Unauthenticated, wrong-role, and missing-capability states show route gates
  instead of rendering an empty or cross-role dashboard.
- Read-only Observer sessions can view all Customer View data, but provision and
  deactivate controls are disabled or hidden and backend guards are still
  required.
- Loading, empty, filtered-empty, source-unavailable, and gateway-error states
  are handled at panel level without leaking raw upstream payloads.

## Fleet Health Overview

Reference: `docs/assets/webui-design/customer-overview.png`

- KPI strip shows Online, Online Rate, Needs Attention, and Active Streams.
- Fleet health trend chart is the primary large panel.
- Health distribution panel is visible and links to device filtering when
  supported.
- Recent Alerts table shows Time, Device, Signal, and Health.
- Attention Queue shows device, issue, since, and action.
- Service health, platform operations, and platform audit do not appear.
- Evaluation-tier quota callout appears only when relevant to the active
  organization and includes current usage, quota, requested quota, submit,
  success, validation-error, and gateway-error states.

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
- Drawer Overview is required. Streams and Events are read-only only when backed
  by source data; Settings must not expose unsupported customer write controls.
- Drawer telemetry panels handle partial unavailability without hiding safe
  identity, readiness, and action context.
- Deactivate is styled as the cautious/destructive action.

## Firmware & OTA

Reference: `docs/assets/webui-design/customer-firmware-ota.png`

- KPI strip shows Latest Version, Devices Current, Pending Update, and Failed
  Rollout.
- Firmware Distribution shows version rows, counts, percentages, and latest
  marker.
- Rollout Campaign Summary shows target, policy, state, counts, and progress.
- Campaign table is read-only.
- Campaign drill-down is read-only and does not introduce create, pause, resume,
  cancel, or policy-edit actions.
- Unsupported firmware policies are visible as unsupported instead of silently
  mapped to an implemented policy.
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
- By Mode rows are source-backed. Do not show RTSP/HLS production support from
  sample data when the upstream source reports WebRTC-only facts.
- Stream attention does not open a live viewer or media preview; those are out
  of scope.

## Complementary WebUI States

- Signup route is evaluation-tier only and does not imply commercial brand-cloud
  user creation.
- Check-email and verification routes cover pending verification, success,
  expired token, invalid token, already verified, resend, and service-unavailable
  states.
- Primary sign-in path is email-first SSO through Account Manager.
- Platform break-glass login is visually secondary and appears only when enabled
  by deployment configuration.
- Customer sessions cannot see Platform View data; Platform View routes and
  switcher targets show an access gate for the wrong role. Platform Admin
  sessions cannot see Customer View data unless future impersonation is
  explicitly implemented.

## Platform View Boundary

- Customer View concept images do not complete Platform View design.
- Platform View contains Service Health, SSO Providers, Operations Log, and Audit
  Log for Tier 1 only.
- SSO Providers page shows organization provider status/settings through Account
  Manager-backed data, never stored provider secrets or raw IdP claims.
- SSO Providers does not present SAML as implemented; OIDC is the first
  supported provider protocol.
- Brand-cloud management routes are future UI consumption surfaces and do not
  appear as a Platform View page without a dedicated design.

## Responsive Checks

- At desktop width, sidebar stays fixed-width and tables remain readable.
- At tablet/mobile width, sidebar stacks above content.
- Tables scroll horizontally rather than clipping columns.
- Drawer fits within viewport and remains scrollable.
- Charts remain visible and do not overlap adjacent panels.
