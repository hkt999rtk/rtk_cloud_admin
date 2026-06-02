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
  release_parent="$(basename "$(dirname "$release_bundle")")"
  case "$release_name" in
    rtk_cloud_admin-*.tar.gz)
      bundle_release="${release_name#rtk_cloud_admin-}"
      bundle_release="${bundle_release%.tar.gz}"
      ;;
    *.tar.gz)
      bundle_release="${release_name%.tar.gz}"
      if [ "$release_parent" != "rtk_cloud_admin-$bundle_release" ]; then
        printf 'error: ADMIN_LINODE_RELEASE_BUNDLE must be named rtk_cloud_admin-<version>.tar.gz or stored as rtk_cloud_admin-<version>/<version>.tar.gz\n' >&2
        exit 1
      fi
      ;;
    *)
      printf 'error: ADMIN_LINODE_RELEASE_BUNDLE must be named rtk_cloud_admin-<version>.tar.gz or stored as rtk_cloud_admin-<version>/<version>.tar.gz\n' >&2
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
node_exporter_listen_addr="${ADMIN_PROMETHEUS_NODE_EXPORTER_LISTEN_ADDR:-127.0.0.1:9100}"
if [ -z "${ADMIN_PROMETHEUS_NODE_EXPORTER_LISTEN_ADDR:-}" ] && [ -n "${ADMIN_LINODE_PRIVATE_IPV4:-}" ]; then
  node_exporter_listen_addr="$ADMIN_LINODE_PRIVATE_IPV4:9100"
fi
nginx_exporter_listen_addr="${ADMIN_PROMETHEUS_NGINX_EXPORTER_LISTEN_ADDR:-127.0.0.1:9113}"
if [ -z "${ADMIN_PROMETHEUS_NGINX_EXPORTER_LISTEN_ADDR:-}" ] && [ -n "${ADMIN_LINODE_PRIVATE_IPV4:-}" ]; then
  nginx_exporter_listen_addr="$ADMIN_LINODE_PRIVATE_IPV4:9113"
fi
release_bundle="${ADMIN_LINODE_RELEASE_BUNDLE:-}"
remote_bundle="${ADMIN_LINODE_REMOTE_BUNDLE:-/tmp/rtk-cloud-admin-${release}.tar.gz}"
data_dir="${ADMIN_LINODE_DATA_DIR:-/var/lib/rtk_cloud_admin}"
env_path="${ADMIN_LINODE_ENV_PATH:-/etc/rtk_cloud_admin/admin.env}"
certbot_enable="${ADMIN_LINODE_CERTBOT_ENABLE:-1}"
cert_cache_dir="${ADMIN_LINODE_CERT_CACHE_DIR:-}"
http_only="${ADMIN_LINODE_HTTP_ONLY:-0}"
artifact_dir="${ADMIN_LINODE_ARTIFACT_DIR:-$root_dir/.artifacts/linode-admin-deploy/$release}"

