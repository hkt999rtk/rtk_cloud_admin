#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${OUTPUT_DIR:-$ROOT_DIR/dist}"
VERSION="${VERSION:-}"

if [[ -z "$VERSION" ]]; then
	if git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
		VERSION="$(git -C "$ROOT_DIR" rev-parse --short HEAD)"
	else
		VERSION="$(date -u +%Y%m%d%H%M%S)"
	fi
fi

case "$VERSION" in
*[!A-Za-z0-9._-]* | "" | .* | *..*)
	printf 'invalid VERSION: use only letters, digits, dot, underscore, and dash\n' >&2
	exit 1
	;;
esac

SOURCE_COMMIT="unknown"
if git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
	SOURCE_COMMIT="$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || printf unknown)"
fi

RELEASE_NAME="rtk_cloud_admin-$VERSION"
STAGE_DIR="$OUTPUT_DIR/$RELEASE_NAME"
TARBALL="$OUTPUT_DIR/$RELEASE_NAME.tar.gz"

printf 'Packaging rtk_cloud_admin release\n'
printf '  version: %s\n' "$VERSION"
printf '  output:  %s\n' "$OUTPUT_DIR"

rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR/bin" "$STAGE_DIR/web" "$OUTPUT_DIR"

(
	cd "$ROOT_DIR/web"
	npm ci
	npm run build
)

(
	cd "$ROOT_DIR"
	GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o "$STAGE_DIR/bin/rtk-cloud-admin" ./cmd/server
)

cp -R "$ROOT_DIR/web/dist" "$STAGE_DIR/web/dist"

cat > "$STAGE_DIR/manifest.txt" <<EOF
release_name=$RELEASE_NAME
version=$VERSION
source_commit=$SOURCE_COMMIT
binary=bin/rtk-cloud-admin
web_dist=web/dist
EOF

(
	cd "$STAGE_DIR"
	if command -v shasum >/dev/null 2>&1; then
		find . -type f ! -name SHA256SUMS | sort | xargs shasum -a 256 > SHA256SUMS
	else
		find . -type f ! -name SHA256SUMS | sort | xargs sha256sum > SHA256SUMS
	fi
)

rm -f "$TARBALL"
COPYFILE_DISABLE=1 tar --no-xattrs -C "$OUTPUT_DIR" -czf "$TARBALL" "$RELEASE_NAME"

printf 'Release bundle created:\n'
printf '  %s\n' "$STAGE_DIR"
printf '  %s\n' "$TARBALL"
