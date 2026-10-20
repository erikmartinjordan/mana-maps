#!/usr/bin/env bash
set -u

ROOT="$HOME/autopilot"
REPO="$ROOT/workspaces/mana-maps"
LOG_DIR="$ROOT/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/blog-$(date +%Y%m%d-%H%M).log"

export PATH="$HOME/bin:$HOME/node/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

cd "$REPO" || {
  echo "No existe el repo en $REPO" >>"$LOG"
  exit 1
}

git fetch origin main >>"$LOG" 2>&1
git checkout main >>"$LOG" 2>&1
git pull --ff-only origin main >>"$LOG" 2>&1

MODEL_OPT=""
if [ -f "$ROOT/config.json" ]; then
  MODEL=$(node -e "try{const c=require('$ROOT/config.json');process.stdout.write(c.model||'')}catch(e){}" 2>/dev/null || true)
  [ -n "$MODEL" ] && MODEL_OPT="--model $MODEL"
fi

opencode run --dir "$REPO" --agent blogger --auto $MODEL_OPT \
  "Escribe y publica el post diario bilingüe (es/en) con un mapa interactivo. Sigue .opencode/agent/blogger.md." \
  >>"$LOG" 2>&1

echo "BLOG_RC=$?" >>"$LOG"
