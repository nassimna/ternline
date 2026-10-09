#!/usr/bin/env bash
set -euo pipefail

version=${1:?Usage: build-arch-package.sh VERSION DEB OUTPUT_DIRECTORY}
deb=$(realpath "${2:?DEB is required}")
output=$(realpath -m "${3:?OUTPUT_DIRECTORY is required}")
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+-alpha\.[0-9]+$ ]]
[[ "${deb##*/}" == "agent-workspace-${version}-x86_64.deb" ]]
repository=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
mkdir -p "$repository/target" "$output"
work=$(mktemp -d "$repository/target/arch-package.XXXXXX")
trap 'rm -rf -- "$work"' EXIT
cp "$repository"/packaging/aur/ternline-bin/{PKGBUILD,ternline-cli} "$work/"
pkgver=${version/-alpha./alpha}
deb_hash=$(sha256sum "$deb" | cut -d ' ' -f1)
cli_hash=$(sha256sum "$work/ternline-cli" | cut -d ' ' -f1)
sed -i -e "s/^pkgver=.*/pkgver=$pkgver/" \
  -e "s/^_upstream_version=.*/_upstream_version=$version/" \
  "$work/PKGBUILD"
sed -i "/^sha256sums=(/,/^)/c\\sha256sums=(\n  '$deb_hash'\n  '$cli_hash'\n)" "$work/PKGBUILD"
cd "$work"
makepkg --printsrcinfo > .SRCINFO
# Archive the exact recipe without the downloaded DEB or build products.
tar -czf "$output/ternline-bin-${version}-recipe.tar.gz" PKGBUILD .SRCINFO ternline-cli
cp "$deb" .
makepkg --verifysource
makepkg --noconfirm
package="ternline-bin-${pkgver}-1-x86_64.pkg.tar.zst"
namcap PKGBUILD "$package" | tee "$output/ternline-bin-${version}-namcap.txt"
if grep -q ' E:' "$output/ternline-bin-${version}-namcap.txt"; then
  printf 'Arch package lint errors block release\n' >&2
  exit 1
fi
cp "$package" "$output/"
