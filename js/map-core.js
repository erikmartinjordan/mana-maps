// ── map-core.js ─ Map init, base layers, resize, stats, utilities ──

// ── BASE LAYERS ──
const tileMap = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OSM &copy; CARTO', subdomains: 'abcd', maxZoom: 20
});
const tileSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  attribution: '&copy; Esri', maxZoom: 20
});

const map = L.map('map', { zoomControl: true, preferCanvas: true }).setView([40.416, -3.703], 6);
tileMap.addTo(map);
let activeBase = 'map';

// ── Leaflet attribution prefix (integrated, minimal) ──
function setLeafletAttributionPrefix() {
  if (!map || !map.attributionControl) return;
  map.attributionControl.setPrefix(
    '<a class="leaflet-prefix-link" href="https://leafletjs.com" target="_blank" rel="noopener noreferrer" aria-label="Leaflet (opens in a new tab)">' +
      '<span class="leaflet-prefix-dot" aria-hidden="true"></span>Leaflet' +
    '</a>'
  );
}
setLeafletAttributionPrefix();

// ── Dark/light tile URLs ──
const TILE_LIGHT = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const TILE_DARK  = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

function setMapThemeTiles() {
  var rootTheme = document.documentElement.getAttribute('data-theme');
  var isDark = rootTheme === 'dark'
    || (!rootTheme && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);

  // ── 2D Map tiles ──
  tileMap.setUrl(isDark ? TILE_DARK : TILE_LIGHT);

  // ── Satellite: apply CSS filter for night look ──
  var mapEl = document.getElementById('map');
  if (mapEl) {
    if (isDark && activeBase === 'satellite') {
      mapEl.classList.add('sat-dark');
    } else {
      mapEl.classList.remove('sat-dark');
    }
  }

  // ── Globe 3D: swap tile source ──
  if (typeof globeMap !== 'undefined' && globeMap && globeMap.isStyleLoaded && globeMap.isStyleLoaded()) {
    var src = globeMap.getSource('carto-light');
    if (src && src.setTiles) {
      var tpl = isDark
        ? ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
           'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
           'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png']
        : ['https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
           'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
           'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png'];
      src.setTiles(tpl);
    }
    // Also update point label colors for readability
    if (globeMap.getLayer('drawn-point-labels')) {
      globeMap.setPaintProperty('drawn-point-labels', 'text-color', isDark ? '#e8e6e3' : '#30363b');
      globeMap.setPaintProperty('drawn-point-labels', 'text-halo-color', isDark ? '#1a1a1a' : '#ffffff');
    }
    if (globeMap.getLayer('drawn-points')) {
      globeMap.setPaintProperty('drawn-points', 'circle-stroke-color', isDark ? '#1a1a1a' : '#ffffff');
    }
  }
}

const drawnItems = new L.FeatureGroup().addTo(map);

// ═══════════════════════════════════════════════════════════════
// ACTIVE LAYER SYSTEM (QGIS-style multi-feature layers)
// ═══════════════════════════════════════════════════════════════
let _manaGroupCounter = 0;
let _activeGroupId = null;
let _manaLayerNameCounter = 0;

// Create a new empty layer/group and set it as active
function createNewLayer(name, geometryType) {
  const gid = ++_manaGroupCounter;
  _manaLayerNameCounter++;
  const layerName = name || (t('layer_default_name') + ' ' + _manaLayerNameCounter);
  registerGroupMeta(gid, layerName, drawColor, geometryType || null);
  _activeGroupId = gid;
  _syncGroupOrder();
  renderLayers();
  if (typeof saveState === 'function') saveState();
  return gid;
}

// Set a group as the active layer
function setActiveGroup(gid) {
  if (_activeGroupId === gid) {
    // Deselect if clicking same one
    _activeGroupId = null;
  } else {
    _activeGroupId = gid;
  }
  renderLayers();
}

// Get the active group, or auto-create one if none exists
function getOrCreateActiveGroup(geometryType) {
  if (_activeGroupId && _manaGroupMeta[_activeGroupId]) {
    const meta = _manaGroupMeta[_activeGroupId];
    // If no geometryType requested, or group matches, or group is untyped → use it
    if (!geometryType || meta.geometryType === geometryType || meta.geometryType === null) {
      return _activeGroupId;
    }
    // Active group has a different type → find another compatible group (no active filter)
    for (const gid of _groupOrder) {
      const m = _manaGroupMeta[gid];
      if (m && m.geometryType === geometryType && m.filter.length === 0) {
        _activeGroupId = +gid;
        renderLayers();
        return _activeGroupId;
      }
    }
    // No compatible group found → create a new one with the correct type
    return createNewLayer(null, geometryType);
  }
  // No active group or it was deleted — create a new one
  return createNewLayer(null, geometryType || null);
}

