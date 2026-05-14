#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VIDEO_CLOUD_BASE_URL="${VIDEO_CLOUD_BASE_URL:-https://video-cloud-staging.realtekconnect.com}"
CERT_PATH="${VIDEO_CLOUD_ADMIN_CERT_PATH:-$ROOT_DIR/keys/admin-client.ed25519.cert.pem}"
KEY_PATH="${VIDEO_CLOUD_ADMIN_KEY_PATH:-$ROOT_DIR/keys/admin-client.ed25519.key.pem}"
CA_PATH="${VIDEO_CLOUD_ADMIN_CA_PATH:-$ROOT_DIR/keys/admin-client-root-ca.ed25519.cert.pem}"
ORG_ID="${E2E_ORG_ID:-org-acme}"
ACCOUNT_DEVICE_1="${E2E_ACCOUNT_DEVICE_1:-dev-001}"
VIDEO_DEVICE_1="${E2E_VIDEO_DEVICE_1:-device-1}"
ACCOUNT_DEVICE_2="${E2E_ACCOUNT_DEVICE_2:-dev-002}"
VIDEO_DEVICE_2="${E2E_VIDEO_DEVICE_2:-device-2}"
ADMIN_EMAIL="${E2E_ADMIN_EMAIL:-admin@example.com}"
ADMIN_PASSWORD="${E2E_ADMIN_PASSWORD:-local-e2e-secret}"
PORT="${E2E_PORT:-}"
ARTIFACTS_DIR="${E2E_ARTIFACTS_DIR:-$ROOT_DIR/.artifacts/live-video-cloud-e2e}"
REPORT_PATH="$ARTIFACTS_DIR/report.json"
REPORT_LINES="$ARTIFACTS_DIR/report.jsonl"

SERVER_PID=""
TMP_DIR=""

cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$TMP_DIR" && "${E2E_KEEP_TMP:-}" != "1" ]]; then
    rm -rf "$TMP_DIR"
  fi
}

finalize_report() {
  local exit_code="$1"
  local status="passed"
  if [[ "$exit_code" != "0" ]]; then
    status="failed"
  fi
  mkdir -p "$ARTIFACTS_DIR"
  if [[ ! -f "$REPORT_LINES" ]]; then
    : >"$REPORT_LINES"
  fi
  jq -s \
    --arg status "$status" \
    --arg base_url "$VIDEO_CLOUD_BASE_URL" \
    --arg org_id "$ORG_ID" \
    --arg account_device_1 "$ACCOUNT_DEVICE_1" \
    --arg video_device_1 "$VIDEO_DEVICE_1" \
    --arg account_device_2 "$ACCOUNT_DEVICE_2" \
    --arg video_device_2 "$VIDEO_DEVICE_2" \
    --arg artifacts_dir "$ARTIFACTS_DIR" \
    '{
      status: $status,
      video_cloud_base_url: $base_url,
      fixture: {
        org_id: $org_id,
        devices: [
          {account_device_id: $account_device_1, video_device_id: $video_device_1},
          {account_device_id: $account_device_2, video_device_id: $video_device_2}
        ]
      },
      artifacts_dir: $artifacts_dir,
      checks: .
    }' "$REPORT_LINES" >"$REPORT_PATH"
  cleanup
}
trap 'exit_code=$?; finalize_report "$exit_code"; exit "$exit_code"' EXIT

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

log() {
  printf '[local-video-cloud-e2e] %s\n' "$*"
}

record_check() {
  local name="$1"
  local status="$2"
  local detail="${3:-}"
  local endpoint="${4:-}"
  local source_status="${5:-}"
  local source_message="${6:-}"
  mkdir -p "$ARTIFACTS_DIR"
  jq -cn \
    --arg name "$name" \
    --arg status "$status" \
    --arg detail "$detail" \
    --arg endpoint "$endpoint" \
    --arg source_status "$source_status" \
    --arg source_message "$source_message" \
    '{
      name: $name,
      status: $status,
      detail: $detail,
      endpoint: $endpoint,
      source_status: $source_status,
      source_message: $source_message
    } | with_entries(select(.value != ""))' >>"$REPORT_LINES"
}

