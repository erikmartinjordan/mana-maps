#!/usr/bin/env bash
# run_loop.sh - Una iteracion del loop autopilot: BACKLOG -> opencode -> push
set -u
setopt NULL_GLOB 2>/dev/null || true

ROOT="$(cd "$(dirname "$0")" && pwd)"
export PATH="$HOME/bin:$HOME/node/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
export GIT_TERMINAL_PROMPT=0
CONFIG="$ROOT/config.json"
STATUS="$ROOT/STATUS.json"
QUEUE_DIR="$ROOT/queue"
LOGS="$ROOT/logs/sessions"
LOCK="$ROOT/.loop.lock"
LOG_FILE="$ROOT/logs/loop.log"
mkdir -p "$LOGS" "$ROOT/logs" "$QUEUE_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >>"$LOG_FILE"; }

# --- lock con PID y anti-stale (una ejecucion a la vez) ---
if [ -d "$LOCK" ]; then
  OLD_PID=0
  [ -f "$LOCK/pid" ] && OLD_PID=$(cat "$LOCK/pid" 2>/dev/null || echo 0)
  if kill -0 "$OLD_PID" 2>/dev/null; then
    log "Ya hay una ejecucion en curso (pid $OLD_PID), salgo."
    exit 0
  fi
  log "Lock stale (pid $OLD_PID muerto), lo limpio."
  rm -rf "$LOCK"
fi
mkdir "$LOCK" && echo "$$" >"$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT

get_cfg() {
  node -e "
    const c=require('$CONFIG');
    let v;
    try { v=eval('c'+process.argv[1]); } catch(e) { v=undefined; }
    process.stdout.write(String(v !== undefined && v !== null ? v : process.argv[2]));
  " "$1" "${2:-}"
}

DOCKER=/Applications/Docker.app/Contents/Resources/bin/docker
AGENT_TIMEOUT=$(( $(get_cfg '.loop.agentTimeoutMinutes' 30) * 60 ))
IDEA_TIMEOUT=$(( $(get_cfg '.loop.ideationTimeoutMinutes' 20) * 60 ))

# Modelo a usar por todos los agentes (desde config.json). Definido aqui para
# que este disponible en TODO el flujo (mapmaker, ideator, autopilot).
if [ -n "$(get_cfg '.model')" ]; then
  MODEL_OPT="--model $(get_cfg '.model')"
else
  MODEL_OPT=""
fi
log "Modelo configurado: $MODEL_OPT"

# --- ejecuta un comando con timeout; si se cuelga, mata el proceso y los contenedores docker ---
run_with_timeout() {
  local secs="$1"; shift
  local logfile="$1"; shift
  "$@" >>"$logfile" 2>&1 &
  local pid=$!
  local elapsed=0
  while kill -0 "$pid" 2>/dev/null; do
    sleep 15
    elapsed=$((elapsed + 15))
    if [ "$elapsed" -ge "$secs" ]; then
      log "TIMEOUT (${secs}s): matando proceso colgado $pid y sus contenedores"
      # Matar el arbol de procesos del agente (wrapper zsh -> docker run -> opencode)
      kill -9 "$pid" 2>/dev/null
      # Matar cualquier hijo (docker run) para que el contenedor no quede huerfano
      pkill -9 -P "$pid" 2>/dev/null
      # El --rm del docker run deberia limpiar el contenedor; como refuerzo,
      # matamos contenedores plan7-opencode SIN nombre (efimeros del loop).
      "$DOCKER" ps --filter ancestor=plan7-opencode --format '{{.ID}} {{.Names}}' 2>/dev/null | while read -r cid name; do
        [ -z "$name" ] && "$DOCKER" kill "$cid" >/dev/null 2>&1
      done
      wait "$pid" 2>/dev/null
      return 124
    fi
  done
  wait "$pid"
  return $?
}

# --- limpia contenedores plan7-opencode huerfanos (colgados mas de N minutos) ---
cleanup_stale_containers() {
  # Solo contenedores efimeros del loop (sin --name, creados por el wrapper docker run).
  # NO toca los contenedores persistentes con nombre (p.ej. amazing_carver).
  "$DOCKER" ps --filter ancestor=plan7-opencode --format '{{.ID}} {{.Names}}' 2>/dev/null | while read -r cid name; do
    if [ -z "$name" ] || [ "$name" = "/" ]; then
      log "Limpieza: matando contenedor huerfano $cid"
      "$DOCKER" kill "$cid" >/dev/null 2>&1
      "$DOCKER" rm -f "$cid" >/dev/null 2>&1
    fi
  done
}

