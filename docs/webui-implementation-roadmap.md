# WebUI Implementation Roadmap

Status: completed first-batch implementation roadmap.

Audience:

- `rtk_cloud_admin` frontend developers
- QA reviewers
- PM / engineering leads planning WebUI implementation issues

Related documents:

- [webui-customer-view-design.md](webui-customer-view-design.md)
- [admin-dashboard-redesign.md](admin-dashboard-redesign.md)
- [platform-view-dashboard-design.md](platform-view-dashboard-design.md)
- [platform-brand-cloud-management-design.md](platform-brand-cloud-management-design.md)
- [customer-view-visual-qa-checklist.md](customer-view-visual-qa-checklist.md)
- [backend-api-gap-audit.md](backend-api-gap-audit.md)
- [SPEC.md](SPEC.md)

## Summary

This roadmap records the completed first RTK Cloud Admin WebUI implementation
batch and remains the reference for future follow-up issues. The original work
was split by implementation milestone rather than by isolated page so that
shared route guards, source states, role behavior, and browser QA were
implemented once and reused consistently.

The completed admin-repo issues were for `hkt999rtk/rtk_cloud_admin`. Upstream
production data work in `rtk_video_cloud` or `rtk_account_manager` remains a
dependency note only and was not opened as part of this batch.

This roadmap tracks the completed first WebUI implementation sequence for
Customer View, auth, Platform View pages, and Platform Dashboard. Brand Clouds
remain a subsequent Platform View design extension; the relevant drafts live in
[platform-view-dashboard-design.md](platform-view-dashboard-design.md) and
[platform-brand-cloud-management-design.md](platform-brand-cloud-management-design.md).

## Issue Body Template

Use this exact structure when creating GitHub issues from this roadmap:

```md
## Goal

## Scope

## Out of Scope

## Dependencies

## Acceptance Criteria

## Required Tests

## References
```

References should include this roadmap, the Customer View design, the admin
dashboard redesign, the visual QA checklist, and relevant source files only when
needed to disambiguate implementation.

## Milestone 1: WebUI Foundation Cleanup And Route Guards

## Goal

Make the app shell, route mapping, and role gates match the approved WebUI scope
before page-level implementation continues.

## Scope

- Keep Customer View navigation limited to Overview, Devices, Firmware & OTA,
  and Stream Health.
- Remove or fully isolate the unused Groups placeholder so it cannot be exposed
  through nav, mobile nav, or direct route fallback.
- Confirm `/console/groups`, `/console/customers`, `/console/operations`, and
  other retired Customer View paths route to a safe Customer View landing state.
- Ensure Platform View links appear only in the visually separated, role-gated
  view switcher.
- Ensure customer sessions never receive Platform View data and platform admin
  sessions see a Customer View guard unless future impersonation is explicitly
  implemented.
- Keep public auth routes (`/signup`, `/signup/check-email`, `/verify`) outside
  the Customer View and Platform View section navigation.

## Out of Scope

- Device Groups UI or API work.
- Tenant impersonation.
- Visual redesign of individual Customer View panels.
- New UI component framework.

## Dependencies

- Current route definitions and tests in `web/src/routes.mjs` and
  `web/src/routes.test.mjs`.
- Auth helper behavior in `web/src/auth-state.mjs`.

## Acceptance Criteria

- Customer View nav contains exactly Overview, Devices, Firmware & OTA, and
  Stream Health.
- No visible or reachable Groups placeholder is present.
- Wrong-role routes show access gates instead of empty dashboards or cross-role
  data.
- Platform View remains reachable only through `/admin` routes or the separated
  role-gated view switcher.
- Existing direct links to retired Customer View paths fall back safely.

## Required Tests

- `cd web && npm test`
- `cd web && npm run build`
- Add or update route/auth tests for retired paths and wrong-role gates.

## References

- [webui-implementation-roadmap.md](webui-implementation-roadmap.md)
- [webui-customer-view-design.md](webui-customer-view-design.md)
- [admin-dashboard-redesign.md](admin-dashboard-redesign.md)
- [customer-view-visual-qa-checklist.md](customer-view-visual-qa-checklist.md)
- `web/src/routes.mjs`
- `web/src/main.jsx`

