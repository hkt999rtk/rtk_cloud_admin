#!/usr/bin/env bash
set -euo pipefail

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

base_url="${ADMIN_LINODE_BASE_URL:-}"
if [ -z "$base_url" ]; then
  domain="${ADMIN_LINODE_DOMAIN:-}"
  [ -n "$domain" ] || { echo "ADMIN_LINODE_BASE_URL or ADMIN_LINODE_DOMAIN is required" >&2; exit 1; }
  if [ "${ADMIN_LINODE_HTTP_ONLY:-0}" = "1" ]; then
    base_url="http://$domain"
  else
    base_url="https://$domain"
  fi
fi

artifacts_dir="${ADMIN_LINODE_VERIFY_ARTIFACTS:-.artifacts/linode-admin-verify}"
mkdir -p "$artifacts_dir"

record() {
  printf '%s\n' "$1" | tee -a "$artifacts_dir/checks.txt" >/dev/null
}

curl -fsS "$base_url/healthz" | tee "$artifacts_dir/healthz.txt" | grep -qx ok
record "PASS healthz"

curl -fsS "$base_url/api/service-health" > "$artifacts_dir/service-health.json"
record "PASS service-health"

curl -fsS "$base_url/console" > "$artifacts_dir/console.html"
grep -q 'id="root"' "$artifacts_dir/console.html"
record "PASS console shell"

if [ -n "${ADMIN_BOOTSTRAP_EMAIL:-}" ] && [ -n "${ADMIN_BOOTSTRAP_PASSWORD:-}" ]; then
  cookie_jar="$(mktemp)"
  login_body="$(mktemp)"
  trap 'rm -f "$login_body" "$cookie_jar"' EXIT
  printf '{"email":"%s","password":"%s"}' "$ADMIN_BOOTSTRAP_EMAIL" "$ADMIN_BOOTSTRAP_PASSWORD" > "$login_body"
  curl -fsS -c "$cookie_jar" -H 'content-type: application/json' --data-binary "@$login_body" "$base_url/api/auth/platform/login" > "$artifacts_dir/login-response.json"
  rm -f "$login_body"
  grep -q '"status":"ok"' "$artifacts_dir/login-response.json"
  curl -fsS -b "$cookie_jar" "$base_url/api/me" > "$artifacts_dir/me.json"
  grep -q '"kind":"platform_admin"' "$artifacts_dir/me.json"
  record "PASS platform login"
else
  record "SKIP platform login credentials not provided"
fi

printf 'Admin verify passed: %s\nArtifacts: %s\n' "$base_url" "$artifacts_dir"
