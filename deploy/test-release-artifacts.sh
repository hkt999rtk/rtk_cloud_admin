#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

FAKE_BIN="$TMP_DIR/bin"
mkdir -p "$FAKE_BIN"

cat > "$FAKE_BIN/ssh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "${FAKE_SSH_LOG:?}"
remote=""
for arg in "$@"; do
  if [ "$arg" = "root@203.0.113.10" ]; then
    remote="$arg"
  fi
done
if [ "$remote" = "root@203.0.113.10" ]; then
  script="$(cat)"
  printf '%s\n' "$script" > "${FAKE_REMOTE_SCRIPT:?}"
  if grep -Eq 'docker|docker\\.io|containerd|ExecStart=.*docker|docker load' "$FAKE_REMOTE_SCRIPT"; then
    echo "remote deploy script still contains Docker runtime commands" >&2
    exit 1
  fi
fi
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
export FAKE_SSH_LOG="$TMP_DIR/ssh.log"
export FAKE_SCP_LOG="$TMP_DIR/scp.log"
export FAKE_REMOTE_SCRIPT="$TMP_DIR/remote-script.sh"
export EXPECTED_VERSION="test-local"
: > "$FAKE_SSH_LOG"
: > "$FAKE_SCP_LOG"
: > "$FAKE_REMOTE_SCRIPT"

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
assert manifest["bundle"] == f"{version}.tar.gz"
assert manifest["artifact_path"] == f"releases/rtk_cloud_admin-{version}/{version}.tar.gz"
assert manifest["format"] == "native-tar"
assert manifest["binary"] == "bin/rtk-cloud-admin"
assert manifest["web_dist"] == "web/dist"
assert manifest["sha256"]
assert manifest["created_at"].endswith("Z")
PY

tar -tzf "$BUNDLE" | grep -Fx "rtk_cloud_admin-$EXPECTED_VERSION/bin/rtk-cloud-admin" >/dev/null
tar -tzf "$BUNDLE" | grep -Fx "rtk_cloud_admin-$EXPECTED_VERSION/web/dist/index.html" >/dev/null
"$ROOT_DIR/deploy/check-release.sh" "$BUNDLE"

SSH_KEY="$TMP_DIR/id_ed25519"
printf 'fake-key\n' > "$SSH_KEY"
chmod 0600 "$SSH_KEY"

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

grep -q "$BUNDLE" "$FAKE_SCP_LOG"
grep -q "rtk-cloud-admin-release.tar.gz" "$FAKE_SCP_LOG"
grep -q "ExecStart=.*bin/rtk-cloud-admin" "$FAKE_REMOTE_SCRIPT"
grep -q "tar --warning=no-unknown-keyword -xzf" "$FAKE_REMOTE_SCRIPT"
grep -q "ln -sf /etc/nginx/sites-available/rtk-cloud-admin.conf /etc/nginx/conf.d/rtk-cloud-admin.conf" "$FAKE_REMOTE_SCRIPT"

echo "release artifact tests passed"
