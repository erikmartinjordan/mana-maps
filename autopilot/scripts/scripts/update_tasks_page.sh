#!/usr/bin/env bash
# update_tasks_page.sh - Genera tasks.html (historial de tareas de los agentes) y lo publica en main
# Uso: update_tasks_page.sh [--no-git]  (--no-git: solo genera el archivo, sin commit ni push)
set -u
GIT_MODE=1
[ "${1:-}" = "--no-git" ] && GIT_MODE=0
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TASKS_FILE="$ROOT/logs/tasks.json"
TEMPLATE="$ROOT/templates/tasks.template.html"
REPO_DIR="$ROOT/workspaces/mana-maps"
TARGET="$REPO_DIR/tasks.html"
LOG="$ROOT/logs/loop.log"
NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "No se encontro node" >&2; exit 1; }

[ -f "$TASKS_FILE" ] || { echo "No hay tasks.json" >&2; exit 0; }
[ -f "$TEMPLATE" ] || { echo "No hay plantilla" >&2; exit 1; }
command -v git >/dev/null || exit 1

if [ "$GIT_MODE" -eq 1 ]; then
  # Primero sincronizamos y solo despues escribimos tasks.html. Si se genera
  # antes del pull, queda como cambio sin commitear y el rebase falla siempre.
  cd "$REPO_DIR" || exit 1
  git fetch origin >/dev/null 2>&1
  git checkout main >/dev/null 2>&1 || exit 1
  git pull --rebase origin main >>"$LOG" 2>&1 || exit 1
fi

"$NODE" -e "
const fs = require('fs');
const tmpl = fs.readFileSync(process.argv[1], 'utf8');
let tasks = [];
try { tasks = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); } catch (e) {}
tasks.sort((a, b) => (a.dateTime || a.date || '').localeCompare(b.dateTime || b.date || ''));
tasks.reverse();

const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;');
const short = sha => sha ? sha.slice(0,7) : '';
const stamp = t => esc(t.dateTime || t.date || '');

let cards = '';
if (!tasks.length) {
  cards = '<div class=\"empty\">A&#250;n no hay tareas registradas.</div>';
} else {
  cards = tasks.map(t => {
    const ok = Number(t.rc) === 0;
    const chip = ok
      ? '<span class=\"chip chip-ok\">&#10003; Completada</span>'
      : '<span class=\"chip chip-err\">&#10007; Error</span>';
    const branch = t.branch ? '<span>rama <b>' + esc(t.branch) + '</b></span>' : '';
    let commit = '';
    if (t.commit) {
      commit = '<span><a href="https://github.com/erikmartinjordan/mana-maps/commit/' + esc(t.commit) + '" rel="nofollow">commit ' + esc(short(t.commit)) + '</a>' + (t.commitMsg ? ' &middot; ' + esc(t.commitMsg) : '') + '</span>';
    }
    return '<article class=\"task-card\">' +
      '<div class=\"task-main\">' +
        '<div class="task-date">' + stamp(t) + '</div>' +
        '<div class=\"task-title\">' + esc(t.task) + '</div>' +
        '<div class=\"task-meta\">' + branch + commit + '</div>' +
      '</div>' + chip +
    '</article>';
  }).join('');
}

const done = tasks.filter(t => Number(t.rc) === 0).length;
const err = tasks.length - done;
const last = tasks.length ? stamp(tasks[0]) : '&mdash;';

const out = tmpl.replace('__TASKS__', cards)
  .replace('__STAT_DONE__', String(done))
  .replace('__STAT_ERR__', String(err))
  .replace('__STAT_LAST__', last);

fs.writeFileSync(process.argv[3], out);
console.log('tasks.html generado (' + tasks.length + ' tareas)');
" "$TEMPLATE" "$TASKS_FILE" "$TARGET" || exit 1

if [ "$GIT_MODE" -eq 0 ]; then
  echo "tasks.html generado (modo --no-git)"
  exit 0
fi

if ! git diff --quiet HEAD -- tasks.html; then
  git add tasks.html
  git -c user.name="Autopilot" -c user.email="autopilot@erikmartinjordan.dev" \
    commit -m "chore: actualizar historial de tareas de los agentes" >>"$LOG" 2>&1 || { echo "sin cambios"; exit 0; }
  for i in 1 2 3; do
    git push origin main >>"$LOG" 2>&1 && break
    sleep 4
    git pull --rebase origin main >>"$LOG" 2>&1
  done
  echo "tasks.html publicado"
fi