// Add a drawn layer (point, line, polygon) to the active group
// Inherits the group's attribute schema (QGIS-style)
function addDrawnLayerToGroup(layer) {
  // Detect the geometry type of the incoming layer
  let detectedType = null;
  if (layer instanceof L.Marker) detectedType = 'point';
  else if (layer instanceof L.Polygon) detectedType = 'polygon';
  else if (layer instanceof L.Polyline) detectedType = 'line';

  const gid = getOrCreateActiveGroup(detectedType);
  const meta = _manaGroupMeta[gid];

  // If group has no geometryType yet, assign it now
  if (meta.geometryType === null && detectedType) {
    meta.geometryType = detectedType;
  }

  layer._manaGroupId = gid;
  layer._manaGroupName = meta.name;

  // Initialize _manaProperties from group schema (all existing columns, empty values)
  if (!layer._manaProperties) layer._manaProperties = {};
  for (const key in meta.attrs) {
    if (!(key in layer._manaProperties)) {
      layer._manaProperties[key] = '';
    }
  }

  drawnItems.addLayer(layer);
  addLayerToGroupMeta(gid, layer);
  stats();
  if (typeof saveState === 'function') saveState();
}


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

function registerGroupMeta(gid, name, color, geometryType) {
  if (!_manaGroupMeta[gid]) {
    _manaGroupMeta[gid] = {
      name: name,
      color: color,
      geometryType: geometryType || null,  // 'point', 'line', 'polygon', or null
      allLayers: [],
      attrs: {},
      filter: [],
      hiddenLayers: new Set(),
      tags: [],
    };
  }
}

function addLayerToGroupMeta(gid, layer) {
  const meta = _manaGroupMeta[gid];
  if (!meta) return;
  meta.allLayers.push(layer);
  _refreshGroupAttributeSchema(gid);
}

function _refreshGroupAttributeSchema(gid) {
  const meta = _manaGroupMeta[gid];
  if (!meta) return {};

  const attrs = {};
  meta.allLayers.forEach(layer => {
    const props = layer._manaProperties || {};
    for (const [key, val] of Object.entries(props)) {
      if (!key || key.startsWith('_') || key === 'bbox' || key === 'name') continue;
      if (!attrs[key]) attrs[key] = { type: 'string', values: new Set() };
      if (val !== null && val !== undefined && val !== '') {
        attrs[key].values.add(String(val));
      }
      if (val !== null && val !== undefined && typeof val === 'number') {
        attrs[key].type = 'number';
      }
    }
  });

  meta.attrs = attrs;
  meta.filter = (meta.filter || []).filter(rule => attrs[rule.field]);
  return attrs;
}

function _getGroupAttrValues(gid, field) {
  const meta = _manaGroupMeta[gid];
  if (!meta || !field) return [];
  const values = new Set();
  meta.allLayers.forEach(layer => {
    const props = layer._manaProperties || {};
    const val = props[field];
    if (val !== null && val !== undefined && val !== '') values.add(String(val));
  });
  return [...values].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
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
  _refreshGroupAttributeSchema(gid);
  const attrKeys = Object.keys(meta.attrs).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
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
  // If field changed, reset value and repaint so the datalist belongs to the new field.
  if (prop === 'field') {
    meta.filter[idx].value = '';
    _refreshGroupAttributeSchema(gid);
    renderLayers();
  }
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
  setMapThemeTiles();
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
    const layerColor = (l instanceof L.Marker) ? (l._manaColor || '#0ea5e9') : ((l.options && l.options.color) || '#0ea5e9');
    f.properties.color = layerColor;
    f.properties._manaColor = layerColor;
    if (l instanceof L.Marker) {
      f.properties.markerType = l._manaMarkerType || markerType || 'circle';
      f.properties._manaMarkerType = f.properties.markerType;
    }
    f.properties.name = l._manaName || f.properties.name || t('generic_element');
    f.properties._manaName = f.properties.name;
    if (l._manaGroupId) f.properties._manaGroupId = l._manaGroupId;
    if (l._manaGroupName) f.properties._manaGroupName = l._manaGroupName;
    if (l._manaTags && l._manaTags.length) f.properties._manaTags = _normalizeManaTags(l._manaTags);
    if (l._manaGroupId && _manaGroupMeta[l._manaGroupId] && _manaGroupMeta[l._manaGroupId].tags && _manaGroupMeta[l._manaGroupId].tags.length) {
      f.properties._manaGroupTags = _normalizeManaTags(_manaGroupMeta[l._manaGroupId].tags);
    }
    if (l.options && typeof l.options.weight !== 'undefined') f.properties._manaWeight = l.options.weight;
    if (l.options && typeof l.options.opacity !== 'undefined') f.properties._manaOpacity = l.options.opacity;
    if (l._manaGroupId && _manaGroupMeta[l._manaGroupId] && _manaGroupMeta[l._manaGroupId].geometryType) {
      f.properties._manaGeometryType = _manaGroupMeta[l._manaGroupId].geometryType;
    }
    features.push(f);
  });
  return { type: 'FeatureCollection', features: features };
}

