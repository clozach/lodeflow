#!/usr/bin/env bash
# Run the engine's property tests, the document-model, camera-math and history properties and the browser scenarios,
# after checking theditor's vendored core against its canonical repository (scripts/sync-theditor.mjs).
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
node "$here/scripts/sync-theditor.mjs" --check
node "$here/scripts/check-theditor-vendor.mjs"
(cd "$here/engine" && CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$here/engine/.target}" cargo test --release)
(cd "$here/web" && node test/model.mjs && node test/loose.mjs && node test/reverse.mjs && node test/geometry.mjs && node test/history.mjs && node test/fixture-controls.mjs && node test/limits.mjs && node test/placement.mjs && node test/presentation.mjs && node test/controls.mjs && node test/forks.mjs && node test/child-reverse.mjs && node test/copy-paste.mjs && node test/rotation.mjs && node test/e2e.mjs && node test/theditor.mjs && node test/theditor-magnets.mjs)
