#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
generated_client="$(mktemp -d "${TMPDIR:-/tmp}/activitymap-swift-client.XXXXXX")"

cleanup() {
  rm -rf "${generated_client}"
}
trap cleanup EXIT

cd "${repository_root}"

npx --yes @openapitools/openapi-generator-cli@2.25.2 generate \
  -i openapi/v1.json \
  -g swift6 \
  -o "${generated_client}" \
  --additional-properties=projectName=ActivityMapAPI

swift build --package-path "${generated_client}"
