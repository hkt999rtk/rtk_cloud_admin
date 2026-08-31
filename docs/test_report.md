# Test Report

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
