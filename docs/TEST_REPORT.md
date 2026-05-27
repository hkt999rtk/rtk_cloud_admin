# Test Report

## Summary

| Item | Result |
|---|---|
| Go total coverage | 80.7% |
| Go coverage gate | >= 80.0% |
| Raw logs | GitHub Actions artifact only |
| Coverage profile | GitHub Actions artifact only |

## CI Test Matrix

| Area | Command / Check | Result |
|---|---|---|
| Backend | `go test ./... -coverprofile=coverage.out` | PASS |
| Backend | `go build ./cmd/server` | PASS |
| Backend | Go total coverage >= 80.0% | PASS |
| Frontend | `npm ci` | PASS |
| Frontend | `npm test` | PASS |
| Frontend | `npm run build` | PASS |
| Runtime | Native server smoke test | PASS |

## Coverage By Package

| Package | Coverage |
|---|---:|
| `rtk_cloud_admin/cmd/server` | 0.0% |
| `rtk_cloud_admin/internal/accountclient` | 88.8% |
| `rtk_cloud_admin/internal/app` | 80.6% |
| `rtk_cloud_admin/internal/config` | 100.0% |
| `rtk_cloud_admin/internal/readinessfacts` | 85.4% |
| `rtk_cloud_admin/internal/store` | 80.1% |
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