require_file() {
  [[ -f "$1" ]] || fail "missing required file: $1"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

curl_bin="${CURL_BIN:-/opt/homebrew/opt/curl/bin/curl}"
if [[ ! -x "$curl_bin" ]]; then
  fail "Homebrew curl is required at /opt/homebrew/opt/curl/bin/curl, or set CURL_BIN to a curl built with OpenSSL 3"
fi
require_cmd jq
require_cmd go
require_cmd npm
require_cmd node

sqlite_bin="${SQLITE3_BIN:-$(command -v sqlite3 || true)}"
if [[ -z "$sqlite_bin" && -x /Users/kevinhuang/Library/Android/sdk/platform-tools/sqlite3 ]]; then
  sqlite_bin="/Users/kevinhuang/Library/Android/sdk/platform-tools/sqlite3"
fi
[[ -n "$sqlite_bin" ]] || fail "sqlite3 is required"

require_file "$CERT_PATH"
require_file "$KEY_PATH"
require_file "$CA_PATH"

key_mode="$(stat -f '%Lp' "$KEY_PATH" 2>/dev/null || stat -c '%a' "$KEY_PATH" 2>/dev/null || true)"
[[ "$key_mode" == "600" ]] || fail "$KEY_PATH must be mode 0600; current mode is ${key_mode:-unknown}"

if ! "$curl_bin" --version | head -n1 | grep -Eq 'OpenSSL/[3-9]'; then
  fail "curl must be built with OpenSSL 3+ for the Ed25519 client certificate: $("$curl_bin" --version | head -n1)"
fi

if [[ -n "$PORT" ]]; then
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    fail "requested E2E_PORT $PORT is already in use"
  fi
else
  PORT="$(node -e "const net=require('net'); const s=net.createServer(); s.listen(0,'127.0.0.1',()=>{console.log(s.address().port); s.close();});")"
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/rtk-cloud-admin-e2e.XXXXXX")"
DB_PATH="$TMP_DIR/admin.db"
SERVER_LOG="$TMP_DIR/server.log"
COOKIE_JAR="$TMP_DIR/platform.cookies"
BASE_URL="http://127.0.0.1:$PORT"
mkdir -p "$ARTIFACTS_DIR"
: >"$REPORT_LINES"

log "bootstrapping Video Cloud admin token from client certificate"
token_response="$("$curl_bin" -fsS \
  --cert "$CERT_PATH" \
  --key "$KEY_PATH" \
  -H 'Content-Type: application/json' \
  -d '{"scope":"admin","expiry":3600}' \
  "$VIDEO_CLOUD_BASE_URL/request_token")"

admin_token="$(printf '%s' "$token_response" | jq -r 'select(.token_type=="Bearer" and .scope=="admin") | .access_token // empty')"
[[ -n "$admin_token" ]] || fail "admin token bootstrap did not return a Bearer admin access_token"
record_check "token bootstrap" "pass" "admin bearer token issued"
log "admin token bootstrap passed"

log "building WebUI assets"
(cd "$ROOT_DIR/web" && npm run build >/dev/null)

log "starting Admin BFF on $BASE_URL"
(
  cd "$ROOT_DIR"
  PORT="$PORT" \
    DATABASE_PATH="$DB_PATH" \
    VIDEO_CLOUD_BASE_URL="$VIDEO_CLOUD_BASE_URL" \
    VIDEO_CLOUD_ADMIN_TOKEN="$admin_token" \
    ADMIN_BOOTSTRAP_EMAIL="$ADMIN_EMAIL" \
    ADMIN_BOOTSTRAP_PASSWORD="$ADMIN_PASSWORD" \
    ADMIN_BREAK_GLASS_ENABLED=true \
    go run ./cmd/server >"$SERVER_LOG" 2>&1
) &
SERVER_PID="$!"

ready=0
for _ in $(seq 1 40); do
  if "$curl_bin" -fsS "$BASE_URL/healthz" >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    sed -n '1,120p' "$SERVER_LOG" >&2 || true
    fail "Admin BFF exited before becoming ready"
  fi
  sleep 0.25
done
[[ "$ready" == "1" ]] || { sed -n '1,120p' "$SERVER_LOG" >&2 || true; fail "Admin BFF did not become ready"; }
record_check "local Admin BFF ready" "pass" "$BASE_URL"

log "normalizing local demo fixture device ids"
"$sqlite_bin" "$DB_PATH" <<SQL
UPDATE devices SET video_cloud_devid = '$VIDEO_DEVICE_1' WHERE id = '$ACCOUNT_DEVICE_1';
UPDATE devices SET video_cloud_devid = '$VIDEO_DEVICE_2' WHERE id = '$ACCOUNT_DEVICE_2';
SQL

customer_session="local-e2e-customer-$(date +%s)-$RANDOM"
created_at="$(node -e 'console.log(new Date().toISOString())')"
expires_at="$(node -e 'console.log(new Date(Date.now()+3600*1000).toISOString())')"
"$sqlite_bin" "$DB_PATH" <<SQL
INSERT INTO sessions (id, kind, subject, email, access_token, refresh_token, active_org_id, expires_at, created_at)
VALUES ('$customer_session', 'customer', 'local-e2e-customer', 'customer@example.local', 'local-access', 'local-refresh', '$ORG_ID', '$expires_at', '$created_at');
SQL
record_check "local customer session" "pass" "$ORG_ID"

assert_json() {
  local label="$1"
  local json="$2"
  shift 2
  printf '%s' "$json" | jq -e "$@" >/dev/null || {
    local source_status source_message
    source_status="$(printf '%s' "$json" | jq -r '.source_status // .telemetry_status // empty' 2>/dev/null || true)"
    source_message="$(printf '%s' "$json" | jq -r '.source_message // .unavailable_reason // empty' 2>/dev/null || true)"
    record_check "$label" "fail" "JSON assertion failed" "" "$source_status" "$source_message"
    printf 'Assertion failed for %s. Body:\n%s\n' "$label" "$json" >&2
    exit 1
  }
}

get_json() {
  local path="$1"
  "$curl_bin" -fsS "$BASE_URL$path"
}

customer_get_json() {
  local path="$1"
  "$curl_bin" -fsS -H "Cookie: rtk_admin_session=$customer_session" "$BASE_URL$path"
}

classify_upstream_response() {
  local status="$1"
  local body_file="$2"
  if [[ "$status" == "401" || "$status" == "403" ]]; then
    printf 'auth_failed'
  elif [[ "$status" == "404" ]]; then
    printf 'not_found'
  elif [[ "$status" =~ ^5 ]]; then
    printf 'source_unavailable'
  elif [[ ! "$status" =~ ^2 ]]; then
    printf 'http_%s' "$status"
  elif ! jq -e . "$body_file" >/dev/null 2>&1; then
    printf 'unexpected_schema'
  else
    printf 'ok'
  fi
}

summarize_upstream_body() {
  local kind="$1"
  local body_file="$2"
  case "$kind" in
    telemetry)
      jq -c '{
        status: .status,
        telemetry_status: .telemetry_status,
        device_id: .device_id,
        latest_health: (.latest_health != null),
        rssi_samples: (.rssi_history // [] | length),
        uptime_samples: (.uptime_history // [] | length),
        recent_events: (.recent_events // [] | length),
        unavailable_reason: .unavailable_reason
      }' "$body_file" 2>/dev/null || printf '{}'
      ;;
    stream)
      jq -c '{
        status: .status,
        source_status: .source_status,
        source_message: .source_message,
        window: .window,
        active_sessions: .active_sessions,
        worst_devices: (.worst_devices // [] | length),
        trend_points: (.trend // [] | length)
      }' "$body_file" 2>/dev/null || printf '{}'
      ;;
    firmware)
      jq -c '{
        status: .status,
        source_status: .source_status,
        source_message: .source_message,
        versions: (.versions // .releases // [] | length),
        rollouts: (.rollouts // [] | length),
        campaigns: (.campaigns // (if .campaign then [.campaign] else [] end) // [] | length)
      }' "$body_file" 2>/dev/null || printf '{}'
      ;;
    *)
      jq -c '{status: .status, source_status: .source_status, source_message: .source_message}' "$body_file" 2>/dev/null || printf '{}'
      ;;
  esac
}

classify_upstream_data() {
  local kind="$1"
  local body_file="$2"
  case "$kind" in
    telemetry)
      jq -e '(.latest_health != null) or ((.rssi_history // []) | length > 0) or ((.uptime_history // []) | length > 0) or ((.recent_events // []) | length > 0)' "$body_file" >/dev/null 2>&1 || {
        printf 'empty_data'
        return
      }
      ;;
    stream)
      jq -e '(.source_status? == "available") or ((.trend // []) | length > 0) or ((.worst_devices // []) | length > 0) or ((.active_sessions // 0) > 0)' "$body_file" >/dev/null 2>&1 || {
        printf 'empty_data'
        return
      }
      ;;
    firmware)
      jq -e '((.versions // .releases // []) | length > 0) or ((.rollouts // []) | length > 0) or ((.campaigns // []) | length > 0) or (.campaign != null)' "$body_file" >/dev/null 2>&1 || {
        printf 'empty_data'
        return
      }
      ;;
  esac
  printf 'ok'
}

