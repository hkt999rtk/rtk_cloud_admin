#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
label="${ADMIN_LINODE_LABEL:-rtk-cloud-admin-staging}"
release="${ADMIN_LINODE_RELEASE:-$(git -C "$root_dir" rev-parse --short HEAD)}"
domain="${ADMIN_LINODE_DOMAIN:-}"
certbot_email="${ADMIN_LINODE_CERTBOT_EMAIL:-}"
ssh_user="${ADMIN_LINODE_SSH_USER:-root}"
ssh_key="${ADMIN_LINODE_SSH_KEY:-$HOME/.ssh/id_ed25519_rtkcloud}"
admin_host="${ADMIN_LINODE_HOST:-${ADMIN_LINODE_PUBLIC_IPV4:-}}"
release_bundle="${ADMIN_LINODE_RELEASE_BUNDLE:-}"
remote_bundle="${ADMIN_LINODE_REMOTE_BUNDLE:-/tmp/rtk-cloud-admin-${release}.tar.gz}"
data_dir="${ADMIN_LINODE_DATA_DIR:-/var/lib/rtk_cloud_admin}"
env_path="${ADMIN_LINODE_ENV_PATH:-/etc/rtk_cloud_admin/admin.env}"
certbot_enable="${ADMIN_LINODE_CERTBOT_ENABLE:-1}"
http_only="${ADMIN_LINODE_HTTP_ONLY:-0}"
artifact_dir="${ADMIN_LINODE_ARTIFACT_DIR:-$root_dir/.artifacts/linode-admin-deploy/$release}"

required_runtime=(
  ACCOUNT_MANAGER_BASE_URL
  VIDEO_CLOUD_BASE_URL
  VIDEO_CLOUD_ADMIN_TOKEN
  ADMIN_BOOTSTRAP_EMAIL
  ADMIN_BOOTSTRAP_PASSWORD
)

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required"
}

write_env() {
  local key="$1"
  local value="${!key:-}"
  if printf '%s' "$value" | grep -q '[[:cntrl:]]'; then
    die "$key contains control characters"
  fi
  if printf '%s' "$value" | grep -q '[[:space:]]'; then
    die "$key contains whitespace, which is not supported in admin env files"
  fi
  printf '%s=%s\n' "$key" "$value"
}

need ssh
need scp

[ -n "$domain" ] || die "ADMIN_LINODE_DOMAIN is required"
[ -n "$certbot_email" ] || [ "$certbot_enable" = "0" ] || die "ADMIN_LINODE_CERTBOT_EMAIL is required when certbot is enabled"
[ -n "$admin_host" ] || die "ADMIN_LINODE_HOST or ADMIN_LINODE_PUBLIC_IPV4 is required"
[ -s "$ssh_key" ] || die "SSH key not found: $ssh_key"
for key in "${required_runtime[@]}"; do
  [ -n "${!key:-}" ] || die "$key is required"
done

mkdir -p "$artifact_dir"

if [ -z "$release_bundle" ]; then
  printf '[admin-deploy] no release bundle supplied; building native release %s locally\n' "$release" >&2
  VERSION="$release" OUTPUT_DIR="$artifact_dir" "$root_dir/deploy/package.sh"
  release_bundle="$artifact_dir/rtk_cloud_admin-$release.tar.gz"
fi
[ -s "$release_bundle" ] || die "release bundle not found: $release_bundle"

ssh_opts=(-i "$ssh_key" -o BatchMode=yes -o StrictHostKeyChecking=accept-new)
remote="$ssh_user@$admin_host"

tmp_env="$(mktemp)"
cleanup() { rm -f "$tmp_env"; }
trap cleanup EXIT
{
  printf 'PORT=8080\n'
  printf 'DATABASE_PATH=%s/rtk-cloud-admin.db\n' "$data_dir"
  write_env ACCOUNT_MANAGER_BASE_URL
  write_env VIDEO_CLOUD_BASE_URL
  write_env VIDEO_CLOUD_ADMIN_TOKEN
  write_env ADMIN_BOOTSTRAP_EMAIL
  write_env ADMIN_BOOTSTRAP_PASSWORD
  printf 'ADMIN_BREAK_GLASS_ENABLED=%s\n' "${ADMIN_BREAK_GLASS_ENABLED:-true}"
  printf 'LEGACY_CUSTOMER_PASSWORD_LOGIN_ENABLED=%s\n' "${LEGACY_CUSTOMER_PASSWORD_LOGIN_ENABLED:-false}"
} > "$tmp_env"
chmod 0600 "$tmp_env"

printf '[admin-deploy] uploading release bundle and env to %s\n' "$remote" >&2
ssh "${ssh_opts[@]}" "$remote" "mkdir -p /tmp/rtk-cloud-admin-deploy"
scp "${ssh_opts[@]}" "$release_bundle" "$remote:$remote_bundle"
scp "${ssh_opts[@]}" "$tmp_env" "$remote:/tmp/rtk-cloud-admin-deploy/admin.env"

