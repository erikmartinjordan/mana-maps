# 🗺️ Maña Maps

Editor de mapas interactivo construido con [Leaflet.js](https://leafletjs.com/), diseño cohesivo con [maña.com](https://maña.com) e IA conversacional integrada.

🔗 **Demo en vivo:** [erikmartinjordan.github.io/mana-maps](https://erikmartinjordan.github.io/mana-maps)

---

## ✨ Funcionalidades

### 🖊️ Herramientas de dibujo
| Herramienta | Descripción |
|---|---|
| Añadir punto | Clic en el mapa → introduce nombre → se añade con popup |
| Dibujar línea | Clic para vértices, doble clic para terminar |
| Dibujar polígono | Clic para vértices, cierra haciendo clic en el primer punto |
| Borrar elemento | Clic sobre cualquier capa para eliminarla |

### 📤 Exportación en 4 formatos
| Formato | Archivo | Compatibilidad |
|---|---|---|
| **GeoJSON** | `mana-maps.geojson` | Web estándar, QGIS, PostGIS... |
| **CSV** | `mana-maps.csv` | Excel, Google Sheets... |
| **KML / KMZ** | `mana-maps.kmz` | Google Earth, Google Maps |
| **Shapefile** | `mana-maps-shp.zip` | ArcGIS, QGIS (puntos .shp + .dbf + .prj) |

### 🤖 Chat IA (lenguaje natural)
Escribe comandos directamente en el panel derecho:
```
"dibuja un punto en Barcelona"
"traza una línea entre Madrid y Valencia"
"centra el mapa en Sevilla"
"borra todo"
"zoom in" / "zoom out"
```

### ↔️ Paneles redimensionables
Arrastra los separadores entre la barra lateral y el mapa para ajustar el ancho de cada panel (mín. 160 px — máx. 520 px).

---

## 🚀 Uso local

No requiere instalación ni servidor. Simplemente abre `index.html` en tu navegador:

```bash
git clone https://github.com/erikmartinjordan/mana-maps.git
cd mana-maps
open index.html   # macOS
# o doble clic en Windows/Linux
```

> ⚠️ El chat IA usa [Nominatim (OpenStreetMap)](https://nominatim.openstreetmap.org/) para geocodificación. Requiere conexión a internet.

---

## 🛠️ Stack técnico

- **[Leaflet 1.9.4](https://leafletjs.com/)** — mapa interactivo
- **[Leaflet Draw 1.0.4](https://github.com/Leaflet/Leaflet.draw)** — herramientas de dibujo
- **[JSZip 3.10.1](https://stuk.github.io/jszip/)** — generación de KMZ y Shapefile ZIP
- **[CartoDB Light](https://carto.com/basemaps/)** — tiles de mapa sin API key ni restricciones
- **[Nominatim](https://nominatim.openstreetmap.org/)** — geocodificación gratuita
- **Vanilla JS / CSS** — sin frameworks, un único `index.html`

---

## 📁 Estructura

```
mana-maps/
└── index.html    # App completa (HTML + CSS + JS en un solo archivo)
```

---

## 📄 Licencia

MIT © [Erik Martín Jordán](https://github.com/erikmartinjordan)
