#!/usr/bin/env bash
set -euo pipefail

coverage_file="${1:-coverage.out}"
logs_dir="${2:-.artifacts/logs}"
output="${3:-.artifacts/report-candidates/docs/TEST_REPORT.md}"
coverage_min="${COVERAGE_MIN:-80.0}"

status_for_log() {
  local file="$1"
  local status_file="${file%.log}.status"
  if [ -s "$status_file" ]; then
    cat "$status_file"
  elif [ -s "$file" ]; then
    printf "UNKNOWN"
  else
    printf "UNKNOWN"
  fi
}

total_coverage="unknown"
if [ -s "$coverage_file" ]; then
  total_coverage="$(go tool cover -func="$coverage_file" | awk '/^total:/ { print $3 }')"
fi

mkdir -p "$(dirname "$output")"
cat > "$output" <<EOF
# Test Report

## Summary

| Item | Result |
|---|---|
| Go total coverage | ${total_coverage} |
| Go coverage gate | >= ${coverage_min}% |
| Raw logs | GitHub Actions artifact only |
| Coverage profile | GitHub Actions artifact only |

## CI Test Matrix

| Area | Command / Check | Result |
|---|---|---|
| Backend | \`go test ./... -coverprofile=coverage.out\` | $(status_for_log "$logs_dir/go-test.log") |
| Backend | \`go build ./cmd/server\` | $(status_for_log "$logs_dir/go-build.log") |
| Backend | Go total coverage >= ${coverage_min}% | $(status_for_log "$logs_dir/go-coverage-gate.log") |
| Frontend | \`npm ci\` | $(status_for_log "$logs_dir/frontend-install.log") |
| Frontend | \`npm test\` | $(status_for_log "$logs_dir/frontend-test.log") |
| Frontend | \`npm run build\` | $(status_for_log "$logs_dir/frontend-build.log") |
| Runtime | Native server smoke test | $(status_for_log "$logs_dir/native-smoke.log") |

## Coverage By Package

| Package | Coverage |
|---|---:|
EOF

if [ -s "$logs_dir/go-test.log" ]; then
  awk '
    /coverage: [0-9.]+% of statements/ {
      pkg=""
      pct=""
      for (i = 1; i <= NF; i++) {
        if ($i ~ /^rtk_cloud_admin\//) pkg=$i
        if ($i ~ /^[0-9.]+%$/) pct=$i
      }
      if (pkg == "" || pct == "") next
      printf "| `%s` | %s |\n", pkg, pct
    }
  ' "$logs_dir/go-test.log" | sort >> "$output"
fi

cat >> "$output" <<'EOF'

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
EOF
