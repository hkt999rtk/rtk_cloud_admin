#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

load_secret_env() {
  local file="$1"
  if [ -f "$file" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$file"
    set +a
  fi
}

if [ -n "${DEPLOY_SECRETS_DIR:-}" ]; then
  [ -d "$DEPLOY_SECRETS_DIR" ] || { printf 'error: DEPLOY_SECRETS_DIR not found: %s\n' "$DEPLOY_SECRETS_DIR" >&2; exit 1; }
  load_secret_env "$DEPLOY_SECRETS_DIR/env/admin-staging.env"
  load_secret_env "$DEPLOY_SECRETS_DIR/state/${ADMIN_LINODE_LABEL:-rtk-cloud-admin-staging}.state"
fi

release_bundle="${ADMIN_LINODE_RELEASE_BUNDLE:-}"
bundle_release=""
if [ -n "$release_bundle" ]; then
  release_name="$(basename "$release_bundle")"
  case "$release_name" in
    rtk_cloud_admin-*.tar.gz)
      bundle_release="${release_name#rtk_cloud_admin-}"
      bundle_release="${bundle_release%.tar.gz}"
      ;;
    *)
      printf 'error: ADMIN_LINODE_RELEASE_BUNDLE must be named rtk_cloud_admin-<version>.tar.gz\n' >&2
      exit 1
      ;;
  esac
fi

if [ -n "${ADMIN_LINODE_RELEASE:-}" ]; then
  release="$ADMIN_LINODE_RELEASE"
elif [ -n "$release_bundle" ]; then
  release="$bundle_release"
else
  release="$(git -C "$root_dir" rev-parse --short HEAD)"
fi
if [ -n "$bundle_release" ] && [ "$release" != "$bundle_release" ]; then
  printf 'error: ADMIN_LINODE_RELEASE (%s) must match bundle version (%s)\n' "$release" "$bundle_release" >&2
  exit 1
fi

domain="${ADMIN_LINODE_DOMAIN:-}"
certbot_email="${ADMIN_LINODE_CERTBOT_EMAIL:-}"
ssh_user="${ADMIN_LINODE_SSH_USER:-root}"
ssh_key="${ADMIN_LINODE_SSH_KEY:-$HOME/.ssh/id_ed25519_rtkcloud}"
admin_host="${ADMIN_LINODE_HOST:-${ADMIN_LINODE_PUBLIC_IPV4:-}}"
remote_bundle="${ADMIN_LINODE_REMOTE_BUNDLE:-/tmp/rtk-cloud-admin-release.tar.gz}"
install_root="${ADMIN_LINODE_INSTALL_ROOT:-/opt/rtk_cloud_admin}"
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
  printf '%s=%s\n' "$key" "$value"
}

if [ -z "$release_bundle" ]; then
  release_bundle="$artifact_dir/rtk_cloud_admin-$release.tar.gz"
  VERSION="$release" OUTPUT_DIR="$artifact_dir" "$root_dir/deploy/package-release.sh"
fi
need ssh
need scp

[ -n "$domain" ] || die "ADMIN_LINODE_DOMAIN is required"
[ -n "$certbot_email" ] || [ "$certbot_enable" = "0" ] || die "ADMIN_LINODE_CERTBOT_EMAIL is required when certbot is enabled"
[ -n "$admin_host" ] || die "ADMIN_LINODE_HOST or ADMIN_LINODE_PUBLIC_IPV4 is required"
[ -s "$ssh_key" ] || die "SSH key not found: $ssh_key"
[ -s "$release_bundle" ] || die "ADMIN_LINODE_RELEASE_BUNDLE not found or empty: $release_bundle"
for key in "${required_runtime[@]}"; do
  [ -n "${!key:-}" ] || die "$key is required"
done

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

printf '[admin-deploy] using native release bundle %s\n' "$release_bundle" >&2
printf '[admin-deploy] uploading release bundle and env to %s\n' "$remote" >&2
ssh "${ssh_opts[@]}" "$remote" "mkdir -p /tmp/rtk-cloud-admin-deploy"
scp "${ssh_opts[@]}" "$release_bundle" "$remote:$remote_bundle"
scp "${ssh_opts[@]}" "$tmp_env" "$remote:/tmp/rtk-cloud-admin-deploy/admin.env"