// ── P1.3: Get current GeoJSON for AI context ──
function getCurrentGeoJSON() {
  const features = [];
  drawnItems.eachLayer(function(l) {
    const f = l.toGeoJSON();
    f.properties.name = l._manaName || f.properties.name || t('generic_element');
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
// Unified resize + collapse system for left (sidebar) and right (chat) panels.
// Both support drag (mouse + touch), dblclick collapse/expand, and localStorage persistence.

(function () {
  var TOOLBAR_W = 52;
  var MIN_W = TOOLBAR_W, MAX_W = 520;
  var DEFAULT_LEFT = 288; // toolbar(52) + panel(236)
  var DEFAULT_RIGHT = 320;
  var app = document.getElementById('app');

  // Saved widths for restore after collapse
  var _prevLeft = parseInt(localStorage.getItem('mana_sidebar_width')) || DEFAULT_LEFT;
  if (_prevLeft <= TOOLBAR_W) _prevLeft = DEFAULT_LEFT;
  var _prevRight = parseInt(localStorage.getItem('mana_chat_width')) || DEFAULT_RIGHT;

  // ────── HELPERS ──────
  function getX(e) {
    return e.touches ? e.touches[0].clientX : e.clientX;
  }

  function persist(key, val) {
    try { localStorage.setItem(key, String(Math.round(val))); } catch (e) {}
  }

  function getSidebarWidth() {
    var sb = document.getElementById('sidebar');
    return sb ? sb.getBoundingClientRect().width : DEFAULT_LEFT;
  }

  function getChatWidth() {
    return parseInt(getComputedStyle(app).getPropertyValue('--right-w')) || DEFAULT_RIGHT;
  }

  // ────── LEFT HANDLE (sidebar) ──────
  function initLeftHandle() {
    var handle = document.getElementById('handle-left');
    if (!handle) return;
    if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) return;
    var sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    var startX, startW, collapsed = false;

    function collapseSidebar() {
      if (collapsed) return;
      _prevLeft = getSidebarWidth() > TOOLBAR_W ? getSidebarWidth() : DEFAULT_LEFT;
      persist('mana_sidebar_width', TOOLBAR_W);
      sidebar.classList.add('collapsing', 'sidebar-toolbar-only');
      sidebar.style.width = TOOLBAR_W + 'px';
      sidebar.style.overflow = 'hidden';
      handle.classList.add('handle-collapsed');
      handle.title = 'Doble clic para expandir';
      collapsed = true;
      setTimeout(function () { sidebar.classList.remove('collapsing'); map.invalidateSize(); }, 220);
    }

    function expandSidebar() {
      if (!collapsed) return;
      var w = _prevLeft > TOOLBAR_W ? _prevLeft : DEFAULT_LEFT;
      persist('mana_sidebar_width', w);
      sidebar.classList.add('collapsing');
      sidebar.style.width = w + 'px';
      handle.classList.remove('handle-collapsed');
      handle.title = '';
      collapsed = false;
      setTimeout(function () {
        sidebar.classList.remove('collapsing', 'sidebar-toolbar-only');
        sidebar.style.overflow = '';
        map.invalidateSize();
      }, 220);
    }

    // Restore persisted width
    var saved = parseInt(localStorage.getItem('mana_sidebar_width'));
    if (saved === 0 || (saved > 0 && saved <= TOOLBAR_W)) {
      collapsed = true;
      sidebar.style.width = TOOLBAR_W + 'px';
      sidebar.style.overflow = 'hidden';
      sidebar.classList.add('sidebar-toolbar-only');
      handle.classList.add('handle-collapsed');
      handle.title = t('dblclick_expand');
    } else if (saved > TOOLBAR_W) {
      sidebar.style.width = saved + 'px';
      _prevLeft = saved;
    }

    // ── Drag ──
    function onStart(e) {
      if (collapsed) return;
      e.preventDefault();
      handle.classList.add('dragging');
      startX = getX(e);
      startW = getSidebarWidth();

      function onMove(ev) {
        var dx = getX(ev) - startX;
        var nw = Math.max(MIN_W, Math.min(MAX_W, startW + dx));
        sidebar.style.width = nw + 'px';
        sidebar.classList.toggle('sidebar-toolbar-only', nw <= TOOLBAR_W);
        map.invalidateSize();
      }
      function onEnd() {
        handle.classList.remove('dragging');
        var w = getSidebarWidth();
        if (w <= TOOLBAR_W) {
          _prevLeft = startW > TOOLBAR_W ? startW : _prevLeft;
          w = TOOLBAR_W;
          sidebar.style.width = TOOLBAR_W + 'px';
          sidebar.style.overflow = 'hidden';
          sidebar.classList.add('sidebar-toolbar-only');
          handle.classList.add('handle-collapsed');
          handle.title = 'Doble clic para expandir';
          collapsed = true;
        } else {
          _prevLeft = w;
          sidebar.style.overflow = '';
          sidebar.classList.remove('sidebar-toolbar-only');
          handle.classList.remove('handle-collapsed');
          handle.title = '';
        }
        persist('mana_sidebar_width', w);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onEnd);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onEnd);
        map.invalidateSize();
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onEnd);
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onEnd);
    }

    handle.addEventListener('mousedown', onStart);
    handle.addEventListener('touchstart', onStart, { passive: false });

    // ── Double-click collapse/expand ──
    handle.addEventListener('dblclick', function () {
      if (!collapsed) collapseSidebar();
      else expandSidebar();
    });
  }

  // ────── RIGHT HANDLE (chat) ──────
  function initRightHandle() {
    var handle = document.getElementById('handle-right');
    if (!handle) return;
    var chat = document.getElementById('chat-panel');
    if (!chat) return;
    var startX, startW, collapsed = false;

    function collapseChat() {
      if (collapsed) return;
      _prevRight = getChatWidth();
      persist('mana_chat_width', 0);
      chat.classList.add('collapsing');
      app.style.setProperty('--right-w', '0px');
      chat.style.overflow = 'hidden';
      document.documentElement.setAttribute('data-chat-collapsed', 'true');
      chat.classList.add('is-collapsed');
      handle.classList.add('handle-collapsed');
      handle.title = 'Doble clic para expandir';
      collapsed = true;
      setTimeout(function () { chat.classList.remove('collapsing'); map.invalidateSize(); }, 220);
    }

    function expandChat() {
      if (!collapsed) return;
      var w = _prevRight || DEFAULT_RIGHT;
      persist('mana_chat_width', w);
      chat.classList.add('collapsing');
      document.documentElement.removeAttribute('data-chat-collapsed');
      chat.classList.remove('is-collapsed');
      app.style.setProperty('--right-w', w + 'px');
      handle.classList.remove('handle-collapsed');
      handle.title = '';
      collapsed = false;
      setTimeout(function () {
        chat.classList.remove('collapsing');
        chat.style.overflow = '';
        map.invalidateSize();
      }, 220);
    }

    window.expandChatPanel = expandChat;

    // Restore persisted width
    var saved = parseInt(localStorage.getItem('mana_chat_width'));
    if (saved === 0) {
      collapsed = true;
      app.style.setProperty('--right-w', '0px');
      chat.style.overflow = 'hidden';
      document.documentElement.setAttribute('data-chat-collapsed', 'true');
      chat.classList.add('is-collapsed');
      handle.classList.add('handle-collapsed');
      handle.title = 'Doble clic para expandir';
    } else if (saved > 0) {
      app.style.setProperty('--right-w', saved + 'px');
      _prevRight = saved;
    }

    // ── Drag ──
    function onStart(e) {
      if (collapsed) return;
      e.preventDefault();
      handle.classList.add('dragging');
      startX = getX(e);
      startW = getChatWidth();

      function onMove(ev) {
        var dx = getX(ev) - startX;
        var nw = Math.max(MIN_W, Math.min(MAX_W, startW - dx));
        app.style.setProperty('--right-w', nw + 'px');
        map.invalidateSize();
      }
      function onEnd() {
        handle.classList.remove('dragging');
        var w = getChatWidth();
        _prevRight = w;
        persist('mana_chat_width', w);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onEnd);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onEnd);
        map.invalidateSize();
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onEnd);
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onEnd);
    }

    handle.addEventListener('mousedown', onStart);
    handle.addEventListener('touchstart', onStart, { passive: false });

    // ── Double-click collapse/expand ──
    handle.addEventListener('dblclick', function () {
      if (!collapsed) collapseChat();
      else expandChat();
    });

  }

  initLeftHandle();
  initRightHandle();
})();

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

