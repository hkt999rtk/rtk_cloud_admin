#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${OUTPUT_DIR:-$ROOT_DIR/dist}"
VERSION="${VERSION:-}"
GOOS="${GOOS:-linux}"
GOARCH="${GOARCH:-amd64}"

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

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "$1 is required" >&2; exit 1; }
}

need go
need npm
need tar

mkdir -p "$OUTPUT_DIR"

bundle="$OUTPUT_DIR/rtk_cloud_admin-$VERSION.tar.gz"
checksum="$bundle.sha256"
manifest="$OUTPUT_DIR/rtk_cloud_admin-$VERSION.object-manifest.json"
staging="$(mktemp -d)"
cleanup() { rm -rf "$staging"; }
trap cleanup EXIT

release_name="rtk_cloud_admin-$VERSION"
release_dir="$staging/$release_name"
mkdir -p "$release_dir/bin" "$release_dir/web"

printf '[release] building frontend\n' >&2
(cd "$ROOT_DIR/web" && npm ci && npm run build)
cp -R "$ROOT_DIR/web/dist" "$release_dir/web/dist"

printf '[release] building %s/%s binary\n' "$GOOS" "$GOARCH" >&2
(
  cd "$ROOT_DIR"
  CGO_ENABLED=0 GOOS="$GOOS" GOARCH="$GOARCH" go build -trimpath -ldflags "-s -w" -o "$release_dir/bin/rtk-cloud-admin" ./cmd/server
)
chmod 0755 "$release_dir/bin/rtk-cloud-admin"

cat > "$release_dir/manifest.txt" <<EOF_MANIFEST
release_name=$release_name
version=$VERSION
source_commit=$SOURCE_COMMIT
binary=bin/rtk-cloud-admin
web_dist=web/dist
goos=$GOOS
goarch=$GOARCH
EOF_MANIFEST

(
  cd "$release_dir"
  find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 shasum -a 256 > SHA256SUMS
)

printf '[release] creating native bundle %s\n' "$bundle" >&2
rm -f "$bundle" "$checksum" "$manifest"
COPYFILE_DISABLE=1 tar -czf "$bundle" -C "$staging" "$release_name"

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
local_bundle = f"rtk_cloud_admin-{version}.tar.gz"
object_bundle = f"{version}.tar.gz"
checksum = Path(os.environ["BUNDLE_SHA256_PATH"])
sha256 = checksum.read_text(encoding="utf-8").strip()
print(json.dumps({
    "version": version,
    "source_commit": os.environ["SOURCE_COMMIT"],
    "bundle": object_bundle,
    "artifact_path": f"releases/rtk_cloud_admin-{version}/{object_bundle}",
    "sha256": sha256,
    "format": "native-tar",
    "binary": "bin/rtk-cloud-admin",
    "web_dist": "web/dist",
    "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
}, indent=2, sort_keys=True))
PY

printf '[release] created %s\n' "$bundle" >&2
