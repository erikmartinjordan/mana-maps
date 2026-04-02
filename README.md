# 🗺️ Maña Maps

Interactive map editor built with [Leaflet.js](https://leafletjs.com/), cohesive design with [maña.com](https://maña.com), and integrated conversational AI.

🔗 **Live demo:** [erikmartinjordan.github.io/mana-maps](https://erikmartinjordan.github.io/mana-maps)

---

## ✨ Features

### 🖊️ Drawing tools
| Tool | Description |
|---|---|
| Add point | Click on the map → enter name → added with popup |
| Draw line | Click for vertices, double-click to finish |
| Draw polygon | Click for vertices, close by clicking the first point |
| Delete element | Click on any layer to remove it |

### 📤 Export in 4 formats
| Format | File | Compatibility |
|---|---|---|
| **GeoJSON** | `mana-maps.geojson` | Web standard, QGIS, PostGIS... |
| **CSV** | `mana-maps.csv` | Excel, Google Sheets... |
| **KML / KMZ** | `mana-maps.kmz` | Google Earth, Google Maps |
| **Shapefile** | `mana-maps-shp.zip` | ArcGIS, QGIS (points .shp + .dbf + .prj) |

### 🤖 AI Chat (natural language)
Type commands directly in the right panel:
```
"draw a point in Barcelona"
"draw a line between Madrid and Valencia"
"center the map on Seville"
"delete everything"
"zoom in" / "zoom out"
```

### ↔️ Resizable panels
Drag the dividers between the sidebar and the map to adjust each panel's width (min. 160 px — max. 520 px).

---

## 🚀 Local usage

No installation or server required. Simply open `index.html` in your browser:

```bash
git clone https://github.com/erikmartinjordan/mana-maps.git
cd mana-maps
open index.html   # macOS
# or double-click on Windows/Linux
```

> ⚠️ The AI chat uses [Nominatim (OpenStreetMap)](https://nominatim.openstreetmap.org/) for geocoding. Requires an internet connection.

---

## 🛠️ Tech stack

- **[Leaflet 1.9.4](https://leafletjs.com/)** — interactive map
- **[Leaflet Draw 1.0.4](https://github.com/Leaflet/Leaflet.draw)** — drawing tools
- **[JSZip 3.10.1](https://stuk.github.io/jszip/)** — KMZ and Shapefile ZIP generation
- **[CartoDB Light](https://carto.com/basemaps/)** — map tiles with no API key or restrictions
- **[Nominatim](https://nominatim.openstreetmap.org/)** — free geocoding
- **Vanilla JS / CSS** — no frameworks, a single `index.html`

---

## 📁 Structure

```
mana-maps/
└── index.html    # Full app (HTML + CSS + JS in a single file)
```

---

## 📄 License

MIT © [Erik Martín Jordán](https://github.com/erikmartinjordan)