## Milestone 2: Customer View Source-Aware Page States

## Goal

Implement a consistent source-aware state model for Customer View pages and
device telemetry so the UI does not substitute demo or local estimates for
production validation.

## Scope

- Define reusable UI behavior for loading, empty, filtered-empty,
  source-unavailable, gateway-error, and read-only states.
- Apply source-aware states to Fleet Health Overview, Firmware & OTA, Stream
  Health, and Device Drawer telemetry panels.
- Preserve safe page context when one panel is unavailable.
- Ensure unavailable source messages name the source category without leaking raw
  upstream payloads.
- Keep local demo data visibly local and development-only.

## Out of Scope

- Building new upstream telemetry, firmware rollout, or stream-session sources.
- Changing backend DTO ownership rules.
- Pixel-perfect page layout work beyond state placement.

## Dependencies

- Existing BFF shapes for `/api/fleet/health-summary`,
  `/api/fleet/firmware-distribution`, `/api/fleet/stream-stats`, and
  `/api/devices/{id}/telemetry`.
- Production data blockers listed in `backend-api-gap-audit.md`.

## Acceptance Criteria

- Each Customer View page renders a useful state for loading, empty,
  filtered-empty, unavailable source, and gateway error.
- Device drawer telemetry failures do not hide safe identity, readiness, source
  facts, or available actions.
- Customer-visible errors omit raw upstream payloads, internal operation IDs,
  `video_cloud_devid`, and platform-only lifecycle states.
- Production validation paths do not silently fall back to demo-derived trends.

## Required Tests

- `cd web && npm test`
- `cd web && npm run build`
- Add focused frontend tests for source-aware state helpers or page rendering
  paths where practical.

## References

- [webui-implementation-roadmap.md](webui-implementation-roadmap.md)
- [webui-customer-view-design.md](webui-customer-view-design.md)
- [backend-api-gap-audit.md](backend-api-gap-audit.md)
- [customer-view-visual-qa-checklist.md](customer-view-visual-qa-checklist.md)
- `web/src/main.jsx`

## Milestone 3: Fleet Health Overview Completion

## Goal

Finish the Fleet Health Overview against the approved Customer View concept and
source-state rules.

## Scope

- Implement the KPI strip: Online, Online Rate, Needs Attention, Active Streams.
- Implement the large fleet health trend chart with 7d / 30d window support.
- Implement health distribution with Healthy, Warning, Critical, Unknown and
  device-filter navigation when supported.
- Implement Recent Alerts and Attention Queue sorted by operational impact.
- Add the evaluation quota callout when the active evaluation organization is
  near or at `evaluation_device_quota`.
- Keep Service Health, platform operations, and platform audit content out of
  Customer View.

## Out of Scope

- Production telemetry aggregation in upstream services.
- Alert notification rules, email, or webhook delivery.
- Device Groups filtering.

## Dependencies

- Milestone 1 route and role gates.
- Milestone 2 source-aware states.
- `/api/summary`, `/api/fleet/health-summary`, `/api/devices`, `/api/me`, and
  `/api/orgs/{orgId}/quota-raise-requests`.

## Acceptance Criteria

- Overview visually matches the approved density, hierarchy, and layout intent.
- 7d is the default window and 30d is available.
- Health distribution and alert/attention rows navigate to filtered Devices
  views where route support exists.
- Quota request states cover current usage, requested quota, submit, success,
  validation error, and gateway error.
- No platform-only content or fields appear.

## Required Tests

- `cd web && npm test`
- `cd web && npm run build`
- `cd web && npm run browser:smoke`
- Add/update tests for quota copy and overview route behavior where needed.

## References

- [webui-implementation-roadmap.md](webui-implementation-roadmap.md)
- [webui-customer-view-design.md](webui-customer-view-design.md)
- [customer-view-visual-qa-checklist.md](customer-view-visual-qa-checklist.md)
- `docs/assets/webui-design/customer-overview.png`

