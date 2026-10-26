# News diario (ES + EN)

El agente `blogger` escribe la pieza diaria de News en español e inglés con un
mapa interactivo del editor de Maña Maps. El prompt canónico vive en
`autopilot/agents/blogger.md` y es el único sitio donde se mantiene.

## Ejecución

Ya no hay runner ni LaunchAgent propios. El loop `~/autopilot/run_loop.sh` lo
ejecuta como primer trabajo de cada ciclo:

- **07:00** — primer intento.
- **13:00** — reintento si falta el post del día.
- **19:00** — segundo reintento si sigue faltando.
- **01:00** — no ejecuta News (fuera de la ventana 07–23 h).

El loop sincroniza los prompts desde `autopilot/agents/`, lanza
`opencode run --agent blogger` (120 steps) y publica en `main` solo si
`news/posts.json` contiene la fecha de hoy y existen las páginas ES/EN.

Si el agente deja trabajo sin commitear, el loop lo commitea y lo pushea. Si el
resultado no es válido, lo guarda en `git stash` y lo reintenta en el siguiente
ciclo (máximo 3 intentos al día).

Los logs quedan en `~/autopilot/logs/sessions/blogger-AAAAMMDD-HHMM.md` y en
`~/autopilot/logs/loop.log`.

## Informe mensual

En la **primera ejecución de News del último día del mes** (07:00), el agente
cierra el mes y escribe el informe mensual en lugar de la pieza diaria. Si esa
ejecución falla, los **días 1-3** lo reintentan con el mes anterior completo:

1. Ejecuta (usa el mes en curso en el cierre del último día y el anterior en el
   fallback de los días 1-3):

   ```bash
   node scripts/tools/monthly-report-metrics.js \
     --month <mes-a-cerrar> \
     --out autopilot/reports/monthly/<mes-a-cerrar>.json \
     --md-out autopilot/reports/monthly/<mes-a-cerrar>.md
   ```
2. Completa el Markdown canónico (lectura, 3 prioridades e instrucciones por
   rol), cambia `status: draft` a `status: final` y lo commitea en
   `autopilot/reports/monthly/<mes>.md`. Un informe en `draft` no se consume.
3. Publica el artículo ES/EN como primera tarjeta de News, con gráficas y sin
   iframe de mapa.
4. Añade una entrada a `news/posts.json` con `type: "report"`, `mapSlug: null`
   y `sourceUrls: []`. El loop necesita esa entrada para validar y pushear la
   publicación.
5. Actualiza sitemap y hreflang. No añadas el informe a la deduplicación de
   noticias diarias.

El informe canónico es la entrada de `autopilot`: en el primer ciclo del día 1,
después del `blogger`, el agente `autopilot` lo lee antes de tocar el BACKLOG y
escribe `autopilot/strategy/current.md`. Si el informe ya existe, el `blogger`
sigue con la pieza diaria normal.

Si el informe falla el último día, el loop reintenta a las 13:00 y 19:00 porque
`news/posts.json` aún no tiene la fecha de hoy. Si sigue fallando, los días 1-3 lo
generan con el mes anterior completo. El informe del último día es un cierre
provisional con datos hasta la mañana; el del día 1 es el cierre completo.
