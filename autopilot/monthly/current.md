---
month: 2026-11
source: autopilot/reports/monthly/2026-10.md
fallback: false
status: active
updated: 2026-11-03
---

# Directiva mensual — 2026-11

## Foco

1. **Distribución antes que catálogo.** Pausar los mapas nuevos hasta el 15 de
   noviembre y trabajar landings, OG cards y enlaces internos de los 8 mapas con
   cero visitas. Métrica: 0 mapas con cero visitas y ≥600 visitas acumuladas a
   mapas (desde 436).
2. **Capturar búsqueda.** Optimizar las 10 landings con más impresiones y
   enlazarlas desde News y desde las fichas de mapas relacionados. Métrica: ≥100
   sesiones externas de buscadores (desde 56) y Bing por debajo del 70% de la
   búsqueda.
3. **Activar el embudo mapa→cuenta.** CTA de guardado en el visor y un caso de
   uso por pieza de News. Métrica: ≥6 signups (desde 2) y ≥30 shares (desde 17).

## Instrucciones por rol

- **ideator:** proponer cinco acciones de distribución y tres temas de News
  atados a mapas con visitas, no mapas nuevos. Evitar cualquier idea que dependa
  de abrir mercados por país (la muestra de 314 sesiones externas no lo permite)
  y evitar propuestas de catálogo hasta el 15-11.
- **mapmaker:** pausar la producción nueva dos semanas. Auditar los 8 mapas con
  cero visitas (metadata, leyenda, OG, enlaces internos) y corregir el único mapa
  sin `legendKey`; priorizar tareas de leyenda, metadata y coherencia de datos
  de mapas ya publicados.
- **blogger:** una pieza diaria, siempre con un mapa ya publicado y enlace a la
  galería. Priorizar ángulos de búsqueda y Reddit (Bing 38/56 y
  Reddit 23/30 son la única señal); no repetir mapas de los últimos 14 días ni
  usar el informe en la deduplicación.
- **reviewer:** vigilar que ningún texto mezcle sesiones internas y externas,
  que toda cifra proceda del JSON de métricas y que no se publiquen mapas sin
  fuente, fecha o leyenda. Rechazar diffs que re-habiliten `.card-desc` o
  `.meta-source` en la galería (decisión de producto).

## Filtro de BACKLOG

- Priorizar: leyenda (`legendKey`/`legendTitle`/`legendFormat`), metadata y
  higiene de datos, landings y OG cards de mapas existentes, enlaces internos,
  JSON-LD, sitemap, auditorías (`audit-gallery-quality.js`), medición,
  distribución y activación.
- Evitar: mapas nuevos y cualquier tarea de catálogo que amplíe la galería
  (incluida `housing-price-spain`) hasta el 15-11; cambios de producto que
  contradigan `AGENTS.md` (descripciones/fuente visibles en tarjetas).

## Métricas de éxito del mes

- 0 mapas con cero visitas y ≥600 visitas acumuladas a mapas.
- ≥100 sesiones externas de buscadores y Bing <70% del tráfico de búsqueda.
- ≥6 signups y ≥30 shares desde mapas públicos.
