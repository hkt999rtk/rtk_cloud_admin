#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${OUTPUT_DIR:-$ROOT_DIR/dist}"
VERSION="${VERSION:-}"
DOCKER_BIN="${DOCKER_BIN:-docker}"

if [ -z "$VERSION" ]; then
  if command -v git >/dev/null 2>&1 && git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    VERSION="$(git -C "$ROOT_DIR" rev-parse --short HEAD)"
  else
    VERSION="$(date +%Y%m%d%H%M%S)"
  fi
fi

case "$VERSION" in
  *[!A-Za-z0-9._-]* | "" | .* | *..*)
    echo "invalid VERSION: use only letters, digits, dot, underscore, and dash" >&2
    exit 1
    ;;
esac

SOURCE_COMMIT="${GITHUB_SHA:-unknown}"
if [ "$SOURCE_COMMIT" = "unknown" ] && command -v git >/dev/null 2>&1 && git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  SOURCE_COMMIT="$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || printf unknown)"
fi

mkdir -p "$OUTPUT_DIR"

image_tag="rtk-cloud-admin:$VERSION"
bundle="$OUTPUT_DIR/rtk_cloud_admin-$VERSION.tar.gz"
checksum="$bundle.sha256"
manifest="$OUTPUT_DIR/rtk_cloud_admin-$VERSION.object-manifest.json"

printf '[release] building Docker image %s\n' "$image_tag" >&2
"$DOCKER_BIN" build --platform linux/amd64 -t "$image_tag" "$ROOT_DIR"

printf '[release] saving image archive %s\n' "$bundle" >&2
rm -f "$bundle" "$checksum" "$manifest"
"$DOCKER_BIN" save "$image_tag" | gzip -c > "$bundle"

if command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "$bundle" | awk '{print $1}' > "$checksum"
elif command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$bundle" | awk '{print $1}' > "$checksum"
else
  echo "shasum or sha256sum is required" >&2
  exit 1
fi

VERSION="$VERSION" OUTPUT_DIR="$OUTPUT_DIR" SOURCE_COMMIT="$SOURCE_COMMIT" BUNDLE_SHA256_PATH="$checksum" python3 - <<'PY' > "$manifest"
import json
import os
from datetime import datetime, timezone
from pathlib import Path

version = os.environ["VERSION"]
bundle = f"rtk_cloud_admin-{version}.tar.gz"
checksum = Path(f"{os.environ.get('OUTPUT_DIR', 'dist')}/{bundle}.sha256")
if not checksum.exists():
    checksum = Path(os.environ["BUNDLE_SHA256_PATH"])
sha256 = checksum.read_text(encoding="utf-8").strip()
print(json.dumps({
    "version": version,
    "source_commit": os.environ["SOURCE_COMMIT"],
    "bundle": bundle,
    "artifact_path": f"releases/{version}/{bundle}",
    "sha256": sha256,
    "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
}, indent=2, sort_keys=True))
PY

printf '[release] created %s\n' "$bundle" >&2
