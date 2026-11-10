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
  var LAYER_EMOJI = 'mana-dp-emoji';
  var LAYER_CLUSTERS = 'mana-dp-clusters';
  var LAYER_CLUSTER_COUNT = 'mana-dp-cluster-count';
  var CLUSTER_ICON = 'mana-cluster-blob';
  var CLUSTER_MAX_ZOOM = 12;
  var CLUSTER_RADIUS = 50;
  var MANA_BLOB_PATH = 'M42.3,-74.7C55.1,-65.8,66.1,-55.2,74.7,-42.4C83.2,-29.7,89.3,-14.8,89.7,0.2C90,15.2,84.6,30.5,74.3,40.2C64,49.8,48.7,54,35.6,62.1C22.4,70.2,11.2,82.3,-0.8,83.6C-12.7,84.9,-25.4,75.4,-36.1,65.9C-46.9,56.4,-55.6,46.8,-61.3,35.8C-66.9,24.8,-69.5,12.4,-72,-1.4C-74.5,-15.3,-76.9,-30.5,-70.9,-41C-64.9,-51.4,-50.6,-57.1,-37.4,-65.8C-24.2,-74.5,-12.1,-86.1,1.3,-88.4C14.7,-90.7,29.5,-83.6,42.3,-74.7Z';

  var _emojiMap = {
    emoji_fire:'\uD83D\uDD25', emoji_collision:'\uD83D\uDCA5', emoji_water:'\uD83C\uDF0A', emoji_star:'\u2B50', emoji_heart:'\u2764\uFE0F', emoji_diamond:'\uD83D\uDC8E',
    emoji_home:'\uD83C\uDFE0', emoji_building:'\uD83C\uDFE2', emoji_tree:'\uD83C\uDF32', emoji_mountain:'\uD83C\uDFD4\uFE0F', emoji_beach:'\uD83C\uDFD6\uFE0F',
    emoji_camping:'\u26FA', emoji_flower:'\uD83C\uDF38', emoji_sun:'\u2600\uFE0F', emoji_moon:'\uD83C\uDF19', emoji_car:'\uD83D\uDE97', emoji_bus:'\uD83D\uDE8C',
    emoji_train:'\uD83D\uDE82', emoji_plane:'\u2708\uFE0F', emoji_ship:'\uD83D\uDEA2', emoji_bike:'\uD83D\uDEB2', emoji_walk:'\uD83D\uDEB6', emoji_parking:'\uD83C\uDD7F\uFE0F',
    emoji_fuel:'\u26FD', emoji_camera:'\uD83D\uDCF7', emoji_music:'\uD83C\uDFB5', emoji_soccer:'\u26BD', emoji_trophy:'\uD83C\uDFC6', emoji_ski:'\uD83C\uDFBF',
    emoji_swim:'\uD83C\uDFCA', emoji_paint:'\uD83C\uDFA8', emoji_game:'\uD83C\uDFAE', emoji_warning:'\u26A0\uFE0F', emoji_info:'\u2139\uFE0F', emoji_question:'\u2753',
    emoji_check:'\u2705', emoji_cross:'\u274C', emoji_lock:'\uD83D\uDD12', emoji_key:'\uD83D\uDD11', emoji_target:'\uD83C\uDFAF', emoji_pin:'\uD83D\uDCCC',
    emoji_pushpin:'\uD83D\uDCCC', emoji_flag:'\uD83C\uDFC1', emoji_gift:'\uD83C\uDF81', emoji_money:'\uD83D\uDCB0', emoji_bulb:'\uD83D\uDCA1', emoji_party:'\uD83C\uDF89',
    emoji_trash:'\uD83D\uDDD1\uFE0F', emoji_package:'\uD83D\uDCE6', emoji_hospital:'\uD83C\uDFE5', emoji_school:'\uD83C\uDFEB', emoji_church:'\u26EA',
    emoji_museum:'\uD83C\uDFDB\uFE0F', emoji_moai:'\uD83D\uDDFF', emoji_hotel:'\uD83C\uDFE8', emoji_store:'\uD83C\uDFEA', emoji_bank:'\uD83C\uDFE6', emoji_factory:'\uD83C\uDFED', emoji_restaurant:'\uD83C\uDF7D\uFE0F',
    emoji_burger:'\uD83C\uDF54', emoji_pizza:'\uD83C\uDF55', emoji_coffee:'\u2615', emoji_beer:'\uD83C\uDF7A', emoji_wine:'\uD83C\uDF77', emoji_cocktail:'\uD83C\uDF79',
    emoji_sushi:'\uD83C\uDF63', emoji_icecream:'\uD83C\uDF66', emoji_rain:'\uD83C\uDF27\uFE0F'
  };
  var _emojiKeys = Object.keys(_emojiMap);

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
  var _bootstrapRetries = 0;

  function _bootstrap() {
    var gl = _getGl();
    if (!gl) {
      if (_bootstrapRetries++ < 300) setTimeout(_bootstrap, 200);
      return;
    }
    _bootstrapRetries = 0;
    if (gl.isStyleLoaded()) {
      try { _setup(gl); } catch (e) { console.warn('vector-renderer setup failed', e); }
    } else {
      var done = false;
      var onLoad = function () { if (done) return; done = true; try { _setup(gl); } catch (e) { console.warn('vector-renderer setup failed', e); } };
      try { gl.once('style.load', onLoad); } catch (e) {}
      // Fallback poll in case event was missed (race on base switch)
      var poll = 0;
      (function waitStyle(){
        if (done) return;
        if (gl.isStyleLoaded()) { done = true; try { _setup(gl); } catch (e) {} return; }
        if (poll++ < 300) setTimeout(waitStyle, 200);
      })();
      setTimeout(function(){ if (!done && gl.isStyleLoaded()) onLoad(); }, 1200);
    }
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

    gl.addSource(SRC, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      cluster: true,
      clusterMaxZoom: CLUSTER_MAX_ZOOM,
      clusterRadius: CLUSTER_RADIUS,
    });

    gl.addLayer({
      id: LAYER_CIRCLE,
      type: 'circle',
      source: SRC,
      filter: ['all',
        ['==', ['geometry-type'], 'Point'],
        ['!', ['in', ['get', 'markerType'], ['literal', _emojiKeys]]],
        ['!', ['has', 'point_count']]],
      paint: {
        'circle-radius': 7,
        'circle-color': ['get', 'color'],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    });

    // Emoji points as colored symbols (keep fire etc. visible in 2D, no marker drift)
    // Raster images keep the emoji color (SDF text is monochrome). The outline is
    // tinted with the feature _manaColor so the legend ramp matches the map; the
    // images are generated per (markerType, color) on each sync.

    gl.addLayer({
      id: LAYER_EMOJI,
      type: 'symbol',
      source: SRC,
      filter: ['all',
        ['in', ['get', 'markerType'], ['literal', _emojiKeys]],
        ['!', ['has', 'point_count']]],
      layout: {
        'icon-image': ['get', 'emojiIcon'],
        'icon-size': ['interpolate', ['linear'], ['coalesce', ['get', 'emojiSize'], 34], 22, 0.38, 34, 0.52, 50, 0.72, 66, 0.92],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-anchor': 'center',
      },
    });

    _addClusterLayers(gl);
    _hideAll();
    _sync();
  }

  // Cluster genérico con la silueta y el color del logo de Maña.
  function _ensureClusterIcon(gl) {
    if (gl.hasImage(CLUSTER_ICON)) return true;
    try {
      if (typeof Path2D !== 'function') return false;
      var size = 128;
      var canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      var ctx = canvas.getContext('2d');
      var path = new Path2D(MANA_BLOB_PATH);
      ctx.translate(size / 2, size / 2);
      ctx.scale(size / 200, size / 200);
      ctx.fillStyle = '#30363B';
      ctx.fill(path);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(1,1,1,0.35)';
      ctx.stroke(path);
      gl.addImage(CLUSTER_ICON, ctx.getImageData(0, 0, size, size));
      return true;
    } catch (e) {
      return false;
    }
  }

  function _addClusterLayers(gl) {
    if (!_ensureClusterIcon(gl)) return;
    if (!gl.getLayer(LAYER_CLUSTERS)) {
      gl.addLayer({
        id: LAYER_CLUSTERS,
        type: 'symbol',
        source: SRC,
        filter: ['has', 'point_count'],
        layout: {
          'icon-image': CLUSTER_ICON,
          'icon-size': ['interpolate', ['linear'], ['get', 'point_count'], 2, 0.22, 10, 0.27, 50, 0.34, 200, 0.42, 1000, 0.52],
          'icon-anchor': 'center',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      });
    }
    if (!gl.getLayer(LAYER_CLUSTER_COUNT)) {
      gl.addLayer({
        id: LAYER_CLUSTER_COUNT,
        type: 'symbol',
        source: SRC,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['Noto Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['get', 'point_count'], 2, 10, 10, 11, 50, 13, 200, 15, 1000, 17],
          'text-anchor': 'center',
          'text-offset': [0, 0],
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: { 'text-color': '#ffffff' },
      });
    }
    if (!gl._manaClusterClickBound) {
      gl._manaClusterClickBound = true;
      gl.on('click', LAYER_CLUSTERS, function(e) {
        var f = e.features && e.features[0];
        if (!f || !f.properties || !gl.getSource(SRC)) return;
        gl.getSource(SRC).getClusterExpansionZoom(f.properties.cluster_id, function(err, zoom) {
          if (err) return;
          gl.easeTo({ center: f.geometry.coordinates, zoom: zoom });
        });
      });
      gl.on('mouseenter', LAYER_CLUSTERS, function() { gl.getCanvas().style.cursor = 'pointer'; });
      gl.on('mouseleave', LAYER_CLUSTERS, function() { gl.getCanvas().style.cursor = ''; });
    }
  }

  function _teardown() {
    if (!_gl) return;
    _removeLayers(_gl);
    _showAll();
    _gl = null;
  }

  function _removeLayers(gl) {
    if (!gl) return;
    try { if (gl.getLayer(LAYER_CLUSTER_COUNT)) gl.removeLayer(LAYER_CLUSTER_COUNT); } catch (e) {}
    try { if (gl.getLayer(LAYER_CLUSTERS)) gl.removeLayer(LAYER_CLUSTERS); } catch (e) {}
    try { if (gl.getLayer(LAYER_EMOJI)) gl.removeLayer(LAYER_EMOJI); } catch (e) {}
    try { if (gl.getLayer(LAYER_CIRCLE)) gl.removeLayer(LAYER_CIRCLE); } catch (e) {}
    try { if (gl.getSource(SRC)) gl.removeSource(SRC); } catch (e) {}
    gl._manaClusterClickBound = false;
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

  // Recorre también los L.FeatureGroup de MultiPoint: L.geoJSON agrupa los
  // puntos de una feature MultiPoint y el vector-renderer debe encontrarlos.
  function _eachMarker(layer, fn) {
    if (!layer) return;
    if (layer instanceof L.Marker) { fn(layer); return; }
    if (typeof layer.eachLayer === 'function') {
      layer.eachLayer(function (child) { _eachMarker(child, fn); });
    }
  }

  function _hideAll() {
    if (typeof drawnItems === 'undefined') return;
    drawnItems.eachLayer(function (l) { _eachMarker(l, _markerInvisible); });
  }

  function _showMarker(m) {
    if (!m || !m._manaInvisible) return;
    m._manaInvisible = false;
    m.setIcon(m._manaOrigIcon);
    m._manaOrigIcon = null;
    if (m._icon) m._icon.style.opacity = '';
    if (m._shadow) m._shadow.style.display = '';
  }

  function _showAll() {
    if (typeof drawnItems === 'undefined') return;
    drawnItems.eachLayer(function (l) { _eachMarker(l, _showMarker); });
  }

  // ── Emoji images (outline tinted with the feature color so the legend matches) ──

  function _emojiOutlineColor(l) {
    var c = l && l._manaColor;
    return (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c)) ? c : '#ffffff';
  }

  function _emojiImageId(mt, color) {
    return 'emoji-' + mt + '-' + String(color).replace('#', '').toLowerCase();
  }

  function _ensureEmojiImage(gl, mt, color) {
    var id = _emojiImageId(mt, color);
    if (gl.hasImage && gl.hasImage(id)) return id;
    var emoji = _emojiMap[mt];
    if (!emoji) return id;
    var size = 72;
    var cssFont = 'px Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif';
    var cx = size / 2, cy = size / 2 + 1;
    var emojiPx = size * 0.62;
    // Solid silhouette of the emoji (same footprint), tintable to any color.
    function emojiTint(col) {
      var c = document.createElement('canvas');
      c.width = size; c.height = size;
      var g = c.getContext('2d');
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = emojiPx + cssFont;
      g.fillStyle = '#000';
      try { g.fillText(emoji, cx, cy); } catch (e) {}
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = col;
      g.fillRect(0, 0, size, size);
      return c;
    }

    var canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    var ctx = canvas.getContext('2d');
    // Die-cut double contour (AGENTS.md §9): white outer halo, then a ring in the
    // legend color hugging the emoji, then the emoji itself on top.
    function emojiDilate(img, r) {
      var n = Math.max(20, Math.round(r * 8));
      for (var i = 0; i < n; i++) {
        var a = (i / n) * Math.PI * 2;
        ctx.drawImage(img, Math.cos(a) * r, Math.sin(a) * r);
      }
    }
    emojiDilate(emojiTint('#ffffff'), emojiPx * 0.106);
    emojiDilate(emojiTint(color), emojiPx * 0.0625);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = emojiPx + cssFont;
    try { ctx.fillText(emoji, cx, cy); } catch (e) {}
    if (gl.addImage) {
      try { gl.addImage(id, canvas, { pixelRatio: 2, sdf: false }); } catch (e) {}
      try {
        if (!gl.hasImage(id)) {
          var data = ctx.getImageData(0, 0, size, size);
          gl.addImage(id, data, { pixelRatio: 2 });
        }
      } catch (e) {}
    }
    return id;
  }

  // ── Sync point data to GL source ──

  function _sync() {
    if (!_gl || !_gl.getSource(SRC)) return;

    var features = [];
    drawnItems.eachLayer(function (layer) {
      _eachMarker(layer, function (l) {
        var ll = l.getLatLng();
        var lng = ((ll.lng + 180) % 360 + 360) % 360 - 180;
        var mt = l._manaMarkerType || 'circle';
        var emoji = _emojiMap[mt] || '';
        var emojiSize = 0;
        var emojiIcon = '';
        if (emoji) {
          // reuse size from marker icon or compute from Area
          if (l._manaEmojiSize) emojiSize = l._manaEmojiSize;
          else if (typeof _emojiSizeFromArea === 'function' && l._manaProperties && l._manaProperties.Area) {
            emojiSize = _emojiSizeFromArea(_parseArea(l._manaProperties.Area));
          } else emojiSize = 34;
          emojiIcon = _ensureEmojiImage(_gl, mt, _emojiOutlineColor(l));
        }
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lng, ll.lat] },
          properties: {
            name: l._manaName || '',
            color: l._manaColor || '#0ea5e9',
            markerType: mt,
            emoji: emoji,
            emojiIcon: emojiIcon,
            emojiSize: emojiSize,
          },
        });
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
