# RTK Cloud Admin — Role Definitions

Status: implementation-aligned draft.

Author: Kevin Huang

Audience:

- rtk_cloud_admin frontend and backend developers
- rtk_account_manager backend developers
- rtk_video_cloud backend developers (telemetry, firmware, and stream APIs must
  honor the field-level visibility rules below when surfacing data per role)
- PM / QA

---

## Three-Tier Architecture

RTK Cloud is structured as a three-tier business hierarchy, analogous to a
shopping mall: Realtek owns the platform (the landlord), brand operators
license it to ship their own branded IoT products (tenants renting storefronts),
and end users own the devices (the consumers walking in).

```
Tier 1 — Realtek (platform owner / landlord)
    └── Tier 2 — Brand Operators (licensed tenants)
            └── Tier 3 — End Users (device owners)
```

Each tier has distinct roles with different visibility and permission scopes
within the admin console. Product authorization decisions are made from Account
Manager-projected capabilities. Human-readable role names explain the operator
persona, but route guards and enabled UI actions must use explicit
capabilities.

### Tier Relationships

- A Tier 2 brand operator licenses the platform from Realtek and operates one
  or more organizations. Each organization is the unit of isolation for devices,
  users, and operations.
- A Tier 3 end user owns one or more devices. Each device is bound to exactly
  one Tier 2 organization, which is responsible for its lifecycle (provisioning,
  firmware, deactivation). The Tier 3 user's identity is managed inside the
  Tier 2 org's user namespace.
- Tier 1 has cross-tenant visibility for platform operations and support;
  Tier 2 sees only their own org.

### Why Tier 3 Appears In This Document

Tier 3 end users do not use this admin console — they use the Realtek Connect+
consumer app. Tier 3 is documented here only to make the org/device ownership
chain explicit, because Tier 1 Platform Admins and Tier 2 Fleet Managers
frequently answer questions on behalf of Tier 3 users (e.g., "the end user says
their camera is offline").

The remainder of this document covers only Tier 1 and Tier 2 roles.

---

## Tier 1 — Realtek Internal Roles

These roles belong to Realtek employees operating the platform. The long-term
daily authentication path is Account Manager-backed SSO, where Account Manager
authorizes platform capabilities and Admin Console creates the local
`rtk_admin_session` cookie. During the password-login migration period, the
Platform Admin login form may also authenticate Account Manager platform-admin
credentials and create an Account Manager-backed `platform_admin` session when
the upstream token passes a platform-admin authorization check. Admin Console
does not provide a local break-glass administrator account; emergency operator
control is handled through Linode, SSH, and deployment tooling. Brand-cloud
management requires an Account Manager-backed `platform_admin` session with an
upstream Bearer token.

### Platform Admin

**Responsibilities:** Overall platform operations, infrastructure health,
cross-tenant oversight, compliance, and support investigations on behalf of
Tier 2 customers.

**Visible scope:** All tenants, all devices, all operations.

**Console surfaces used:**
- Platform View — Service Health (Account Manager, Video Cloud, SQLite status)
- Platform View — Operations Log (all lifecycle operation types across tenants)
- Platform View — Audit Log (all actor/action/target records)

**Can execute:**
- Platform-side admin actions: customer session refresh and invalidation (existing in `internal/app/app.go`).
- Brand-cloud backend actions when authenticated through Account Manager as
  `platform_admin`: create/list/read/update brand clouds and assign existing
  Account Manager users to a brand cloud.
- Tenant lifecycle actions (provisioning, deactivation, firmware campaign control on behalf of a tenant): not supported. Tenant-side write actions remain with Tier 2 Fleet Managers.

**Current Admin Console capabilities:**
- `platform.customers.read`
- `platform.devices.read`
- `platform.operations.read`
- `platform.audit.read`
- `platform.sso.manage`

**Known gap:** There is no cross-tenant device-detail surface today. Operations
Log shows lifecycle operation history and Audit Log shows actor/action/target
records, but neither exposes a tenant's current device fleet (health, RSSI,
firmware version). A Platform Admin investigating "what is the current state of
this customer's devices?" cannot answer it from the console today and must
either read SQLite directly or contact the tenant.

**Future capabilities (deferred):** WebUI screens for brand-cloud management
and read-only impersonation of any tenant's Customer View will close this gap.

---

## Tier 2 — Brand Operator Roles

These roles belong to the licensed tenant operating their own branded IoT
product. Tier 2 sessions are org-scoped — users can only see and act on devices
within their own organization.