## Milestone 4: Devices Table And Detail Drawer Completion

## Goal

Complete the daily device scan, filter, drill-down, and lifecycle action
workflow.

## Scope

- Implement search and filters for Health, Status, Signal, and Firmware.
- Keep table columns aligned to Device, Organization, Model, Firmware, Health,
  Status, Signal, Last Seen, and Actions.
- Implement selected-row highlight and right-side detail drawer behavior.
- Complete drawer Overview content: identity, health, firmware, readiness/source
  facts, RSSI, uptime, recent telemetry, and active stream status.
- Make Streams and Events read-only only when backed by documented source data.
- Ensure Settings exposes no unsupported customer write controls.
- Gate Provision and Deactivate by explicit capabilities and read-only role
  behavior; Deactivate uses destructive styling.

## Out of Scope

- Device Groups.
- Unsupported Settings writes.
- Live stream viewer, clip library, or media download manager.
- Tenant lifecycle writes from Platform View.

## Dependencies

- Milestone 1 route and role gates.
- Milestone 2 source-aware states.
- Customer-safe `/api/devices`, `/api/devices/{id}`, and
  `/api/devices/{id}/telemetry`.

## Acceptance Criteria

- Customer users cannot see out-of-org devices.
- Customer View never exposes operation IDs, raw upstream payloads,
  `video_cloud_devid`, `dead_lettered`, or platform-only lifecycle vocabulary.
- Read-only Observer sees the same data as Fleet Manager but cannot execute
  write actions.
- Drawer partial telemetry unavailability preserves safe identity, readiness,
  source facts, and available action context.

## Required Tests

- `cd web && npm test`
- `cd web && npm run build`
- `cd web && npm run browser:smoke`
- Add/update device action, route, and drawer workflow tests.
- `go test ./...` if backend guards or DTO behavior are changed.

## References

- [webui-implementation-roadmap.md](webui-implementation-roadmap.md)
- [webui-customer-view-design.md](webui-customer-view-design.md)
- [customer-view-visual-qa-checklist.md](customer-view-visual-qa-checklist.md)
- `docs/assets/webui-design/customer-devices.png`

## Milestone 5: Firmware & OTA Read-Only Workflows

## Goal

Complete the Firmware & OTA page as a read-only operational view of firmware
distribution, rollout progress, and firmware risk.

## Scope

- Implement KPI strip: Latest Version, Devices Current, Pending Update, Failed
  Rollout.
- Implement firmware distribution with version rows, count, percent of fleet,
  latest marker, and device-filter navigation.
- Implement rollout campaign summary and read-only campaigns table.
- Implement read-only campaign drill-down with device rollout status, reason,
  and last updated values.
- Implement Firmware Risk Queue with unknown or behind firmware visible and
  sortable as operational risk.
- Display unsupported policy values explicitly as unsupported.

## Out of Scope

- Full OTA campaign engine.
- Campaign create, edit, pause, resume, cancel, archive, or policy update flows.
- Device Groups targeting.

## Dependencies

- Milestone 1 route and role gates.
- Milestone 2 source-aware states.
- `/api/fleet/firmware-distribution` and documented firmware rollout facts.
- Upstream production source blocker: observed firmware versions and rollout
  facts from Video Cloud or normalized telemetry read model.

## Acceptance Criteria

- Campaign data is read-only throughout the page.
- Firmware version rows can route to filtered Devices views where supported.
- Unknown firmware is visible and sortable.
- Unsupported policy states are not silently mapped to implemented policies.
- Generated fallback versions are not treated as production validation evidence.

## Required Tests

- `cd web && npm test`
- `cd web && npm run build`
- `cd web && npm run browser:smoke`
- Add/update firmware tests for empty, unsupported policy, unknown firmware, and
  drill-down behavior.

## References

- [webui-implementation-roadmap.md](webui-implementation-roadmap.md)
- [webui-customer-view-design.md](webui-customer-view-design.md)
- [customer-view-visual-qa-checklist.md](customer-view-visual-qa-checklist.md)
- `docs/assets/webui-design/customer-firmware-ota.png`

