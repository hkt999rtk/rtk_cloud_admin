#!/usr/bin/env bash
set -euo pipefail

report="${1:-docs/TEST_REPORT.md}"

if [ ! -s "$report" ]; then
  echo "test report is missing or empty: $report" >&2
  exit 1
fi

for heading in "## Summary" "## CI Test Matrix" "## Coverage By Package" "## Artifact Policy"; do
  if ! grep -qx "$heading" "$report"; then
    echo "missing required heading: $heading" >&2
    exit 1
  fi
done

if grep -Eiq '(access_token|refresh_token|authorization: bearer|rtk_admin_session=|password=|password":|secret=|video_cloud_admin_token|admin_bootstrap_password)' "$report"; then
  echo "test report contains a redaction-sensitive token pattern" >&2
  exit 1
fi

if grep -Eq '^\+\+\+|^---|^Step [0-9]+/|docker buildx|Sending build context|Successfully built|coverage mode:|^mode: ' "$report"; then
  echo "test report appears to contain raw logs or raw coverage data" >&2
  exit 1
fi
