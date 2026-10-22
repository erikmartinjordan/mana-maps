# Scripts de Maña Maps

Este directorio contiene las herramientas de datos y publicación de mapas. La
regla es simple: **un script, una responsabilidad, una carpeta**.

## Estructura

```text
scripts/
├── maps/          # un generador y un publicador por mapa
│   ├── gen-<slug>.js       # fuente cruda → data/maps/<slug>.geojson
│   └── publish-<slug>.js   # geojson → Firestore + metadatos
├── tools/         # auditorías, landings, sitemap, higiene y utilidades
└── lib/
    └── publisher.js        # auth y helpers compartidos de Firestore
```

## Pipeline de un mapa

```text
~/autopilot/strategy/data/<slug>/   (fuente cruda, fuera del repo)
        │
        ▼
scripts/maps/gen-<slug>.js
        │
        ▼
data/maps/<slug>.geojson
        │
        ▼
scripts/maps/publish-<slug>.js
        │
        ├── Firestore: maps/<slug> (isPublished, legendKey, mapPreview…)
        ├── scripts/tools/generate-map-landings.js → gallery/<slug>/ + og-cards/<slug>.png
        └── scripts/tools/update-sitemap-gallery.js → sitemap.xml + JSON-LD
```

## Comandos habituales

```bash
node scripts/maps/gen-<slug>.js
node scripts/maps/publish-<slug>.js --dry-run
node scripts/maps/publish-<slug>.js
node scripts/tools/audit-gallery-quality.js --dry-run
node scripts/tools/check-local-assets.js
node scripts/tools/check-repo-hygiene.js
node scripts/tools/generate-map-landings.js
node scripts/tools/update-sitemap-gallery.js
```

## Reglas

- No crear bundles locales tipo `data/gallery-*.js`: la galería carga de
  Firestore.
- Los GeoJSON publicables viven en `data/maps/`; los crudos en `data/sources/`.
- No guardar temporales (`*.tmp.js`, `.DS_Store`, logs) en el repo.
- Los scripts de mapas no van en la raíz de `scripts/`.
- Antes de publicar: `--dry-run`, validar GeoJSON, colores, etiquetas y
  coordenadas, y dejar Playwright en verde.
- `scripts/lib/publisher.js` es la única puerta de autenticación con Firestore.