// ── Layer ordering (drag & drop) ──
let _groupOrder = []; // ordered array of group IDs for sidebar rendering

function _syncGroupOrder() {
  // Add any new groups not yet in the order array
  for (const gid in _manaGroupMeta) {
    if (!_groupOrder.includes(Number(gid))) _groupOrder.push(Number(gid));
  }
  // Remove deleted groups
  _groupOrder = _groupOrder.filter(gid => _manaGroupMeta[gid]);
}

// Move a group from one position to another
function reorderGroup(fromIdx, toIdx) {
  if (fromIdx === toIdx) return;
  const item = _groupOrder.splice(fromIdx, 1)[0];
  _groupOrder.splice(toIdx, 0, item);
  // Reorder layers on the map (bring later groups to front)
  _groupOrder.forEach(gid => {
    const meta = _manaGroupMeta[gid];
    if (!meta) return;
    meta.allLayers.forEach(l => {
      if (drawnItems.hasLayer(l) && l.bringToFront) {
        try { l.bringToFront(); } catch(e) {}
      }
    });
  });
  renderLayers();
  if (typeof saveState === 'function') saveState();
}

// ── SVG ICONS ──
const ICON = {
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
  filter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>',
  palette: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.5-.7 1.5-1.5 0-.4-.1-.7-.4-1-.3-.3-.4-.6-.4-1 0-.8.7-1.5 1.5-1.5H16c3.3 0 6-2.7 6-6 0-5.5-4.5-9-10-9z"/><circle cx="7.5" cy="11.5" r="1.5" fill="currentColor"/><circle cx="10.5" cy="7.5" r="1.5" fill="currentColor"/><circle cx="14.5" cy="7.5" r="1.5" fill="currentColor"/><circle cx="17.5" cy="11.5" r="1.5" fill="currentColor"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  geomPoint: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5" fill="currentColor" stroke="none"/></svg>',
  geomLine: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="20" x2="20" y2="4"/><circle cx="4" cy="20" r="2" fill="currentColor" stroke="none"/><circle cx="20" cy="4" r="2" fill="currentColor" stroke="none"/></svg>',
  geomPolygon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12,3 21,19 3,19"/></svg>',
  table: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>',
  tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
  cursor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4l7.07 17 2.51-7.39L21 11.07z"/></svg>',
};

