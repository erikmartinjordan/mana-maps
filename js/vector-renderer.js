// ── vector-renderer.js ──
// Renders drawn points as MapLibre GL vector layers for drift-free panning.
// Leaflet markers are kept as invisible interaction anchors for popups/selection.
(function () {
  'use strict';

  var _gl = null;
  var _ready = false;
  var _syncTimer = null;

  var SRC = 'mana-dp';
  var LAYER_CIRCLE = 'mana-dp-circle';
  var LAYER_LABEL = 'mana-dp-label';

  // ── Init ──

  function _init() {
    if (_ready) return;
    _ready = true;

    // Re-init when base layer changes
    var orig = window.setBaseLayer;
    if (orig) {
      window.setBaseLayer = function (type) {
        orig(type);
        _teardown();
        setTimeout(_bootstrap, 150);
      };
    }

    // Listen for point changes via drawnItems events
    if (typeof drawnItems !== 'undefined' && drawnItems.on) {
      drawnItems.on('layeradd', function (e) {
        if (e.layer instanceof L.Marker && _gl) _markerInvisible(e.layer);
        _debounceSync();
      });
      drawnItems.on('layerremove', _debounceSync);
    }

    _bootstrap();
  }

  // Auto-init when DOM is ready (all defer scripts have executed)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

  window.syncVectorRenderer = _fullSync;

  // ── Bootstrap: wait for GL map + style ──

  function _bootstrap() {
    var gl = _getGl();
    if (!gl) return;
    if (gl.isStyleLoaded()) _setup(gl);
    else gl.once('style.load', function () { _setup(gl); });
  }

  function _getGl() {
    var base = (typeof activeBase !== 'undefined' && activeBase === 'satellite') ? tileSat : tileMap;
    if (!base || !base.getMaplibreMap) return null;
    return base.getMaplibreMap();
  }

  // ── Setup MapLibre GL layers ──

  function _setup(gl) {
    _gl = gl;
    _removeLayers(gl);

    gl.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

    gl.addLayer({
      id: LAYER_CIRCLE,
      type: 'circle',
      source: SRC,
      paint: {
        'circle-radius': 7,
        'circle-color': ['get', 'color'],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    });

    gl.addLayer({
      id: LAYER_LABEL,
      type: 'symbol',
      source: SRC,
      layout: {
        'text-field': ['get', 'name'],
        'text-size': 11,
        'text-offset': [0, 1.8],
        'text-anchor': 'top',
        'text-font': ['Open Sans Regular', 'Noto Sans Regular', 'Arial Unicode MS Regular'],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: {
        'text-color': '#30363b',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.5,
      },
    });

    _hideAll();
    _sync();
  }

  function _teardown() {
    if (!_gl) return;
    _removeLayers(_gl);
    _showAll();
    _gl = null;
  }

  function _removeLayers(gl) {
    if (!gl) return;
    try { if (gl.getLayer(LAYER_LABEL)) gl.removeLayer(LAYER_LABEL); } catch (e) {}
    try { if (gl.getLayer(LAYER_CIRCLE)) gl.removeLayer(LAYER_CIRCLE); } catch (e) {}
    try { if (gl.getSource(SRC)) gl.removeSource(SRC); } catch (e) {}
  }

  // ── Hide Leaflet markers (keep invisible for interaction) ──

  function _markerInvisible(m) {
    if (m._manaInvisible) return;
    m._manaInvisible = true;
    m._manaOrigIcon = m.options.icon;
    m.setIcon(L.divIcon({ className: 'mana-ghost-marker', iconSize: [20, 20], iconAnchor: [10, 10] }));
    if (m._icon) m._icon.style.opacity = '0.01';
    if (m._shadow) m._shadow.style.display = 'none';
  }

  function _hideAll() {
    if (typeof drawnItems === 'undefined') return;
    drawnItems.eachLayer(function (l) {
      if (l instanceof L.Marker) _markerInvisible(l);
    });
  }

  function _showAll() {
    if (typeof drawnItems === 'undefined') return;
    drawnItems.eachLayer(function (l) {
      if (!(l instanceof L.Marker) || !l._manaInvisible) return;
      l._manaInvisible = false;
      l.setIcon(l._manaOrigIcon);
      l._manaOrigIcon = null;
      if (l._icon) l._icon.style.opacity = '';
      if (l._shadow) l._shadow.style.display = '';
    });
  }

  // ── Sync point data to GL source ──

  function _sync() {
    if (!_gl || !_gl.getSource(SRC)) return;

    var features = [];
    drawnItems.eachLayer(function (l) {
      if (!(l instanceof L.Marker)) return;
      var ll = l.getLatLng();
      var lng = ((ll.lng + 180) % 360 + 360) % 360 - 180;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, ll.lat] },
        properties: {
          name: l._manaName || '',
          color: l._manaColor || '#0ea5e9',
        },
      });
    });

    _gl.getSource(SRC).setData({ type: 'FeatureCollection', features: features });
  }

  function _debounceSync() {
    if (_syncTimer) clearTimeout(_syncTimer);
    _syncTimer = setTimeout(function () { _syncTimer = null; _sync(); }, 30);
  }

  function _fullSync() {
    if (!_gl) { _bootstrap(); return; }
    _hideAll();
    _sync();
  }

  // ── Inject CSS ──
  var _css = document.createElement('style');
  _css.textContent =
    '.mana-ghost-marker{background:transparent!important;border:none!important}' +
    '.mana-ghost-marker div{background:transparent!important}';
  document.head.appendChild(_css);

})();