REPOS_JSON="$(node -e "const c=require('$CONFIG');console.log(JSON.stringify(c.repos))")"
INTERVAL=$(get_cfg ".loop.intervalMinutes")
cleanup_stale_containers

# --- autodiagnóstico ligero (host macOS) ---
ensure_port_free() {
  local port="$1"
  if python3 -c "import socket; s=socket.socket(); s.settimeout(1); r=s.connect_ex(('127.0.0.1', int('$port'))); s.close(); exit(0 if r!=0 else 1)" 2>/dev/null; then
    return 0
  fi
  log "Puerto $port ocupado (macOS), matando http.server huérfano..."
  if command -v lsof >/dev/null 2>&1; then
    for pid in $(lsof -ti:$port 2>/dev/null); do
      log "Matando PID $pid que ocupa $port (lsof)"
      kill -9 "$pid" 2>/dev/null || true
    done
  fi
  for pid in $(ps aux 2>/dev/null | grep "[h]ttp.server.*$port" | awk '{print $2}'); do
    log "Matando PID $pid via ps"
    kill -9 "$pid" 2>/dev/null || true
  done
  sleep 2
}

check_memory_pressure() {
  local free_pages=$(vm_stat 2>/dev/null | awk '/Pages free/ {gsub(/\./,"",$3); print $3}')
  if [ -n "$free_pages" ] && [ "$free_pages" -gt 0 ]; then
    local free_mb=$(( free_pages * 4096 / 1024 / 1024 ))
    if [ "$free_mb" -lt 400 ]; then
      log "Memoria baja: ${free_mb}MB libres, limpiando contenedores huérfanos..."
      cleanup_stale_containers
    else
      log "Memoria OK: ${free_mb}MB libres"
    fi
  fi
}

validate_config() {
  local model=$(get_cfg '.model' '')
  if [ -z "$model" ] || [ "$model" = "undefined" ] || [ "$model" = "null" ]; then
    log "WARN: config.json model vacío, se usará fallback opencode-go/mimo-v2.5"
    MODEL_OPT="--model opencode-go/mimo-v2.5"
  fi
}

consecutive_failures() {
  local task="$1"
  node -e "
    const fs=require('fs');
    const f='$ROOT/logs/tasks.json';
    let a=[]; try{a=JSON.parse(fs.readFileSync(f,'utf8'))}catch(e){}
    const t=process.argv[1];
    let c=0;
    for(let i=a.length-1;i>=0;i--){
      if(a[i].task===t && a[i].rc!==0) c++; else break;
    }
    process.stdout.write(String(c));
  " "$task"
}


set_status() {
  node -e "const fs=require('fs');const p='$STATUS';let s={};try{s=JSON.parse(fs.readFileSync(p,'utf8'))}catch(e){};Object.assign(s,$1);fs.writeFileSync(p,JSON.stringify(s,null,2))"
}

# --- merge de comandos de la cola (WhatsApp) al BACKLOG ---
merge_queue() {
  for f in "$QUEUE_DIR"/*.json; do
    [ -e "$f" ] || continue
    cmd=$(node -e "const j=require('$f');process.stdout.write(j.cmd||'')")
    case "$cmd" in
      task)
        repo=$(node -e "const j=require('$f');process.stdout.write(j.repo||'')")
        text=$(node -e "const j=require('$f');process.stdout.write(j.text||'')")
        if [ -n "$text" ] && [ -n "$repo" ]; then
          BFILE="$ROOT/workspaces/$repo/BACKLOG.md"
          if [ -f "$BFILE" ]; then
            printf '%s\n' "- [ ] $text" >>"$BFILE"
            (cd "$ROOT/workspaces/$repo" && git add BACKLOG.md >/dev/null 2>&1 && git commit -m "chore: tarea anadida desde WhatsApp" >/dev/null 2>&1 && git push origin main >/dev/null 2>&1)
            log "Tarea anadida por WhatsApp en $repo: $text"
          fi
        fi
        ;;
      run) log "Ejecucion solicitada desde WhatsApp." ;;
      *) log "Comando desconocido en cola: $cmd" ;;
    esac
    rm -f "$f"
  done
}

# --- conteo de tareas pendientes ---
pending_count() {
  node -e "const fs=require('fs');const p=process.argv[1];
const m=(fs.readFileSync(p,'utf8')||'').match(/^- \[ \].*/gm);process.stdout.write(String(m?m.length:0))" "$1"
}

