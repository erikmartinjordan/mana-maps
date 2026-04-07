// ── map-core.js ─ Map init, base layers, resize, stats, utilities ──

// ── BASE LAYERS ──
const tileMap = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OSM &copy; CARTO', subdomains: 'abcd', maxZoom: 20
});
const tileSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  attribution: '&copy; Esri', maxZoom: 20
});

const map = L.map('map', { zoomControl: true }).setView([40.416, -3.703], 6);
tileMap.addTo(map);
let activeBase = 'map';

const drawnItems = new L.FeatureGroup().addTo(map);

// ── SET BASE LAYER ──
function setBaseLayer(type) {
  var mapEl = document.getElementById('map');
  var globeEl = document.getElementById('globe');
  var globeAtmo = document.getElementById('globe-atmo');
  var globeCtrl = document.getElementById('globe-controls');

  if (type === 'globe') {
    mapEl.style.display = 'none';
    globeEl.style.display = 'block';
    globeAtmo.style.display = 'block';
    globeCtrl.style.display = 'flex';
    document.getElementById('map-bottom-bar').style.display = 'none';
    if (!globeMap) { requestAnimationFrame(function(){ initGlobe(); }); }
    else { requestAnimationFrame(function(){ globeMap.resize(); syncToGlobe(); }); }
  } else {
    globeEl.style.display = 'none';
    globeAtmo.style.display = 'none';
    globeCtrl.style.display = 'none';
    if (spinActive) toggleSpin();
    document.getElementById('globe-spin-indicator').style.display = 'none';
    mapEl.style.display = 'block';
    document.getElementById('map-bottom-bar').style.display = 'flex';
    if (type === 'map') { map.removeLayer(tileSat); tileMap.addTo(map); }
    else { map.removeLayer(tileMap); tileSat.addTo(map); }
    setTimeout(function(){ map.invalidateSize(); }, 50);
    if (globeMap) {
      var c = globeMap.getCenter();
      map.setView([c.lat, c.lng], Math.min(18, Math.round(globeMap.getZoom()) + 1));
    }
  }
  activeBase = type;
  document.getElementById('bmc-map').classList.toggle('active', type === 'map');
  document.getElementById('bmc-sat').classList.toggle('active', type === 'satellite');
  document.getElementById('bmc-globe').classList.toggle('active', type === 'globe');
}

// ── ENRICHED GEOJSON (shared utility) ──
function getEnrichedGeoJSON() {
  const features = [];
  drawnItems.eachLayer(function(l) {
    const f = l.toGeoJSON();
    if (l instanceof L.Marker) {
      f.properties.color = l._manaColor || '#0ea5e9';
    } else {
      f.properties.color = (l.options && l.options.color) || '#0ea5e9';
    }
    f.properties.name = l._manaName || f.properties.name || 'Elemento';
    features.push(f);
  });
  return { type: 'FeatureCollection', features: features };
}

// ── MOUSE COORDS ──
map.on('mousemove', e => {
  const lat = e.latlng.lat.toFixed(5);
  const lng = e.latlng.lng.toFixed(5);
  document.getElementById('mouse-coords').textContent = lat + '\u00B0N  ' + lng + '\u00B0E';
});
map.on('mouseout', () => {
  document.getElementById('mouse-coords').textContent = '\u2014 , \u2014';
});

// ── RESIZE HANDLES ──
const RAIL_W = 44, RAIL_THR = 88;

function initResize(handleId, side) {
  const handle = document.getElementById(handleId);
  const app = document.getElementById('app');
  const sidebar = document.getElementById('sidebar');
  let startX, startW;

  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    handle.classList.add('dragging');
    startX = e.clientX;
    const cols = getComputedStyle(app).gridTemplateColumns.split(' ');
    startW = side === 'left' ? parseInt(cols[0]) : parseInt(cols[4]);

    const onMove = e => {
      const dx = e.clientX - startX;
      if (side === 'left') {
        const nw = Math.max(RAIL_W, Math.min(320, startW + dx));
        app.style.setProperty('--left-w', nw + 'px');
        sidebar.classList.toggle('rail', nw < RAIL_THR);
      } else {
        const nw = Math.max(180, Math.min(520, startW - dx));
        app.style.setProperty('--right-w', nw + 'px');
      }
      map.invalidateSize();
    };

    const onUp = () => {
      handle.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      map.invalidateSize();
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

initResize('handle-left', 'left');
initResize('handle-right', 'right');

// ── STATS & LAYER LIST ──
function stats() {
  let pts = 0, lns = 0, pols = 0;
  drawnItems.eachLayer(l => {
    if (l instanceof L.Marker) pts++;
    else if (l instanceof L.Polygon) pols++;
    else if (l instanceof L.Polyline) lns++;
  });
  document.getElementById('cnt-points').textContent = pts;
  document.getElementById('cnt-lines').textContent = lns;
  document.getElementById('cnt-polygons').textContent = pols;
  renderLayers();
}

function renderLayers() {
  const list = document.getElementById('layer-list');
  const layers = [];
  drawnItems.eachLayer(l => layers.push(l));

  if (!layers.length) {
    list.innerHTML = '<p class="empty-note">A\u00FAn no hay elementos.<br>Dibuja algo en el mapa o usa el chat.</p>';
    return;
  }

  list.innerHTML = layers.map((l, i) => {
    let kind, color, name;
    if (l instanceof L.Marker) {
      kind = 'Punto'; color = l._manaColor || '#0ea5e9';
      name = l._manaName || ('Punto ' + (i + 1));
    } else if (l instanceof L.Polygon) {
      kind = 'Pol\u00EDgono'; color = (l.options && l.options.color) || '#10b981';
      name = l._manaName || ('Pol\u00EDgono ' + (i + 1));
    } else {
      kind = 'L\u00EDnea'; color = (l.options && l.options.color) || '#f59e0b';
      name = l._manaName || ('L\u00EDnea ' + (i + 1));
    }
    return `<div class="layer-item" onclick="focusLayer(${i})"><div class="layer-dot" style="background:${color}"></div><span class="layer-name">${name}</span><span class="layer-type">${kind}</span></div>`;
  }).join('');
}

function focusLayer(i) {
  const layers = [];
  drawnItems.eachLayer(l => layers.push(l));
  const l = layers[i];
  if (!l) return;
  if (l.getBounds) map.fitBounds(l.getBounds(), { maxZoom: 14 });
  else map.setView(l.getLatLng(), 14);
}
