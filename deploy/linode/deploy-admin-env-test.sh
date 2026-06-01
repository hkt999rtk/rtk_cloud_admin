#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

fake_bin="$tmpdir/bin"
capture="$tmpdir/capture"
mkdir -p "$fake_bin" "$capture" "$tmpdir/release"

cat > "$fake_bin/ssh" <<'FAKE_SSH'
#!/usr/bin/env bash
set -euo pipefail
mkdir -p "$RTK_TEST_CAPTURE_DIR"
if [ "$#" -gt 0 ] && [ "${*: -1}" = "mkdir -p /tmp/rtk-cloud-admin-deploy" ]; then
  exit 0
fi
if printf '%s\n' "$*" | grep -q 'bash -s'; then
  cat > "$RTK_TEST_CAPTURE_DIR/remote-install.sh"
  printf '%s\n' "$*" > "$RTK_TEST_CAPTURE_DIR/remote-install-args.txt"
  exit 0
fi
exit 0
FAKE_SSH
chmod +x "$fake_bin/ssh"

cat > "$fake_bin/scp" <<'FAKE_SCP'
#!/usr/bin/env bash
set -euo pipefail
mkdir -p "$RTK_TEST_CAPTURE_DIR"
src="${@: -2:1}"
dest="${@: -1}"
case "$dest" in
  *:/tmp/rtk-cloud-admin-deploy/admin.env)
    cp "$src" "$RTK_TEST_CAPTURE_DIR/admin.env"
    ;;
esac
FAKE_SCP
chmod +x "$fake_bin/scp"

release_bundle="$tmpdir/release/rtk_cloud_admin-test.tar.gz"
printf 'fake release\n' > "$release_bundle"
ssh_key="$tmpdir/id_ed25519"
printf 'fake key\n' > "$ssh_key"

PATH="$fake_bin:$PATH" \
RTK_TEST_CAPTURE_DIR="$capture" \
ADMIN_LINODE_DOMAIN="admin.example.test" \
ADMIN_LINODE_CERTBOT_EMAIL="admin@example.test" \
ADMIN_LINODE_HOST="203.0.113.30" \
ADMIN_LINODE_SSH_KEY="$ssh_key" \
ADMIN_LINODE_RELEASE="test" \
ADMIN_LINODE_RELEASE_BUNDLE="$release_bundle" \
ACCOUNT_MANAGER_BASE_URL="https://account-manager.example.test" \
VIDEO_CLOUD_BASE_URL="https://video-cloud.example.test" \
VIDEO_CLOUD_ADMIN_TOKEN="video-admin-token" \
VIDEO_CLOUD_PROMETHEUS_BASE_URL="http://10.42.1.30:9090" \
ADMIN_BOOTSTRAP_EMAIL="admin@example.test" \
ADMIN_BOOTSTRAP_PASSWORD="admin-password" \
  "$repo_root/deploy/linode/deploy-admin.sh" >/tmp/deploy-admin-env-test.out

grep -q '^VIDEO_CLOUD_PROMETHEUS_BASE_URL=http://10.42.1.30:9090$' "$capture/admin.env"

printf 'deploy-admin env test passed\n'
