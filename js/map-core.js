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

// ── Track which groups are expanded ──
const _expandedGroups = {};

function renderLayers() {
  const list = document.getElementById('layer-list');
  const layers = [];
  drawnItems.eachLayer(l => layers.push(l));

  if (!layers.length) {
    list.innerHTML = '<p class="empty-note">A\u00FAn no hay elementos.<br>Dibuja algo en el mapa o usa el chat.</p>';
    return;
  }

  // Separate into grouped (imported) and ungrouped (drawn) layers
  const groups = {};      // groupId -> { name, color, layers: [{layer, index}] }
  const ungrouped = [];   // [{layer, index}]
  const groupOrder = [];  // preserve insertion order of groups

  layers.forEach((l, i) => {
    if (l._manaGroupId) {
      const gid = l._manaGroupId;
      if (!groups[gid]) {
        groups[gid] = {
          name: l._manaGroupName || 'Capa importada',
          color: (l instanceof L.Marker) ? (l._manaColor || '#0ea5e9') : (l.options && l.options.color) || '#0ea5e9',
          layers: []
        };
        groupOrder.push(gid);
      }
      groups[gid].layers.push({ layer: l, index: i });
    } else {
      ungrouped.push({ layer: l, index: i });
    }
  });

  let html = '';

  // Render grouped layers (imported files) first
  groupOrder.forEach(gid => {
    const g = groups[gid];
    const count = g.layers.length;
    const isExpanded = !!_expandedGroups[gid];
    const chevronCls = isExpanded ? 'group-chevron expanded' : 'group-chevron';

    // Determine geometry types in this group
    let typeSummary = [];
    let pts = 0, lns = 0, pols = 0;
    g.layers.forEach(({ layer }) => {
      if (layer instanceof L.Marker) pts++;
      else if (layer instanceof L.Polygon) pols++;
      else if (layer instanceof L.Polyline) lns++;
    });
    if (pts) typeSummary.push(pts + ' pt' + (pts > 1 ? 's' : ''));
    if (lns) typeSummary.push(lns + ' l\u00EDn' + (lns > 1 ? 's' : ''));
    if (pols) typeSummary.push(pols + ' pol' + (pols > 1 ? 's' : ''));

    html += '<div class="layer-group">';
    html += '<div class="layer-group-header" onclick="toggleLayerGroup(' + gid + ')">';
    html += '  <div class="layer-dot" style="background:' + g.color + '"></div>';
    html += '  <span class="layer-name">' + g.name + '</span>';
    html += '  <span class="layer-group-badge">' + count + '</span>';
    html += '  <span class="' + chevronCls + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg></span>';
    html += '</div>';
    html += '<div class="layer-group-meta">' + typeSummary.join(' \u00B7 ') + '</div>';

    if (isExpanded) {
      html += '<div class="layer-group-children">';
      g.layers.forEach(({ layer, index }, fi) => {
        let kind, name;
        if (layer instanceof L.Marker) {
          kind = 'Punto'; name = layer._manaName || ('Punto ' + (fi + 1));
        } else if (layer instanceof L.Polygon) {
          kind = 'Pol\u00EDgono'; name = layer._manaName || ('Pol\u00EDgono ' + (fi + 1));
        } else {
          kind = 'L\u00EDnea'; name = layer._manaName || ('L\u00EDnea ' + (fi + 1));
        }
        html += '<div class="layer-item layer-child" onclick="focusLayer(' + index + ')">';
        html += '  <span class="layer-name">' + name + '</span>';
        html += '  <span class="layer-type">' + kind + '</span>';
        html += '</div>';
      });
      html += '</div>';
    }

    // Zoom-to-group button row
    html += '<div class="layer-group-actions">';
    html += '  <button class="layer-group-zoom" onclick="focusGroup(' + gid + ')" title="Zoom a la capa"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></button>';
    html += '  <button class="layer-group-delete" onclick="deleteGroup(' + gid + ')" title="Eliminar capa"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg></button>';
    html += '</div>';
    html += '</div>';
  });

  // Render ungrouped (hand-drawn) layers
  ungrouped.forEach(({ layer, index }) => {
    let kind, color, name;
    if (layer instanceof L.Marker) {
      kind = 'Punto'; color = layer._manaColor || '#0ea5e9';
      name = layer._manaName || ('Punto ' + (index + 1));
    } else if (layer instanceof L.Polygon) {
      kind = 'Pol\u00EDgono'; color = (layer.options && layer.options.color) || '#10b981';
      name = layer._manaName || ('Pol\u00EDgono ' + (index + 1));
    } else {
      kind = 'L\u00EDnea'; color = (layer.options && layer.options.color) || '#f59e0b';
      name = layer._manaName || ('L\u00EDnea ' + (index + 1));
    }
    html += '<div class="layer-item" onclick="focusLayer(' + index + ')">';
    html += '  <div class="layer-dot" style="background:' + color + '"></div>';
    html += '  <span class="layer-name">' + name + '</span>';
    html += '  <span class="layer-type">' + kind + '</span>';
    html += '</div>';
  });

  list.innerHTML = html;
}

function toggleLayerGroup(gid) {
  _expandedGroups[gid] = !_expandedGroups[gid];
  renderLayers();
}

function focusGroup(gid) {
  const allBounds = L.latLngBounds();
  drawnItems.eachLayer(l => {
    if (l._manaGroupId === gid) {
      if (l.getBounds) allBounds.extend(l.getBounds());
      else if (l.getLatLng) allBounds.extend(l.getLatLng());
    }
  });
  if (allBounds.isValid()) map.fitBounds(allBounds, { maxZoom: 14, padding: [24, 24] });
}

function deleteGroup(gid) {
  if (!confirm('\u00BFEliminar toda la capa importada?')) return;
  const toRemove = [];
  drawnItems.eachLayer(l => {
    if (l._manaGroupId === gid) toRemove.push(l);
  });
  toRemove.forEach(l => drawnItems.removeLayer(l));
  delete _expandedGroups[gid];
  stats();
}

function focusLayer(i) {
  const layers = [];
  drawnItems.eachLayer(l => layers.push(l));
  const l = layers[i];
  if (!l) return;
  if (l.getBounds) map.fitBounds(l.getBounds(), { maxZoom: 14 });
  else map.setView(l.getLatLng(), 14);
  // Open popup if available
  if (l.getPopup && l.getPopup()) {
    setTimeout(() => l.openPopup(), 200);
  }
}