Tier 2 daily authentication should use Account Manager-backed SSO. Account
Manager is responsible for external identity provider discovery, OIDC token
exchange, user mapping, organization membership, and role authorization. Admin
Console keeps the existing `rtk_admin_session` cookie; the session row carries
the upstream Bearer / refresh token pair when in proxy mode. The legacy customer
password login endpoint is a compatibility path, not the long-term production
login direction. Local SQLite seed data is for development/demo mode only and is
not a production validation source. Plaintext credentials are never persisted.

### Fleet Manager

**Responsibilities:** Day-to-day fleet operations — device provisioning,
deactivation, health monitoring, OTA tracking, stream health.

**Visible scope:** Own org only.

**Console surfaces used:**
- Customer View — all sections (Fleet Health Overview, Devices, Firmware & OTA,
  Stream Health)
- Device Detail Drawer — full detail

**Can execute:** Provision, Deactivate.

**Current Admin Console capabilities:**
- `customer.devices.read`
- `customer.devices.provision`
- `customer.devices.deactivate`
- `customer.firmware.read`
- `customer.stream.read`

---

### Read-only Observer

**Responsibilities:** Monitoring fleet health and reviewing reports without
making operational changes. Typical role for IT managers or customer success
staff within a tenant org.

**Visible scope:** Own org only.

**Console surfaces used:**
- Customer View — all sections, read-only
- Device Detail Drawer — full detail, read-only

**Cannot execute:** No provision, deactivate, or any write actions.

**Current Admin Console capabilities:**
- `customer.devices.read`
- `customer.firmware.read`
- `customer.stream.read`

**Current implementation:** Backend write handlers require the relevant Account
Manager-projected capability for provision and deactivate. Any future tenant
write action must use the same backend guard; frontend button hiding is only a
usability affordance.

---

## Role-to-View Mapping Summary

| Role | Customer View | Platform View | Can Write |
|---|---|---|---|
| Platform Admin (T1) | — (impersonation deferred) | Full | Platform-side only (session control); no tenant lifecycle actions |
| Fleet Manager (T2) | Full (own org) | — | Yes (provision, deactivate) |
| Read-only Observer (T2) | Full read-only (own org) | — | No |

---

## Capability Projection Contract

Admin Console accepts Account Manager organization projections with either
`capabilities` or `permissions` arrays and normalizes both into the `/api/me`
`capabilities` response. Each membership also carries its org-scoped
`capabilities`. The top-level `/api/me.capabilities` list represents the active
organization for customer sessions and platform compatibility capabilities for
platform sessions.

Capability checks are enforced in both layers:

- BFF route guards reject missing write capabilities before calling upstream
  lifecycle APIs.
- UI actions use `/api/me.capabilities` or active membership capabilities to
  enable or disable controls.
- Local Cloud Admin break-glass `platform_admin` is not supported. Emergency
  deployment control belongs in Linode, SSH, and operator tooling, not in an
  extra dashboard account.

---

## Field-Level Visibility Rules

Page-level access is described per role above. This section defines the
field-level rules that apply *within* shared concepts (devices, operations,
events) when the same data surface is shown to different tiers.

Backend handlers and frontend components must enforce these rules consistently.
Source of truth — when a section in `admin-dashboard-redesign.md` mentions a
visibility constraint on a specific field, it must align with the table below.

| Field / Concept | Tier 2 (Fleet Manager, Read-only Observer) | Tier 1 (Platform Admin) |
|---|---|---|
| `video_cloud_devid` | hidden | visible |
| Account Manager device ID (e.g. `acct-dev-1`) | visible (used as device row key) | visible |
| Internal operation type names (e.g. `DeviceProvisionRequested`, `cloud_activation_pending`) | hidden — Friendly Summary only | visible as secondary text alongside Friendly Summary |
| Operation `dead_lettered` state | hidden | visible (filter chip available in Operations Log) |
| Operation IDs | hidden | visible |
| Raw upstream error payloads | hidden — surface as user-facing message only | visible in Operations Log detail |
| Audit log (`audit_events` table) | hidden | visible (cross-tenant) |
| Service Health (Account Manager / Video Cloud / SQLite status) | hidden | visible |
| Demo Mode banner | hidden | visible |
| Cross-tenant device list / per-tenant fleet view | not applicable (org-scoped session) | not directly available today; cross-tenant inspection happens via Operations Log and Audit Log only. Direct cross-tenant device drill-down requires the deferred impersonation capability. |
| Bearer / refresh tokens | never exposed in UI | never exposed in UI |

Read-only Observer (T2) sees exactly the same fields as Fleet Manager (T2);
the distinction is write actions only, not field visibility.

---

## Out Of Scope For This Version

The following role-related features are intentionally deferred:

- Tenant impersonation for Tier 1 Platform Admin
- Role assignment UI
