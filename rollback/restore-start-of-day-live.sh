#!/bin/sh
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
rm -rf "$ROOT/deploy/live-with-thread"
mkdir -p "$ROOT/deploy/live-with-thread"
cp -a "$ROOT/rollback/start-of-day-live/." "$ROOT/deploy/live-with-thread/"
rm -f "$ROOT/deploy/live-with-thread/README.md"
echo "Restored deploy/live-with-thread to the start-of-day live site."
echo "Deploy that folder as contextboard-web to finish the rollback."
