# Autopilot

Esta carpeta contiene **solo los prompts de los agentes** (`agents/*.md`).
Son la fuente de verdad de los prompts: el iMac los copia automáticamente a
`~/autopilot/agents/` en cada pull del repo (`sync_repo_agents()` en el
`run_loop.sh` del iMac), de modo que editar un prompt aquí lo aplica el loop
sin tocar el iMac a mano.

El **sistema que ejecuta esos agentes vive únicamente en el iMac**, en
`~/autopilot` (no es un repo): loop, configuración real, scripts, panel, bot de
WhatsApp, datos y generadores de estrategia. Nada de eso se versiona aquí.

## Agentes

- `agents/autopilot.md` — implementa la primera tarea `- [ ]` del `BACKLOG.md`, crea rama `autopilot/AAAAMMDD-slug`, ejecuta tests, commitea y pushea.
- `agents/mapmaker.md` — crea mapas nuevos (pipelina dato real → Firestore).
- `agents/ideator.md` — audita la galería y propone tareas en `BACKLOG.md`.
- `agents/reviewer.md` — subagente que revisa `git diff` sin modificar (`agents/chat.md` vive solo en el iMac).
- `agents/blogger.md` — escribe cada día un post bilingüe (ES/EN) con un mapa interactivo. El scheduling y el runner están en `blogger/`; ver `blogger/README.md`.

## Blog diario (en el iMac)

El agente `blogger` se ejecuta a diario a las 08:00 con
`autopilot/blogger/run_blogger.sh` y el LaunchAgent
`autopilot/blogger/com.mana-maps.blogger.plist`. Instrucciones completas en
`autopilot/blogger/README.md`.

## Configuración (en el iMac)

La configuración real —modelo, intervalos y `whatsapp.ownerNumber`— está en
`~/autopilot/config.json` del iMac y **no se versiona** (contiene datos
personales). El modelo se define **solo** ahí; el loop lo lee y lo pasa a todos
los agentes con `--model`.
