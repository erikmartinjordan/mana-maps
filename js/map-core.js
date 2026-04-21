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

// ═══════════════════════════════════════════════════════════════
// GROUP META REGISTRY
// Stores all layers (visible & hidden), attribute schema, filters
// ═══════════════════════════════════════════════════════════════
const _manaGroupMeta = {};
// Format: _manaGroupMeta[gid] = {
//   name: string,
//   color: string,
//   allLayers: [leafletLayer, ...],
//   attrs: { fieldName: { type:'string'|'number', values: Set } },
//   filter: [ {field, op, value}, ... ],   // active filter rules
//   hiddenLayers: Set(leafletLayer),        // layers removed by filter
// }

function registerGroupMeta(gid, name, color) {
  if (!_manaGroupMeta[gid]) {
    _manaGroupMeta[gid] = {
      name: name,
      color: color,
      allLayers: [],
      attrs: {},
      filter: [],
      hiddenLayers: new Set(),
    };
  }
}

function addLayerToGroupMeta(gid, layer) {
  const meta = _manaGroupMeta[gid];
  if (!meta) return;
  meta.allLayers.push(layer);
  // Scan properties to build attribute schema
  const props = layer._manaProperties || {};
  for (const [key, val] of Object.entries(props)) {
    if (key.startsWith('_') || key === 'bbox') continue;
    if (val === null || val === undefined) continue;
    if (!meta.attrs[key]) {
      meta.attrs[key] = { type: typeof val === 'number' ? 'number' : 'string', values: new Set() };
    }
    const sv = String(val);
    if (meta.attrs[key].values.size < 500) meta.attrs[key].values.add(sv);
    // Promote type to number if it looks numeric
    if (meta.attrs[key].type === 'string' && typeof val === 'number') meta.attrs[key].type = 'number';
  }
}

// ═══════════════════════════════════════════════════════════════
// FILTER ENGINE
// ═══════════════════════════════════════════════════════════════
function testFilter(props, rules) {
  // AND logic: all rules must pass
  for (const rule of rules) {
    const raw = props[rule.field];
    if (raw === undefined || raw === null) return false;
    const val = String(raw);
    const ruleVal = rule.value;
    const numRaw = parseFloat(raw);
    const numRule = parseFloat(ruleVal);
    const isNum = !isNaN(numRaw) && !isNaN(numRule);

    switch (rule.op) {
      case '=':
        if (val !== ruleVal) return false;
        break;
      case '!=':
        if (val === ruleVal) return false;
        break;
      case '>':
        if (!isNum || numRaw <= numRule) return false;
        break;
      case '<':
        if (!isNum || numRaw >= numRule) return false;
        break;
      case '>=':
        if (!isNum || numRaw < numRule) return false;
        break;
      case '<=':
        if (!isNum || numRaw > numRule) return false;
        break;
      case 'contains':
        if (!val.toLowerCase().includes(ruleVal.toLowerCase())) return false;
        break;
      case 'starts':
        if (!val.toLowerCase().startsWith(ruleVal.toLowerCase())) return false;
        break;
      default:
        break;
    }
  }
  return true;
}

function applyGroupFilter(gid) {
  const meta = _manaGroupMeta[gid];
  if (!meta) return;
  const rules = meta.filter;

  // First, restore all hidden layers
  meta.hiddenLayers.forEach(l => {
    if (!drawnItems.hasLayer(l)) drawnItems.addLayer(l);
  });
  meta.hiddenLayers.clear();

  if (!rules.length) { stats(); return; }

  // Apply filter: hide non-matching
  let matched = 0;
  meta.allLayers.forEach(l => {
    const props = l._manaProperties || {};
    if (testFilter(props, rules)) {
      if (!drawnItems.hasLayer(l)) drawnItems.addLayer(l);
      matched++;
    } else {
      if (drawnItems.hasLayer(l)) drawnItems.removeLayer(l);
      meta.hiddenLayers.add(l);
    }
  });

  stats();
}

function clearGroupFilter(gid) {
  const meta = _manaGroupMeta[gid];
  if (!meta) return;
  meta.filter = [];
  meta.hiddenLayers.forEach(l => {
    if (!drawnItems.hasLayer(l)) drawnItems.addLayer(l);
  });
  meta.hiddenLayers.clear();
  delete _filterOpen[gid];
  stats();
}

function addFilterRule(gid) {
  const meta = _manaGroupMeta[gid];
  if (!meta) return;
  const attrKeys = Object.keys(meta.attrs);
  if (!attrKeys.length) return;
  meta.filter.push({ field: attrKeys[0], op: '=', value: '' });
  renderLayers();
}

