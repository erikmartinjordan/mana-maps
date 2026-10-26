# Autopilot

Esta carpeta contiene **solo los prompts de los agentes** (`agents/*.md`).
Son la fuente de verdad de los prompts. El loop del iMac sincroniza todos los
prompts a `~/autopilot/agents/` y `~/.config/opencode/agents/` al inicio de cada
ejecución.

El **sistema que ejecuta esos agentes vive únicamente en el iMac**, en
`~/autopilot` (no es un repo): loop, configuración real, scripts, panel, bot de
WhatsApp, datos y generadores de estrategia. Nada de eso se versiona aquí.

## Agentes

- `agents/autopilot.md` — lee la directiva mensual, elige la primera tarea `- [ ]` alineada, crea rama `autopilot/AAAAMMDD-slug`, ejecuta tests, commitea y pushea.
- `agents/mapmaker.md` — crea mapas nuevos (pipelina dato real → Firestore).
- `agents/ideator.md` — audita la galería y propone tareas en `BACKLOG.md`.
- `agents/reviewer.md` — subagente que revisa `git diff` sin modificar (`agents/chat.md` vive solo en el iMac).
- `agents/blogger.md` — escribe cada día una pieza bilingüe de News (ES/EN) con un mapa interactivo. La primera ejecución de cada mes escribe el informe mensual de estado. Ver `blogger/README.md`.

## Ciclo mensual

El mes se cierra en la **primera ejecución de News del último día del mes**
(07:00). Si falla, se genera el informe completo del mes anterior en los días
1-3 como fallback. El cierre del último día es provisional (datos hasta la mañana);
el fallback de los días 1-3 usa el mes completo. El `blogger` genera:

1. `autopilot/reports/monthly/<YYYY-MM>.md` — informe canónico del mes cerrado.
2. Un artículo público ES/EN, como primera tarjeta de News, con gráficas y una
   versión resumida para dirección. Se registra en `news/posts.json` con
   `type: "report"` y `mapSlug: null` para que el loop valide la publicación.

Después, en el primer ciclo del día 1 (o en los dos días siguientes si el
informe falla), `autopilot` lee el informe del mes anterior **antes de tocar el
BACKLOG**, escribe `autopilot/strategy/current.md` y lo pushea a `main`
para que `ideator`, `mapmaker`, `blogger` y `reviewer` lo lean en su siguiente
ejecución. Si el informe falta, `autopilot` no lo inventa: usa la directiva
anterior y deja constancia.

El loop ya ejecuta `blogger` antes que `autopilot` en cada ciclo; **ese orden es
obligatorio el día 1**. No hace falta cambiar `run_loop.sh`.

Los scripts y formatos están en `reports/monthly/README.md` y
`strategy/README.md`. Las métricas se generan con
`node scripts/tools/monthly-report-metrics.js`.

## News diario (en el iMac)

El loop `~/autopilot/run_loop.sh` se ejecuta a las **07:00, 13:00, 19:00 y
01:00**. El primer trabajo de cada ciclo es el News del día (o el informe mensual el
último día del mes): se intenta a las 07:00 y, si falta, se reintenta a las
13:00 y a las 19:00 (máximo 3 intentos).
No hay runner ni LaunchAgent propios del blog. Instrucciones completas en
`autopilot/blogger/README.md`.

## Configuración (en el iMac)

La configuración real —modelo, intervalos y `whatsapp.ownerNumber`— está en
`~/autopilot/config.json` del iMac y **no se versiona** (contiene datos
personales). El modelo se define **solo** ahí; el loop lo lee y lo pasa a todos
los agentes con `--model`.
