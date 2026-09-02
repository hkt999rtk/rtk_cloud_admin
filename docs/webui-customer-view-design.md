# Brand Fleet Management WebUI Design

Status: Brand Fleet layout reference. The design-first
[multi-cloud WebUI contract](multicloud_webui.md) supersedes cloud navigation,
scope, sharing, ownership and Billing behavior below; runtime changes wait for
the complete docs-only review/merge gate.

## Runtime Brand Cloud session contract

The target console uses one global human account session, with cloud scope
explicit in each route and BFF request. The server validates that scope against
current membership/capabilities; no session-global active-cloud selection may
override it. The shell selector is populated by `GET /api/developer/brand-clouds`
and navigates only its own tab. Switching cancels old requests and isolates caches
by cloud; failure preserves the current tab's authorized route. URLs support
deep-link/refresh only after scope validation, never by trusting a browser ID.

Navigation and actions are derived from active-cloud capabilities, not a UI
role switch. Display roles remain useful for explanation, but authorization
uses the capability matrix in `roles.md`.

The login page posts credentials exactly once to `POST /api/auth/login`. The BFF
calls Account Manager global login and `/v1/me`; the browser never probes
separate customer, platform, or tenant login endpoints. A valid deep-link
`next` route wins when authorized. Otherwise the default landing is the
integrated My Clouds page when at least one membership exists, Platform View
when only platform access exists, and the empty My Clouds state for an eligible
developer without memberships. A dual-capability account can
switch Platform View, Brand Fleet, and active Brand Clouds without logging in
again.

Owner email activation ends in the same global account session. After logout,
that owner signs in through the normal login page without supplying a tenant
slug. Legacy local sessions are intentionally invalidated during the coordinated
identity cutover.

Every fleet query is server-side and every batch/report/provisioning operation
stores an immutable scope snapshot and hash. Jobs expose progress, partial
failure, retryability, result expiry, and audit metadata. Provisioning is an
async validation-then-execution workflow.

> Supersession note: the earlier small-fleet Customer View concept in this
> document is retained as historical context only. The current product target
> is the brand sub-tenant Fleet Management console for Developer / Release
> Manager and Operations users managing 100K+ devices. The HTML prototype
> `brand-fleet-management-mock.html` remains authoritative for the Fleet work
> area only; [multicloud_webui.md](multicloud_webui.md) is authoritative for the
> application shell, sidebar, routes, cloud scope and Billing placement.

Original date: 2026-05-09

Last updated: 2026-09-02 — integrated My Clouds, Fleet Management and
cloud-scoped Billing navigation

Audience:

- `rtk_cloud_admin` frontend developers
- product / QA reviewers for Customer View

Related documents:

- [spec.md](spec.md)
- [roles.md](roles.md)
- [admin-dashboard-redesign.md](admin-dashboard-redesign.md)
- [backend-api-gap-audit.md](backend-api-gap-audit.md)
- [sso-oidc-design.md](sso-oidc-design.md)

## Summary

This document records the approved Brand Fleet Management WebUI design
direction for RTK Cloud Admin. The visual direction is **Realtek Ops Console**: a dense,
calm B2B operations console based on the Realtek Connect+ palette from
`webtest.mgmeet.io`.

The current Brand Fleet surface covers:

- My Clouds list/create/switch in the persistent Brand Cloud sidebar
- Fleet Overview, Devices, provisioning status, groups/tags, products/profiles
- Firmware Releases and full Update Plans
- Batch Jobs, Reports, and Team/Permission management
- owner-only Billing inside the selected Brand Cloud navigation scope
- A separate global `ChipSet & SDK` resource center for published development
  resources; it is not scoped to the active Brand Cloud in v1.

Platform View pages, auth pages, and signup pages are required WebUI surfaces,
but they are not part of the Brand Fleet HTML mockup. Groups, tags, products,
batch jobs, and reports are required Brand Fleet surfaces for 100K+ tenants.

The approved HTML mockup is the review reference for the Brand Fleet work
area, not a complete application-state inventory. The implementation must also satisfy the
coverage addendum below for auth, quota, capability, error, and source-state
requirements from `spec.md`, `roles.md`, and `backend-api-gap-audit.md`.

### Functional parity checklist

The React application is accepted against this checklist, not against pixel
identity:

| Surface | Required functional parity |
| --- | --- |
| Overview / Devices | Active-cloud scope, server pagination/filtering, cross-page selection, safe source states |
| Product | Service/device/firmware policy, ACL impact preview, capability-gated writes |
| Firmware / OTA | Release lifecycle, artifact validation, server scope preview, immutable plan, lifecycle controls |
| Jobs | Bounded query, progress, partial failure, per-item result, retry attempt, CSV/JSON download and expiry |
| Reports | Async builder with type, dimensions, range, timezone, scope, output, freshness and expiry |
| Team | Backend-defined display roles, capabilities, scope, invitations, member lifecycle and owner transfer |
| Provisioning | CSV/source or compatibility JSON input, immutable validation, confirmation, execution, retry/cancel/result |
| ChipSet & SDK | Published ChipSet cards, SDK versions, recommended release, supported models, endpoint links, stale/LKG state |

The mockup's sample counts and state buttons are visual examples only. Every
production action shown in the mockup must either call a documented API or be
removed from the production UI.

## Design Coverage Matrix

| Surface | Required for v0.1 | Visual source | Status in this design |
| --- | --- | --- | --- |
| Brand Fleet shell | Yes | `brand-fleet-management-mock.html` plus this document | Implemented with fixed grouped navigation |
| Fleet Overview | Yes | `brand-fleet-management-mock.html` | Implemented inside the Brand Cloud tab shell |
| Devices + Detail Drawer | Yes | `brand-fleet-management-mock.html` | Approved server-side query direction |
| Firmware Releases + Update Plans | Yes | `brand-fleet-management-mock.html` | Approved Developer / Operations workflow |
| Batch Jobs + Reports | Yes | `brand-fleet-management-mock.html` | Approved asynchronous operations direction |
| Signup / check-email / verify | Yes | Text requirements in this document and `spec.md` | Required, no PNG concept |
| SSO login and route gates | Yes | Text requirements in this document and `sso-oidc-design.md` | Required, no PNG concept |
| Platform View: Service Health | Yes | `admin-dashboard-redesign.md` | Required outside Customer View PNG batch |
| Platform View: SSO Providers | Yes | `admin-dashboard-redesign.md` and `sso-oidc-design.md` | Required outside Customer View PNG batch |
| Platform View: Operations Log | Yes | `admin-dashboard-redesign.md` | Required outside Customer View PNG batch |
| Platform View: Audit Log | Yes | `admin-dashboard-redesign.md` | Required outside Customer View PNG batch |
| Brand-cloud management UI | No | [platform-brand-cloud-management-design.md](platform-brand-cloud-management-design.md) plus backend/BFF contract | Platform View draft, outside Customer View |
| ChipSet & SDK resource center | Yes | [chipset-sdk-information-provider-mock.html](assets/webui-design/chipset-sdk-information-provider-mock.html) | Developer read-only resource center; global published catalog |
| Brand Cloud members and settings | Yes | This document plus backend/BFF contracts | Implemented as addressable page tabs |
| Groups and Tags | Yes | `brand-fleet-management-mock.html` | Implemented for large-fleet targeting |
| Batch Jobs and Reports | Yes | `brand-fleet-management-mock.html` | Implemented asynchronous operations surfaces |

## Review Mockup

Open [`brand-fleet-management-mock.html`](assets/webui-design/brand-fleet-management-mock.html)
in a browser to review the large-fleet pages, role views, batch interactions,
OTA workflow, and key non-ideal states.

