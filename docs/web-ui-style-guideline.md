# Realtek Connect+ Web UI Style Guideline

Status: implementation guideline for the developer/enterprise console refresh,
2026-09-05. This document defines the target quality bar; it is not a claim that
every listed page or state has passed visual verification.

## Purpose and authority

Create a calm, professional Realtek console using GitHub-inspired information
density and predictable resource workflows. Scope covers customer `/console/*`
pages and their sign-in, account verification, password recovery, and invitation
flows. Public marketing and internal `/admin/*` redesign are outside this
refresh. Shared styles must still be checked for regressions on those surfaces.

The [Frontend Style Contract](rtk_cloud_contracts_doc/frontend_style.md) is the
canonical shared palette, typography, semantic-state, and radius authority.
This guideline defines how the console applies it. The contracts directory is
a symlink to the adjacent canonical repository; never create a competing copy.
The [multi-cloud contract](multicloud_webui.md), [roles](roles.md), and API
contracts retain authority over permissions, routes, ownership, and financial
operations. Earlier mockups are historical visual references where they conflict
with this guideline; this does not supersede their domain requirements.

## Identity, color, and typography

Use the approved Realtek logo and the consistent product name **Realtek
Connect+**. Do not recreate the logo with initials, recolor it, or substitute a
GitHub/Microsoft mark. Display the actual environment compactly when known;
never infer production status from a theme or sample dataset.