printf '[admin-deploy] installing runtime on %s\n' "$remote" >&2
ssh "${ssh_opts[@]}" "$remote" bash -s -- "$domain" "$certbot_email" "$release" "$remote_bundle" "$install_root" "$data_dir" "$env_path" "$certbot_enable" "$http_only" <<'REMOTE'
set -euo pipefail

domain="$1"
certbot_email="$2"
release="$3"
remote_bundle="$4"
install_root="$5"
data_dir="$6"
env_path="$7"
certbot_enable="$8"
http_only="$9"
service_user="rtk-cloud-admin"
release_dir="$install_root/releases/$release"
current_dir="$install_root/current"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl systemd ca-certificates gnupg2 lsb-release ubuntu-keyring tar
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
if ! grep -q 'server_names_hash_bucket_size' /etc/nginx/nginx.conf; then
  sed -i '/http {/a\    server_names_hash_bucket_size 128;' /etc/nginx/nginx.conf
fi

if ! id "$service_user" >/dev/null 2>&1; then
  useradd --system --home-dir "$data_dir" --shell /usr/sbin/nologin "$service_user"
fi
mkdir -p /etc/rtk_cloud_admin "$data_dir" "$install_root/releases" /etc/nginx/sites-available /etc/nginx/sites-enabled
chmod 0750 /etc/rtk_cloud_admin "$data_dir"
chown "$service_user:$service_user" "$data_dir"

rm -rf "$release_dir"
mkdir -p "$release_dir"
tar --warning=no-unknown-keyword -xzf "$remote_bundle" -C "$release_dir" --strip-components=1
test -x "$release_dir/bin/rtk-cloud-admin"
test -f "$release_dir/web/dist/index.html"
ln -sfn "$release_dir" "$current_dir"
chown -R root:root "$release_dir"

mv /tmp/rtk-cloud-admin-deploy/admin.env "$env_path"
chown root:"$service_user" "$env_path"
chmod 0640 "$env_path"

cat > /etc/systemd/system/rtk-cloud-admin.service <<UNIT
[Unit]
Description=RTK Cloud Admin dashboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$service_user
Group=$service_user
WorkingDirectory=$current_dir
EnvironmentFile=$env_path
Restart=always
RestartSec=5
TimeoutStartSec=120
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
ln -sf /etc/nginx/sites-available/rtk-cloud-admin.conf /etc/nginx/conf.d/rtk-cloud-admin.conf
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
  certbot_log="$(mktemp)"
  set +e
  certbot --nginx --non-interactive --agree-tos --email "$certbot_email" -d "$domain" --redirect 2>&1 | tee "$certbot_log"
  certbot_status="${PIPESTATUS[0]}"
  set -e
  if [ "$certbot_status" -ne 0 ]; then
    if grep -Eqi 'too many certificates|rate-limits|rate limit' "$certbot_log"; then
      retry_after="$(sed -nE 's/.*retry after ([^:]+:[^:]+:[^ ]+ UTC).*/\1/p' "$certbot_log" | tail -n 1)"
      printf 'error: Let'\''s Encrypt rate limit hit for %s; Cloud Admin deploy stopped before verify.' "$domain" >&2
      if [ -n "$retry_after" ]; then
        printf ' Retry after %s.' "$retry_after" >&2
      fi
      printf ' See Certbot output above and %s.\n' "$certbot_log" >&2
    else
      printf 'error: Certbot failed for %s; Cloud Admin deploy stopped before verify. See output above and %s.\n' "$domain" "$certbot_log" >&2
    fi
    exit "$certbot_status"
  fi
  rm -f "$certbot_log"
fi

systemctl is-active rtk-cloud-admin
systemctl is-active nginx
REMOTE

printf '[admin-deploy] deployed %s to %s\n' "$release" "$domain" >&2
