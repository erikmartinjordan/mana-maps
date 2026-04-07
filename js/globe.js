// ── globe.js ─ 3D Globe (MapLibre GL JS) ──

var globeMap = null;
var spinActive = false;
var spinRAF = null;

function initGlobe() {
  try {
    var container = document.getElementById('globe');
    var rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      console.warn('Globe container has 0 dimensions, retrying...');
      setTimeout(initGlobe, 150);
      return;
    }

    globeMap = new maplibregl.Map({
      container: 'globe',
      style: {
        version: 8,
        projection: {type: 'globe'},
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        sources: {
          'carto-light': {
            type: 'raster',
            tiles: [
              'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
              'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
              'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png'
            ],
            tileSize: 256,
            attribution: '\u00a9 OSM \u00a9 CARTO'
          }
        },
        layers: [{
          id: 'carto', type: 'raster', source: 'carto-light',
          minzoom: 0, maxzoom: 20
        }]
      },
      center: [map.getCenter().lng, map.getCenter().lat],
      zoom: Math.max(1.5, map.getZoom() - 1),
      maxPitch: 85
    });

    globeMap.addControl(new maplibregl.NavigationControl({
      showCompass: true, showZoom: false
    }), 'top-right');

    globeMap.on('load', function() {
      globeMap.resize();
      try { globeMap.setProjection({type: 'globe'}); } catch(e) { console.warn('setProjection:', e); }
      syncToGlobe();
    });

    setTimeout(function() { if (globeMap) globeMap.resize(); }, 300);

    globeMap.on('mousedown', function() { if (spinActive) toggleSpin(); });
    globeMap.on('touchstart', function() { if (spinActive) toggleSpin(); });
  } catch(e) {
    console.error('Error initializing 3D globe:', e);
    alert('Error al inicializar el globo 3D: ' + e.message);
  }
}

function syncToGlobe() {
  if (!globeMap) return;
  if (globeMap.getLayer('drawn-point-labels')) globeMap.removeLayer('drawn-point-labels');
  if (globeMap.getLayer('drawn-points')) globeMap.removeLayer('drawn-points');
  if (globeMap.getLayer('drawn-lines')) globeMap.removeLayer('drawn-lines');
  if (globeMap.getLayer('drawn-fills')) globeMap.removeLayer('drawn-fills');
  if (globeMap.getSource('drawn')) globeMap.removeSource('drawn');

  var geo = getEnrichedGeoJSON();
  if (!geo.features.length) return;

  geo.features.forEach(function(f) { f.properties._type = f.geometry.type; });

  globeMap.addSource('drawn', { type: 'geojson', data: geo });

  globeMap.addLayer({
    id: 'drawn-fills', type: 'fill', source: 'drawn',
    filter: ['==', ['get', '_type'], 'Polygon'],
    paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.25 }
  });
  globeMap.addLayer({
    id: 'drawn-lines', type: 'line', source: 'drawn',
    filter: ['any', ['==', ['get', '_type'], 'LineString'], ['==', ['get', '_type'], 'Polygon']],
    paint: { 'line-color': ['get', 'color'], 'line-width': 2.5 }
  });
  globeMap.addLayer({
    id: 'drawn-points', type: 'circle', source: 'drawn',
    filter: ['==', ['get', '_type'], 'Point'],
    paint: { 'circle-radius': 7, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 }
  });
  globeMap.addLayer({
    id: 'drawn-point-labels', type: 'symbol', source: 'drawn',
    filter: ['==', ['get', '_type'], 'Point'],
    layout: {
      'text-field': ['get', 'name'], 'text-size': 11,
      'text-offset': [0, 1.8], 'text-anchor': 'top',
      'text-font': ['Open Sans Regular']
    },
    paint: { 'text-color': '#30363b', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 }
  });
}

function globeZoomIn() { if (globeMap) globeMap.zoomIn(); }
function globeZoomOut() { if (globeMap) globeMap.zoomOut(); }

function toggleSpin() {
  spinActive = !spinActive;
  var btn = document.getElementById('btn-spin');
  btn.style.background = spinActive ? 'var(--blue)' : '';
  btn.style.color = spinActive ? 'white' : '';
  document.getElementById('globe-spin-indicator').style.display = spinActive ? 'block' : 'none';
  if (spinActive) spinGlobe();
  else if (spinRAF) { cancelAnimationFrame(spinRAF); spinRAF = null; }
}

function spinGlobe() {
  if (!spinActive || !globeMap) return;
  var center = globeMap.getCenter();
  center.lng -= 0.12;
  globeMap.setCenter(center);
  spinRAF = requestAnimationFrame(spinGlobe);
}
