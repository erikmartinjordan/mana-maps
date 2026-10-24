# Autopilot

Esta carpeta contiene **solo los prompts de los agentes** (`agents/*.md`).
Son la fuente de verdad de los prompts. El loop del iMac sincroniza todos los
prompts a `~/autopilot/agents/` y `~/.config/opencode/agents/` al inicio de cada
ejecución.

El **sistema que ejecuta esos agentes vive únicamente en el iMac**, en
`~/autopilot` (no es un repo): loop, configuración real, scripts, panel, bot de
WhatsApp, datos y generadores de estrategia. Nada de eso se versiona aquí.

## Agentes

- `agents/autopilot.md` — implementa la primera tarea `- [ ]` del `BACKLOG.md`, crea rama `autopilot/AAAAMMDD-slug`, ejecuta tests, commitea y pushea.
- `agents/mapmaker.md` — crea mapas nuevos (pipelina dato real → Firestore).
- `agents/ideator.md` — audita la galería y propone tareas en `BACKLOG.md`.
- `agents/reviewer.md` — subagente que revisa `git diff` sin modificar (`agents/chat.md` vive solo en el iMac).
- `agents/blogger.md` — escribe cada día una pieza bilingüe de News (ES/EN) con un mapa interactivo. Es un trabajo del loop; ver `blogger/README.md`.

## News diario (en el iMac)

El loop `~/autopilot/run_loop.sh` se ejecuta a las **07:00, 13:00, 19:00 y
01:00**. El primer trabajo de cada ciclo es el News del día: se intenta a las
07:00 y, si falta, se reintenta a las 13:00 y a las 19:00 (máximo 3 intentos).
No hay runner ni LaunchAgent propios del blog. Instrucciones completas en
`autopilot/blogger/README.md`.

## Configuración (en el iMac)

La configuración real —modelo, intervalos y `whatsapp.ownerNumber`— está en
`~/autopilot/config.json` del iMac y **no se versiona** (contiene datos
personales). El modelo se define **solo** ahí; el loop lo lee y lo pasa a todos
los agentes con `--model`.