Open [`chipset-sdk-information-provider-mock.html`](assets/webui-design/chipset-sdk-information-provider-mock.html#%2Fdeveloper)
to review the global Developer resource center, SDK version hierarchy,
recommended release treatment, external endpoints, and stale/unavailable states.

### Known Asset Differences

Earlier visual concepts were small-fleet concepts and are superseded by the
Brand Fleet mockup. Groups, tags, batch jobs, and reports are part of the new
large-fleet information architecture.

The concept images also show secondary drawer tabs and stream mode examples.
Those are treated as layout examples only. The authoritative scope is:

- Drawer `Overview` is required.
- Drawer `Streams` and `Events` are read-only only when backed by documented
  source data.
- Drawer `Settings` must not expose unsupported customer write controls.
- Stream modes beyond WebRTC appear only when the upstream source reports them.

## Design Goals

Customer View is for Tier 2 Fleet Managers and Read-only Observers. It should
help users answer operational questions quickly:

- Is the fleet healthy now?
- Which devices need attention?
- Which devices are behind on firmware?
- Are video streams working for end users?

The UI must feel like a daily operations tool, not a marketing page. Prioritize
scan speed, comparison, filtering, and drill-down paths.

## Customer View Refresh Rules

The refresh keeps the existing Realtek Ops Console visual language but changes
the information hierarchy and wording for everyday fleet operators. The UI is
Traditional Chinese for the review prototype and should use plain language in
the production surface.

### Page Names

| Current/design name | Approved display name |
|---|---|
| Fleet Health Overview | Fleet Overview |
| Devices | My Devices |
| Firmware & OTA | Firmware Updates |
| Stream Health | Video Playback Health |
| Products and Device Profiles | Products and Services |

The English internal names remain valid for routes, code, API fields, and
documentation references. They are not the primary customer-facing labels.

### Page Priorities

- **Fleet Overview:** current fleet state, devices needing attention, and the next
  action. Alerts and attention queue are one list, not two competing lists.
- **My Devices:** searchable fleet comparison with health, status, firmware,
  signal, and last seen. Device details open from the row.
- **Firmware Updates:** latest version, devices not yet updated, failed devices, and
  update progress. Campaign implementation details are secondary.
- **Video Playback Health:** playback success, devices with playback problems, and
  devices that have never played successfully. Protocol names are secondary.
- **Products and Services:** connect each Product to its product/device specification,
  enabled services, user permissions, device policy, and firmware policy.
  This page is for brand operators, not end users.

### Approved Customer Copy

| Internal field/concept | Customer copy |
|---|---|
| `online_rate_7d_pct` | Online Rate in the Last 7 Days |
| `active_sessions` | Currently Streaming Devices |
| `warning` / `critical` | Needs Attention / Critical Issues |
| `pending` firmware | Not Yet Updated |
| `failed` firmware | Update Failed |
| `provision` | Provision Device |
| `deactivate` | Deactivate Device |
| `unavailable` | Latest Data Temporarily Unavailable |

Do not require users to understand WebRTC, OTA, readiness, source status,
campaign, rollout, or raw device identifiers. These values belong in expanded
details or Platform View diagnostics.

### Products and Services

The Product page follows the shared design defined in
`admin-dashboard-redesign.md` and must not create a separate product or
permission vocabulary. Each Product shows:

- Basic Information: Product, product name, product model, product line, and hardware version.
- Available Services: video service, live view, recording and retention, device reporting, and Firmware Updates.
- User Permissions: operations the current role may view or perform.
- Device Policy: provisioning, binding, activation, and deactivation rules.
- Firmware Policy: available versions, hardware compatibility, OTA rules, rollback prevention, and Update Campaigns.

The device drawer links the device to one Product and shows the services and
policies inherited from that Product. A disabled or unsupported service is shown
as `Not Enabled`, `Not Applicable`, or `Contact an Administrator`; raw `service_options`, runtime
scopes, and ACL permission names remain detail-only.

Product editing is a guided flow:

```
Basic Information → Product and Hardware Specifications → Available Services → Device Policy → Firmware Policy
→ ACL Impact Preview → Related Device Check → Save
```

The impact preview must show affected Product/device counts, region/group scope,
current service state, and whether reprovisioning or firmware update may be
required.

### Required Non-ideal States

Each page must have a designed state for loading, no data, stale data,
temporarily unavailable data, device attention, and insufficient permission.
The primary message must explain what the user can do next. Raw upstream error
messages are not customer copy.

### Device Drawer

The default drawer view is a short summary: device identity, status, health,
last seen, main issue, and allowed actions. Signal history, uptime, playback
details, events, and technical source facts are placed under expandable detail
sections.

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
- Checkboxes use the shared 18px console control: white surface and neutral
  border when unchecked, primary blue with a white check when selected, and a
  visible blue focus ring. They must not inherit text-input width, height, or
  padding; disabled and indeterminate states remain visually distinct.

Status color usage:

- Healthy / success: green badge or indicator.
- Warning / pending / attention: amber badge or indicator.
- Critical / failed / destructive: red badge or indicator.
- Unknown / unavailable: neutral gray badge or indicator.

## App Shell

Customer Developers and Platform Admins use the same `Connect+ Ops` app shell:
a dark fixed sidebar, common topbar, account summary, focus treatment, and
responsive mobile navigation. The authenticated session selects one navigation
hierarchy; the UI does not expose a view switcher or combine cross-role data.
On desktop the shell uses a fixed left sidebar and a full-height work area.
Below 1024px, it uses a sticky top app bar and an off-canvas navigation drawer;
the full sidebar must not consume the first mobile viewport.

Sidebar:

- Brand label: `Connect+ Ops`.
- `My Clouds` is the first global destination and remains visible throughout
  every Brand Cloud route. It uses the same application shell rather than a
  separate landing-page layout.
- A cloud selector/context control follows My Clouds on selected-cloud routes
  and displays the validated cloud name and current user's role. Selecting a
  cloud navigates; it does not mutate shared session authority.
- Brand Cloud navigation uses fixed, non-collapsible groups: `Brand Cloud`,
  `Features`, and `Management`.
- `Fleet Management` is an explicit first-level feature. Fleet Overview,
  Devices, groups/tags and batch work remain subviews of that named feature.
- `Billing` is a selected-cloud Management item. It is present only for the
  current sole owner with Billing capability; direct URLs remain backend gated.
- Navigation items and Brand Cloud tabs are role-aware. Hidden affordances do
  not replace backend authorization checks.
- Active nav item uses primary blue fill.
- Customer sessions show only Customer groups. Platform Admin sessions show
  only Platform groups, including when the current deep link is rejected by a
  wrong-role access gate.
- Platform View content must not appear inside Customer View pages.
- Sidebar account summary shows signed-in identity separately from the selected
  cloud context so account role and cloud role are not conflated.

The fixed group and item order is:

| Group | Items |
| --- | --- |
| Global | My Clouds |
| Brand Cloud | Overview |
| Features | Products、Fleet Management、Firmware & OTA、Analytics |
| Management | Members & Access、Billing、Settings、Audit |

Groups are always expanded. Capability filtering removes unavailable items but
does not reorder the remaining items or collapse the group hierarchy. The
`My Clouds` item is always available to authenticated developer accounts.
Selected-cloud items do not render until the route cloud has been validated;
route authorization independently chooses the first accessible cloud feature.

Main header:

- Page title at the top-left of the content area.
- Do not duplicate the sidebar cloud selector in the header. A compact cloud
  breadcrumb may identify scope but cannot change it.
- Window controls where relevant, usually `7d` / `30d`.
- Refresh affordance and signed-in actions on the right.
- Do not show a passive active-organization label or global last-updated
  timestamp in the header.

Brand Cloud pages share one shell while remaining independently addressable.
Overview includes fleet and team summaries when their sources and capabilities
are available. Members & Access contains invitations, members, roles and scopes.
Settings contains ownership transfer, deletion and low-frequency cloud controls.

### Brand Cloud route contract

Each sidebar feature has a cloud-explicit URL rather than a query parameter or
session-selected tenant:

| Item | Canonical route | Minimum frontend access |
| --- | --- | --- |
| My Clouds | `/console/clouds` | Authenticated global developer account |
| Overview | `/console/clouds/{cloudId}` | Current cloud membership |
| Products | `/console/clouds/{cloudId}/products` | Effective Product read scope |
| Fleet Management | `/console/clouds/{cloudId}/fleet` | `fleet.read` or `customer.devices.read` |
| Firmware & OTA | `/console/clouds/{cloudId}/firmware-ota` | Effective firmware or OTA read scope |
| Analytics | `/console/clouds/{cloudId}/analytics` | Effective reports, fleet or stream-read scope |
| Members & Access | `/console/clouds/{cloudId}/members` | `team.read` or `role_assignment.read`; owner-only writes |
| Billing | `/console/clouds/{cloudId}/billing` | Current sole owner plus operation capability |
| Settings | `/console/clouds/{cloudId}/settings` | Current cloud membership; tools remain capability gated |
| Audit | `/console/clouds/{cloudId}/audit` | Effective cloud audit-read scope |

Direct links, refresh, Back, and Forward restore the same active destination.
Invitation acceptance resolves to `/console/clouds/{cloudId}/members` after
successful scope validation. Legacy `/console/overview`, `/console/devices`,
`/console/billing` and `/console/{cloudId}/*` paths are redirect-only inputs:
they may navigate to a canonical route only when cloud scope is explicit or
unambiguous and reauthorized; otherwise they lead to My Clouds.

### Shared Brand Cloud shell

All cloud features share the Brand Cloud name, Cloud ID, cloud selector and
sidebar. The content responsibilities include:

- **Overview:** fleet KPIs, health trend, region distribution, attention devices,
  and a compact team summary with member count, owner, pending invitations, and
  the current user's role.
- **Members & Access:** members, pending invitations, available roles, and readable
  management scopes. The invitation form expands from an explicit action;
  read-only users do not see write controls.
- **Billing:** the current sole owner's cloud-scoped balance, usage, invoices,
  activity, payment settings and profile. It never appears as a global account
  page or for a collaborator.
- **Settings:** owner-transfer create/cancel for `team.manage`, owner-transfer token
  acceptance for every authenticated customer developer, and PKI test bundle
  issuance for `pki.test.issue`.

The validated route/request cloud ID is the authority for that request's scope.
The cloud selector navigates the current tab; it is not shared session state and
cannot redirect another tab's operations. Avoid duplicate pickers in one page
header.

### Access data composition and failure isolation

The WebUI composes existing APIs; there is no new aggregate backend endpoint:

- Overview requests members and invitations only when `team.read` or
  `role_assignment.read` is present and reduces them into the team summary.
- Members and access loads members, invitations, and `/api/role-assignments`
  concurrently, then joins role and scope facts into one view model.
- Each source retains its own availability status. Team-source failure affects
  only the summary/access panels; it cannot hide Fleet Overview. Fleet-source
  failure cannot remove team administration.
- Existing idempotency keys, request paths, success/error messages, and backend
  authorization remain authoritative for every write action.

On mobile, the same ordered groups move into an off-canvas navigation drawer.
The active feature, cloud name, Cloud ID, and primary content remain readable
without changing route semantics.

Login page:

- Use the Realtek logo asset, followed by the `Connect+ Ops` product label.
- The auth page is a normal website-style entry page with two first-class
  modes: `Login` and `Sign Up`. Do not model either mode as a fallback hidden
  behind secondary copy.
- `Login` is the default mode for an existing Admin Console user. It shows
  `Email`, `Password`, a primary `Login` action, and a `Forgot password?`
  link. Password login posts once to the unified account endpoint and derives
  available views from the returned capabilities and memberships.
- `Sign Up` is the public evaluation-account creation mode. It collects only
  `Email`. It does not ask for a password, `Organization name`, `Display name`,
  a manual `CAPTCHA token`, or terms acceptance. It calls
  `POST /api/auth/customer/signup`; a successful response creates a new
  pending-verification account, uses the normalized email as the default initial
  Brand Cloud name, and routes to `/signup/check-email`.
- The `Login` / `Sign Up` switcher must be visible in the first viewport, for
  example as tabs or a segmented control directly above the form.
- The email field label is `Email`; do not use `Work email`.
- A duplicate signup email is an account conflict, not a service outage. Show
  `An account already exists for this email. Log in or reset your password.`;
  reserve the temporary-unavailable message for gateway, timeout, and 5xx
  failures.
- Do not show a top-right `Need help?` link on the login page.
- Keep login copy short and operational. Avoid support, marketing, or
  instructional links in the first viewport.
- The existing Account Manager email activation-link sign-in API remains an
  authentication capability, but it is not exposed as the account-creation tab
  and must not be labeled `Sign Up`.
- `/forgot-password` requests a password reset token by email and returns the
  same accepted UI for known, unknown, disabled, or throttled accounts.
- `/reset-password` consumes a reset token, writes the new password through
  Account Manager, and returns to `/login` after success. The reset flow uses
  the same server-side token delivery lifecycle as email sign-in.

Cloud selector:

- Customer sessions can navigate only to clouds returned by
  `/api/developer/brand-clouds` and permitted by the current account session.
- Selecting a cloud navigates the current tab to an explicit
  `/console/clouds/{cloudId}/*` route, cancels old in-flight requests, isolates
  caches by cloud ID, and clears filters that reference cloud-specific values
  such as firmware versions or device IDs. It does not call or depend on
  `POST /api/me/active-org`.
- The selector must not offer cross-tenant search, platform customer browsing,
  or tenant impersonation. Platform Admin impersonation is deferred.
- If navigation or authorization fails, keep the current route cloud visible
  and show a concise retryable error near the selector. Never silently fall
  back to a different cloud.

Customer-safe field policy:

- Customer View API payloads must not include `video_cloud_devid`.
- Customer View API payloads must not include raw upstream payloads.
- Customer View API payloads must not include operation IDs or internal
  upstream operation IDs.
- Customer View API payloads must not include `dead_lettered` or platform-only
  lifecycle vocabulary.
- Use customer-readable labels and contract-backed display names.

Capability and role behavior:

- Fleet Managers can see and execute `Provision` and `Deactivate` when the
  active membership includes `customer.devices.provision` or
  `customer.devices.deactivate`.
- Read-only Observers see the same Customer View data as Fleet Managers, but
  write actions are disabled or hidden with clear read-only affordance text.
- Frontend affordances are usability only. Backend route guards remain the
  enforcement boundary for provision, deactivate, quota, and any future tenant
  write action.
- Customer sessions must not receive Platform View data. If they open a
  Platform View route directly, the UI shows a role/access gate rather than
  platform content and keeps Customer navigation visible.
- Platform Admin sessions must see a guard if they open Customer View directly,
  with a route back to `/admin` rather than customer data and with Platform
  navigation still visible.

Auth and access states:

- Unauthenticated users see the standalone Admin Console auth page. `Login`
  and `Sign Up` are both first-class modes, with `Login` selected by default.
- The `Sign Up` tab and direct `/signup` route open the same self-service
  evaluation flow documented in `spec.md`; commercial brand-cloud user
  creation is separate and platform admin-owned.
- SSO callback, verification, expired-token, and gateway-error states need
  dedicated copy. Do not leave users on a blank dashboard shell while auth state
  is pending.
- Local demo mode is development-only. Customer View can use demo data locally,
  but production/server validation must show source-unavailable states instead
  of silently substituting demo trends.

## Fleet Overview

Purpose: give the operator a single-glance answer to whether the fleet is
healthy now and whether it has been healthy recently.

Required layout:

- KPI strip with current online devices, seven-day online ratio, devices needing
  attention, and devices playing now.
- Health distribution panel with Normal, Needs attention, Serious problem, and
  No data.
- Large device-status trend chart with online ratio plus attention trends.
- One **Devices that need attention** list with Device, Problem, Time, and one
  direct action. Do not render separate Recent Alerts and Attention Queue
  panels.
- Region summary follows the attention list. Ranked region bars are primary on
  mobile; the map is available behind a `View map` disclosure.

Responsive hierarchy:

- At 1280px and wider, show four KPI cards, the desktop sidebar, and the
  two-column Health Distribution / Fleet Health Trend row.
- From 1024px through 1279px, keep the desktop sidebar, use a 2 × 2 KPI grid,
  and stack operational panels into one column.
- Below 1024px, use the sticky app bar and keyboard-accessible navigation
  drawer, a 2 × 2 KPI grid, and single-column operational panels.
- Below 360px, KPI cards may collapse to one column. No supported viewport may
  introduce page-level horizontal overflow.

Behavior notes:

- `7d` is the default time window; `30d` is available.
- Production data must come from authoritative telemetry/read-model APIs. Do
  not ship demo-derived or readiness-derived trend data for server validation.
- Health distribution segments and attention rows should navigate to a filtered
  Devices view when the backend/frontend path supports it.
- Service health, open platform operations, and platform audit content stay out
  of this page.
- Evaluation-tier organizations show a compact quota indicator when device usage
  approaches or reaches `evaluation_device_quota`. The quota callout belongs
  below the operational panels so it does not displace Fleet Health KPIs.
- The quota callout includes current usage, current quota, a requested quota
  input, and a submit action backed by
  `POST /api/orgs/{orgId}/quota-raise-requests`. It appears only for the active
  organization and never for Platform Admin sessions.
- Quota request errors must distinguish validation errors from Account Manager
  gateway failures with stable, user-facing messages.

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
- The desktop table is a high-density operations surface: normal rows target
  42–46 px, use vertically centered 12–13 px content, compact 22 px status
  badges, and a 28–30 px inspect action. Long identity fields truncate with a
  native title while device name and serial retain a compact two-line hierarchy.
- Below the table breakpoint, use compact list rows rather than tall cards;
  target approximately 48–72 px depending on available width.
- Server pagination appears both above and below the device rows so an operator
  never needs to cross the full list just to change pages.
- Page numbers form one compact segmented control with no gaps. Show at most
  seven page tokens: first page, last page, and the current-page neighborhood
  (`‹ 1 2 3 4 5 … 100 ›` or `‹ 1 … 49 50 51 … 100 ›`). The control may scroll
  horizontally on narrow screens, but the page itself must not overflow.

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

Drawer tabs and states:

- The concept image includes Overview, Streams, Events, and Settings tabs. For
  v0.1, Overview is required; Streams and Events may be implemented as
  read-only drill-downs when backed by the documented telemetry and stream
  endpoints; Settings must not expose unsupported customer write controls.
- Telemetry loading, unavailable-source, empty-data, and unexpected-schema
  states are first-class drawer states. Show the affected panel as unavailable
  while preserving the rest of the drawer.
- Provision and Deactivate actions require confirmation or clear action
  feedback when they create a lifecycle operation. Deactivate uses destructive
  color and copy; Provision stays secondary.

Behavior notes:

- Customer users must not see out-of-org devices.
- Platform admin data must not leak through the Customer View device drawer or
  customer API payloads.
- In production mode, readiness badges and fleet counts must use the API's
  source-attributed readiness projection: Account Manager owns registry and
  lifecycle operations, while Video Cloud owns activation and current transport.
  Demo/cache facts must remain visibly local projections.
- Filters must preserve table scan speed and avoid card-wall layouts.
- Page-number actions preserve the active server-side search, sort, and filter
  query while changing only the offset; current page uses `aria-current=page`.
- Read-only Observer sessions must be enforced by the backend before any
  provision or deactivate action is accepted.
- Device action menus must not expose operation IDs, raw upstream errors,
  `video_cloud_devid`, or platform-only lifecycle states in Customer View.

## Firmware & OTA

Purpose: show firmware distribution, release lifecycle, rollout progress, and
devices at firmware risk while keeping all writes inside capability-guarded
Account Manager/Video Cloud contracts.

Required layout:

- Product selector as the first control. The page does not load or combine firmware
  status until the operator selects one Product.
- KPI strip with `Latest Version`, `Devices Current`, `Pending Update`, and
  `Failed Rollout`.
- Firmware distribution panel with version rows, count, percent of fleet, and
  latest marker.
- Rollout Campaign Summary with target version, policy, state, applied,
  pending, failed, skipped, total, and start timestamp.
- Release and campaign table with capability-derived create, publish, schedule,
  pause, resume, cancel, and retry actions.
- Firmware Risk Queue with device, current version, health, and last seen.

Behavior notes:

- Firmware distribution, releases, campaigns, rollout details, and risk rows
  are scoped to the selected Product. Changing Product clears campaign selection and
  scope previews before loading the new Product state.
- The selected Product is preserved in the `product_id` query parameter for refresh,
  direct links, and Back/Forward navigation.
- Clicking a firmware version should navigate to the Devices page with that
  firmware and Product pre-filtered when supported.
- Campaign creation, tenant-wide write actions, and policy editing are exposed
  only when the active membership has the corresponding release or OTA
  capability; Operations and Observer users remain read-only for release
  metadata and Product policy.
- Unknown firmware should be visible and sortable as an operational risk.
- Production firmware distribution must use observed firmware and rollout facts
  from Video Cloud or the normalized telemetry read model, not generated sample
  versions.
- Campaign drill-down shows device rollout status, reason, and last updated
  values from documented rollout facts; lifecycle actions use the async/write
  contracts and must not be simulated by frontend-only state.
- Unsupported policy values should be shown explicitly as unsupported rather
  than silently mapped to an implemented policy.

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
- The By Mode panel can show non-WebRTC rows only when backed by source data.
  Do not imply RTSP/HLS production support from sample rows if the upstream
  source reports WebRTC-only stream facts.
- Stream attention rows must link to the Devices drawer or to a filtered Devices
  route. They must not open a live viewer; stream preview/player is out of scope.

## Complementary WebUI Surfaces

The Customer View image batch does not cover every WebUI surface required by
`spec.md`. The following surfaces are required for v0.1 but are governed by
separate designs or by the app shell rules in this document.

### Self-Service Signup And Verification

Required routes:

- `/signup`
- `/signup/check-email`
- `/signup/verification-expired`
- `/verify`

Design requirements:

- Signup is for public evaluation-tier onboarding only. It creates a pending
  Account Manager signup and must not be used for commercial brand-cloud user
  creation.
- The `Sign Up` tab on the standalone auth page and the direct `/signup` route
  are two entry points to this same flow; they must submit the same payload,
  containing only `email`, and produce the same pending-verification state.
- The signup form collects only email. Password, optional profile,
  organization-name, manual CAPTCHA-token, and terms-acceptance fields are not
  exposed during signup. Verification email is required before account use.
- The check-email state explains that the user must verify email before signing
  in. It may offer resend only through the Account Manager-backed API.
- The verification landing state asks the user to create a password of at least
  eight characters. It submits `token` and `new_password` together so Account
  Manager atomically sets the initial password, verifies the email, clears the
  pending state, and issues the initial session. The callback token is an opaque
  credential read from the URL and must never be rendered as page text, a form
  control, or any other DOM content. Verification links expire according to
  Account Manager's `EMAIL_VERIFICATION_TTL`, which defaults to 30 minutes.
  Before rendering the password form, the page must perform a non-consuming
  token-status check. A valid link may show the password form; an expired link
  must immediately replace the browser location with
  `/signup/verification-expired`.
- The dedicated expired-verification page is a terminal explanation state. It
  must not render the token or password form. Its primary action is
  `Sign up again`, linking to `/signup`, so an unverified account whose last
  verification token expired can restart signup and receive a new email.
  Invalid-token, already-verified, and service-unavailable outcomes remain
  distinct states and must not be presented as an expired link.
- Evaluation-tier quota copy uses the Account Manager quota fields
  `tier=evaluation` and `evaluation_device_quota`; it must not imply commercial
  entitlement or automatic quota approval.

#### Signup And Verification Lifecycle

The WebUI lifecycle is:

| Stage | Account/token state | Required UI | Next transition |
| --- | --- | --- | --- |
| Start | No account exists for the email | `Sign Up` on `/login` or `/signup`; collect only email | Submit signup and open `/signup/check-email` |
| Awaiting verification | Account is enabled, unverified, signup-pending, and has an active verification token | Explain that a verification email was sent; do not expose the token | Open the email link or request resend through the Account Manager-backed API |
| Valid link | The non-consuming status check returns `valid` | `/verify` shows only the new-password form and never renders the token | Submit `token` and `new_password` to complete verification |
| Expired link | The status check returns `expired` | Immediately replace the location with `/signup/verification-expired`; show no password field or token | `Sign up again` opens `/signup` |
| Restart after expiry | The account is still unverified and signup-pending, with no active verification token | Accept the same email as a recovery signup | Reuse the pending account and Brand Cloud, issue a fresh token, and return to `/signup/check-email` |
| Completed | Email is verified, signup-pending is cleared, the password is stored, and an initial session exists | Redirect to `/console/clouds` | Future access uses `Login` |

Exception rules:

- Signup for a verified account or a pending account that still has an active
  verification token is a conflict; the WebUI must not create another account.
- `invalid` is distinct from `expired`. An invalid or already-consumed token
  must not be described as an expired link.
- The Account Manager verification response remains authoritative. If the token
  expires after the initial status check but before submission, verification
  must fail without changing the account. Refreshing or reopening the link runs
  the status check again and transitions to the expired-verification page.
- Network and upstream failures preserve the current state and show a retryable,
  customer-safe error; they must not be presented as token expiry.

### SSO Login And Session Gates

Required behavior:

- The primary sign-in panel posts email and password credentials to Account
  Manager through the Admin Console BFF.
- The UI displays submitting, denied access, source-unavailable, and retry
  states.
- One Account Manager-backed password form serves both Platform and Brand Fleet
  views; there is no platform/customer mode switch or fallback request.
- Route gates distinguish unauthenticated, wrong-role, and missing-capability
  states. A missing Customer View membership should not render empty fleet data.

### Platform View Coverage Boundary

The approved Customer View concepts do not complete Platform View design. The
Platform View still requires implementation-aligned UI treatment for:

- Service Health
- SSO Providers
- Operations Log
- Audit Log

Those pages use the same Realtek Ops Console shell and density, but they are
Tier 1 only. Customer View must not show service health, audit data, raw
operation payloads, `dead_lettered`, or platform customer browsing.
Brand-cloud management belongs in Platform View only and is covered by
[platform-brand-cloud-management-design.md](platform-brand-cloud-management-design.md).

## Required Page States

Each Customer View page and complementary auth surface must define these states
before implementation is considered complete:

- Loading: preserve the app shell and show panel-level loading text or skeletons.
- Empty: explain that no source data exists for the current org/filter/window.
- Filtered empty: identify that filters, not fleet absence, produced no rows.
- Source unavailable: name the unavailable source category without leaking raw
  upstream payloads.
- Gateway error: show a retryable message and keep the last safe context when
  possible.
- Forbidden: preserve the active cloud and explain the missing capability
  without exposing upstream authorization details.
- Partial failure: keep successful rows/results visible and identify retryable
  failed items.
- Read-only: expose data normally and remove or disable write controls.
- Mobile/tablet: use the sticky app bar and off-canvas navigation drawer below
  1024px. Purpose-built compact lists are preferred where defined; data tables
  may scroll horizontally rather than dropping required columns.

## Implementation Notes

- Keep the implementation inside the existing React/Vite app.
- Reuse current API contracts and the backend fields already documented in
  `backend-api-gap-audit.md`.
- Backend API scope must be tightened where needed to return customer-safe DTOs
  for Customer View routes.
- Do not add a new UI component framework.
- Preserve URL-backed routes for directly linkable console views.
- Do not use the retired small-fleet PNG concepts as the visual source of truth.
- Treat `brand-fleet-management-mock.html` as the design reference for large
  fleet work-area layout, density, role views, and batch interactions.
- When the images conflict with text requirements, the text requirements in
  this document, `spec.md`, `roles.md`, and `admin-dashboard-redesign.md` win.

## Review Checklist

- Customer View pages use the Realtek Ops Console palette and density.
- Desktop pages keep the left sidebar + main work area structure; below 1024px
  they use the shared top app bar + off-canvas drawer shell.
- Customer View does not contain Platform View content.
- Brand Fleet navigation exposes Groups, Tags, Batch Jobs, and Reports according
  to role capabilities, without a second device-registration workflow.
- Auth, signup, verification, and route-gate states are covered.
- Active Brand Cloud switching is scoped to `/api/developer/brand-clouds` and
  committed through the server-side `/api/me/active-org` session endpoint.
- Evaluation quota display and quota raise request states are covered.
- Read-only Observer sessions show read-only action behavior.
- Source-unavailable, loading, empty, filtered-empty, and gateway-error states
  are covered per panel.
- Customer-safe field policy is followed.
- Customer View network payloads are customer-safe, not just visually hidden in
  the React components.
- The four designed pages map to existing or planned Customer View API
  contracts.
- Formal React implementation follows only after the Brand Fleet mockup and
  API/BFF gap audit are reviewed.