diagnose_get() {
  local name="$1"
  local path="$2"
  local kind="$3"
  local body_file="$TMP_DIR/diag-$(printf '%s' "$name" | tr -cs '[:alnum:]' '-').json"
  local status
  status="$("$curl_bin" -sS -o "$body_file" -w '%{http_code}' \
    -H "Authorization: Bearer $admin_token" \
    "$VIDEO_CLOUD_BASE_URL$path" || true)"
  local class summary
  class="$(classify_upstream_response "$status" "$body_file")"
  if [[ "$class" == "ok" ]]; then
    class="$(classify_upstream_data "$kind" "$body_file")"
  fi
  summary="$(summarize_upstream_body "$kind" "$body_file")"
  record_check "$name" "$class" "$summary" "$path"
}

diagnose_post() {
  local name="$1"
  local path="$2"
  local payload="$3"
  local kind="$4"
  local body_file="$TMP_DIR/diag-$(printf '%s' "$name" | tr -cs '[:alnum:]' '-').json"
  local status
  status="$("$curl_bin" -sS -o "$body_file" -w '%{http_code}' \
    -H "Authorization: Bearer $admin_token" \
    -H 'Content-Type: application/json' \
    -d "$payload" \
    "$VIDEO_CLOUD_BASE_URL$path" || true)"
  local class summary
  class="$(classify_upstream_response "$status" "$body_file")"
  if [[ "$class" == "ok" ]]; then
    class="$(classify_upstream_data "$kind" "$body_file")"
  fi
  summary="$(summarize_upstream_body "$kind" "$body_file")"
  record_check "$name" "$class" "$summary" "$path"
}

