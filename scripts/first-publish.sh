#!/usr/bin/env bash
# One-time local publish for a package that is new to npm: trusted publishing
# (OIDC) can only be configured for packages that already exist on the
# registry. Every later release is published by .github/workflows/main.yml.
set -euo pipefail

usage="usage: scripts/first-publish.sh <package-dir>   e.g. scripts/first-publish.sh core"
pkg_dir="packages/${1:?$usage}"
manifest="$pkg_dir/package.json"
[[ -f $manifest ]] || {
  echo "not a package: $pkg_dir" >&2
  exit 1
}

name=$(jq -r .name "$manifest")
version=$(jq -r .version "$manifest")

[[ $(jq -r '.private // false' "$manifest") == false ]] || {
  echo "$name is \"private\": true — make it publishable first" >&2
  exit 1
}

npm whoami > /dev/null || {
  echo "not logged in to npm — run: npm login" >&2
  exit 1
}

if npm view "$name" version > /dev/null 2>&1; then
  echo "$name already exists on npm — releases go through CI, not this script" >&2
  exit 1
fi

bun install --frozen-lockfile
if [[ -n $(jq -r '.scripts.build // empty' "$manifest") ]]; then
  (cd "$pkg_dir" && bun run build)
fi
(cd "$pkg_dir" && rm -f ./*.tgz && bun pm pack && npm publish ./*.tgz --access public && rm -f ./*.tgz)

cat << EOS

published $name@$version

Now enable trusted publishing so CI can release future versions:
  1. Open https://www.npmjs.com/package/$name/access
  2. Add Trusted Publisher -> GitHub Actions:
       organization or user: zgeoff
       repository:           wringer
       workflow filename:    main.yml
       environment:          (leave empty)
  3. Turn on "Allow npm publish" for the publisher. Without it, the publisher
     allows only npm stage publish, and the CI publish fails with ENEEDAUTH.
  4. Release the package from CI within 2 days: npm expires a trusted
     publisher that no publish uses in that time.
EOS
