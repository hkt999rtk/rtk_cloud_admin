# Test Report

## 2026-09-01 automatic scoped UI fixture

- The Product/device/sharing cases no longer require a manually started server
  or skip flag. A worker-scoped Playwright fixture owns a Go test process,
  temporary SQLite database and dynamic loopback port; cleanup stops that exact
  process and removes only its own binary directory.
- Flag-free desktop/Pixel 7 run: 6 PASS (50.6s), two workers; log:
  `/tmp/rtk-scoped-ui-auto-tests.log`. Per-project screenshots are under
  `/tmp/rtk-scoped-ui-auto-evidence/raw/main/` and were inspected.
  The preliminary combined reporter target label is not per-target evidence.
- Frontend unit tests: 131 PASS; scoped Go tests/race, vet, Go build and web
  build pass. Logs: `/tmp/rtk-scoped-ui-auto-node.log`,
  `/tmp/rtk-scoped-ui-auto-go-race.log`, `/tmp/rtk-scoped-ui-auto-build.log`.
- No deployed service, external email, provider or shared database was used.
  Full suite, Linux CI, service integration and staging acceptance remain open.

## Summary

| Item | Result |
|---|---|
| Go total coverage | 80.4% |
| Go coverage gate | >= 65.0% |
| Report source | CI-generated canonical candidate |
| Raw logs | GitHub Actions artifact only |
| Coverage profile | GitHub Actions artifact only |

## CI Test Matrix

| Area | Command / Check | Result |
|---|---|---|
| Backend | `go test ./... -coverprofile=coverage.out` | PASS |
| Backend | `go build ./cmd/server` | PASS |
| Backend | Go total coverage >= 65.0% | PASS |
| Frontend | `npm ci` | PASS |
| Frontend | `npm test` | PASS |
| Frontend | `npm run build` | PASS |
| Runtime | Native server smoke test | PASS |

## Coverage By Package

| Package | Coverage |
|---|---:|
| `rtk_cloud_admin/cmd/s3put` | 73.4% |
| `rtk_cloud_admin/cmd/server` | 0.0% |
| `rtk_cloud_admin/internal/accountclient` | 89.2% |
| `rtk_cloud_admin/internal/app` | 81.1% |
| `rtk_cloud_admin/internal/billingclient` | 30.2% |
| `rtk_cloud_admin/internal/config` | 100.0% |
| `rtk_cloud_admin/internal/correlation` | 90.5% |
| `rtk_cloud_admin/internal/readinessfacts` | 86.0% |
| `rtk_cloud_admin/internal/store` | 80.4% |
| `rtk_cloud_admin/internal/videoclient` | 86.3% |

## Artifact Policy

- Raw command logs are uploaded as CI artifacts and are not committed.
- Native server smoke diagnostics are uploaded as CI artifacts and are not committed.
- `coverage.out` is uploaded as a CI artifact and is not committed.
- This report contains only sanitized summaries and pass/fail outcomes.

## Required Headings

- Summary
- CI Test Matrix
- Coverage By Package
- Artifact Policy

## Local Product implementation checkpoint — 2026-08-31

The CI-generated baseline above is historical, not the result for this unmerged
local implementation. Current local validation: full Go suite PASS, total
statement coverage **81.1%**; scoped Product race tests PASS twice; vet, server
build and frontend build PASS; frontend unit tests **127 PASS**. The opt-in
Product browser case passed on desktop Chromium and emulated Pixel 7, including
CRUD/disable fixture readback, pagination, viewer/cross-cloud denial and passive
revocation. This uses synthetic upstreams/temporary SQLite, not staging or real
financial operations. OpenAPI validation PASS; inventory has zero blocking
findings, but the workspace traceability freshness check is still FAIL.

See `multicloud_implementation_progress.md` for reproducible commands, local
artifact locations and remaining CI/cross-service/staging gates. These results
do not establish end-to-end release acceptance.

## Local Product-device checkpoint — 2026-08-31

Full local Go suite PASS, total statement coverage **81.0%**; targeted device/
Product race cases PASS twice; vet and frontend build PASS; **131 frontend unit
tests PASS**. Product and device browser cases PASS on desktop and emulated
Pixel 7 (**4 passes**). Device display updates preserve serial and scope on fixture
readback; real persistence/identity preservation is separately tested in AM's
isolated PostgreSQL suite. These are not staging or hosted CI results.

AM/Admin OpenAPI validation PASS. A combined current AM/Billing/Admin inventory
reveals **21 blocking operation mappings** and stale workspace traceability;
the earlier Admin-only zero-blocker report is not combined integration evidence.
Full release acceptance remains incomplete. See the implementation progress
document for scope, commands, artifacts and remaining gates.

## Local Product-sharing pagination checkpoint — 2026-08-31

All Admin Go packages, vet, 131 frontend unit tests and frontend build PASS.
Product/device/sharing browser cases PASS on desktop and emulated Pixel 7;
the final sharing case additionally verifies exact cross-page Product IDs,
off-page deselection, retry without lost selection, initial request deduplication,
different-cloud tabs and passive revocation. Screenshot inspection confirms
readable desktop/mobile layouts without horizontal overflow.

These are opt-in local fixtures, not a live owner invitation or CI-qualified
deployment. See `multicloud_implementation_progress.md` for source provenance and
artifact paths. Its refreshed inventory section also supersedes the earlier
21-blocker diagnostic above; no requirement was removed to pass the inventory.