run_upstream_diagnostics() {
  if [[ "${E2E_DIAGNOSTICS:-}" != "1" ]]; then
    return
  fi
  log "running redacted Video Cloud upstream diagnostics"
  local devices_csv model
  devices_csv="$VIDEO_DEVICE_1,$VIDEO_DEVICE_2"
  model="${E2E_FIRMWARE_MODEL:-RTK-CAM-A}"
  diagnose_get "upstream telemetry $VIDEO_DEVICE_1" "/api/devices/$VIDEO_DEVICE_1/telemetry?org_id=$ORG_ID" telemetry
  diagnose_get "upstream telemetry $VIDEO_DEVICE_2" "/api/devices/$VIDEO_DEVICE_2/telemetry?org_id=$ORG_ID" telemetry
  diagnose_get "upstream stream 7d" "/api/fleet/stream-stats?org_id=$ORG_ID&window=7d&devices=$devices_csv" stream
  diagnose_get "upstream stream 30d" "/api/fleet/stream-stats?org_id=$ORG_ID&window=30d&devices=$devices_csv" stream
  diagnose_post "upstream firmware enum $model" "/enum_firmware" "{\"model\":\"$model\"}" firmware
  diagnose_post "upstream firmware rollout $model" "/query_firmware_rollout" "{\"model\":\"$model\"}" firmware
  diagnose_post "upstream firmware campaign $model" "/query_firmware_campaign" "{\"model\":\"$model\"}" firmware
}

log "checking service health"
healthz="$(get_json /healthz)"
[[ "$healthz" == "ok" ]] || fail "/healthz returned $healthz"
record_check "healthz" "pass" "ok" "/healthz"
service_health="$(get_json /api/service-health)"
assert_json "service health" "$service_health" '.[] | select(.name=="Video Cloud" and .status=="ok")'
record_check "service health" "pass" "Video Cloud ok" "/api/service-health"

