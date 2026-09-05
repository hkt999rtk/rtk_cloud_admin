# Realtek developer console UI implementation

Date: 2026-09-05

## Upstream integration follow-up

The refresh is now integrated on Admin main `68e976c`, preserving upstream social
login, Test Lab management/mapping workflows, the PRO2 browser burner and their
safety/coverage improvements. The original checkout was left intact; the merged
implementation is on the local `codex/ui-quality-integration-20260905` branch in
the isolated integration workspace.

New developer tools now share the Realtek palette and control/layout vocabulary.
Test Lab adds keyboard-operable protocol tabs and a shared confirmation modal;
closing its dialog restores trigger focus without executing the action. The
platform context badge remains visible, while view switching is in Account.
Social provider buttons and callback errors share the service login treatment.
No authentication, billing, scope or firmware protocol contracts were replaced.

The workspace report `docs/ui-quality-integration-20260905.md` records current
versions, test results, evidence and release boundaries. The sections below are
the initial refresh's historical record; their earlier test counts, preview port,
uncommitted status and pending snapshot refresh do not describe this follow-up.

## Service login follow-up

The service login now has a Realtek-branded split layout, deep-blue product
introduction, focused white sign-in panel and compact mobile banner. Sign-in,
inline account creation, recovery and reset share the new entry layout. Added
password visibility, autofill metadata and announced login errors without changing
the authentication API or redirect/session behavior. The follow-up production build,
149 unit tests and 29 desktop/mobile authentication browser checks passed. Captures
at 1440, 1024, 768, 390 and 320px are stored in
`.artifacts/test-runs/service-login/`. No deployment is included.

## Delivered

- Realtek corporate blue (`#0068b7`, dark `#035390`), neutral surfaces, readable
  14px tables, 12px metadata, consistent borders, spacing and focus outlines.
- Shared customer shell for cloud pages, fleet, SDK/docs and all six Billing views;
  contextual breadcrumbs, cloud switching, skip link and one account menu.
- Compact cloud list and product/device tables; copyable identifiers and readable
  status labels. Existing scoped permissions and allowed actions remain authoritative.
- Native create/edit/invite dialogs with keyboard focus containment, Escape and
  focus return; inline validation remains visible inside the dialog.
- General settings before collapsed transfer/deletion workflows. Existing PKI
  tools remain reachable through the overview's cloud-settings tab.
- Overview preserves unknown online counts instead of constructing `– / 0`,
  consolidates unavailable telemetry notices and omits unavailable charts.
- Seven-column fleet table, labelled search and sort announcements, keyboard
  device-row opening; detailed metadata remains in the existing drawer.
- Provisioning upload/validation/execution progress and labelled inputs; durable
  jobs, OTA scope preview, firmware upload and report contracts remain unchanged.
- Customer Audit now renders explicit cloud-scoped device activity, including
  loading, empty, error and revoked states. It is **not** a complete compliance log.
- Billing plan information is secondary to operational balances and costs.
- Documentation directory and articles use readable typography, section navigation,
  and code-copy controls with success/failure announcements. Cloud context is kept.
- Public verification/onboarding branding aligns with the existing shared sign-in.
- [Web UI style guideline](web-ui-style-guideline.md) and canonical shared styling
  guidance updated. Platform body styling is excluded from the customer theme.

## Verification

- Production build passed. The existing large-JavaScript-chunk advisory remains;
  this change does not add a charting library or component framework.
- 149 unit tests passed.
- Core desktop/mobile browser run: **65 passed** (account, audit, billing,
  documentation, responsive shell, product/device scope, sharing, provisioning).
- Final navigation/page-family run: **18 passed** across desktop and mobile.
- Extended run validated firmware artifact metadata, OTA server scope/progress,
  report submission/results/idempotency, SDK fallback and platform account/audit
  behavior. Seven environment-specific error cases were skipped by their existing
  fixture guards; those skips are not acceptance evidence.
- Responsive coverage exercises 1440, 1280, 768 and 390px. Product, billing,
  documentation and mobile captures were visually inspected. Browser-generated
  screenshots and evidence are under the workspace's
  `.artifacts/test-runs/manual/ui/desktop/` directory.
- Tests exercise real local BFFs and/or isolated fixtures, never live customer
  modifications. Older assertions were updated for deliberate changes such as
  account-menu logout, collapsed ownership controls, contextual titles and the
  corporate primary blue; tenant and write-safety assertions were retained.

## Release boundary and remaining acceptance

No deployment, commit, PR, database change, or live customer write is included.
The local preview at `http://127.0.0.1:18082` contains disposable test data.

Before deployment, obtain visual acceptance in the target development environment
and run the environment-specific error suites with their required fixtures. A
formal accessibility audit, actual browser 200% zoom check, and approved visual
snapshot-baseline refresh are still required; responsive checks are not substitutes
for those checks. The checklist in the style guideline is the broader acceptance
matrix, not a claim that every possible backend state has been exercised.

The review's inconsistent live telemetry/attention counts need separate source
and scope investigation if they persist. This UI change does not fabricate totals
or modify the telemetry backend to make the overview numbers agree.
