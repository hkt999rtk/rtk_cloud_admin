# Brand Fleet Management Visual QA Checklist

> The detailed checks below are retained for the earlier four-page Customer
> View batch. For the current 100K+ brand sub-tenant console, use
> `docs/assets/webui-design/brand-fleet-management-mock.html` and the
> Brand Fleet requirements in `webui-customer-view-design.md`.

Use this checklist when reviewing the Customer View redesign implementation
against the approved design assets in `docs/assets/webui-design/`.

## Global Customer View Shell

- Sidebar uses the Realtek Ops Console navy background and primary blue active
  nav state.
- Sidebar groups are fixed and non-collapsible, in this order: 品牌雲、設備營運、
  產品與更新、監控與分析、帳號管理.
- Group items appear in the approved order: 品牌雲首頁; 設備、群組與標籤、
  設備註冊、批次工作; SKU 與服務、ChipSet & SDK、韌體更新; 影像播放狀況、
  報表; 帳務與自動加值.
- 團隊與權限 is not a separate sidebar item. 品牌雲首頁 remains active for the
  總覽、成員與權限、設定 tabs.
- No `Switch to Platform View` or `Switch to Customer View` control is present.
  Customer and Platform sessions use the same Connect+ Ops shell, but each
  session renders only its own grouped navigation.
- Sidebar account summary shows role and email only; it does not repeat the
  active organization name.
- Header contains page title, relevant window control, refresh action, and
  logout action when signed in. It does not show a passive active-organization
  label or global last-updated text.
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

## Brand Cloud Shell And Tabs

- `/console/{cloudId}/overview`, `/access`, and `/settings` render the same
  Brand Cloud name, Cloud ID, organization selector, and tab strip.
- Direct navigation, refresh, Back, and Forward preserve the URL and selected
  tab. Existing unscoped `/console/overview`, `/console/access`, and
  `/console/settings` routes remain usable.
- Clicking 品牌雲首頁 opens the first accessible tab in the order 總覽、成員與
  權限、設定. Sidebar active state is present on every Brand Cloud tab.
- 總覽 shows the team summary only when team or role-assignment read access is
  available. A failed team source does not hide fleet KPIs or fleet panels.
- 成員與權限 shows members, pending invitations, roles, and readable management
  scopes. Invite/member mutation controls are absent for read-only users.
- 設定 always exposes owner-transfer token acceptance to authenticated customer
  developers. Owner-transfer management requires `team.manage`; PKI test bundle
  issuance requires `pki.test.issue`.
- A failed fleet source does not hide usable team administration. Members,
  invitations, and role-assignment source failures are rendered independently.
- On mobile, grouped navigation and tabs remain usable without converting the
  three routes into a single long page.

## Fleet Health Overview

Reference: `docs/assets/webui-design/customer-view-refresh-mock.html` — 設備總覽

- KPI strip shows current online devices, seven-day online ratio, devices needing attention, and devices playing now.
- Fleet health trend chart is the primary large panel.
- Health distribution panel is visible and links to device filtering when
  supported.
- One Devices that need attention list shows device, problem, time, and action.
- Service health, platform operations, and platform audit do not appear.
- Evaluation-tier quota callout appears only when relevant to the active
  organization and includes current usage, quota, requested quota, submit,
  success, validation-error, and gateway-error states.

## Devices + Detail Drawer

Reference: `docs/assets/webui-design/customer-view-refresh-mock.html` — 我的設備

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

Reference: `docs/assets/webui-design/customer-view-refresh-mock.html` — 韌體更新

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

Reference: `docs/assets/webui-design/customer-view-refresh-mock.html` — 影像播放狀況

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
- Primary sign-in path is email and password through Account Manager.
- Platform password login is Account Manager-backed and appears only for
  platform routes
  by deployment configuration.
- Customer sessions cannot see Platform View data; direct `/admin/*` links show
  an access gate while retaining Customer navigation. Platform Admin sessions
  opening `/console/*` see a Customer access gate while retaining Platform
  navigation. Future impersonation must be explicitly designed and authorized.

## Platform View Boundary

- Platform Admin uses the same dark Connect+ Ops shell and responsive behavior
  as Customer, with fixed groups: 平台總覽、監控與診斷、組織與產品、營運與稽核.
- Platform navigation contains 平台首頁; Grafana、服務健康、服務日誌; 品牌雲管理、
  ChipSet & SDK 供應商、SSO 供應商; 營運紀錄、稽核紀錄, in that order.
- Platform content remains Tier 1 only and stays on `/admin/*`; Customer content
  remains on `/console/*`. A unified shell does not imply shared payloads.
- Platform Dashboard follows `docs/platform-view-dashboard-design.md`: curated
  cross-tenant metrics, Prometheus scrape health, and source-unavailable states,
  not a raw Prometheus or Grafana replacement UI.
- SSO Providers page shows organization provider status/settings through Account
  Manager-backed data, never stored provider secrets or raw IdP claims.
- SSO Providers does not present SAML as implemented; OIDC is the first
  supported provider protocol.
- Brand-cloud management routes are future UI consumption surfaces and do not
  appear as a Platform View page without a dedicated design.

## Issue Coverage Mapping

Use this mapping when reviewing developer issues opened from
`docs/webui-implementation-roadmap.md`.

| Roadmap milestone | QA focus |
| --- | --- |
| 1. WebUI foundation cleanup and route guards | Unified shell, session-specific grouped navigation, wrong-role route gates |
| 2. Customer View source-aware page states | Loading, empty, filtered-empty, source-unavailable, gateway-error, and read-only panel states |
| 3. Fleet Health Overview completion | Overview KPI strip, trend chart, health distribution, recent alerts, attention queue, quota callout |
| 4. Devices table and detail drawer completion | Device filters, selected row, drawer overview, source facts, telemetry panels, provision/deactivate states |
| 5. Firmware & OTA read-only workflows | Firmware distribution, campaign summary/table, read-only drill-down, unsupported policies, firmware risk queue |
| 6. Stream Health read-only workflows | Stream KPIs, trend, source-backed By Mode rows, per-device table, attention routing |
| 7. Public auth, signup, verification, and quota UX polish | Email/password login, signup/check-email/verify states, quota request states, platform login routing |
| 8. Platform View polish | Shared shell, grouped Platform navigation, dashboard and drill-downs, Tier 1-only boundaries |
| 9. Final WebUI browser QA and documentation signoff | Desktop/mobile browser smoke, visual checklist closure, documented remaining upstream blockers |

## Responsive Checks

- At desktop width, sidebar stays fixed-width and tables remain readable.
- At tablet/mobile width, sidebar stacks above content.
- Tables scroll horizontally rather than clipping columns.
- Drawer fits within viewport and remains scrollable.
- Charts remain visible and do not overlap adjacent panels.

## Final Signoff

- Status: admin repo WebUI design scope is implementation-ready and smoke-tested
  for the current mocked BFF contract.
- Browser QA command: `cd web && npm run browser:smoke`.
- Final smoke coverage includes desktop Customer View, Platform View, public
  auth routes, and mobile Devices/signup checks. Screenshots are emitted to
  `.artifacts/browser-smoke/`.
- Remaining production validation blockers are upstream source availability for
  telemetry, firmware rollout facts, and WebRTC session facts; these are tracked
  separately from Customer View and Platform View UI completion.
