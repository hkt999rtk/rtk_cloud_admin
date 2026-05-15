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
remote_image="${ADMIN_LINODE_REMOTE_IMAGE:-/tmp/rtk-cloud-admin-image.tar.gz}"
data_dir="${ADMIN_LINODE_DATA_DIR:-/var/lib/rtk_cloud_admin}"
env_path="${ADMIN_LINODE_ENV_PATH:-/etc/rtk_cloud_admin/admin.env}"
certbot_enable="${ADMIN_LINODE_CERTBOT_ENABLE:-1}"
http_only="${ADMIN_LINODE_HTTP_ONLY:-0}"
image_tag="rtk-cloud-admin:${release}"
artifact_dir="${ADMIN_LINODE_ARTIFACT_DIR:-$root_dir/.artifacts/linode-admin-deploy/$release}"
image_archive="$artifact_dir/rtk-cloud-admin-${release}.tar.gz"

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

quote_env() {
  local key="$1"
  local value="${!key:-}"
  if printf '%s' "$value" | grep -q '[[:cntrl:]]'; then
    die "$key contains control characters"
  fi
  value="${value//\\/\\\\}"
  value="${value//"/\\"}"
  printf '%s="%s"\n' "$key" "$value"
}

need docker
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

printf '[admin-deploy] building Docker image %s\n' "$image_tag" >&2
docker build --platform linux/amd64 -t "$image_tag" "$root_dir"

printf '[admin-deploy] saving image archive %s\n' "$image_archive" >&2
docker save "$image_tag" | gzip -c > "$image_archive"

ssh_opts=(-i "$ssh_key" -o BatchMode=yes -o StrictHostKeyChecking=accept-new)
remote="$ssh_user@$admin_host"

tmp_env="$(mktemp)"
cleanup() { rm -f "$tmp_env"; }
trap cleanup EXIT
{
  printf 'PORT=8080\n'
  printf 'DATABASE_PATH=/data/rtk-cloud-admin.db\n'
  quote_env ACCOUNT_MANAGER_BASE_URL
  quote_env VIDEO_CLOUD_BASE_URL
  quote_env VIDEO_CLOUD_ADMIN_TOKEN
  quote_env ADMIN_BOOTSTRAP_EMAIL
  quote_env ADMIN_BOOTSTRAP_PASSWORD
  printf 'ADMIN_BREAK_GLASS_ENABLED=%s\n' "${ADMIN_BREAK_GLASS_ENABLED:-true}"
  printf 'LEGACY_CUSTOMER_PASSWORD_LOGIN_ENABLED=%s\n' "${LEGACY_CUSTOMER_PASSWORD_LOGIN_ENABLED:-false}"
} > "$tmp_env"
chmod 0600 "$tmp_env"

printf '[admin-deploy] uploading image and env to %s\n' "$remote" >&2
ssh "${ssh_opts[@]}" "$remote" "mkdir -p /tmp/rtk-cloud-admin-deploy"
scp "${ssh_opts[@]}" "$image_archive" "$remote:$remote_image"
scp "${ssh_opts[@]}" "$tmp_env" "$remote:/tmp/rtk-cloud-admin-deploy/admin.env"

printf '[admin-deploy] installing runtime on %s\n' "$remote" >&2
ssh "${ssh_opts[@]}" "$remote" bash -s -- "$domain" "$certbot_email" "$image_tag" "$remote_image" "$data_dir" "$env_path" "$certbot_enable" "$http_only" <<'REMOTE'
set -euo pipefail

domain="$1"
certbot_email="$2"
image_tag="$3"
remote_image="$4"
data_dir="$5"
env_path="$6"
certbot_enable="$7"
http_only="$8"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y docker.io nginx certbot python3-certbot-nginx curl systemd ca-certificates
systemctl enable --now docker

mkdir -p /etc/rtk_cloud_admin "$data_dir" /etc/nginx/sites-available /etc/nginx/sites-enabled
chmod 0750 /etc/rtk_cloud_admin
# Dockerfile creates the runtime app user/group as the first system uid/gid.
# The host bind mount must be writable by that non-root container user.
chown 100:100 "$data_dir"
chmod 0750 "$data_dir"
mv /tmp/rtk-cloud-admin-deploy/admin.env "$env_path"
chmod 0600 "$env_path"

cat > /etc/systemd/system/rtk-cloud-admin.service <<UNIT
[Unit]
Description=RTK Cloud Admin dashboard
After=network-online.target docker.service
Wants=network-online.target docker.service

[Service]
Restart=always
RestartSec=5
TimeoutStartSec=120
ExecStartPre=-/usr/bin/docker rm -f rtk-cloud-admin
ExecStart=/usr/bin/docker run --rm --name rtk-cloud-admin --env-file $env_path -p 127.0.0.1:8080:8080 -v $data_dir:/data $image_tag
ExecStop=/usr/bin/docker rm -f rtk-cloud-admin

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
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

docker load -i "$remote_image"
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

printf '[admin-deploy] deployed %s to %s\n' "$image_tag" "$domain" >&2