function removeFilterRule(gid, idx) {
  const meta = _manaGroupMeta[gid];
  if (!meta) return;
  meta.filter.splice(idx, 1);
  renderLayers();
}

function updateFilterRule(gid, idx, prop, value) {
  const meta = _manaGroupMeta[gid];
  if (!meta || !meta.filter[idx]) return;
  meta.filter[idx][prop] = value;
  // If field changed, reset value
  if (prop === 'field') meta.filter[idx].value = '';
}

function execFilter(gid) {
  applyGroupFilter(gid);
}

// ── SET BASE LAYER ──
function setBaseLayer(type) {
  var mapEl = document.getElementById('map');
  var globeEl = document.getElementById('globe');
  var globeAtmo = document.getElementById('globe-atmo');
  var globeCtrl = document.getElementById('globe-controls');

  // P2.9: Animated transition between 2D and 3D
  var isGoing3D = (type === 'globe');
  var isLeaving3D = (activeBase === 'globe' && type !== 'globe');

  if (isGoing3D) {
    // Fade out map, then show globe
    mapEl.style.transition = 'opacity 0.2s ease';
    mapEl.style.opacity = '0';
    setTimeout(function() {
      mapEl.style.display = 'none';
      globeEl.style.display = 'block';
      globeAtmo.style.display = 'block';
      globeCtrl.style.display = 'flex';
      document.getElementById('map-bottom-bar').style.display = 'none';
      globeEl.style.opacity = '0';
      globeEl.style.transition = 'opacity 0.2s ease';
      if (!globeMap) { requestAnimationFrame(function(){ initGlobe(); }); }
      else { requestAnimationFrame(function(){ globeMap.resize(); syncToGlobe(); }); }
      requestAnimationFrame(function() { globeEl.style.opacity = '1'; });
    }, 200);
  } else if (isLeaving3D) {
    // Fade out globe, then show map
    globeEl.style.transition = 'opacity 0.2s ease';
    globeEl.style.opacity = '0';
    setTimeout(function() {
      globeEl.style.display = 'none';
      globeAtmo.style.display = 'none';
      globeCtrl.style.display = 'none';
      if (spinActive) toggleSpin();
      document.getElementById('globe-spin-indicator').style.display = 'none';
      mapEl.style.display = 'block';
      document.getElementById('map-bottom-bar').style.display = 'flex';
      mapEl.style.opacity = '0';
      mapEl.style.transition = 'opacity 0.2s ease';
      if (type === 'map') { map.removeLayer(tileSat); tileMap.addTo(map); }
      else { map.removeLayer(tileMap); tileSat.addTo(map); }
      setTimeout(function(){ map.invalidateSize(); }, 50);
      if (globeMap) {
        var c = globeMap.getCenter();
        map.setView([c.lat, c.lng], Math.min(18, Math.round(globeMap.getZoom()) + 1));
      }
      requestAnimationFrame(function() { mapEl.style.opacity = '1'; });
    }, 200);
  } else {
    // Switching between map/satellite (no globe involved)
    if (type === 'map') { map.removeLayer(tileSat); tileMap.addTo(map); }
    else { map.removeLayer(tileMap); tileSat.addTo(map); }
    setTimeout(function(){ map.invalidateSize(); }, 50);
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
    // Merge attribute table data (_manaProperties) into exported properties
    // Start from toGeoJSON() base (may have original import props), then overlay edits
    if (l._manaProperties) {
      const mp = l._manaProperties;
      for (const k in mp) {
        // Skip internal metadata keys
        if (k.startsWith('_') || k === 'bbox') continue;
        if (mp[k] !== null && mp[k] !== undefined) {
          f.properties[k] = mp[k];
        }
      }
    }
    // Set color and name last (these are Maña-specific display properties)
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

// ── P1.3: Get current GeoJSON for AI context ──
function getCurrentGeoJSON() {
  const features = [];
  drawnItems.eachLayer(function(l) {
    const f = l.toGeoJSON();
    f.properties.name = l._manaName || f.properties.name || 'Elemento';
    f.properties.color = (l instanceof L.Marker) ? (l._manaColor || '#0ea5e9') : (l.options.color || '#0ea5e9');
    features.push(f);
  });
  return { type: 'FeatureCollection', features: features };
}

// ── MOUSE COORDS WITH DMS TOGGLE ──
let _coordFormat = localStorage.getItem('mana-coords-format') || 'DD';

function _toDMS(deg, isLat) {
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const mf = (abs - d) * 60;
  const m = Math.floor(mf);
  const s = ((mf - m) * 60).toFixed(1);
  const dir = isLat ? (deg >= 0 ? 'N' : 'S') : (deg >= 0 ? 'E' : 'W');
  return d + '\u00B0' + String(m).padStart(2, '0') + '\'' + String(s).padStart(4, '0') + '"' + dir;
}

function _formatCoords(lat, lng) {
  if (_coordFormat === 'DMS') {
    return _toDMS(lat, true) + '  ' + _toDMS(lng, false);
  }
  return lat.toFixed(5) + '\u00B0N  ' + lng.toFixed(5) + '\u00B0E';
}

function toggleCoordsFormat() {
  _coordFormat = _coordFormat === 'DD' ? 'DMS' : 'DD';
  localStorage.setItem('mana-coords-format', _coordFormat);
  const btn = document.getElementById('coords-format-btn');
  if (btn) btn.textContent = _coordFormat === 'DD' ? 'DMS' : 'DD';
}

map.on('mousemove', e => {
  document.getElementById('mouse-coords').textContent = _formatCoords(e.latlng.lat, e.latlng.lng);
});
map.on('mouseout', () => {
  document.getElementById('mouse-coords').textContent = '\u2014 , \u2014';
});

// Init coords format button text on load
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('coords-format-btn');
  if (btn) btn.textContent = _coordFormat === 'DD' ? 'DMS' : 'DD';
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

// ── Track UI state ──
const _expandedGroups = {};
const _filterOpen = {};

// ── SVG ICONS ──
const ICON = {
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
  filter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>',
  palette: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.5-.7 1.5-1.5 0-.4-.1-.7-.4-1-.3-.3-.4-.6-.4-1 0-.8.7-1.5 1.5-1.5H16c3.3 0 6-2.7 6-6 0-5.5-4.5-9-10-9z"/><circle cx="7.5" cy="11.5" r="1.5" fill="currentColor"/><circle cx="10.5" cy="7.5" r="1.5" fill="currentColor"/><circle cx="14.5" cy="7.5" r="1.5" fill="currentColor"/><circle cx="17.5" cy="11.5" r="1.5" fill="currentColor"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
};

function esc(s) { return String(s).replace(/</g,'&lt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

function renderLayers() {
  const list = document.getElementById('layer-list');
  const layers = [];
  drawnItems.eachLayer(l => layers.push(l));

  // Also count hidden layers from filters
  let totalHidden = 0;
  for (const gid in _manaGroupMeta) {
    totalHidden += _manaGroupMeta[gid].hiddenLayers.size;
  }

  if (!layers.length && !totalHidden) {
    list.innerHTML = '<p class="empty-note">A\u00FAn no hay elementos.<br>Dibuja algo en el mapa o usa el chat.</p>';
    return;
  }

  // Build group info from meta registry (includes hidden layers)
  const groupOrder = [];
  const groups = {};
  const ungrouped = [];

  // First pass: collect from meta registry
  for (const gid in _manaGroupMeta) {
    const meta = _manaGroupMeta[gid];
    if (!meta.allLayers.length) continue;
    groups[gid] = {
      name: meta.name,
      color: meta.color,
      totalCount: meta.allLayers.length,
      visibleCount: meta.allLayers.length - meta.hiddenLayers.size,
      hasFilter: meta.filter.length > 0,
      visibleLayers: [],
    };
    groupOrder.push(+gid);
  }

  // Map visible layers to their indices in drawnItems
  layers.forEach((l, i) => {
    if (l._manaGroupId && groups[l._manaGroupId]) {
      groups[l._manaGroupId].visibleLayers.push({ layer: l, index: i });
    } else if (!l._manaGroupId) {
      ungrouped.push({ layer: l, index: i });
    }
  });

  let html = '';

  // Render grouped layers
  groupOrder.forEach(gid => {
    const g = groups[gid];
    if (!g) return;
    const meta = _manaGroupMeta[gid];
    const isExpanded = !!_expandedGroups[gid];
    const isFilterOpen = !!_filterOpen[gid];
    const chevronCls = isExpanded ? 'group-chevron expanded' : 'group-chevron';

    // Geometry type summary
    let pts = 0, lns = 0, pols = 0;
    meta.allLayers.forEach(l => {
      if (l instanceof L.Marker) pts++;
      else if (l instanceof L.Polygon) pols++;
      else if (l instanceof L.Polyline) lns++;
    });
    const typeParts = [];
    if (pts) typeParts.push(pts + ' pt' + (pts > 1 ? 's' : ''));
    if (lns) typeParts.push(lns + ' l\u00EDn' + (lns > 1 ? 's' : ''));
    if (pols) typeParts.push(pols + ' pol' + (pols > 1 ? 's' : ''));

    const filterBadge = g.hasFilter
      ? '<span class="filter-active-badge">' + g.visibleCount + '/' + g.totalCount + '</span>'
      : '';

    html += '<div class="layer-group' + (g.hasFilter ? ' has-filter' : '') + '">';

    // ── Header
    html += '<div class="layer-group-header" onclick="toggleLayerGroup(' + gid + ')" oncontextmenu="showLayerCtx(event,\'group\',' + gid + ')">';
    html += '  <div class="layer-dot" style="background:' + g.color + '"></div>';
    html += '  <span class="layer-name">' + esc(g.name) + '</span>';
    html += '  ' + filterBadge;
    html += '  <span class="layer-group-badge">' + g.totalCount + '</span>';
    html += '  <span class="' + chevronCls + '">' + ICON.chevron + '</span>';
    html += '</div>';
    html += '<div class="layer-group-meta">' + typeParts.join(' \u00B7 ') + '</div>';

    // ── Expanded children
    if (isExpanded) {
      html += '<div class="layer-group-children">';
      g.visibleLayers.forEach(({ layer, index }, fi) => {
        let kind, name;
        if (layer instanceof L.Marker) {
          kind = 'Punto'; name = layer._manaName || ('Punto ' + (fi + 1));
        } else if (layer instanceof L.Polygon) {
          kind = 'Pol\u00EDgono'; name = layer._manaName || ('Pol\u00EDgono ' + (fi + 1));
        } else {
          kind = 'L\u00EDnea'; name = layer._manaName || ('L\u00EDnea ' + (fi + 1));
        }
        html += '<div class="layer-item layer-child" onclick="focusLayer(' + index + ')" oncontextmenu="showLayerCtx(event,\'layer\',' + index + ')">';
        html += '  <span class="layer-name">' + esc(name) + '</span>';
        html += '  <span class="layer-type">' + kind + '</span>';
        html += '</div>';
      });
      if (g.hasFilter && g.visibleCount < g.totalCount) {
        html += '<div class="filter-hidden-note">' + (g.totalCount - g.visibleCount) + ' elementos ocultos por filtro</div>';
      }
      html += '</div>';
    }

    // ── Filter panel
    if (isFilterOpen) {
      html += renderFilterPanel(gid, meta);
    }

    // ── Actions row
    html += '<div class="layer-group-actions">';
    html += '  <button class="layer-group-action-btn" onclick="showLayerCtxBtn(event,\'group\',' + gid + ')" title="Estilo y categorización">' + ICON.palette + '</button>';
    html += '  <button class="layer-group-action-btn' + (isFilterOpen ? ' active' : '') + (g.hasFilter ? ' has-filter' : '') + '" onclick="toggleFilterPanel(' + gid + ')" title="Filtrar atributos">' + ICON.filter + '</button>';
    html += '  <button class="layer-group-action-btn" onclick="focusGroup(' + gid + ')" title="Zoom a la capa">' + ICON.search + '</button>';
    html += '  <button class="layer-group-action-btn danger" onclick="deleteGroup(' + gid + ')" title="Eliminar capa">' + ICON.trash + '</button>';
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
    html += '<div class="layer-item" onclick="focusLayer(' + index + ')" oncontextmenu="showLayerCtx(event,\'layer\',' + index + ')">';
    html += '  <div class="layer-dot" style="background:' + color + '"></div>';
    html += '  <span class="layer-name">' + esc(name) + '</span>';
    html += '  <span class="layer-type">' + kind + '</span>';
    html += '</div>';
  });

  list.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════
// FILTER PANEL RENDERER
// ═══════════════════════════════════════════════════════════════
function renderFilterPanel(gid, meta) {
  const attrKeys = Object.keys(meta.attrs);
  if (!attrKeys.length) {
    return '<div class="filter-panel"><div class="filter-empty">Esta capa no tiene atributos</div></div>';
  }

  const rules = meta.filter;
  let html = '<div class="filter-panel">';
  html += '<div class="filter-title">' + ICON.filter + ' Filtrar por atributos</div>';

  if (!rules.length) {
    html += '<div class="filter-empty">Sin filtros activos. Pulsa <strong>+</strong> para a\u00F1adir.</div>';
  }

  rules.forEach((rule, idx) => {
    const fieldInfo = meta.attrs[rule.field] || { values: new Set() };
    const sortedVals = [...fieldInfo.values].sort();

    html += '<div class="filter-rule">';

    // Field selector
    html += '<select class="filter-select filter-field" onchange="updateFilterRule(' + gid + ',' + idx + ',\'field\',this.value)">';
    attrKeys.forEach(k => {
      html += '<option value="' + esc(k) + '"' + (k === rule.field ? ' selected' : '') + '>' + esc(k) + '</option>';
    });
    html += '</select>';

    // Operator selector
    html += '<select class="filter-select filter-op" onchange="updateFilterRule(' + gid + ',' + idx + ',\'op\',this.value)">';
    const ops = [
      ['=', '='], ['!=', '\u2260'],
      ['>', '>'], ['<', '<'], ['>=', '\u2265'], ['<=', '\u2264'],
      ['contains', 'contiene'], ['starts', 'empieza']
    ];
    ops.forEach(([val, label]) => {
      html += '<option value="' + val + '"' + (val === rule.op ? ' selected' : '') + '>' + label + '</option>';
    });
    html += '</select>';

    // Value input with datalist
    const dlId = 'dl_' + gid + '_' + idx;
    html += '<input class="filter-value" type="text" placeholder="Valor..." value="' + esc(rule.value) + '"';
    html += ' list="' + dlId + '"';
    html += ' oninput="updateFilterRule(' + gid + ',' + idx + ',\'value\',this.value)"';
    html += '/>';
    html += '<datalist id="' + dlId + '">';
    sortedVals.slice(0, 100).forEach(v => {
      html += '<option value="' + esc(v) + '">';
    });
    html += '</datalist>';

    // Remove rule button
    html += '<button class="filter-rule-remove" onclick="removeFilterRule(' + gid + ',' + idx + ')" title="Eliminar regla">' + ICON.x + '</button>';
    html += '</div>';
  });

  // Action buttons
  html += '<div class="filter-actions">';
  html += '<button class="filter-btn filter-btn-add" onclick="addFilterRule(' + gid + ')" title="A\u00F1adir regla">' + ICON.plus + ' Regla</button>';
  if (rules.length) {
    html += '<button class="filter-btn filter-btn-apply" onclick="execFilter(' + gid + ')">Aplicar</button>';
    html += '<button class="filter-btn filter-btn-clear" onclick="clearGroupFilter(' + gid + ')">Limpiar</button>';
  }
  html += '</div>';

  html += '</div>';
  return html;
}

// ═══════════════════════════════════════════════════════════════
// UI ACTIONS
// ═══════════════════════════════════════════════════════════════
function toggleLayerGroup(gid) {
  _expandedGroups[gid] = !_expandedGroups[gid];
  renderLayers();
}

function toggleFilterPanel(gid) {
  _filterOpen[gid] = !_filterOpen[gid];
  renderLayers();
}

function focusGroup(gid) {
  const meta = _manaGroupMeta[gid];
  if (!meta) return;
  const allBounds = L.latLngBounds();
  meta.allLayers.forEach(l => {
    if (!meta.hiddenLayers.has(l)) {
      if (l.getBounds) allBounds.extend(l.getBounds());
      else if (l.getLatLng) allBounds.extend(l.getLatLng());
    }
  });
  if (allBounds.isValid()) map.fitBounds(allBounds, { maxZoom: 14, padding: [24, 24] });
}

async function deleteGroup(gid) {
  const ok = await manaConfirm('\u00BFEliminar toda la capa importada?');
  if (!ok) return;
  const meta = _manaGroupMeta[gid];
  if (meta) {
    meta.allLayers.forEach(l => {
      if (drawnItems.hasLayer(l)) drawnItems.removeLayer(l);
    });
    delete _manaGroupMeta[gid];
  }
  delete _expandedGroups[gid];
  delete _filterOpen[gid];
  stats();
  if (typeof saveState === 'function') saveState();
}

function focusLayer(i) {
  const layers = [];
  drawnItems.eachLayer(l => layers.push(l));
  const l = layers[i];
  if (!l) return;
  if (l.getBounds) map.fitBounds(l.getBounds(), { maxZoom: 14 });
  else map.setView(l.getLatLng(), 14);
  if (l.getPopup && l.getPopup()) {
    setTimeout(() => l.openPopup(), 200);
  }
}
