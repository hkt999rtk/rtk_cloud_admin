#!/usr/bin/env bash
set -euo pipefail

admin_host="${ADMIN_LINODE_HOST:-${ADMIN_LINODE_PUBLIC_IPV4:-}}"
ssh_user="${ADMIN_LINODE_SSH_USER:-root}"
ssh_key="${ADMIN_LINODE_SSH_KEY:-$HOME/.ssh/id_ed25519_rtkcloud}"
data_dir="${ADMIN_LINODE_DATA_DIR:-/var/lib/rtk_cloud_admin}"
backup_dir="${ADMIN_LINODE_BACKUP_DIR:-.artifacts/linode-admin-backups}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
remote_archive="/tmp/rtk-cloud-admin-db-$stamp.tar.gz"
local_archive="$backup_dir/rtk-cloud-admin-db-$stamp.tar.gz"

[ -n "$admin_host" ] || { echo "ADMIN_LINODE_HOST or ADMIN_LINODE_PUBLIC_IPV4 is required" >&2; exit 1; }
[ -s "$ssh_key" ] || { echo "SSH key not found: $ssh_key" >&2; exit 1; }
mkdir -p "$backup_dir"
ssh_opts=(-i "$ssh_key" -o BatchMode=yes -o StrictHostKeyChecking=accept-new)
remote="$ssh_user@$admin_host"

ssh "${ssh_opts[@]}" "$remote" "tar -C '$data_dir' -czf '$remote_archive' rtk-cloud-admin.db rtk-cloud-admin.db-wal rtk-cloud-admin.db-shm 2>/dev/null || tar -C '$data_dir' -czf '$remote_archive' rtk-cloud-admin.db"
scp "${ssh_opts[@]}" "$remote:$remote_archive" "$local_archive"
ssh "${ssh_opts[@]}" "$remote" "rm -f '$remote_archive'"
sha256sum "$local_archive" > "$local_archive.sha256"
printf 'Backup written: %s\n' "$local_archive"
