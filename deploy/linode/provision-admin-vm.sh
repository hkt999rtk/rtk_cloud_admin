#!/usr/bin/env bash
set -euo pipefail

label="${ADMIN_LINODE_LABEL:-rtk-cloud-admin-staging}"
region="${ADMIN_LINODE_REGION:-us-sea}"
type="${ADMIN_LINODE_TYPE:-g6-standard-2}"
image="${ADMIN_LINODE_IMAGE:-linode/ubuntu24.04}"
public_key_path="${ADMIN_LINODE_PUBLIC_KEY_PATH:-$HOME/.ssh/id_ed25519_rtkcloud.pub}"
allowed_ssh_cidrs="${ADMIN_LINODE_ALLOWED_SSH_CIDRS:-}"
firewall_label="${ADMIN_LINODE_FIREWALL_LABEL:-${label}-firewall}"
state_path="${ADMIN_LINODE_STATE_PATH:-deploy/linode/${label}.state}"

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required"
}

need linode-cli
need jq
need openssl

test -s "$public_key_path" || die "public key not found: $public_key_path"
if [ -z "$allowed_ssh_cidrs" ]; then
  die "ADMIN_LINODE_ALLOWED_SSH_CIDRS must be set to operator CIDR(s)"
fi

if linode-cli linodes list --json --label "$label" | jq -e 'length > 0' >/dev/null; then
  die "Linode label already exists: $label"
fi

root_pass="$(openssl rand -base64 36)"
ssh_key="$(cat "$public_key_path")"

printf '[admin-linode] creating public-only Linode %s in %s\n' "$label" "$region" >&2
create_json="$(linode-cli linodes create \
  --json \
  --label "$label" \
  --region "$region" \
  --type "$type" \
  --image "$image" \
  --authorized_keys "$ssh_key" \
  --root_pass "$root_pass" \
  --tags rtk-cloud-admin-staging,admin-deploy)"

linode_id="$(printf '%s' "$create_json" | jq -r '.[0].id')"
public_ipv4="$(printf '%s' "$create_json" | jq -r '.[0].ipv4[0]')"
if [ -z "$linode_id" ] || [ "$linode_id" = "null" ] || [ -z "$public_ipv4" ] || [ "$public_ipv4" = "null" ]; then
  die "failed to read Linode id/public IPv4 from linode-cli output"
fi

rules="$(jq -cn --arg cidrs "$allowed_ssh_cidrs" '{
  inbound_policy: "DROP",
  outbound_policy: "ACCEPT",
  inbound: [
    {label: "ssh", action: "ACCEPT", protocol: "TCP", ports: "22", ipv4: {addresses: ($cidrs | split(","))}},
    {label: "http", action: "ACCEPT", protocol: "TCP", ports: "80", ipv4: {addresses: ["0.0.0.0/0"]}},
    {label: "https", action: "ACCEPT", protocol: "TCP", ports: "443", ipv4: {addresses: ["0.0.0.0/0"]}}
  ],
  outbound: []
}')"

printf '[admin-linode] creating firewall %s\n' "$firewall_label" >&2
firewall_json="$(linode-cli firewalls create --json --label "$firewall_label" --rules "$rules")"
firewall_id="$(printf '%s' "$firewall_json" | jq -r '.[0].id')"
if [ -z "$firewall_id" ] || [ "$firewall_id" = "null" ]; then
  die "failed to read firewall id from linode-cli output"
fi

linode-cli firewalls device-create "$firewall_id" --id "$linode_id" --type linode >/dev/null

mkdir -p "$(dirname "$state_path")"
cat > "$state_path" <<STATE
ADMIN_LINODE_ID=$linode_id
ADMIN_LINODE_LABEL=$label
ADMIN_LINODE_PUBLIC_IPV4=$public_ipv4
ADMIN_LINODE_FIREWALL_ID=$firewall_id
ADMIN_LINODE_FIREWALL_LABEL=$firewall_label
STATE
chmod 0600 "$state_path"

cat <<EOF_OUT
Linode created.

State file: $state_path
Public IPv4: $public_ipv4

Create or update DNS before deploying:
  ${ADMIN_LINODE_DOMAIN:-admin.video-cloud-staging.realtekconnect.com} A $public_ipv4
EOF_OUT
