#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

FAKE_BIN="$TMP_DIR/bin"
mkdir -p "$FAKE_BIN"

cat > "$FAKE_BIN/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "${FAKE_DOCKER_LOG:?}"
case "$1" in
  build)
    exit 0
    ;;
  save)
    printf 'fake docker image archive for %s\n' "$2"
    ;;
  load)
    shift
    while [ "$#" -gt 0 ]; do
      case "$1" in
        -i)
          test -s "$2"
          shift 2
          ;;
        *)
          shift
          ;;
      esac
    done
    ;;
  image)
    test "$2" = "inspect"
    test "$3" = "rtk-cloud-admin:${EXPECTED_VERSION:?}"
    ;;
  *)
    echo "unexpected docker command: $*" >&2
    exit 1
    ;;
esac
SH
chmod +x "$FAKE_BIN/docker"

cat > "$FAKE_BIN/ssh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "${FAKE_SSH_LOG:?}"
exit 0
SH
chmod +x "$FAKE_BIN/ssh"

cat > "$FAKE_BIN/scp" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "${FAKE_SCP_LOG:?}"
exit 0
SH
chmod +x "$FAKE_BIN/scp"

export PATH="$FAKE_BIN:$PATH"
export FAKE_DOCKER_LOG="$TMP_DIR/docker.log"
export FAKE_SSH_LOG="$TMP_DIR/ssh.log"
export FAKE_SCP_LOG="$TMP_DIR/scp.log"
export EXPECTED_VERSION="test-local"
: > "$FAKE_DOCKER_LOG"
: > "$FAKE_SSH_LOG"
: > "$FAKE_SCP_LOG"

OUTPUT_DIR="$TMP_DIR/dist"
OUTPUT_DIR="$OUTPUT_DIR" VERSION="$EXPECTED_VERSION" "$ROOT_DIR/deploy/package-release.sh"

BUNDLE="$OUTPUT_DIR/rtk_cloud_admin-$EXPECTED_VERSION.tar.gz"
CHECKSUM="$BUNDLE.sha256"
MANIFEST="$OUTPUT_DIR/rtk_cloud_admin-$EXPECTED_VERSION.object-manifest.json"

test -s "$BUNDLE"
test -s "$CHECKSUM"
test -s "$MANIFEST"

python3 - "$MANIFEST" "$EXPECTED_VERSION" <<'PY'
import json
import sys

manifest_path, version = sys.argv[1], sys.argv[2]
with open(manifest_path, "r", encoding="utf-8") as handle:
    manifest = json.load(handle)
assert manifest["version"] == version
assert manifest["bundle"] == f"rtk_cloud_admin-{version}.tar.gz"
assert manifest["artifact_path"] == f"releases/{version}/rtk_cloud_admin-{version}.tar.gz"
assert manifest["sha256"]
assert manifest["created_at"].endswith("Z")
PY

"$ROOT_DIR/deploy/check-release.sh" "$BUNDLE"

SSH_KEY="$TMP_DIR/id_ed25519"
printf 'fake-key\n' > "$SSH_KEY"
chmod 0600 "$SSH_KEY"
: > "$FAKE_DOCKER_LOG"

ADMIN_LINODE_RELEASE="$EXPECTED_VERSION" \
ADMIN_LINODE_RELEASE_BUNDLE="$BUNDLE" \
ADMIN_LINODE_DOMAIN="admin.example.test" \
ADMIN_LINODE_CERTBOT_EMAIL="admin@example.test" \
ADMIN_LINODE_HOST="203.0.113.10" \
ADMIN_LINODE_SSH_KEY="$SSH_KEY" \
ACCOUNT_MANAGER_BASE_URL="https://account.example.test" \
VIDEO_CLOUD_BASE_URL="https://video.example.test" \
VIDEO_CLOUD_ADMIN_TOKEN="token" \
ADMIN_BOOTSTRAP_EMAIL="admin@example.test" \
ADMIN_BOOTSTRAP_PASSWORD="password" \
"$ROOT_DIR/deploy/linode/deploy-admin.sh"

if grep -q '^build ' "$FAKE_DOCKER_LOG"; then
  echo "deploy-admin.sh built a local Docker image despite ADMIN_LINODE_RELEASE_BUNDLE" >&2
  cat "$FAKE_DOCKER_LOG" >&2
  exit 1
fi
grep -q "$BUNDLE" "$FAKE_SCP_LOG"

echo "release artifact tests passed"