## Milestone 6: Stream Health Read-Only Workflows

## Goal

Complete the Stream Health page as a read-only operational view of stream
success, active sessions, and devices needing stream attention.

## Scope

- Implement KPI strip: Stream Success Rate, Avg Stream Duration, Active Sessions
  Now, Devices Never Streamed.
- Implement 7d / 30d trend showing success rate and request volume.
- Implement By Mode summary, initially WebRTC-focused.
- Implement per-device stream table sorted by failure/attention priority.
- Implement Devices Needing Stream Attention with action links to device detail
  or filtered Devices route.
- Show non-WebRTC modes only when backed by source data.

## Out of Scope

- WebRTC player, live preview, clip library, or media download manager.
- Inferring stream activity from free-form telemetry summaries.
- Stream mode claims not backed by source data.

## Dependencies

- Milestone 1 route and role gates.
- Milestone 2 source-aware states.
- `/api/fleet/stream-stats` and explicit active stream status in device detail.
- Upstream production source blocker: WebRTC session event aggregation with
  success/failure, duration, active-session, never-streamed, and per-device
  worst-device facts.

## Acceptance Criteria

- Stream attention rows route to Devices detail or filtered Devices workflow.
- No live viewer or media preview is opened.
- By Mode rows are source-backed and do not imply RTSP/HLS production support
  from sample data.
- Local estimates are not treated as production validation evidence.

## Required Tests

- `cd web && npm test`
- `cd web && npm run build`
- `cd web && npm run browser:smoke`
- Add/update stream tests for source-backed modes, empty windows, attention
  routing, and unavailable source behavior.

## References

- [webui-implementation-roadmap.md](webui-implementation-roadmap.md)
- [webui-customer-view-design.md](webui-customer-view-design.md)
- [customer-view-visual-qa-checklist.md](customer-view-visual-qa-checklist.md)
- `docs/assets/webui-design/customer-stream-health.png`

## Milestone 7: Public Auth, Signup, Verification, And Quota UX Polish

## Goal

Complete public auth and evaluation-tier UX around the existing BFF routes while
keeping Account Manager-backed email/password login as the primary production
sign-in path.

## Scope

- Polish email/password login states: idle, submitting, denied access,
  unavailable source, and retry.
- Route platform password login through Account Manager platform-admin
  authorization during migration.
- Complete `/signup`, `/signup/check-email`, and `/verify` states for public
  evaluation-tier onboarding.
- Cover success, pending verification, expired token, invalid token, already
  verified, resend, validation error, and service-unavailable states.
- Ensure quota copy uses `tier=evaluation` and `evaluation_device_quota` without
  implying commercial entitlement or automatic approval.

## Out of Scope

- Commercial brand-cloud user creation.
- Customer self-service IdP setup.
- Implementing OIDC provider configuration or token exchange directly in Admin
  Console.
- Multi-language UI.

## Dependencies

- Existing BFF routes for signup, verification, customer password login,
  SSO start/callback, `/api/me`,
  active org, and quota raise requests.
- Account Manager remains source of truth for accounts, verification, SSO, and
  quota decisions.

## Acceptance Criteria

- Public auth pages are outside Customer View and Platform View section nav.
- Signup is clearly evaluation-tier only.
- Verification and login errors use user-facing copy without exposing internal
  upstream payloads.
- Quota raise requests target only the active organization.
- Password login is presented as the primary production path.

## Required Tests

- `cd web && npm test`
- `cd web && npm run build`
- `cd web && npm run browser:smoke`
- `go test ./...` if BFF auth, signup, verification, or quota behavior changes.

## References

- [webui-implementation-roadmap.md](webui-implementation-roadmap.md)
- [webui-customer-view-design.md](webui-customer-view-design.md)
- [sso-oidc-design.md](sso-oidc-design.md)
- [SPEC.md](SPEC.md)

## Milestone 8: Platform View Polish

## Goal

Complete the Tier 1 Platform View surfaces while preserving Customer View and
Platform View separation.

