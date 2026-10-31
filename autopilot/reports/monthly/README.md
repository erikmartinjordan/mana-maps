# Informes mensuales

Cada mes, la primera ejecución del agente `blogger` del último día cierra el mes
y genera dos artefactos. Si falla, el día 1 los regenera con el mes anterior
completo:

1. **Informe canónico (interno):** `autopilot/reports/monthly/<YYYY-MM>.md`.
   Es la fuente que lee `autopilot` para fijar la estrategia del mes.
2. **Artículo público:** una pieza de News en ES/EN, resumida y con gráficas,
   que se añade como primera tarjeta de `news/index.html` y
   `en/news/index.html`.

El informe canónico no se publica en el sitio. Es un documento de trabajo para
los agentes y para dirección.

## Generación

El agente `blogger` ejecuta primero:

```bash
node scripts/tools/monthly-report-metrics.js \
  --month <YYYY-MM> \
  --out autopilot/reports/monthly/<YYYY-MM>.json \
  --md-out autopilot/reports/monthly/<YYYY-MM>.md
```

Después completa el Markdown (lectura, prioridades e instrucciones por rol) a
partir del JSON. El JSON no se versiona: es un artefacto de la ejecución. El
Markdown sí se versiona porque es la entrada de `autopilot`.

## Formato obligatorio

El Markdown debe empezar con este frontmatter:

```yaml
---
month: YYYY-MM
generated: YYYY-MM-DD
status: final
---
```

Y contener, como mínimo, estas secciones con estos nombres exactos:

- `## Métricas clave`
- `## Lectura`
- `## Prioridades para el próximo mes`
- `## Instrucciones por rol`

`autopilot` busca las prioridades y las instrucciones por encabezado. No cambies
los nombres ni el orden. Solo consume informes con `status: final`; un informe
en `draft` se ignora y se usa el último final o el fallback.

## Reglas

- Español.
- Datos agregados; nunca nombres de ciudades internas, UIDs, emails ni IPs.
- Separa siempre tráfico externo de tráfico interno/QA.
- Si un dato no es comparable con el mes anterior, dilo.
- Cada prioridad debe tener una métrica de éxito verificable.
- Las instrucciones por rol son obligatorias para `ideator`, `mapmaker`,
  `blogger` y `reviewer`.
- Si no hay datos suficientes, publica un informe corto con la limitación y no
  inventes cifras.

Plantilla: `TEMPLATE.md`. Los agentes ignoran este README y la plantilla al
buscar el último informe.
