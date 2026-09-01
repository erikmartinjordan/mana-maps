#!/usr/bin/env bash
# tunnel.sh - Expone el panel con un tunel publico (localtunnel)
# Se ejecuta en PRIMER PLANO: launchd (KeepAlive) lo reinicia si muere.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PANEL_PORT:-4567}"
URL_FILE="$ROOT/panel-url.txt"
LOG="$ROOT/logs/tunnel.log"
PID_FILE="$ROOT/.tunnel.pid"

log() { echo "[$(date '+%H:%M:%S')] $*" >>"$LOG"; }

is_running() { [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; }

case "$1" in
  stop)
    if is_running; then kill "$(cat "$PID_FILE")" 2>/dev/null; rm -f "$PID_FILE"; echo "Tunel detenido"; else echo "Sin tunel activo"; fi
    exit 0
    ;;
  status)
    if [ -f "$URL_FILE" ]; then echo "Tunel actual: $(cat "$URL_FILE")"; else echo "Sin URL guardada"; fi
    exit 0
    ;;
esac

if pkill -f "localTunnel/bin/index.js\|npx .*localtunnel" 2>/dev/null; then
  sleep 1
  log "Tunel previo detenido"
fi
rm -f "$PID_FILE"

# localtunnel en primer plano; al obtener URL la registra y actualiza maña.com/tasks
"$HOME/node/bin/npx" --yes localtunnel --port "$PORT" \
  >"$ROOT/logs/lt.log" 2>&1 &
LT_PID=$!
echo $LT_PID >"$PID_FILE"

for i in $(seq 1 45); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.loca\.lt' "$ROOT/logs/lt.log" 2>/dev/null | head -1)
  if [ -n "${URL:-}" ]; then
    OK=0
    for p in 1 2 3 4; do
      CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$URL/" 2>/dev/null || echo 000)
      if [ "$CODE" = "200" ]; then OK=1; break; fi
      sleep 5
    done
    if [ "$OK" = "1" ]; then
      printf '%s' "$URL" >"$URL_FILE"
      log "Panel publico (verificado 200): $URL"
      "$ROOT/scripts/update_tasks_page.sh" >>"$LOG" 2>&1
      echo "Panel publico: $URL"
      break
    fi
    log "Tunel registrado pero no responde (ultima probe: $CODE). Reiniciando."
    kill "$LT_PID" 2>/dev/null
    rm -f "$PID_FILE"
    exit 0
  fi
  sleep 2
done

# --- watchdog: mantiene viva la conexion y reinicia si degrada ---
UNREACH=0
while :; do
  sleep 45
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$URL/" 2>/dev/null || echo 000)
  if [ "$CODE" != "200" ]; then
    UNREACH=$((UNREACH + 1))
    log "Watchdog: $CODE ($UNREACH/3)"
  else
    UNREACH=0
    log "Watchdog: OK"
  fi
  if [ "$UNREACH" -ge 3 ]; then
    log "Tunel degradado. Cerrando para que launchd lo reinicie."
    kill "$LT_PID" 2>/dev/null
    pkill -f "localTunnel/bin/index.js" 2>/dev/null
    rm -f "$PID_FILE"
    exit 0
  fi
done
