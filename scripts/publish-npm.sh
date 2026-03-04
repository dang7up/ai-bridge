#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
NPM_REGISTRY=${NPM_REGISTRY:-https://registry.npmjs.org/}
PACKAGE_JSON="$ROOT_DIR/package.json"

if [[ $# -lt 1 ]]; then
  echo "Usage: $(basename "$0") <version>"
  echo "Example: $(basename "$0") 0.1.0"
  exit 1
fi

TARGET_VERSION=$1

update_package_json_version() {
  local package_json_path=$1
  local version=$2
  node -e '
    const fs = require("fs");
    const path = process.argv[1];
    const version = process.argv[2];
    const pkg = JSON.parse(fs.readFileSync(path, "utf8"));
    pkg.version = version;
    fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
  ' "$package_json_path" "$version"
}

TMP_NPMRC=""
cleanup() {
  if [[ -n "$TMP_NPMRC" ]]; then
    rm -f "$TMP_NPMRC"
  fi
}
trap cleanup EXIT

echo "Updating package version to ${TARGET_VERSION}..."
update_package_json_version "$PACKAGE_JSON" "$TARGET_VERSION"

if [[ -n "${NPM_TOKEN:-}" ]]; then
  TMP_NPMRC=$(mktemp)
  printf "//registry.npmjs.org/:_authToken=%s\n" "$NPM_TOKEN" > "$TMP_NPMRC"
  printf "registry=%s\n" "$NPM_REGISTRY" >> "$TMP_NPMRC"
  export NPM_CONFIG_USERCONFIG="$TMP_NPMRC"
else
  npm whoami >/dev/null
fi

DRY_RUN=${DRY_RUN:-0}
PUBLISH_FLAGS=(--access public)
if [[ -n "${NPM_OTP:-}" ]]; then
  PUBLISH_FLAGS+=(--otp "$NPM_OTP")
fi
if [[ "$DRY_RUN" == "1" ]]; then
  PUBLISH_FLAGS+=(--dry-run)
fi

echo "==> Installing dependencies..."
cd "$ROOT_DIR"
if [[ -f "pnpm-lock.yaml" ]] && command -v pnpm >/dev/null 2>&1; then
  pnpm install
else
  npm install
fi

echo "==> Building..."
npm run build

echo "==> Publishing ai-bridge@${TARGET_VERSION}..."
if ! npm publish "${PUBLISH_FLAGS[@]}"; then
  echo "npm publish failed"
  exit 1
fi

echo "✓ Successfully published ai-bridge@${TARGET_VERSION}"
