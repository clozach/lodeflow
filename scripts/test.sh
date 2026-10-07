#!/usr/bin/env bash
# Run the engine's property tests, the document-model, camera-math and history properties and the browser scenarios.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
(cd "$here/engine" && CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$here/engine/.target}" cargo test --release)
(cd "$here/web" && node test/model.mjs && node test/geometry.mjs && node test/history.mjs && node test/limits.mjs && node test/placement.mjs && node test/presentation.mjs && node test/controls.mjs && node test/e2e.mjs)
