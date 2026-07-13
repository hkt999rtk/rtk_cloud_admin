# Test Report

## Summary

| Item | Result |
|---|---|
| Go total coverage | 65.3% |
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
| `rtk_cloud_admin/internal/accountclient` | 50.2% |
| `rtk_cloud_admin/internal/app` | 64.1% |
| `rtk_cloud_admin/internal/config` | 85.7% |
| `rtk_cloud_admin/internal/correlation` | 90.5% |
| `rtk_cloud_admin/internal/readinessfacts` | 86.0% |
| `rtk_cloud_admin/internal/store` | 78.3% |
| `rtk_cloud_admin/internal/videoclient` | 86.2% |

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