Color provenance is the [official Realtek website](https://www.realtek.com/),
specifically its [site CSS](https://wwwfile.realtek.com/css/site.css) and
[layout CSS](https://wwwfile.realtek.com/css/layout.css), inspected 2026-09-05.
The site uses `#0068b7` links/titles, `#035390` navigation accents, white
navigation, and secondary cyan. These observations are not a formal brand
manual. Use the canonical contract's subset consistently, not every hue found
in corporate imagery or third-party widget styles.

| Role | Canonical token | Console application |
| --- | --- | --- |
| Main surface | `--bg` | White content, controls, and resource surfaces |
| Quiet surface | `--bg-soft` | Low-emphasis shell or section background |
| Text | `--text`, `--muted` | Main text and readable supporting information |
| Rule | `--line` | Table dividers, input borders, panel boundaries |
| Primary action | `--brand` (`#0068b7`) | Main button, link, selected accent |
| Strong blue | `--brand-dark` (`#035390`) | Hover/strong accent; not a full-page gradient |
| Soft selection | `--brand-soft` | Selected navigation and quiet emphasis |
| Secondary accent | `--brand-cyan` | Small supporting accents, never body text on white |
| Failure/action risk | `--danger` | Failed and destructive actions only |

Use neutral surfaces and borders. Reserve shadows for overlays or occasional
raised surfaces; remove decorative gradients, colored KPI stripes, oversized
icon tiles, and nested card walls. Default radius is **8px** for controls and
panels. Do not introduce a second page-specific palette through broad selectors.

Use the shared Inter/system sans-serif stack with appropriate CJK fallbacks.
Use monospace for code and copyable identifiers, and tabular numerals for
metrics/costs. Interface body and table text default to 14px; supporting labels
may use 12px where readable. Page titles use 24–28px, section titles 16–18px.
Documentation prose may use 16px. Font size must not scale with viewport width.
Use sentence case, except product names and established acronyms (API, SDK, OTA).
Keep normal text line height around 1.5 and use a 4px spacing increment.

## Shell and page structure

- Maintain one shell and component vocabulary across My Clouds and cloud
  features. A light, compact navigation area must not visually outweigh the
  workspace. Group destinations by user task rather than backend service.
- Keep cloud context visible and use explicit cloud routes for every scoped
  request. Cloud switching must not reuse another cloud's data or permissions.
  A remembered selection is navigation preference only.
- Before a cloud is selected, prioritize My Clouds and developer resources;
  explain the need to select a cloud once rather than presenting a wall of
  inactive controls. Preserve discoverability and capability-derived access.
- Use one page title and short purpose sentence, with one primary action when
  applicable. Put breadcrumbs above details and filters next to their data.
  Avoid repeated eyebrow/title/title-card combinations.
- Keep account actions in one account area. Avoid duplicate Logout buttons.
  Preserve authorized Platform-view switching without redesigning Platform UI.
- Use 24px desktop workspace padding and 16px on small screens as defaults.
  Tables may use the available width; forms and prose use a readable maximum
  width. Do not expand two resource cards to fill an entire widescreen row.

## Reusable components and interaction

Use shared page headers, buttons, form fields, tabs, resource tables, pagination,
status badges, alerts, empty/loading states, and dialog/drawer patterns. Reuse
existing React and routing behavior; a new UI framework is not required.

**Actions and forms.** Use a blue primary button for the main action, bordered
secondary buttons, and low-emphasis tertiary links or menus. Put destructive
actions in an explicit danger section with consequence-specific confirmation.
Every input needs a persistent label; placeholders are examples, not labels.
Show field errors next to their field and submission state on the action.
Do not discard entered values after a recoverable error. Preserve existing
idempotency, explicit execution confirmation, and server-validated scope.

**Tables.** Prefer compact rows for resources, people, invoices, and devices.
Use sentence-case headers, row dividers, visible sort state, a nearby search and
filter toolbar, and explicit detail links. Keep row identity visible when
scrolling. Use server query/pagination for large fleets; do not fetch all devices
to support a visual redesign. Display result count and page position; avoid
inactive pagination chrome when there is only one page. Keep existing backend
selection semantics; do not promise cross-page bulk selection unless supported.

**Details.** Use a consistent detail page or drawer with a resource title,
status, summary, and contextual actions. Put long IDs and technical metadata in
copyable details. An action-menu label must identify the associated resource.
Use icons selectively to clarify actions and states, not on every field.

**States and metrics.** Distinguish loading, empty, no search matches, unavailable,
stale, and permission denied. Unknown is not zero. Every metric needs a clear
meaning, scope, time window, and unit; incompatible metrics must not be presented
as parts of the same total. Repeated unavailable telemetry should produce one
useful explanation plus local placeholders, not several warning cards. Show
last-updated information when supplied by the source. Never invent samples,
trends, counts, timestamps, or service health to make a dashboard look complete.

Preserve the contract's semantic badge meanings: green success, amber warning,
red failure, neutral unknown. Status always includes text; filled badges must
use a foreground/background pair that passes contrast. Prefer compact badges
over coloring the whole resource card. Charts need readable labels, units,
legends and a text/table way to understand the result.

## Page patterns

| Page or workflow | Required presentation |
| --- | --- |
| My Clouds | Compact cloud list, All/Owned/Shared filters, one Create cloud action, role and owner metadata; quota near creation and a useful no-cloud state |
| Overview | Consistent scoped metrics, one attention list before secondary analysis, clearly distinguished missing telemetry, useful next actions |
| Products and details | Scannable resources, consistent status/model/service/role fields; product devices reuse the fleet table vocabulary |
| Fleet, groups, jobs | Search/filter table and consistent details; job scope, progress, failures and available next action remain clear |
| CSV provisioning | Upload → review validation → confirm execution; row counts and errors first, integrity/debug metadata secondary |
| Firmware & OTA | Separate releases from update-plan work; product selection and target review before confirmation; readable counts and upgrade rate |
| Analytics and reports | Shared timeframe/filter hierarchy, metric definitions, meaningful empty/unavailable states and clear report progress/history |
| Members & Access | Member and invitation lists with identity, role, scope and status; one invite flow and contextual access actions |
| Billing | Balance, estimated charges and payment state first; usage, invoices, payments and billing profile grouped predictably |
| Settings | General information first, technical identifiers in details, ownership transfer and deletion in separate lower-priority sections |
| Audit | Customer-scoped activity table with loading/empty/error states; accurate coverage description and no platform data fallback |
| Chipsets & SDKs | Distinguish cloud SDKs and hardware resources; platform/version/docs/download first, checksums and lengthy limitations in details |
| Developer Docs | Searchable directory, readable article width, clear breadcrumb/section navigation, usable code and overflow tables |
| Sign-in and account flows | Realtek-branded service entry with a desktop brand/form split and compact single-column mobile layout; preserve redirect/session behavior |
| Cloud Test Lab | One page title, device workspace and scoped selectors first; concise protocol tabs, neutral result surfaces and explicit live-action confirmation |
| PRO2 firmware burner | Shared console shell with a local-device task card, connected/disconnected states, visible workflow progress and a dark UART terminal |

### Service login presentation

The service entry uses the official Realtek mark and Connect+ wordmark in a quiet
header. Its desktop brand panel uses deep Realtek blue with cyan emphasis, concise
product context and no unsupported security or availability claims. The white
form panel keeps sign-in, account creation and recovery actions clearly separated.
At widths below 768px, the brand panel becomes a short banner and the extended
feature list is hidden so the form remains the primary task.

Use 46px form controls, persistent labels, a named password-visibility control,
password-manager autocomplete and announced error messages. Do not add decorative
third-party requests to the login page or change authentication/session contracts.
The initial September 2026 follow-up checked sign-in/signup at 1440, 1024, 768,
390 and 320px. For the subsequent upstream integration and current verification,
see the implementation report. The implementation is in
`web/src/service-login.css` and the existing auth views.

Configured social providers use full-width bordered white buttons, 46px minimum
height and 8px corners. Keep the provider identity legible without introducing a
second page theme. Render only available providers; email sign-in remains usable
when none are configured or a provider fails. Announce callback/start errors once,
preserve entered values, and pass through the exact validated next destination.
Do not change provider configuration, OAuth state, callbacks or session policy
for visual consistency.

### Developer tools added by upstream changes

Apply `web/src/developer-tools-ui.css` after the shared console and login layers.
Its selectors are scoped to the customer console and service login; it must not
retheme platform operations or alter SDK/runtime behavior.

Test Lab places the device workspace and protocol controls above long background
explanations. Keep explanations in a labelled disclosure, not remove them. Use
Realtek blue for the selected protocol, neutral output panels, readable monospace
messages and local table scrolling. Tabs support Left/Right, Home/End and a single
tab stop; changing protocol still stops existing playback and clears its metrics.
Device and live-test confirmations use the shared modal, contain keyboard focus,
cancel safely on Escape, and return focus to the initiating control after it is
re-enabled. Never issue a live request merely by opening a page or changing tabs.

The PRO2 tool uses a blue task-card rule, 24px title, compact controls and explicit
workflow state. Keep the dark terminal as a functional exception to white content
surfaces. Preserve local-only firmware/UART handling, secure-context warnings,
unsupported-browser guidance, device choice, destructive-action confirmations,
verification and disabled reset states. A connected fixture screenshot is not
hardware flashing or Web Serial compatibility evidence.

Check these newly integrated surfaces at 1440, 1024, 768, 390 and 320px. Review
Darwin and Linux desktop/mobile SDK and burner screenshots before regenerating
only those affected baselines; rerun comparisons without the update option.
Do not increase mismatch tolerances to make the refresh pass.

Settings, provisioning, firmware and billing copy must explain user decisions,
not implementation internals. Examples: "Review target devices", "Upload a CSV
file", "Payment activity", and "You can view reports. Contact an administrator
to create them." Technical product terms remain appropriate for developers.
Changing labels never changes API values, permissions, lifecycle states, payment
consent, or confirmation rules. Use the selected interface language consistently;
an unset region should have the localized missing-value label, not raw mixed
Chinese/English data text.

Documentation prose should remain around 72–80 characters per line on desktop;
code, diagrams and tables can use a wider region. Copy controls, release/version
context, and section navigation must use actual available content. Do not invent
installation commands, compatibility claims, support levels or release metadata.

## Accessibility and responsive acceptance

- Target WCAG 2.2 AA: normal text contrast at least 4.5:1; large text and required
  non-text controls at least 3:1. Check rendered colors, including hover,
  disabled-context explanation, badges and focus indicators.
- Provide a skip-to-content link, coherent headings, landmarks, visible keyboard
  focus, accessible names, sortable-header semantics, and keyboard-operable
  detail actions. Clickable table rows cannot be the only way to open details.
- Dialogs and mobile navigation manage focus, support Escape where safe, and
  return focus to their trigger. Confirmation must not happen on Escape or
  backdrop click. Announce asynchronous status changes without noisy repeats.
- Respect reduced motion. Do not make hover, animation, or color the only way
  to discover information or state.
- Check 1440px and 1280px desktop, 768px intermediate and 390px/360px mobile
  widths, plus 200% zoom. Avoid page-wide horizontal overflow. Local table/code
  scrolling is acceptable when its identity and controls remain usable.

## Review record and verification checklist

The September 2026 review found oversized My Clouds cards, inactive navigation
clutter, repeated telemetry warnings, inconsistent page families, developer-facing
implementation prose, and mixed-language missing-region text. The live overview
showed zero in its online denominator alongside 11 devices needing attention;
that requires source/scope verification, not a cosmetic number substitution.
The live Audit route rendered the shell without a content body. Source review
found a customer route with no corresponding render/data-loading branch.

Authenticated browsing redirected sign-in back to the console. Sign-in and
signup findings therefore came from source inspection, not a verified live
signed-out screenshot. Protected or unavailable states must be exercised with
authorized fixtures; do not change real resources just to populate screenshots.

Current customer Audit implementation filters local device-target events through
the authorized device set. Until the backend contract is deliberately expanded,
do not describe it as a complete cloud, billing or enterprise compliance history.
Use only the explicit cloud-scoped customer endpoint; never fall back to platform
audit data or render platform-only event metadata to fill the page.

For each row below, record viewport, account/role, fixture or environment, result,
and evidence location during QA. Unchecked items are pending acceptance, not
verified successes.

- [ ] My Clouds: owned/shared/empty/many clouds, create form, quota reached.
- [ ] Overview: populated/zero/partial/unavailable/stale metrics and region label.
- [ ] Products: list/detail/create/edit, product devices, unavailable/no access.
- [ ] Fleet/groups/jobs: filters, sorting, pagination, details, empty and progress.
- [ ] Provisioning: upload, validation errors, review, execution progress/failure.
- [ ] Firmware: no product, releases, artifact validation, target preview, plans.
- [ ] Analytics/reports: timeframe/filter changes, no data, failure, report states.
- [ ] Members: populated/empty, invite/edit, selected-product scope, confirmations.
- [ ] Billing: owner/read-only access, summary, usage, invoices and payment states.
- [ ] Settings: edit, identifiers, transfer/deletion entry and blocker states.
- [ ] Audit: customer events, empty/loading/error, revoked and cross-cloud access.
- [ ] SDKs/docs: directory/search/detail, unavailable resources, long code/tables.
- [ ] Account flows: signed-out login, signup, verification, reset, invitation.
- [ ] Shared controls: keyboard, focus, mobile navigation/dialog, contrast, zoom.
- [ ] Existing scope/auth/write behavior and out-of-scope shared-style regression.

Run the existing unit and relevant Playwright suites, then inspect representative
desktop/mobile captures for every page family and non-happy-path state. Keep
visual evidence separate from functional test results. A passing build is not
visual signoff; a new screenshot baseline is not proof of acceptable appearance.
