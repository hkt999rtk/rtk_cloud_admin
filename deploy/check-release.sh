#!/usr/bin/env bash
set -euo pipefail

release_dir="${1:-}"
if [[ -z "$release_dir" ]]; then
	printf 'usage: deploy/check-release.sh dist/rtk_cloud_admin-<version>\n' >&2
	exit 2
fi

[[ -d "$release_dir" ]] || { printf 'release directory not found: %s\n' "$release_dir" >&2; exit 1; }
[[ -s "$release_dir/manifest.txt" ]] || { printf 'missing manifest.txt\n' >&2; exit 1; }
[[ -x "$release_dir/bin/rtk-cloud-admin" ]] || { printf 'missing executable bin/rtk-cloud-admin\n' >&2; exit 1; }
[[ -s "$release_dir/web/dist/index.html" ]] || { printf 'missing web/dist/index.html\n' >&2; exit 1; }
[[ -s "$release_dir/SHA256SUMS" ]] || { printf 'missing SHA256SUMS\n' >&2; exit 1; }

version="$(awk -F= '$1 == "version" { print $2; exit }' "$release_dir/manifest.txt")"
[[ -n "$version" ]] || { printf 'manifest missing version\n' >&2; exit 1; }
case "$version" in
*[!A-Za-z0-9._-]* | "" | .* | *..*)
	printf 'invalid manifest version: %s\n' "$version" >&2
	exit 1
	;;
esac

desc="$(file "$release_dir/bin/rtk-cloud-admin")"
printf '%s\n' "$desc" | grep -Eq 'ELF 64-bit.*x86-64|ELF 64-bit.*x86-64' || {
	printf 'rtk-cloud-admin binary is not linux x86_64: %s\n' "$desc" >&2
	exit 1
}

(
	cd "$release_dir"
	if command -v shasum >/dev/null 2>&1; then
		shasum -a 256 -c SHA256SUMS >/dev/null
	else
		sha256sum -c SHA256SUMS >/dev/null
	fi
)

printf 'Release bundle verified: %s\n' "$release_dir"