# --- espera el resultado de CI para un commit (max ~12 min) ---
ci_wait() {
  local sha="$1" ownerrepo="$2" tries=0 max=24
  while [ "$tries" -lt "$max" ]; do
    local out total done ok
    out=$(curl -s --max-time 20 "https://api.github.com/repos/$ownerrepo/commits/$sha/check-runs?per_page=100")
    total=$(printf '%s' "$out" | node -e "try{const j=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(String(j.total_count||0))}catch(e){process.stdout.write('-1')}")
    if [ "$total" = "-1" ]; then
      log "CI: API no disponible, reintento"
      sleep 20; tries=$((tries+1)); continue
    fi
    if [ "$total" -gt 0 ]; then
      done=$(printf '%s' "$out" | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(String(j.check_runs.filter(x=>x.status==='completed').length))")
      if [ "$done" = "$total" ]; then
        ok=$(printf '%s' "$out" | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(String(j.check_runs.every(x=>['success','skipped','neutral'].includes(x.conclusion))))")
        if [ "$ok" = "true" ]; then return 0; else return 1; fi
      fi
    fi
    sleep 30; tries=$((tries+1))
  done
  return 2
}

merge_queue

# --- maximas ejecuciones diarias (despues de mergear la cola de WhatsApp) ---
MAX_RUNS=$(get_cfg '.loop.maxRunsPerDay')
if [ -n "$MAX_RUNS" ] && [ "$MAX_RUNS" -gt 0 ]; then
  TODAY=$(TZ=Europe/Madrid date +%Y-%m-%d)
  RUNS_TODAY=$(grep -c "$TODAY.*Iteracion terminada" "$LOG_FILE" 2>/dev/null || echo 0)
  log "Ejecuciones hoy: $RUNS_TODAY / max $MAX_RUNS"
  if [ "$RUNS_TODAY" -ge "$MAX_RUNS" ]; then
    log "Maximo de ejecuciones diarias alcanzado, salgo."
    exit 0
  fi
fi

for repo in $(echo "$REPOS_JSON" | node -e "const a=JSON.parse(require('fs').readFileSync(0,'utf8'));a.forEach(r=>console.log(r.name))"); do
  REPO_DIR="$ROOT/workspaces/$repo"
  URL=$(echo "$REPOS_JSON" | node -e "const a=JSON.parse(require('fs').readFileSync(0,'utf8'));const r=a.find(x=>x.name==='$repo');process.stdout.write(r.url)")
  BRANCH=$(echo "$REPOS_JSON" | node -e "const a=JSON.parse(require('fs').readFileSync(0,'utf8'));const r=a.find(x=>x.name==='$repo');process.stdout.write(r.branch)")

  if [ ! -d "$REPO_DIR/.git" ]; then
    git clone "$URL" "$REPO_DIR" >>"$LOG_FILE" 2>&1
    log "Clonado $repo"
  fi

  cd "$REPO_DIR" || exit 1
  git fetch origin >>"$LOG_FILE" 2>&1
  git checkout main >>"$LOG_FILE" 2>&1
  git pull --ff-only origin main >>"$LOG_FILE" 2>&1

  PENDING=$(pending_count "$REPO_DIR/BACKLOG.md")
  log "Repo $repo: $PENDING tareas pendientes"
  set_status "{\"state\":\"idle\",\"repo\":\"$repo\",\"pending\":$PENDING,\"checkedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"

  if [ "$PENDING" -eq 0 ]; then
    # --- produccion de mapas: si no hay tareas, crear un mapa nuevo ---
    # (el mapa es el motor de la estrategia; min 3h entre mapas)
    MIN_MAP=$(get_cfg '.maps.minIntervalHours' 3)
    MIN_MAP_SEC=$((MIN_MAP * 3600))
    LAST_MAP=0
    [ -f "$ROOT/logs/last-map.ts" ] && LAST_MAP=$(cat "$ROOT/logs/last-map.ts")
    NOW=$(date +%s)
    if [ $((NOW - LAST_MAP)) -ge $MIN_MAP_SEC ]; then
      date +%s >"$ROOT/logs/last-map.ts"
      set_status "{\"state\":\"mapping\",\"repo\":\"$repo\"}"
      log "Produccion de mapa nuevo para $repo..."
      MAP_LOG="$LOGS/mapmaker-$(date +%Y%m%d-%H%M).md"
      OPDIR=$(echo "$REPO_DIR" | sed "s|^$HOME|/home/erik|")
      run_with_timeout "$AGENT_TIMEOUT" "$MAP_LOG" opencode run --dir "$OPDIR" --agent mapmaker --auto $MODEL_OPT \
        "Crea un mapa de datos nuevo para la galeria siguiendo el pipeline del prompt de mapmaker. No repitas mapas ya existentes."
      RC_MAP=$?
      [ "$RC_MAP" -ne 0 ] && log "Mapmaker terminado con rc=$RC_MAP (timeout o error)"
      # El mapmaker deja su trabajo en una rama autopilot/* pusheada; lo mergeamos
      # en la seccion estandar de merge del loop (RAMA_A_CONSOLIDAR).
      RAMA_A_CONSOLIDAR=$(git branch --show-current)
      if [ -z "$RAMA_A_CONSOLIDAR" ] || [ "$RAMA_A_CONSOLIDAR" = "main" ]; then
        if [ -n "$(git status --porcelain)" ]; then
          RAMA_A_CONSOLIDAR="autopilot/mapmaker-$(date +%Y%m%d-%H%M)"
          git switch -c "$RAMA_A_CONSOLIDAR" >>"$LOG_FILE" 2>&1
          git add -A >>"$LOG_FILE" 2>&1
          git commit -m "chore: mapa nuevo autopilot" >>"$LOG_FILE" 2>&1 || true
        fi
      fi
      PENDING=$(pending_count "$REPO_DIR/BACKLOG.md")
      set_status "{\"state\":\"idle\",\"repo\":\"$repo\",\"pending\":$PENDING}"
      log "Produccion de mapa: rama=$RAMA_A_CONSOLIDAR pendientes=$PENDING"
    fi

    # --- ideacion automatica: auditar calidad de mapas y proponer mejoras ---
    MIN_IDEA=$(get_cfg '.ideation.minIntervalHours' 12)
    MIN_IDEA_SEC=$((MIN_IDEA * 3600))
    LAST_IDEA=0
    [ -f "$ROOT/logs/last-idea.ts" ] && LAST_IDEA=$(cat "$ROOT/logs/last-idea.ts")
    NOW=$(date +%s)
    if [ $((NOW - LAST_IDEA)) -ge $MIN_IDEA_SEC ]; then
      date +%s >"$ROOT/logs/last-idea.ts"
      set_status "{\"state\":\"ideating\",\"repo\":\"$repo\"}"
      log "Ideacion automatica para $repo..."
      IDEA_LOG="$LOGS/ideator-$(date +%Y%m%d-%H%M).md"
      OPDIR=$(echo "$REPO_DIR" | sed "s|^$HOME|/home/erik|")
      run_with_timeout "$IDEA_TIMEOUT" "$IDEA_LOG" opencode run --dir "$OPDIR" --agent ideator --auto $MODEL_OPT \
        "Audita la calidad de los mapas de la galeria y propone mejoras o nuevos mapas en BACKLOG.md."
      RC_IDEA=$?
      [ "$RC_IDEA" -ne 0 ] && log "Ideator terminado con rc=$RC_IDEA (timeout o error)"
      git checkout main >>"$LOG_FILE" 2>&1
      if [ -n "$(git status --porcelain -- BACKLOG.md)" ]; then
        git add BACKLOG.md >>"$LOG_FILE" 2>&1
        if git commit -m "chore: tareas propuestas por el ideator" >>"$LOG_FILE" 2>&1; then
          git push origin main >>"$LOG_FILE" 2>&1
          log "Ideacion: BACKLOG actualizado"
        fi
      else
        log "Ideacion: sin tareas nuevas (BACKLOG sin cambios)"
      fi
      PENDING=$(pending_count "$REPO_DIR/BACKLOG.md")
      set_status "{\"state\":\"idle\",\"repo\":\"$repo\",\"pending\":$PENDING}"
      log "Ideacion: $PENDING tareas pendientes"
    fi
  fi

  # --- ejecutar el agente ---
  TASK_TEXT=$(grep -m1 '^- \[ \]' BACKLOG.md | sed 's/^- \[ \] *//')
  STARTED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  set_status "{\"state\":\"running\",\"repo\":\"$repo\",\"startedAt\":\"$STARTED\"}"
  # autodiagnóstico previo
  validate_config
  ensure_port_free 4173
  check_memory_pressure
  FAILS=$(consecutive_failures "$TASK_TEXT")
  if [ "$FAILS" -ge 3 ]; then
    log "WARN: $FAILS fallos consecutivos en misma tarea (\"$TASK_TEXT\"), pausando para evitar bucle"
    ESCAPED_TASK=$(printf '%s' "$TASK_TEXT" | node -e "process.stdout.write(JSON.stringify(require('fs').readFileSync(0,'utf8')))")
    set_status "{\"state\":\"paused\",\"reason\":\"consecutive_failures\",\"task\":$ESCAPED_TASK,\"fails\":$FAILS}"
    continue
  fi
  log "Lanzando opencode en $repo..."

  SESSION_LOG="$LOGS/$(date +%Y%m%d-%H%M)-$repo.md"
  : >"$SESSION_LOG"


  # shellcheck disable=SC2086
  OPDIR=$(echo "$REPO_DIR" | sed "s|^$HOME|/home/erik|")
  RC=0
  if [ -n "${RAMA_A_CONSOLIDAR:-}" ]; then
    # Venimos del mapmaker: ya hay un mapa en rama, no lanzamos autopilot.
    log "Consolidando rama del mapmaker: $RAMA_A_CONSOLIDAR"
  else
    run_with_timeout "$AGENT_TIMEOUT" "$SESSION_LOG" opencode run --dir "$OPDIR" --agent autopilot --auto $MODEL_OPT \
      "Procesa la siguiente tarea del BACKLOG.md de este repositorio."
    RC=$?
  fi

  # --- capturar siempre la rama del agente (aunque deje el arbol limpio) ---
  BRANCH_ACT=$(git branch --show-current)
  if [ -n "${RAMA_A_CONSOLIDAR:-}" ]; then
    BRANCH_ACT="$RAMA_A_CONSOLIDAR"
  fi
  if [ -z "$BRANCH_ACT" ] || [ "$BRANCH_ACT" = "main" ]; then
    if [ -n "$(git status --porcelain)" ]; then
      BRANCH_ACT="autopilot/checkpoint-$(date +%Y%m%d-%H%M)"
      git switch -c "$BRANCH_ACT" >>"$LOG_FILE" 2>&1
      git add -A >>"$LOG_FILE" 2>&1
      git commit -m "chore: checkpoint autopilot" >>"$LOG_FILE" 2>&1 || true
      log "Checkpoint commit en $BRANCH_ACT"
    fi
  else
    if [ -n "$(git status --porcelain)" ]; then
      git add -A >>"$LOG_FILE" 2>&1
      git commit -m "chore: checkpoint autopilot" >>"$LOG_FILE" 2>&1 || true
    fi
    log "Rama del agente: $BRANCH_ACT"
  fi
  PR_URL=""
  if [ -n "$BRANCH_ACT" ] && [ "$BRANCH_ACT" != "main" ]; then
    git push -u origin "$BRANCH_ACT" >>"$LOG_FILE" 2>&1 && log "Push de $BRANCH_ACT"
    TOKEN=$(get_cfg '.githubToken')
    if [ -n "$TOKEN" ]; then
      OWNER_REPO=$(git remote get-url origin | sed -E 's#.*(github\.com[:/])([^/]+/[^/.]+)(\.git)?$#\2#')
      PR_URL=$(node -e "
        const https=require('https');
        const r={repo:'$OWNER_REPO',branch:'$BRANCH_ACT',token:'$TOKEN'};
        const body=JSON.stringify({title:'autopilot: cambios del agente',head:r.branch,base:'main',body:'Generado por el agente autopilot.'});
        const req=https.request({host:'api.github.com',path:'/repos/'+r.repo+'/pulls',method:'POST',headers:{Authorization:'token '+r.token,'User-Agent':'autopilot','Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>{
          let d='';res.on('data',c=>d+=c);res.on('end',()=>{try{const j=JSON.parse(d);process.stdout.write(j.html_url||'')}catch(e){process.stdout.write('')}});
        });req.on('error',()=>{process.stdout.write('')});req.write(body);req.end();
      ")
      log "PR: $PR_URL"
    fi
  fi

  ENDED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  set_status "{\"state\":\"$([ $RC -eq 0 ] && echo done || echo error)\",\"finishedAt\":\"$ENDED\",\"exitCode\":$RC,\"branch\":\"${BRANCH_ACT:-}\",\"prUrl\":\"$PR_URL\",\"lastRun\":\"$(date)\"}"

  echo "=== RESUMEN DE SESION ($(date)) ===" >>"$SESSION_LOG"
  git log --oneline -5 >>"$SESSION_LOG" 2>&1

  # --- si el agente tuvo exito: registrar la tarea y la pagina EN LA RAMA, y mergear en UNA sola subida ---
  CODE_COMMIT=""
  CODE_MSG=""
  CI_OK=1
  MERGED_OK=0
  if [ "$RC" -eq 0 ]; then
    AGENT_BRANCH="$BRANCH_ACT"
    git checkout main >>"$LOG_FILE" 2>&1
    git pull --ff-only origin main >>"$LOG_FILE" 2>&1
    AUTOMERGE=$(echo "$REPOS_JSON" | node -e "const a=JSON.parse(require('fs').readFileSync(0,'utf8'));const r=a.find(x=>x.name==='$repo');process.stdout.write(String(r&&r.autoMerge!==undefined?r.autoMerge:'false'))")
    if [ "$AUTOMERGE" = "true" ] && [ -n "$AGENT_BRANCH" ] && [ "$AGENT_BRANCH" != "main" ]; then
      git checkout "$AGENT_BRANCH" >>"$LOG_FILE" 2>&1
      git rebase -X ours main >>"$LOG_FILE" 2>&1
      while [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ]; do
        git rebase --skip >>"$LOG_FILE" 2>&1
      done

      # registrar la tarea + regenerar tasks.html + marcar BACKLOG DENTRO de la rama,
      # para que el CI valide todo en la unica subida que se hara a main.
      HAS_REAL_CHANGES=$(git rev-list --count main..HEAD 2>/dev/null || echo 0)
      if [ "$HAS_REAL_CHANGES" -gt 0 ]; then
        if [ -n "${TASK_TEXT:-}" ]; then
          PRE_COMMIT=$(git rev-parse HEAD)
          PRE_MSG=$(git log -1 --format=%s)
          REC="{\"date\":\"$(TZ=Europe/Madrid date +%Y-%m-%d)\",\"dateTime\":\"$(TZ=Europe/Madrid date '+%Y-%m-%d %H:%M')\",\"task\":\"$(printf '%s' "$TASK_TEXT" | sed 's/"/\\"/g')\",\"branch\":\"$AGENT_BRANCH\",\"commit\":\"$PRE_COMMIT\",\"commitMsg\":\"$(printf '%s' "$PRE_MSG" | sed 's/"/\\"/g')\",\"rc\":0,\"repo\":\"$repo\"}"
          node -e "
            const fs=require('fs');
            const f='$ROOT/logs/tasks.json';
            let a=[];
            try { a=JSON.parse(fs.readFileSync(f,'utf8')); } catch(e){}
            a.push(JSON.parse(process.argv[1]));
            fs.writeFileSync(f, JSON.stringify(a, null, 2));
          " "$REC"
          "$ROOT/scripts/update_tasks_page.sh" --no-git >>"$LOG_FILE" 2>&1
          node -e "const fs=require('fs');const p='BACKLOG.md';const t=fs.readFileSync(p,'utf8').replace(/^- \[ \]/, '- [x]');fs.writeFileSync(p,t)"
          git add tasks.html BACKLOG.md >/dev/null 2>&1
          git -c user.name="Autopilot" -c user.email="autopilot@erikmartinjordan.dev" \
            commit -m "chore: actualizar historial de tareas de los agentes" >>"$LOG_FILE" 2>&1 || true
          log "Tarea registrada y pagina generada en $AGENT_BRANCH"
        fi
      else
        log "QA: el agente no dejo cambios reales en la rama, NO marco la tarea como hecha"
      fi

      # mergear en UNA sola subida y validar el CI de ese unico commit
      git checkout main >>"$LOG_FILE" 2>&1
      if git merge --ff-only "$AGENT_BRANCH" >>"$LOG_FILE" 2>&1; then
        MERGED_OK=1
        git push origin main >>"$LOG_FILE" 2>&1 && log "Merged $AGENT_BRANCH -> main"
        OWNER_REPO=$(git remote get-url origin | sed -E 's#.*(github\.com[:/])([^/]+/[^/.]+)(\.git)?$#\2#')
        CODE_COMMIT=$(git rev-parse HEAD)
        CODE_MSG=$(git log -1 --format=%s)
        log "Esperando resultado de CI para $CODE_COMMIT..."
        ci_wait "$CODE_COMMIT" "$OWNER_REPO"
        CI_RC=$?
        if [ "$CI_RC" -eq 0 ]; then
          log "CI: tests OK"
          CI_OK=1
          # Red de seguridad: publicar en Firestore cualquier mapa nuevo/modificado
          # de data/gallery-*.js (los mapas viven en Firestore, no estaticos)
          if [ -f "$ROOT/.publisher-credentials.json" ] && [ -f "$ROOT/scripts/publish_maps_firestore.js" ]; then
            P_EMAIL=$(node -e "console.log(require('$ROOT/.publisher-credentials.json').email||'')" 2>/dev/null)
            P_PASS=$(node -e "console.log(require('$ROOT/.publisher-credentials.json').password||'')" 2>/dev/null)
            P_PROJ=$(node -e "console.log(require('$ROOT/.publisher-credentials.json').projectId||'')" 2>/dev/null)
            P_KEY=$(node -e "console.log(require('$ROOT/.publisher-credentials.json').apiKey||'')" 2>/dev/null)
            if [ -n "$P_EMAIL" ] && [ -n "$P_PASS" ] && [ -n "$P_PROJ" ]; then
              cd "$REPO_DIR" && node "$ROOT/scripts/publish_maps_firestore.js" "$P_EMAIL" "$P_PASS" "$P_PROJ" "$P_KEY" >>"$LOG_FILE" 2>&1 && \
                log "Firestore: publicados los mapas de data/gallery-*.js" || \
                log "Firestore: aviso al publicar mapas (revisar)"
            fi
          fi
        elif [ "$CI_RC" -eq 1 ]; then
          log "CI: TESTS FALLIDOS en $CODE_COMMIT"
          CI_OK=0
        else
          log "CI: timeout esperando resultado (se continua con aviso)"
          CI_OK=1
        fi
        git push origin --delete "$AGENT_BRANCH" >>"$LOG_FILE" 2>&1
        git branch -D "$AGENT_BRANCH" >>"$LOG_FILE" 2>&1
        if [ "$CI_OK" -eq 0 ]; then
          git pull --ff-only origin main >>"$LOG_FILE" 2>&1
          node -e "
            const fs=require('fs');
            const f='$ROOT/logs/tasks.json';
            let a=[];
            try { a=JSON.parse(fs.readFileSync(f,'utf8')); } catch(e){}
            if (a.length) { a[a.length-1].rc = 2; fs.writeFileSync(f, JSON.stringify(a, null, 2)); }
          " 2>/dev/null || true
          "$ROOT/scripts/update_tasks_page.sh" --no-git >>"$LOG_FILE" 2>&1
          TASK_TEXT="$TASK_TEXT" node -e "const fs=require('fs');const p='BACKLOG.md';const t=fs.readFileSync(p,'utf8').replace(/^- \[x\].*$/m, '- [ ] Arreglar los tests que fallan tras: ' + process.env.TASK_TEXT);fs.writeFileSync(p,t)"
          git add tasks.html BACKLOG.md >/dev/null 2>&1
          git commit -m "chore: tarea de arreglo de tests (CI fallido)" >>"$LOG_FILE" 2>&1
          git push origin main >>"$LOG_FILE" 2>&1
          log "Creada tarea de arreglo de tests y pagina corregida"
        fi
      else
        log "No se pudo mergear $AGENT_BRANCH (revisar manualmente)"
      fi
    else
      # sin autoMerge o sin rama propia: marcar la tarea como antes (si CI OK y hubo cambios)
      git checkout main >>"$LOG_FILE" 2>&1
      git pull --ff-only origin main >>"$LOG_FILE" 2>&1
      HAS_REAL_CHANGES=""
      if [ -n "${AGENT_BRANCH:-}" ] && [ "$AGENT_BRANCH" != "main" ]; then
        HAS_REAL_CHANGES=$(git rev-list --count main.."$AGENT_BRANCH" 2>/dev/null || echo 0)
      fi
      if [ "$CI_OK" -eq 1 ] && grep -q '^- \[ \]' BACKLOG.md && [ -n "$HAS_REAL_CHANGES" ] && [ "$HAS_REAL_CHANGES" -gt 0 ]; then
        node -e "const fs=require('fs');const p='BACKLOG.md';const t=fs.readFileSync(p,'utf8').replace(/- \[ \]/, '- [x]');fs.writeFileSync(p,t)"
        git add BACKLOG.md >/dev/null 2>&1
        git commit -m "chore: marcar tarea completada por autopilot" >>"$LOG_FILE" 2>&1
        git push origin main >>"$LOG_FILE" 2>&1
        log "BACKLOG actualizado en main"
      elif [ "$CI_OK" -eq 1 ] && grep -q '^- \[ \]' BACKLOG.md; then
        log "QA: el agente no dejo cambios reales en la rama, NO marco la tarea como hecha"
      fi
    fi
    # apuntar al commit si no hubo merge (caso fallback)
    if [ -z "$CODE_COMMIT" ] && [ -n "$AGENT_BRANCH" ] && [ "$AGENT_BRANCH" != "main" ]; then
      CODE_COMMIT=$(git rev-parse "$AGENT_BRANCH" 2>/dev/null || true)
      CODE_MSG=$(git log -1 --format=%s "$AGENT_BRANCH" 2>/dev/null || true)
    fi
    if [ -z "$CODE_COMMIT" ]; then
      CODE_COMMIT=$(git rev-parse HEAD 2>/dev/null || true)
      CODE_MSG=$(git log -1 --format=%s 2>/dev/null || true)
    fi
  fi

  # --- si el agente fallo o no se mergeo: registrar la tarea y la pagina (push de metadatos) ---
  if [ "$RC" -ne 0 ] || [ "$MERGED_OK" -eq 0 ]; then
    MAIN_COMMIT="$CODE_COMMIT"
    REC_RC=$RC
    [ "$CI_OK" -eq 0 ] && REC_RC=2
    if [ -n "${TASK_TEXT:-}" ]; then
      REC="{\"date\":\"$(TZ=Europe/Madrid date +%Y-%m-%d)\",\"dateTime\":\"$(TZ=Europe/Madrid date '+%Y-%m-%d %H:%M')\",\"task\":\"$(printf '%s' "$TASK_TEXT" | sed 's/"/\\"/g')\",\"branch\":\"${AGENT_BRANCH:-${BRANCH_ACT:-}}\",\"commit\":\"$MAIN_COMMIT\",\"commitMsg\":\"$(printf '%s' "$CODE_MSG" | sed 's/"/\\"/g')\",\"rc\":$REC_RC,\"repo\":\"$repo\"}"
      node -e "
        const fs=require('fs');
        const f='$ROOT/logs/tasks.json';
        let a=[];
        try { a=JSON.parse(fs.readFileSync(f,'utf8')); } catch(e){}
        a.push(JSON.parse(process.argv[1]));
        fs.writeFileSync(f, JSON.stringify(a, null, 2));
      " "$REC"
      if [ "$CI_OK" -eq 1 ]; then
        "$ROOT/scripts/update_tasks_page.sh" >>"$LOG_FILE" 2>&1
      fi
      log "Tarea registrada (rc=$REC_RC) y pagina $([ "$CI_OK" -eq 1 ] && echo publicada || echo NO publicada: CI fallido)"
    fi
  fi

  log "Iteracion terminada (exit=$RC) para $repo"
done
