#!/bin/bash
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
TIMESTAMP=$(date +%s)
TMPFILE="/tmp/daily-map-$TIMESTAMP.geojson"

cd "$DIR"
node scripts/daily-map.js > "$TMPFILE"
node scripts/publish-map.js "$TMPFILE" >> /tmp/daily-publish.log 2>&1
rm -f "$TMPFILE"