required_runtime=(
  ACCOUNT_MANAGER_BASE_URL
  VIDEO_CLOUD_BASE_URL
  VIDEO_CLOUD_ADMIN_TOKEN
  VIDEO_CLOUD_PROMETHEUS_BASE_URL
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
need openssl

[ -n "$domain" ] || die "ADMIN_LINODE_DOMAIN is required"
[ -n "$certbot_email" ] || [ "$certbot_enable" = "0" ] || die "ADMIN_LINODE_CERTBOT_EMAIL is required when certbot is enabled"
[ -n "$admin_host" ] || die "ADMIN_LINODE_HOST or ADMIN_LINODE_PUBLIC_IPV4 is required"
[ -s "$ssh_key" ] || die "SSH key not found: $ssh_key"
if [ -n "$cert_cache_dir" ]; then
  [ -s "$cert_cache_dir/fullchain.pem" ] || die "cached certificate fullchain not found: $cert_cache_dir/fullchain.pem"
  [ -s "$cert_cache_dir/privkey.pem" ] || die "cached certificate private key not found: $cert_cache_dir/privkey.pem"
  openssl x509 -in "$cert_cache_dir/fullchain.pem" -noout -checkend "${ADMIN_LINODE_CERT_CACHE_MIN_VALID_SECONDS:-604800}" >/dev/null \
    || die "cached certificate is expired or too close to expiry: $cert_cache_dir/fullchain.pem"
fi
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
  write_env VIDEO_CLOUD_PROMETHEUS_BASE_URL
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
if [ -n "$cert_cache_dir" ]; then
  printf '[admin-deploy] uploading cached certificate for %s\n' "$domain" >&2
  ssh "${ssh_opts[@]}" "$remote" "mkdir -p /tmp/rtk-cloud-admin-deploy/cert-cache"
  scp "${ssh_opts[@]}" "$cert_cache_dir/fullchain.pem" "$remote:/tmp/rtk-cloud-admin-deploy/cert-cache/fullchain.pem"
  scp "${ssh_opts[@]}" "$cert_cache_dir/privkey.pem" "$remote:/tmp/rtk-cloud-admin-deploy/cert-cache/privkey.pem"
fi

printf '[admin-deploy] installing runtime on %s\n' "$remote" >&2
ssh "${ssh_opts[@]}" "$remote" bash -s -- "$domain" "$certbot_email" "$release" "$remote_bundle" "$data_dir" "$env_path" "$certbot_enable" "$http_only" "$cert_cache_dir" "$node_exporter_listen_addr" "$nginx_exporter_listen_addr" <<'REMOTE'
set -euo pipefail

domain="$1"
certbot_email="$2"
release="$3"
remote_bundle="$4"
data_dir="$5"
env_path="$6"
certbot_enable="$7"
http_only="$8"
cert_cache_dir="${9:-}"
node_exporter_listen_addr="${10:-127.0.0.1:9100}"
nginx_exporter_listen_addr="${11:-127.0.0.1:9113}"
service_user="rtk-cloud-admin"
release_root="/opt/rtk_cloud_admin/releases"
release_dir="$release_root/$release"
current_dir="/opt/rtk_cloud_admin/current"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl systemd ca-certificates gnupg2 lsb-release ubuntu-keyring prometheus-node-exporter prometheus-nginx-exporter
printf 'ARGS="--web.listen-address=%s"\n' "$node_exporter_listen_addr" > /etc/default/prometheus-node-exporter
mkdir -p /etc/systemd/system/prometheus-nginx-exporter.service.d
cat > /etc/systemd/system/prometheus-nginx-exporter.service.d/override.conf <<EXPORTER
[Service]
ExecStart=
ExecStart=/usr/bin/prometheus-nginx-exporter -nginx.scrape-uri=http://127.0.0.1:8081/stub_status -web.listen-address=$nginx_exporter_listen_addr
EXPORTER
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
mkdir -p /var/www/certbot/.well-known/acme-challenge
if ! grep -q 'server_names_hash_bucket_size' /etc/nginx/nginx.conf; then
  sed -i '/http {/a\    server_names_hash_bucket_size 128;' /etc/nginx/nginx.conf
fi
if [ -d /etc/nginx/sites-enabled ] && ! grep -q 'sites-enabled' /etc/nginx/nginx.conf && [ ! -f /etc/nginx/conf.d/rtk-sites-enabled.conf ]; then
  printf 'include /etc/nginx/sites-enabled/*;\n' > /etc/nginx/conf.d/rtk-sites-enabled.conf
fi

if ! id "$service_user" >/dev/null 2>&1; then
  useradd --system --home-dir "$data_dir" --shell /usr/sbin/nologin "$service_user"
fi
mkdir -p /etc/rtk_cloud_admin "$data_dir" "$release_root" "$release_dir"
chmod 0750 /etc/rtk_cloud_admin "$data_dir"
chown "$service_user:$service_user" "$data_dir"
mv /tmp/rtk-cloud-admin-deploy/admin.env "$env_path"
chown root:"$service_user" "$env_path"
chmod 0640 "$env_path"
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
    listen 127.0.0.1:8081;
    server_name localhost;

    location = /stub_status {
        stub_status;
        allow 127.0.0.1;
        deny all;
    }
}