function esc(s) { return String(s).replace(/</g,'&lt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function _cleanManaTag(tag) { return String(tag || '').trim().replace(/\s+/g, ' ').substring(0, 28); }
function _normalizeManaTags(tags) {
  const out = [];
  (Array.isArray(tags) ? tags : []).forEach(function(tag) {
    const clean = _cleanManaTag(tag);
    if (clean && out.map(t => t.toLowerCase()).indexOf(clean.toLowerCase()) === -1) out.push(clean);
  });
  return out;
}
function _renderLayerTags(tags, cls) {
  const clean = _normalizeManaTags(tags);
  if (!clean.length) return '';
  return '<div class="' + cls + '">' + clean.slice(0, 6).map(tag => '<span class="layer-tag-chip">#' + esc(tag) + '</span>').join('') + '</div>';
}

function renderLayers() {
  const list = document.getElementById('layer-list');
  const layers = [];
  drawnItems.eachLayer(l => layers.push(l));

  // Also count hidden layers from filters
  let totalHidden = 0;
  for (const gid in _manaGroupMeta) {
    totalHidden += _manaGroupMeta[gid].hiddenLayers.size;
  }

  if (!layers.length && !totalHidden && !Object.keys(_manaGroupMeta).length) {
    list.innerHTML = '<p class="empty-note">' + t('layer_empty').replace('\n','<br>') + '</p>';
    return;
  }

  // Build group info from meta registry (includes hidden layers)
  const groupOrder = [];
  const groups = {};

  // First pass: collect from meta registry, using persistent order
  _syncGroupOrder();
  for (const gid of _groupOrder) {
    const meta = _manaGroupMeta[gid];
    if (!meta) continue;
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

  // Map visible layers to their group
  layers.forEach((l, i) => {
    if (l._manaGroupId && groups[l._manaGroupId]) {
      groups[l._manaGroupId].visibleLayers.push({ layer: l, index: i });
    }
  });

  let html = '';

  // "New layer" button at top
  html += '<button class="new-layer-btn" onclick="createNewLayer()">';
  html += ICON.plus + ' ' + t('layer_new') + '</button>';

  // Render grouped layers
  groupOrder.forEach(gid => {
    const g = groups[gid];
    if (!g) return;
    const meta = _manaGroupMeta[gid];
    const isExpanded = !!_expandedGroups[gid];
    const isFilterOpen = !!_filterOpen[gid];
    const isActive = _activeGroupId === gid;
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
    if (lns) typeParts.push(lns + ' ' + t('draw_line_label').toLowerCase() + (lns > 1 ? 's' : ''));
    if (pols) typeParts.push(pols + ' pol' + (pols > 1 ? 's' : ''));

    const filterBadge = g.hasFilter
      ? '<span class="filter-active-badge">' + g.visibleCount + '/' + g.totalCount + '</span>'
      : '';

    var orderIdx = _groupOrder.indexOf(gid);
    html += '<div class="layer-group' + (g.hasFilter ? ' has-filter' : '') + (isActive ? ' active-layer' : '') + '" data-gid="' + gid + '" data-order="' + orderIdx + '" draggable="true" ondragstart="onLayerDragStart(event,' + orderIdx + ')" ondragover="onLayerDragOver(event)" ondrop="onLayerDrop(event,' + orderIdx + ')" ondragend="onLayerDragEnd(event)">';

    // ── Header: click sets active, chevron toggles expand
    html += '<div class="layer-group-header" onclick="setActiveGroup(' + gid + ')" oncontextmenu="showLayerCtx(event,\'group\',' + gid + ')">';
    html += '  <span class="layer-drag-handle" title="' + t('layer_drag_hint') + '">&#8942;&#8942;</span>';
    html += '  <div class="layer-dot" style="background:' + g.color + '"></div>';
    // Geometry type icon
    const _gtIcon = meta.geometryType === 'point' ? ICON.geomPoint
                   : meta.geometryType === 'line' ? ICON.geomLine
                   : meta.geometryType === 'polygon' ? ICON.geomPolygon : '';
    html += '  <span class="layer-geom-icon">' + _gtIcon + '</span>';
    html += '  <span class="layer-name">' + esc(g.name) + '</span>';
    html += '  ' + filterBadge;
    html += '  <span class="layer-group-badge">' + g.totalCount + '</span>';
    html += '  <span class="' + chevronCls + '" onclick="event.stopPropagation();toggleLayerGroup(' + gid + ')">' + ICON.chevron + '</span>';
    html += '</div>';
    if (isActive) {
      html += '<div class="active-layer-indicator">' + t('layer_active') + '</div>';
    }
    html += '<div class="layer-group-meta">' + typeParts.join(' \u00B7 ') + '</div>';
    html += _renderLayerTags(meta.tags, 'layer-tags layer-group-tags');

    // ── Expanded children
    if (isExpanded) {
      html += '<div class="layer-group-children">';
      g.visibleLayers.forEach(({ layer, index }, fi) => {
        let kind, name;
        if (layer instanceof L.Marker) {
          kind = t('geom_point'); name = layer._manaName || (t('geom_point') + ' ' + (fi + 1));
        } else if (layer instanceof L.Polygon) {
          kind = t('geom_polygon'); name = layer._manaName || (t('geom_polygon') + ' ' + (fi + 1));
        } else {
          kind = t('geom_line'); name = layer._manaName || (t('geom_line') + ' ' + (fi + 1));
        }
        html += '<div class="layer-item layer-child" onclick="focusLayer(' + index + ')" oncontextmenu="showLayerCtx(event,\'layer\',' + index + ')">';
        html += '  <span class="layer-name">' + esc(name) + '</span>';
        html += '  <span class="layer-type">' + kind + '</span>';
        html += _renderLayerTags(layer._manaTags, 'layer-tags layer-child-tags');
        html += '</div>';
      });
      if (g.hasFilter && g.visibleCount < g.totalCount) {
        html += '<div class="filter-hidden-note">' + (g.totalCount - g.visibleCount) + ' ' + t('filter_hidden') + '</div>';
      }
      html += '</div>';
    }

    // ── Filter panel
    if (isFilterOpen) {
      html += renderFilterPanel(gid, meta);
    }

    // ── Actions row
    html += '<div class="layer-group-actions">';
    html += '  <button class="layer-group-action-btn" onclick="showLayerCtxBtn(event,\'group\',' + gid + ')" title="' + t('panel_style_title') + '">' + ICON.palette + '</button>';
    html += '  <button class="layer-group-action-btn' + ((meta.tags && meta.tags.length) ? ' has-tags' : '') + '" onclick="showLayerCtxBtn(event,\'group\',' + gid + ')" title="' + t('ctx_tags') + '">' + ICON.tag + '</button>';
    html += '  <button class="layer-group-action-btn' + (isFilterOpen ? ' active' : '') + (g.hasFilter ? ' has-filter' : '') + '" onclick="toggleFilterPanel(' + gid + ')" title="' + t('filter_title') + '">' + ICON.filter + '</button>';
    html += '  <button class="layer-group-action-btn" onclick="openAttrTable(' + gid + ')" title="Tabla de atributos">' + ICON.table + '</button>';
    html += '  <button class="layer-group-action-btn" onclick="focusGroup(' + gid + ')" title="' + t('lctx_zoom') + '">' + ICON.search + '</button>';
    html += '  <button class="layer-group-action-btn danger" onclick="deleteGroup(' + gid + ')" title="' + t('lctx_delete') + '">' + ICON.trash + '</button>';
    html += '</div>';
    html += '</div>';
  });

  list.innerHTML = html;
}


// ═══════════════════════════════════════════════════════════════
// FILTER PANEL RENDERER
// ═══════════════════════════════════════════════════════════════
function renderFilterPanel(gid, meta) {
  _refreshGroupAttributeSchema(gid);
  const attrKeys = Object.keys(meta.attrs).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  if (!attrKeys.length) {
    return '<div class="filter-panel"><div class="filter-empty">' + t('filter_no_attrs') + '</div></div>';
  }

  const rules = meta.filter;
  let html = '<div class="filter-panel">';
  html += '<div class="filter-title">' + ICON.filter + ' ' + t('filter_title') + '</div>';

  if (!rules.length) {
    html += '<div class="filter-empty">' + t('filter_empty') + '</div>';
  }

  rules.forEach((rule, idx) => {
    const sortedVals = _getGroupAttrValues(gid, rule.field);

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
      ['contains', t('filter_contains')], ['starts', t('filter_starts')]
    ];
    ops.forEach(([val, label]) => {
      html += '<option value="' + val + '"' + (val === rule.op ? ' selected' : '') + '>' + label + '</option>';
    });
    html += '</select>';

    // Value input with datalist
    const dlId = 'dl_' + gid + '_' + idx;
    html += '<input class="filter-value" type="text" placeholder="' + t('filter_value_placeholder') + '" value="' + esc(rule.value) + '"';
    html += ' list="' + dlId + '"';
    html += ' oninput="updateFilterRule(' + gid + ',' + idx + ',\'value\',this.value)"';
    html += '/>';
    html += '<datalist id="' + dlId + '">';
    sortedVals.slice(0, 100).forEach(v => {
      html += '<option value="' + esc(v) + '">';
    });
    html += '</datalist>';

    // Remove rule button
    html += '<button class="filter-rule-remove" onclick="removeFilterRule(' + gid + ',' + idx + ')" title="' + t('filter_remove_rule') + '">' + ICON.x + '</button>';
    html += '</div>';
  });

  // Action buttons
  html += '<div class="filter-actions">';
  html += '<button class="filter-btn filter-btn-add" onclick="addFilterRule(' + gid + ')" title="' + t('filter_add_rule') + '">' + ICON.plus + ' ' + t('filter_add_rule') + '</button>';
  if (rules.length) {
    html += '<button class="filter-btn filter-btn-apply" onclick="execFilter(' + gid + ')">' + t('filter_apply') + '</button>';
    html += '<button class="filter-btn filter-btn-clear" onclick="clearGroupFilter(' + gid + ')">' + t('filter_clear') + '</button>';
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
  const ok = await manaConfirm(t('modal_delete_group'));
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
  if (_activeGroupId === gid) _activeGroupId = null;
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

// ═══════════════════════════════════════════════════════════════
// LAYER DRAG & DROP REORDERING
// ═══════════════════════════════════════════════════════════════
let _dragFromIdx = null;

function onLayerDragStart(e, idx) {
  _dragFromIdx = idx;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', idx);
  // Add visual feedback
  setTimeout(() => { e.target.classList.add('dragging'); }, 0);
}

function onLayerDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  // Highlight drop target
  const group = e.target.closest('.layer-group');
  document.querySelectorAll('.layer-group').forEach(g => g.classList.remove('drag-over'));
  if (group) group.classList.add('drag-over');
}

function onLayerDrop(e, toIdx) {
  e.preventDefault();
  document.querySelectorAll('.layer-group').forEach(g => {
    g.classList.remove('drag-over');
    g.classList.remove('dragging');
  });
  if (_dragFromIdx !== null && _dragFromIdx !== toIdx) {
    reorderGroup(_dragFromIdx, toIdx);
  }
  _dragFromIdx = null;
}

function onLayerDragEnd(e) {
  document.querySelectorAll('.layer-group').forEach(g => {
    g.classList.remove('drag-over');
    g.classList.remove('dragging');
  });
  _dragFromIdx = null;
}


// ═══════════════════════════════════════════════════════════════
// SELECTION SYSTEM
// ═══════════════════════════════════════════════════════════════
const _selectedLayers = new Set();
let _selectionHighlights = [];

function selectLayerOnMap(layer, addToSelection) {
  if (!addToSelection) clearSelection();
  if (_selectedLayers.has(layer)) {
    _selectedLayers.delete(layer);
  } else {
    _selectedLayers.add(layer);
  }
  _updateSelectionHighlights();
  // If attr table is open, refresh it
  if (_attrTableGid !== null) _renderAttrTableBody(_attrTableGid);
}

function clearSelection() {
  _selectedLayers.clear();
  _updateSelectionHighlights();
}

function _updateSelectionHighlights() {
  // Remove old highlights
  _selectionHighlights.forEach(h => { try { map.removeLayer(h); } catch(e) {} });
  _selectionHighlights = [];
  // Add new highlights
  _selectedLayers.forEach(layer => {
    let highlight;
    if (layer instanceof L.Marker) {
      highlight = L.circleMarker(layer.getLatLng(), {
        radius: 16, color: '#fbbf24', weight: 3, fillOpacity: 0.18, dashArray: '5 3',
        interactive: false, className: 'selection-highlight'
      }).addTo(map);
    } else if (layer.getLatLngs) {
      const Ctor = (layer instanceof L.Polygon) ? L.polygon : L.polyline;
      highlight = Ctor(layer.getLatLngs(), {
        color: '#fbbf24', weight: 5, fillOpacity: 0.12, dashArray: '6 4',
        interactive: false, className: 'selection-highlight'
      }).addTo(map);
    }
    if (highlight) _selectionHighlights.push(highlight);
  });
}

// ═══════════════════════════════════════════════════════════════
// GLOBAL ATTRIBUTE TABLE (QGIS-style bottom panel)
// ═══════════════════════════════════════════════════════════════
let _attrTableGid = null;

function openAttrTable(gid) {
  const meta = _manaGroupMeta[gid];
  if (!meta) return;
  _attrTableGid = gid;

  const panel = document.getElementById('attr-table-panel');
  if (!panel) return;

  // Build header
  const visibleCount = meta.allLayers.length - meta.hiddenLayers.size;
  const headerHTML = '<div class="atp-header">'
    + '<span class="atp-title">' + esc(meta.name) + '</span>'
    + '<span class="atp-count">' + visibleCount + ' / ' + meta.allLayers.length + ' elementos</span>'
    + '<button class="atp-close" onclick="closeAttrTable()">' + ICON.x + '</button>'
    + '</div>';

  // Build table wrapper
  const tableHTML = '<div class="atp-table-wrap" id="atp-table-wrap"></div>';

  // Build footer
  const footerHTML = '<div class="atp-footer">'
    + '<button class="atp-btn" onclick="attrTableAddColumn()">' + ICON.plus + ' Añadir columna</button>'
    + '<button class="atp-btn atp-btn-close" onclick="closeAttrTable()">Cerrar</button>'
    + '</div>';

  panel.innerHTML = '<div class="atp-resize-handle" id="atp-resize-handle"></div>' + headerHTML + tableHTML + footerHTML;
  panel.classList.add('open');

  _renderAttrTableBody(gid);
  _initAttrTableResize();

  // Invalidate map size
  setTimeout(() => { if (typeof map !== 'undefined') map.invalidateSize(); }, 50);
}

function closeAttrTable() {
  _attrTableGid = null;
  const panel = document.getElementById('attr-table-panel');
  if (panel) {
    panel.classList.remove('open');
    panel.innerHTML = '';
  }
  setTimeout(() => { if (typeof map !== 'undefined') map.invalidateSize(); }, 50);
}

function _renderAttrTableBody(gid) {
  const meta = _manaGroupMeta[gid];
  if (!meta) return;
  _refreshGroupAttributeSchema(gid);
  const wrap = document.getElementById('atp-table-wrap');
  if (!wrap) return;

  // Get visible layers (respecting filter)
  const visibleLayers = meta.allLayers.filter(l => !meta.hiddenLayers.has(l));

  // Collect all attribute keys sorted
  const attrKeys = Object.keys(meta.attrs).sort();

  let html = '<table class="atp-table"><thead><tr>';
  html += '<th class="atp-th-fixed">#</th>';
  html += '<th class="atp-th-fixed atp-th-zoom"></th>';
  html += '<th>nombre</th>';
  attrKeys.forEach(k => {
    html += '<th>' + esc(k) + '</th>';
  });
  html += '</tr></thead><tbody>';

  visibleLayers.forEach((layer, idx) => {
    const isSelected = _selectedLayers.has(layer);
    const rowClass = isSelected ? 'atp-row selected' : 'atp-row';
    html += '<tr class="' + rowClass + '" data-layer-idx="' + idx + '">';
    html += '<td class="atp-td-fixed atp-td-num">' + (idx + 1) + '</td>';
    html += '<td class="atp-td-fixed atp-td-zoom"><button class="atp-zoom-btn" onclick="attrTableZoom(' + gid + ',' + idx + ')" title="Zoom">' + ICON.search + '</button></td>';

    // Name cell (editable)
    const name = esc(layer._manaName || '');
    html += '<td class="atp-td-edit" contenteditable="true" data-gid="' + gid + '" data-lidx="' + idx + '" data-field="_name" onblur="attrTableSaveCell(this)">' + name + '</td>';

    // Attribute cells (editable)
    const props = layer._manaProperties || {};
    attrKeys.forEach(k => {
      const val = (props[k] !== null && props[k] !== undefined) ? esc(String(props[k])) : '';
      html += '<td class="atp-td-edit" contenteditable="true" data-gid="' + gid + '" data-lidx="' + idx + '" data-field="' + esc(k) + '" onblur="attrTableSaveCell(this)">' + val + '</td>';
    });

    html += '</tr>';
  });

  html += '</tbody></table>';
  wrap.innerHTML = html;
}

function attrTableSaveCell(el) {
  const gid = +el.dataset.gid;
  const lidx = +el.dataset.lidx;
  const field = el.dataset.field;
  const meta = _manaGroupMeta[gid];
  if (!meta) return;

  const visibleLayers = meta.allLayers.filter(l => !meta.hiddenLayers.has(l));
  const layer = visibleLayers[lidx];
  if (!layer) return;

  const newVal = el.textContent.trim();

  if (field === '_name') {
    layer._manaName = newVal;
    if (layer.getPopup && layer.getPopup()) {
      layer.setPopupContent('<strong>' + newVal + '</strong>');
    }
  } else {
    if (!layer._manaProperties) layer._manaProperties = {};
    const num = parseFloat(newVal);
    layer._manaProperties[field] = (newVal !== '' && !isNaN(num) && String(num) === newVal) ? num : newVal;
    _refreshGroupAttributeSchema(gid);
  }

  if (typeof saveState === 'function') saveState();
}

function attrTableZoom(gid, lidx) {
  const meta = _manaGroupMeta[gid];
  if (!meta) return;
  const visibleLayers = meta.allLayers.filter(l => !meta.hiddenLayers.has(l));
  const layer = visibleLayers[lidx];
  if (!layer) return;

  if (layer.getBounds) map.fitBounds(layer.getBounds(), { maxZoom: 15, padding: [24, 24] });
  else if (layer.getLatLng) map.setView(layer.getLatLng(), 15);

  // Select this layer
  selectLayerOnMap(layer, false);

  // Highlight the row
  document.querySelectorAll('.atp-row').forEach(r => r.classList.remove('selected'));
  const row = document.querySelector('.atp-row[data-layer-idx="' + lidx + '"]');
  if (row) row.classList.add('selected');
}

function attrTableAddColumn() {
  if (_attrTableGid === null) return;
  const meta = _manaGroupMeta[_attrTableGid];
  if (!meta) return;

  const name = prompt('Nombre de la nueva columna:');
  if (!name || !name.trim()) return;
  const field = name.trim();

  // Register in attrs schema
  if (!meta.attrs[field]) {
    meta.attrs[field] = { type: 'string', values: new Set() };
  }

  // Add empty value to all layers in this group
  meta.allLayers.forEach(l => {
    if (!l._manaProperties) l._manaProperties = {};
    if (!(field in l._manaProperties)) l._manaProperties[field] = '';
  });

  // Re-render table
  _renderAttrTableBody(_attrTableGid);
  if (typeof saveState === 'function') saveState();
  var _lastRow = document.querySelector('.atp-row:last-child .atp-td-edit');
  if (_lastRow) attrInlineFeedback(_lastRow, t('attr_col_added', {field: field}), 'success');
}

function _initAttrTableResize() {
  const handle = document.getElementById('atp-resize-handle');
  const panel = document.getElementById('attr-table-panel');
  if (!handle || !panel) return;

  let startY, startH;

  function onStart(e) {
    e.preventDefault();
    startY = e.touches ? e.touches[0].clientY : e.clientY;
    startH = panel.offsetHeight;
    handle.classList.add('dragging');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
  }

  function onMove(e) {
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    const dy = startY - y;
    const newH = Math.max(120, Math.min(600, startH + dy));
    panel.style.height = newH + 'px';
  }

  function onEnd() {
    handle.classList.remove('dragging');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onEnd);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onEnd);
    if (typeof map !== 'undefined') map.invalidateSize();
  }

  handle.addEventListener('mousedown', onStart);
  handle.addEventListener('touchstart', onStart, { passive: false });
}
