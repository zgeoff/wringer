#!/usr/bin/env bash
# Rebuilds ghostty/ghostty-vt.wasm and its manifest from the pinned ghostty tag.
# Needs git, curl-reachable GitHub, zig at the pinned version and sha256sum on PATH.
set -euo pipefail

tag="vt-1.0.1"
zig_version="0.17.0"
repo="https://github.com/ghostty-org/ghostty"

package_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "$(zig version)" != "$zig_version" ]; then
  echo "build-ghostty-vt: needs zig $zig_version, found $(zig version)" >&2
  exit 1
fi

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

git clone --quiet --depth 1 --branch "$tag" "$repo" "$work_dir/ghostty"

commit="$(git -C "$work_dir/ghostty" rev-parse HEAD)"

(
  cd "$work_dir/ghostty"
  zig build -Demit-lib-vt -Dtarget=wasm32-freestanding -Doptimize=ReleaseSmall
)

cp "$work_dir/ghostty/zig-out/bin/ghostty-vt.wasm" "$package_dir/ghostty/ghostty-vt.wasm"

sha256="$(sha256sum "$package_dir/ghostty/ghostty-vt.wasm" | cut -d' ' -f1)"

cat > "$package_dir/ghostty/ghostty-vt.json" << JSON
{
  "tag": "$tag",
  "commit": "$commit",
  "zig": "$zig_version",
  "optimize": "ReleaseSmall",
  "sha256": "$sha256"
}
JSON

echo "build-ghostty-vt: wrote ghostty-vt.wasm ($sha256)"