server {
    listen 80;
    server_name $domain;

    client_max_body_size 10m;

    location ^~ /.well-known/acme-challenge/ {
        alias /var/www/certbot/.well-known/acme-challenge/;
        default_type text/plain;
    }

    location = /metrics/prometheus {
        return 404;
    }

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
rm -f /etc/nginx/conf.d/rtk-cloud-admin.conf /etc/nginx/sites-enabled/default /etc/nginx/conf.d/default.conf
nginx -t
systemctl enable --now nginx
systemctl reload nginx

systemctl daemon-reload
systemctl enable --now prometheus-node-exporter
systemctl restart prometheus-node-exporter
systemctl is-active prometheus-node-exporter
systemctl enable --now prometheus-nginx-exporter
systemctl restart prometheus-nginx-exporter
systemctl is-active prometheus-nginx-exporter
for _ in $(seq 1 10); do
  if ss -lnt | grep -F "$node_exporter_listen_addr" >/dev/null; then
    node_exporter_ready=1
    break
  fi
  sleep 1
done
if [ "${node_exporter_ready:-0}" != "1" ]; then
  ss -lnt >&2 || true
  exit 1
fi
for _ in $(seq 1 10); do
  if ss -lnt | grep -F "$nginx_exporter_listen_addr" >/dev/null; then
    nginx_exporter_ready=1
    break
  fi
  sleep 1
done
if [ "${nginx_exporter_ready:-0}" != "1" ]; then
  ss -lnt >&2 || true
  exit 1
fi
systemctl enable --now rtk-cloud-admin
systemctl restart rtk-cloud-admin

for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8080/healthz 2>/dev/null | grep -qx ok; then
    ready=1
    break
  fi
  if [ "${health_wait_logged:-0}" != "1" ]; then
    printf '[admin-deploy] waiting for rtk-cloud-admin local health on 127.0.0.1:8080\n' >&2
    health_wait_logged=1
  fi
  sleep 1
done
if [ "${ready:-0}" != "1" ]; then
  journalctl -u rtk-cloud-admin -n 120 --no-pager >&2 || true
  exit 1
fi

if [ -n "$cert_cache_dir" ] && [ "$http_only" != "1" ]; then
  archive_dir="/etc/letsencrypt/archive/$domain"
  live_dir="/etc/letsencrypt/live/$domain"
  renewal_conf="/etc/letsencrypt/renewal/$domain.conf"
  mkdir -p "$archive_dir" "$live_dir" /etc/letsencrypt/renewal /var/www/certbot/.well-known/acme-challenge
  install -m 0644 /tmp/rtk-cloud-admin-deploy/cert-cache/fullchain.pem "$archive_dir/fullchain1.pem"
  install -m 0600 /tmp/rtk-cloud-admin-deploy/cert-cache/privkey.pem "$archive_dir/privkey1.pem"
  awk 'BEGIN{n=0} /-----BEGIN CERTIFICATE-----/{n++} n==1{print > cert} n>1{print > chain}' \
    cert="$archive_dir/cert1.pem" chain="$archive_dir/chain1.pem" "$archive_dir/fullchain1.pem"
  if [ ! -s "$archive_dir/chain1.pem" ]; then
    cp "$archive_dir/fullchain1.pem" "$archive_dir/chain1.pem"
  fi
  ln -sfn "../../archive/$domain/cert1.pem" "$live_dir/cert.pem"
  ln -sfn "../../archive/$domain/chain1.pem" "$live_dir/chain.pem"
  ln -sfn "../../archive/$domain/fullchain1.pem" "$live_dir/fullchain.pem"
  ln -sfn "../../archive/$domain/privkey1.pem" "$live_dir/privkey.pem"
  cat > "$renewal_conf" <<RENEWAL
version = 2.9.0
archive_dir = /etc/letsencrypt/archive/$domain
cert = /etc/letsencrypt/live/$domain/cert.pem
privkey = /etc/letsencrypt/live/$domain/privkey.pem
chain = /etc/letsencrypt/live/$domain/chain.pem
fullchain = /etc/letsencrypt/live/$domain/fullchain.pem

[renewalparams]
account =
authenticator = webroot
webroot_path = /var/www/certbot
server = https://acme-v02.api.letsencrypt.org/directory
key_type = rsa
deploy_hook = systemctl reload nginx
RENEWAL
  certbot register --non-interactive --agree-tos --email "$certbot_email" >/dev/null 2>&1 || true
  account="$(find /etc/letsencrypt/accounts/acme-v02.api.letsencrypt.org/directory -mindepth 1 -maxdepth 1 -type d 2>/dev/null | head -n1 | xargs basename || true)"
  if [ -n "$account" ]; then
    sed -i "s/^account =.*/account = $account/" "$renewal_conf"
  fi
  cat > /etc/nginx/sites-available/rtk-cloud-admin.conf <<NGINX
server {
    listen 127.0.0.1:8081;
    server_name localhost;

    location = /stub_status {
        stub_status;
        allow 127.0.0.1;
        deny all;
    }
}

server {
    listen 80;
    server_name $domain;

    location ^~ /.well-known/acme-challenge/ {
        alias /var/www/certbot/.well-known/acme-challenge/;
        default_type text/plain;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name $domain;

    ssl_certificate /etc/letsencrypt/live/$domain/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$domain/privkey.pem;
    client_max_body_size 10m;

    location ^~ /.well-known/acme-challenge/ {
        alias /var/www/certbot/.well-known/acme-challenge/;
        default_type text/plain;
    }

    location = /metrics/prometheus {
        return 404;
    }

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
NGINX
  nginx -t
  systemctl reload nginx
  systemctl enable --now certbot.timer
  systemctl is-enabled certbot.timer >/dev/null
  printf 'installed cached certificate lineage for %s\n' "$domain"
elif [ "$certbot_enable" = "1" ] && [ "$http_only" != "1" ]; then
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
  systemctl enable --now certbot.timer
  systemctl is-enabled certbot.timer >/dev/null
fi

systemctl is-active rtk-cloud-admin
systemctl is-active nginx
REMOTE

printf '[admin-deploy] deployed %s to %s\n' "$release" "$domain" >&2
