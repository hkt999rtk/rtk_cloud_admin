#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <release-bundle-or-stem>" >&2
  exit 1
fi

input="$1"
bundle="$input"
if [ ! -f "$bundle" ] && [ -f "$input.tar.gz" ]; then
  bundle="$input.tar.gz"
fi

case "$(basename "$bundle")" in
  rtk_cloud_admin-*.tar.gz)
    version="$(basename "$bundle")"
    version="${version#rtk_cloud_admin-}"
    version="${version%.tar.gz}"
    ;;
  *)
    echo "release bundle must be named rtk_cloud_admin-<version>.tar.gz" >&2
    exit 1
    ;;
esac

checksum="$bundle.sha256"
manifest="${bundle%.tar.gz}.object-manifest.json"

require_file() {
  if [ ! -s "$1" ]; then
    echo "missing or empty required file: $1" >&2
    exit 1
  fi
}

require_file "$bundle"
require_file "$checksum"
require_file "$manifest"

if command -v shasum >/dev/null 2>&1; then
  actual="$(shasum -a 256 "$bundle" | awk '{print $1}')"
elif command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$bundle" | awk '{print $1}')"
else
  echo "shasum or sha256sum is required" >&2
  exit 1
fi
expected="$(awk '{print $1}' "$checksum")"
if [ "$actual" != "$expected" ]; then
  echo "checksum mismatch for $bundle" >&2
  exit 1
fi

python3 - "$manifest" "$version" "$expected" <<'PY'
import json
import sys

manifest_path, version, expected_sha = sys.argv[1], sys.argv[2], sys.argv[3]
with open(manifest_path, "r", encoding="utf-8") as handle:
    manifest = json.load(handle)

required = ["version", "source_commit", "bundle", "artifact_path", "sha256", "created_at"]
missing = [field for field in required if not manifest.get(field)]
if missing:
    raise SystemExit(f"manifest missing fields: {', '.join(missing)}")

bundle = f"{version}.tar.gz"
if manifest["version"] != version:
    raise SystemExit("manifest version mismatch")
if manifest["bundle"] != bundle:
    raise SystemExit("manifest bundle mismatch")
if manifest["artifact_path"] != f"releases/rtk_cloud_admin-{version}/{bundle}":
    raise SystemExit("manifest artifact_path mismatch")
if manifest["sha256"] != expected_sha:
    raise SystemExit("manifest sha256 mismatch")
if manifest.get("format") not in ("native-tar", None):
    raise SystemExit("manifest format must be native-tar")
if not manifest["created_at"].endswith("Z"):
    raise SystemExit("manifest created_at must be UTC Z")
PY

tmp="$(mktemp -d)"
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT

gzip -t "$bundle"
tar -xzf "$bundle" -C "$tmp"
release_dir="$tmp/rtk_cloud_admin-$version"
require_file "$release_dir/manifest.txt"
require_file "$release_dir/SHA256SUMS"
require_file "$release_dir/bin/rtk-cloud-admin"
require_file "$release_dir/web/dist/index.html"
test -x "$release_dir/bin/rtk-cloud-admin" || { echo "release binary is not executable" >&2; exit 1; }
(
  cd "$release_dir"
  shasum -a 256 -c SHA256SUMS >/dev/null
)

echo "release bundle verification passed: $bundle"