printf '[admin-deploy] installing runtime on %s\n' "$remote" >&2
ssh "${ssh_opts[@]}" "$remote" bash -s -- "$domain" "$certbot_email" "$release" "$remote_bundle" "$data_dir" "$env_path" "$certbot_enable" "$http_only" <<'REMOTE'
set -euo pipefail

domain="$1"
certbot_email="$2"
release="$3"
remote_bundle="$4"
data_dir="$5"
env_path="$6"
certbot_enable="$7"
http_only="$8"
release_root="/opt/rtk_cloud_admin/releases"
release_dir="$release_root/$release"
current_dir="/opt/rtk_cloud_admin/current"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl systemd ca-certificates gnupg2 lsb-release ubuntu-keyring
curl -fsS https://nginx.org/keys/nginx_signing.key | gpg --dearmor -o /usr/share/keyrings/nginx-archive-keyring.gpg.tmp
mv /usr/share/keyrings/nginx-archive-keyring.gpg.tmp /usr/share/keyrings/nginx-archive-keyring.gpg
printf 'deb [signed-by=/usr/share/keyrings/nginx-archive-keyring.gpg] http://nginx.org/packages/ubuntu %s nginx\n' "$(lsb_release -cs)" > /etc/apt/sources.list.d/nginx-org.list
cat > /etc/apt/preferences.d/99nginx <<'PREF'
Package: *
Pin: origin nginx.org
Pin-Priority: 900
PREF
apt-get update -y
nginx_candidate="$(apt-cache policy nginx | awk '/Candidate:/ {print $2}')"
dpkg --compare-versions "$nginx_candidate" ge 1.30.0
apt-get install -y -o Dpkg::Options::=--force-confold nginx certbot python3-certbot-nginx
mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled
if ! grep -q 'server_names_hash_bucket_size' /etc/nginx/nginx.conf; then
  sed -i '/http {/a\    server_names_hash_bucket_size 128;' /etc/nginx/nginx.conf
fi
if [ -d /etc/nginx/sites-enabled ] && ! grep -q 'sites-enabled' /etc/nginx/nginx.conf && [ ! -f /etc/nginx/conf.d/rtk-sites-enabled.conf ]; then
  printf 'include /etc/nginx/sites-enabled/*;\n' > /etc/nginx/conf.d/rtk-sites-enabled.conf
fi

mkdir -p /etc/rtk_cloud_admin "$data_dir" "$release_root" "$release_dir"
chmod 0750 /etc/rtk_cloud_admin
chmod 0750 "$data_dir"
mv /tmp/rtk-cloud-admin-deploy/admin.env "$env_path"
chmod 0600 "$env_path"
rm -rf "$release_dir"
mkdir -p "$release_dir"
tar --warning=no-unknown-keyword -xzf "$remote_bundle" -C "$release_dir" --strip-components=1 \
  2> >(grep -v "Ignoring unknown extended header keyword 'LIBARCHIVE.xattr.com.apple.provenance'" >&2)
test -x "$release_dir/bin/rtk-cloud-admin"
test -s "$release_dir/web/dist/index.html"
ln -sfn "$release_dir" "$current_dir"

cat > /etc/systemd/system/rtk-cloud-admin.service <<UNIT
[Unit]
Description=RTK Cloud Admin dashboard
After=network-online.target
Wants=network-online.target

[Service]
Restart=always
RestartSec=5
TimeoutStartSec=120
EnvironmentFile=$env_path
WorkingDirectory=$current_dir
ExecStart=$current_dir/bin/rtk-cloud-admin

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/nginx/sites-available/rtk-cloud-admin.conf <<NGINX
server {
    listen 80;
    server_name $domain;

    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/rtk-cloud-admin.conf /etc/nginx/sites-enabled/rtk-cloud-admin.conf
rm -f /etc/nginx/sites-enabled/default /etc/nginx/conf.d/default.conf
nginx -t
systemctl enable --now nginx
systemctl reload nginx

systemctl daemon-reload
systemctl enable --now rtk-cloud-admin
systemctl restart rtk-cloud-admin

for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8080/healthz | grep -qx ok; then
    ready=1
    break
  fi
  sleep 1
done
if [ "${ready:-0}" != "1" ]; then
  journalctl -u rtk-cloud-admin -n 120 --no-pager >&2 || true
  exit 1
fi

if [ "$certbot_enable" = "1" ] && [ "$http_only" != "1" ]; then
  certbot --nginx --non-interactive --agree-tos --email "$certbot_email" -d "$domain" --redirect
fi

systemctl is-active rtk-cloud-admin
systemctl is-active nginx
REMOTE

printf '[admin-deploy] deployed %s to %s\n' "$release" "$domain" >&2
