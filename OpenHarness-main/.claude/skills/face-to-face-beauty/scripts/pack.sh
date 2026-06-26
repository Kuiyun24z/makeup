#!/usr/bin/env bash
# Pack face-to-face-beauty bundle for distribution
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/../face-to-face-beauty-bundle.tar.gz}"
cd "$ROOT/.."
tar czf "$OUT" face-to-face-beauty/
echo "Created: $OUT"
ls -lh "$OUT"