## Scope

- Polish Service Health, including Platform-only demo mode banner behavior.
- Keep Platform Dashboard as the Tier 1 landing page through the implemented
  metrics BFF surface; follow `platform-view-dashboard-design.md`.
- Complete SSO Providers status/settings surface through Account Manager-backed
  data.
- Complete Operations Log with Friendly Summary, raw type/state as Platform-only
  secondary text, and state filter including Dead Lettered.
- Complete Audit Log as a read-only table with current write-side limitations
  documented in UI copy where needed.
- Ensure Platform View pages are Tier 1 only.

## Out of Scope

- Brand-cloud management UI.
- Tenant impersonation.
- Role assignment UI.
- Audit log export.
- Tenant lifecycle write actions from Platform View.
- SAML as implemented provider protocol.

## Dependencies

- Milestone 1 route and role gates.
- `/api/admin/platform-dashboard`, `/api/admin/service-health`, `/api/admin/sso/providers`,
  `/api/admin/operations`, and `/api/admin/audit`.
- Account Manager remains source of truth for SSO provider configuration and
  secrets.

## Acceptance Criteria

- Customer users cannot see Platform View data.
- Platform Dashboard remains the first Platform View route and shows Prometheus
  source states instead of direct Prometheus or Grafana browser access.
- SSO Providers never displays secrets or stores provider secrets in Admin
  Console SQLite.
- SSO Providers does not present SAML as implemented; OIDC is first supported.
- Operations Log exposes raw type/state only inside Platform View.
- Audit Log expectations match current audit write coverage.

## Required Tests

- `cd web && npm test`
- `cd web && npm run build`
- `cd web && npm run browser:smoke`
- `go test ./...` if platform API guards or SSO provider BFF behavior changes.

## References

- [webui-implementation-roadmap.md](webui-implementation-roadmap.md)
- [admin-dashboard-redesign.md](admin-dashboard-redesign.md)
- [customer-view-visual-qa-checklist.md](customer-view-visual-qa-checklist.md)
- [sso-oidc-design.md](sso-oidc-design.md)

## Milestone 9: Final WebUI Browser QA And Documentation Signoff

## Goal

Close the WebUI implementation with repeatable browser QA, responsive checks,
and documentation signoff against the approved design scope.

## Scope

- Expand `web/scripts/browser-smoke.mjs` to cover desktop and mobile workflows
  for Customer View, Platform View, and public auth routes.
- Verify Customer View pages against the approved PNG concepts and documented
  asset differences.
- Verify source-unavailable, empty, filtered-empty, loading, read-only, and
  wrong-role states.
- Update `docs/webui-browser-qa.md` with the final smoke coverage and commands.
- Record final checklist status against
  `docs/customer-view-visual-qa-checklist.md`.

## Out of Scope

- New feature work beyond closing implementation gaps found by QA.
- Upstream production telemetry, firmware rollout, or stream-session
  implementation.
- Pixel-perfect redesign beyond the approved Customer View work-area concepts.

## Dependencies

- Milestones 1 through 8 are complete or explicitly deferred.
- Local browser smoke environment can mock required BFF responses.

## Acceptance Criteria

- Browser smoke covers Customer View, Platform View, and public auth routes.
- Desktop and mobile responsive checks pass without clipped tables, unusable
  drawer, or overlapping chart/panel content.
- QA documentation names remaining upstream blockers separately from admin repo
  WebUI completion.
- Final checklist confirms Groups hidden, Platform/Customer boundaries enforced,
  source-aware states covered, and browser QA repeatable.

## Required Tests

- `cd web && npm test`
- `cd web && npm run build`
- `cd web && npm run browser:smoke`
- `go test ./...` if backend behavior changed during QA fixes.

## References

- [webui-implementation-roadmap.md](webui-implementation-roadmap.md)
- [webui-browser-qa.md](webui-browser-qa.md)
- [customer-view-visual-qa-checklist.md](customer-view-visual-qa-checklist.md)
- [webui-customer-view-design.md](webui-customer-view-design.md)
