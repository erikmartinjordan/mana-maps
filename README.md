# Maña Maps

Interactive map editor built with [Leaflet.js](https://leafletjs.com/) and integrated conversational AI.

**Live demo:** [mana.com/maps](https://maña.com)

---

## Features

### Drawing tools

| Tool | Description |
|---|---|
| Add point | Click on the map, enter a name, added with popup |
| Draw line | Click to add vertices, double-click to finish |
| Draw polygon | Click to add vertices, close by clicking the first point |
| Measure distance | Click to set waypoints, double-click to see total distance |
| Edit geometry | Move vertices of existing elements (points, lines, polygons) |

### Undo / Redo

| Action | Shortcut |
|---|---|
| Undo | `Ctrl+Z` / `Cmd+Z` |
| Redo | `Ctrl+Y` / `Cmd+Shift+Z` |

History keeps up to 50 steps. Every draw, delete, rename, style change or geometry edit is recorded. Buttons in the sidebar show the available steps and become disabled when the stack is empty.

### Style customisation

| Option | Values |
|---|---|
| Draw colour | 8 swatches (blue, indigo, mint, gold, red, pink, purple, slate) |
| Marker type | Pin, circle, square, star |
| Line weight | 1, 2, 3, 5, 8 px (per-element via context menu) |
| Opacity | 10 – 100 % slider (per-element via context menu) |
| Categorise by attribute | Automatic colour assignment from any attribute field |

### Map types

| Type | Source |
|---|---|
| Map | CartoDB Light |
| Satellite | Esri World Imagery |
| 3D Globe | MapLibre GL JS with globe projection |

Switching between 2D and 3D uses a fade transition (~400 ms).

### Place search

A search bar in the top bar queries [Nominatim](https://nominatim.openstreetmap.org/) and shows up to 5 results. Click a result to fly to the location at zoom 14. Works without an AI key.

### Import

| Format | Extension |
|---|---|
| GeoJSON | `.geojson`, `.json` |
| KML | `.kml` |
| KMZ | `.kmz` |
| Shapefile | `.zip` containing `.shp` + `.dbf` + `.prj` |

Files can also be dropped directly onto the map. Imported layers appear as named groups with attribute metadata, filters and categorisation.

### Export

| Format | Contents |
|---|---|
| **GeoJSON** | Full feature collection with attributes |
| **CSV** | One row per feature, with coordinates and all attribute columns |
| **KML / KMZ** | Styled placemarks with `<ExtendedData>` for every attribute |
| **Shapefile** | ZIP with `points/`, `lines/`, `polygons/` folders, each containing `.shp` + `.shx` + `.dbf` + `.prj` |

All exports use the **project name** defined in the sidebar footer as the filename prefix (default: `mana-maps`). Attribute table data is preserved across all formats; internal metadata keys are filtered automatically.

### OGC services

Connect to external WMS or WFS endpoints. A built-in catalogue provides quick access to common Spanish SDI services.

### Attribute table

Notion-style key/value editor accessible from the context menu or the layer list. Supports:

- Inline editing of values and field names
- Adding / deleting attributes
- Navigating between elements of a group
- Visual highlight of the selected element on the map

### Filter engine

Per-group attribute filters with AND logic. Operators: `=`, `≠`, `>`, `<`, `≥`, `≤`, `contains`, `starts`. Hidden elements are excluded from the map but preserved in exports.

### AI Chat

The right-side panel accepts natural language in Spanish (or any language with an API key):

```
"añade un punto en Barcelona"
"ruta de Madrid a Sevilla"
"busca museos en París"
"satélite" / "globo 3D"
"color rojo"
"exporta como KML"
```

**Without API key** — regex-based command parser with geocoding.
**With API key** — full function-calling via OpenAI, Groq (free) or any compatible endpoint. The system prompt includes the current map state so the model can reference existing elements.

The welcome message shows clickable suggestion buttons. Chat input supports `↑` / `↓` history navigation (last 50 messages).

### Persistence

| Feature | Detail |
|---|---|
| Auto-save | Every map change is saved to `localStorage` |
| Auto-restore | On load, the previous session is restored with a toast notification |
| Share via URL | `#map=` hash encoding (one-click copy) |
| Clear saved data | Button in sidebar footer |

### Accessibility

- `aria-live="polite"` on the toast container
- `role="dialog"` and `aria-modal="true"` on the name modal
- Focus trap (Tab / Shift+Tab) inside all modals
- `focus-visible` outlines on all interactive elements
- Escape closes any open modal or context menu

---

## Local usage

No installation or server required:

```bash
git clone https://github.com/erikmartinjordan/mana-maps.git
cd mana-maps
open index.html   # macOS
# or double-click on Windows / Linux
```

> The AI chat and place search use [Nominatim](https://nominatim.openstreetmap.org/) for geocoding. Requires an internet connection.

---

## Tech stack

| Library | Version | Purpose |
|---|---|---|
| [Leaflet](https://leafletjs.com/) | 1.9.4 | Interactive map |
| [Leaflet Draw](https://github.com/Leaflet/Leaflet.draw) | 1.0.4 | Drawing & geometry editing |
| [MapLibre GL JS](https://maplibre.org/) | 5.x | 3D globe |
| [JSZip](https://stuk.github.io/jszip/) | 3.10.1 | KMZ & Shapefile ZIP generation |
| [shp.js](https://github.com/calvinmetcalf/shapefile-js) | 4.0.4 | Shapefile import |
| [Firebase](https://firebase.google.com/) | 10.12.2 | Analytics & sharing |
| [CartoDB Light](https://carto.com/basemaps/) | — | Base tiles (no key required) |
| [Esri World Imagery](https://www.arcgis.com/) | — | Satellite tiles |
| [Nominatim](https://nominatim.openstreetmap.org/) | — | Geocoding |

No frameworks. Vanilla JS + CSS (DM Sans / DM Mono).

---

## Project structure

```
mana-maps/
├── index.html              # Main HTML shell
├── styles.css              # Design system (DM Sans, CSS variables)
├── favicon.svg
├── favicon.ico
├── CNAME
├── README.md
├── js/
│   ├── markers.js          # Draw colour state & SVG marker icons
│   ├── modal.js            # Name input dialog & focus trapping
│   ├── map-core.js         # Map init, base layers, group meta, filter engine, stats
│   ├── stats.js            # Stats panel
│   ├── globe.js            # 3D globe (MapLibre GL)
│   ├── tools.js            # Drawing tools, ruler & geometry editing
│   ├── context-menu.js     # Right-click menu, toast, colour palette, attribute editor
│   ├── import-export.js    # File import, drag-drop & export (GeoJSON/CSV/KML/Shapefile)
│   ├── chat.js             # AI chat, function calling, regex fallback, geocoding
│   ├── undo-redo.js        # Undo / redo with GeoJSON snapshots
│   ├── persistence.js      # localStorage auto-save, restore & URL sharing
│   ├── ogc-loader.js       # WMS / WFS & ArcGIS service loader
│   ├── filter.js           # Attribute filter logic
│   ├── responsive.js       # Mobile / tablet layout
│   ├── tracking.js         # Firebase analytics
│   └── plans.js            # Subscription plans
├── about/
├── changelog/
└── open/
```

---

## License

MIT © [Erik Martín Jordán](https://github.com/erikmartinjordan)