run_upstream_diagnostics

log "checking platform break-glass login"
platform_login="$("$curl_bin" -fsS -c "$COOKIE_JAR" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
  "$BASE_URL/api/auth/platform/login")"
assert_json "platform login" "$platform_login" '.status=="ok"'
platform_session="$(awk '($0 !~ /^#/ || $0 ~ /^#HttpOnly_/) && $6=="rtk_admin_session"{print $7}' "$COOKIE_JAR" | tail -n1)"
[[ -n "$platform_session" ]] || fail "platform login did not return rtk_admin_session cookie"
platform_me="$("$curl_bin" -fsS -b "$COOKIE_JAR" "$BASE_URL/api/me")"
assert_json "platform me" "$platform_me" '.kind=="platform_admin"'
record_check "platform break-glass login" "pass" "platform_admin session issued" "/api/auth/platform/login"

log "checking customer-safe devices"
devices_json="$(customer_get_json /api/devices)"
assert_json "devices" "$devices_json" --arg id "$ACCOUNT_DEVICE_1" 'type=="array" and any(.[]; .id==$id)'
if printf '%s' "$devices_json" | grep -Eq 'video_cloud_devid|operation_id|upstream_operation_id|raw_payload|dead_lettered'; then
  printf '%s\n' "$devices_json" >&2
  fail "/api/devices exposed platform-only fields"
fi
record_check "customer-safe devices" "pass" "platform-only fields absent" "/api/devices"

log "checking device telemetry"
telemetry_json="$(customer_get_json "/api/devices/$ACCOUNT_DEVICE_1/telemetry")"
assert_json "device telemetry" "$telemetry_json" '.telemetry_status=="available"'
record_check "device telemetry" "pass" "telemetry source available" "/api/devices/$ACCOUNT_DEVICE_1/telemetry" "$(printf '%s' "$telemetry_json" | jq -r '.telemetry_status // empty')" "$(printf '%s' "$telemetry_json" | jq -r '.unavailable_reason // empty')"

log "checking firmware distribution"
firmware_json="$(customer_get_json /api/fleet/firmware-distribution)"
assert_json "firmware distribution" "$firmware_json" '.source_status=="available" and (.versions | length > 0)'
record_check "firmware distribution" "pass" "firmware source available" "/api/fleet/firmware-distribution" "$(printf '%s' "$firmware_json" | jq -r '.source_status // empty')" "$(printf '%s' "$firmware_json" | jq -r '.source_message // empty')"

log "checking stream stats"
stream_7d_json="$(customer_get_json /api/fleet/stream-stats?window=7d)"
assert_json "stream stats 7d" "$stream_7d_json" '.source_status=="available"'
record_check "stream stats 7d" "pass" "stream source available" "/api/fleet/stream-stats?window=7d" "$(printf '%s' "$stream_7d_json" | jq -r '.source_status // empty')" "$(printf '%s' "$stream_7d_json" | jq -r '.source_message // empty')"
stream_30d_json="$(customer_get_json /api/fleet/stream-stats?window=30d)"
assert_json "stream stats 30d" "$stream_30d_json" '.source_status=="available"'
record_check "stream stats 30d" "pass" "stream source available" "/api/fleet/stream-stats?window=30d" "$(printf '%s' "$stream_30d_json" | jq -r '.source_status // empty')" "$(printf '%s' "$stream_30d_json" | jq -r '.source_message // empty')"

log "running live browser validation"
LIVE_BFF_BASE_URL="$BASE_URL" \
  E2E_CUSTOMER_SESSION_ID="$customer_session" \
  E2E_PLATFORM_SESSION_ID="$platform_session" \
  E2E_ACCOUNT_DEVICE_1="$ACCOUNT_DEVICE_1" \
  E2E_ARTIFACTS_DIR="$ARTIFACTS_DIR" \
  node "$ROOT_DIR/web/scripts/live-bff-e2e.mjs"
record_check "live browser validation" "pass" "browser flows passed" "$ARTIFACTS_DIR"

log "passed. Artifacts: $ARTIFACTS_DIR"
