# AGENTS.md — Convenciones para agentes en mana-maps

Repositorio de Maña Maps (`maña.com`): editor de mapas en el navegador con
galería comunitaria servida desde Firestore. Este archivo es de lectura
obligatoria para cualquier agente que trabaje aquí.

## Arquitectura vigente

- La galería carga mapas **exclusivamente de Firestore** (colección `maps`,
  proyecto `mana-maps-pro-f2177`). Los bundles locales `data/gallery-*.js`
  fueron eliminados: **no recrearlos** ni añadir `<script>` de datos.
- El mapa destacado de `/gallery/?slug=<id>` se renderiza con MapLibre y
  respeta por feature: `_manaFillOpacity`, `_manaBorderColor`, `_manaWeight`
  y etiqueta polígonos con `_manaName`, con popups de datos reales al hacer
  clic. Genera leyenda a partir de la clave numérica declarada en el doc
  (`legendKey` + `legendTitle`/`legendFormat`) vía `buildLegendForKey` en
  `site/js/gallery-page.js`; con rampas continuas (muchos colores) la leyenda se
  colapsa en una barra de degradado.

## Estructura del repositorio (obligatoria)

- `site/`: **todo lo público que se despliega** en GitHub Pages (HTML, CSS, JS,
  assets, landings, OG cards, News y `tasks.html`). El workflow sube solo esta
  carpeta como artefacto de Pages.
- `data/maps/<slug>.geojson`: GeoJSON publicable de cada mapa. Los crudos que
  sí se versionan van en `data/sources/`.
- `scripts/maps/`: un `gen-<slug>.js` y un `publish-<slug>.js` por mapa.
- `scripts/tools/`: auditorías, generación de landings/OG, sitemap, higiene y
  utilidades. `scripts/lib/publisher.js` es la única puerta a Firestore y
  `scripts/lib/map-card.js` renderiza las tarjetas OG.
- `site/assets/`: imágenes de marca y OG raíz. `site/css/`: `main.css`,
  `auth-gallery.css`, `site-footer.css`, `site-navbar.css` y `tutorial.css`.
  `site/basemaps/`: estilos MapLibre. `docs/`: documentación interna (no se
  publica).
- **Prohibido** en la raíz: cualquier archivo o carpeta pública (`index.html`,
  `404.html`, `gallery/`, `news/`, `css/`, `js/`, `assets/`, `favicon.*`,
  `sitemap.xml`…) y los residuos `.DS_Store`, `*.tmp.js`, `strategy/`,
  `styles/`, `brand/`, `globe-thumb.png`, `og-card.png`, `styles.css`,
  `auth-gallery.css`, `fabrica.html`. Los artículos viven en
  `site/news/<slug>/` y `site/en/news/<slug>/`. También prohibidos
  `data/gallery-*.js`, scripts de mapas sueltos en `scripts/` y contenido
  interno dentro de `site/`.
- Documentación: `docs/repo-structure.md` y `scripts/README.md`.
- Guardia en CI: `node scripts/tools/check-repo-hygiene.js`.

## Estándar de publicación de mapas (obligatorio)

Todo mapa nuevo o actualización de la galería debe cumplir:

1. **Datos de fuente autoritativa y citada** (Natural Earth, IHO, GEBCO/NOAA,
   USGS, ONU, Smithsonian…). Rellenar siempre `dataSource` y `dataDate`.
2. **Geometría real**: prohibidos polígonos aproximados a mano. Usar
   geometrías oficiales recortadas (shapely: región aproximada ∩ geometría
   real), `simplify(preserve_topology)` y descartar partes pequeñas
   (`área >= max(25°², 40 % de la parte mayor)`) para evitar etiquetas
   duplicadas.
3. **Paleta semántica**: si hay variable numérica, rampa secuencial
   monocromática ordenada por el dato (claro→oscuro). Nada de colores
   arbitrarios tipo arcoíris. En coropletas, borde blanco fino.
4. **Propiedades por feature** (contenido en español): `_manaName`, `name`,
   `_manaColor`, `_manaFillOpacity`, `_manaGroupName`, `_manaGroupId`,
   `_manaLabelStyle` completo (haloWidth ≥ 2) y claves de datos legibles:
   `Superficie`, `Dato`, `Description` + la clave numérica que alimente la
   leyenda (p. ej. `Profundidad media`).
5. **Popups con información real**: cada feature muestra datos concretos,
   no solo el nombre.
6. **Validación previa obligatoria**: GeoJSON válido, coordenadas dentro de
   ±180/±90, `featureCount` coherente, colores hex válidos, labelStyles
   completos, sin nombres duplicados, rampa ordenable por el dato.
7. **Tests en verde**: `npx playwright test --config=tests/predeploy/playwright.config.js`
   → 19/19 antes de pushear. Añadir también
   `node scripts/tools/check-local-assets.js` y
   `node scripts/tools/check-repo-hygiene.js`.
8. **Publicación directa en Firestore** (REST o SDK con cuenta publicadora;
   credenciales fuera del repo): documento `maps/<slug>` con `isPublished:
   true`, `shareMode: 'view'`, `createdBy`/`ownerUid` = uid autenticado.
   Tamaño máx. 1 MiB/doc; geojsonText como string.
9. **Verificación posterior**: lectura REST (`isPublished`, `featureCount`)
   y revisión visual escritorio + móvil de `/gallery/?slug=<id>`
   (leyenda, etiquetas únicas, popup funcional).

### Mapas puntuales con iconos (emojis)

Cuando el tema sea una **entidad puntual real** (picos, volcanes, incendios,
cráteres, lugares extremos), es válido y recomendable usar features `Point`
con icono. Requisitos por feature: `name`/`_manaName`, `markerType` y
`_manaMarkerType` con un id de emoji válido del catálogo (`site/js/markers.js`,
replicado en `site/js/vector-renderer.js` y `site/js/globe.js`), `_manaColor`,
`_manaEmojiSize` (o clave `Area`) para escalar el icono, `_manaGroupName`,
`_manaGroupId` y `_manaLabelStyle` completo. **Nunca** representes un área
(país, desierto, región) con un punto: eso exige polígono real (punto 2).

## Contenido

- Español para todo lo visible por usuarios (títulos, popups, descripciones).
- Cada mapa es una landing SEO: título descriptivo, descripción útil,
  OG card generada (workflow `generate-images.yml`) y entrada en changelog.

## Higiene

- No commitear secretos ni credenciales.
- No modificar `firestore.rules` sin necesidad explícita.
- Tests y lint antes de cada push; commits concisos estilo `feat:`/`chore:`.

## Decisiones de producto (NO tocar)

- **Tarjetas de la galería**: las descripciones (`.card-desc`) y la fuente de
  datos (`.meta-source`) permanecen **OCULTAS** por decisión de producto. Está
  prohibido proponerlas o re-habilitarlas (ni en BACKLOG ni en código). Hay un
  test que lo bloquea: `tests/predeploy/gallery-smoke.spec.js`
  ("gallery cards keep descriptions and data source hidden").
- Si una tarea del BACKLOG contradice esta sección, se descarta.
