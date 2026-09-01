#!/usr/bin/env bash
# update_site_link.sh - Actualiza maña.com/tasks (tasks.html) con la URL actual del tunel
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
URL_FILE="$ROOT/panel-url.txt"
REPO_DIR="$ROOT/workspaces/mana-maps"
TEMPLATE="$ROOT/templates/tasks.html"
TARGET="$REPO_DIR/tasks.html"

if [ ! -f "$URL_FILE" ]; then
  echo "Sin URL en $URL_FILE"
  exit 0
fi
URL=$(cat "$URL_FILE" | tr -d '[:space:]')
if [ -z "$URL" ] || [ "${URL#http}" = "$URL" ]; then
  echo "URL invalida: $URL"
  exit 0
fi

CURRENT=""
[ -f "$TARGET" ] && CURRENT=$(grep -oE 'https://[^"< ]+' "$TARGET" | head -1)
if [ "$CURRENT" = "$URL" ]; then
  echo "tasks.html ya apunta a $URL"
  exit 0
fi

sed "s|__TUNNEL_URL__|$URL|g" "$TEMPLATE" >"$TARGET"
cd "$REPO_DIR" || exit 1
git fetch origin >/dev/null 2>&1
git checkout main >/dev/null 2>&1
git pull --ff-only origin main >/dev/null 2>&1
sed "s|__TUNNEL_URL__|$URL|g" "$TEMPLATE" >"$TARGET"
git add tasks.html
git -c user.name="Autopilot" -c user.email="autopilot@erikmartinjordan.dev" \
  commit -m "chore: actualizar enlace del panel agents -> $URL" >/dev/null 2>&1 || { echo "nada que commitear"; exit 0; }
git push origin main 2>&1 | tail -1
echo "tasks.html actualizado a $URL"
