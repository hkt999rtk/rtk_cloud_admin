#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

fake_bin="$tmpdir/bin"
capture="$tmpdir/capture"
mkdir -p "$fake_bin" "$capture"

cat > "$fake_bin/openssl" <<'FAKE_OPENSSL'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "rand" ]; then
  printf 'abcdef1234567890abcdef12\n'
  exit 0
fi
exec /usr/bin/openssl "$@"
FAKE_OPENSSL
chmod +x "$fake_bin/openssl"

cat > "$fake_bin/curl" <<'FAKE_CURL'
#!/usr/bin/env bash
set -euo pipefail
method="GET"
data=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -X)
      method="$2"
      shift 2
      ;;
    -H)
      shift 2
      ;;
    --data-binary|-d|--data)
      data="$2"
      shift 2
      ;;
    -*)
      shift
      ;;
    *)
      url="$1"
      shift
      ;;
  esac
done

mkdir -p "$RTK_TEST_CAPTURE_DIR"
case "$url" in
  */linode/instances?page_size=500)
    printf '{"data":[]}'
    ;;
  */networking/firewalls?page_size=500)
    printf '{"data":[]}'
    ;;
  */linode/instances)
    printf '%s' "$data" > "$RTK_TEST_CAPTURE_DIR/linode-create.json"
    printf '{"id":12345,"ipv4":["203.0.113.30"]}'
    ;;
  */networking/firewalls)
    printf '%s' "$data" > "$RTK_TEST_CAPTURE_DIR/firewall-create.json"
    printf '{"id":67890}'
    ;;
  */networking/firewalls/67890/devices)
    printf '%s' "$data" > "$RTK_TEST_CAPTURE_DIR/firewall-device.json"
    printf '{"id":67890}'
    ;;
  *)
    printf 'unexpected curl url: %s\n' "$url" >&2
    exit 22
    ;;
esac
FAKE_CURL
chmod +x "$fake_bin/curl"

state="$tmpdir/admin.env"
PATH="$fake_bin:$PATH" \
RTK_TEST_CAPTURE_DIR="$capture" \
LINODE_TOKEN="token-for-test" \
ADMIN_LINODE_LABEL="rtk-cloud-admin-test" \
ADMIN_LINODE_FIREWALL_LABEL="rtk-cloud-admin-test-fw" \
ADMIN_LINODE_PUBLIC_KEY_PATH="$tmpdir/id_ed25519.pub" \
ADMIN_LINODE_ALLOWED_SSH_CIDRS="203.0.113.10/32" \
ADMIN_LINODE_STATE_PATH="$state" \
ADMIN_LINODE_VPC_SUBNET_ID="710365" \
ADMIN_LINODE_PRIVATE_IPV4="10.42.1.60" \
  bash -c 'printf "ssh-ed25519 test-key\n" > "$ADMIN_LINODE_PUBLIC_KEY_PATH"; "$0"' \
  "$repo_root/deploy/linode/provision-admin-vm.sh" >/tmp/provision-admin-vm-test.out

jq -e '
  .interfaces[0].purpose == "public" and
  .interfaces[0].primary == true and
  .interfaces[1].purpose == "vpc" and
  .interfaces[1].subnet_id == 710365 and
  .interfaces[1].ipv4.vpc == "10.42.1.60"
' "$capture/linode-create.json" >/dev/null

jq -e '
  [.rules.inbound[] | select(.label == "vpc-metrics")] as $rules |
  ($rules | length) == 1 and
  $rules[0].protocol == "TCP" and
  $rules[0].ports == "8080,9100,9113" and
  $rules[0].addresses.ipv4 == ["10.42.1.0/24"]
' "$capture/firewall-create.json" >/dev/null

grep -q '^ADMIN_LINODE_PRIVATE_IPV4=10.42.1.60$' "$state"

printf 'provision-admin-vm VPC test passed\n'
