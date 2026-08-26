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
  var LAYER_LABEL = 'mana-dp-label';

  var _emojiMap = {
    emoji_fire:'\uD83D\uDD25', emoji_water:'\uD83C\uDF0A', emoji_star:'\u2B50', emoji_heart:'\u2764\uFE0F', emoji_diamond:'\uD83D\uDC8E',
    emoji_home:'\uD83C\uDFE0', emoji_building:'\uD83C\uDFE2', emoji_tree:'\uD83C\uDF32', emoji_mountain:'\uD83C\uDFD4\uFE0F', emoji_beach:'\uD83C\uDFD6\uFE0F',
    emoji_camping:'\u26FA', emoji_flower:'\uD83C\uDF38', emoji_sun:'\u2600\uFE0F', emoji_moon:'\uD83C\uDF19', emoji_car:'\uD83D\uDE97', emoji_bus:'\uD83D\uDE8C',
    emoji_train:'\uD83D\uDE82', emoji_plane:'\u2708\uFE0F', emoji_ship:'\uD83D\uDEA2', emoji_bike:'\uD83D\uDEB2', emoji_walk:'\uD83D\uDEB6', emoji_parking:'\uD83C\uDD7F\uFE0F',
    emoji_fuel:'\u26FD', emoji_camera:'\uD83D\uDCF7', emoji_music:'\uD83C\uDFB5', emoji_soccer:'\u26BD', emoji_trophy:'\uD83C\uDFC6', emoji_ski:'\uD83C\uDFBF',
    emoji_swim:'\uD83C\uDFCA', emoji_paint:'\uD83C\uDFA8', emoji_game:'\uD83C\uDFAE', emoji_warning:'\u26A0\uFE0F', emoji_info:'\u2139\uFE0F', emoji_question:'\u2753',
    emoji_check:'\u2705', emoji_cross:'\u274C', emoji_lock:'\uD83D\uDD12', emoji_key:'\uD83D\uDD11', emoji_target:'\uD83C\uDFAF', emoji_pin:'\uD83D\uDCCC',
    emoji_pushpin:'\uD83D\uDCCC', emoji_flag:'\uD83C\uDFC1', emoji_gift:'\uD83C\uDF81', emoji_money:'\uD83D\uDCB0', emoji_bulb:'\uD83D\uDCA1', emoji_party:'\uD83C\uDF89',
    emoji_trash:'\uD83D\uDDD1\uFE0F', emoji_package:'\uD83D\uDCE6', emoji_hospital:'\uD83C\uDFE5', emoji_school:'\uD83C\uDFEB', emoji_church:'\u26EA',
    emoji_museum:'\uD83C\uDFDB\uFE0F', emoji_hotel:'\uD83C\uDFE8', emoji_store:'\uD83C\uDFEA', emoji_bank:'\uD83C\uDFE6', emoji_factory:'\uD83C\uDFED', emoji_restaurant:'\uD83C\uDF7D\uFE0F',
    emoji_burger:'\uD83C\uDF54', emoji_pizza:'\uD83C\uDF55', emoji_coffee:'\u2615', emoji_beer:'\uD83C\uDF7A', emoji_wine:'\uD83C\uDF77', emoji_cocktail:'\uD83C\uDF79',
    emoji_sushi:'\uD83C\uDF63', emoji_icecream:'\uD83C\uDF66'
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
      if (_bootstrapRetries++ < 20) setTimeout(_bootstrap, 200);
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
        if (poll++ < 25) setTimeout(waitStyle, 200);
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

    gl.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

    gl.addLayer({
      id: LAYER_CIRCLE,
      type: 'circle',
      source: SRC,
      filter: ['all', ['==', ['geometry-type'], 'Point'], ['!', ['in', ['get', 'markerType'], ['literal', _emojiKeys]]]],
      paint: {
        'circle-radius': 7,
        'circle-color': ['get', 'color'],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    });

    // Emoji points as colored symbols (keep fire etc. visible in 2D, no marker drift)
    // Generate raster images for emoji so they keep color (SDF text is monochrome)
    (function(){
      Object.keys(_emojiMap).forEach(function(mt){
        var id='emoji-'+mt;
        if(gl.hasImage && gl.hasImage(id)) return;
        var emoji=_emojiMap[mt];
        var size=64;
        var canvas=document.createElement('canvas');
        canvas.width=size; canvas.height=size;
        var ctx=canvas.getContext('2d');
        ctx.clearRect(0,0,size,size);
        ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.font=(size*0.72)+'px Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif';
        ctx.strokeStyle='white'; ctx.lineWidth=6; ctx.lineJoin='round'; ctx.miterLimit=2;
        try{ctx.strokeText(emoji,size/2,size/2+2);}catch(e){}
        try{ctx.fillText(emoji,size/2,size/2+2);}catch(e){}
        if(gl.addImage){
          try{gl.addImage(id,canvas,{pixelRatio:2,sdf:false});}catch(e){}
          try{
            if(!gl.hasImage(id)){
              var data=ctx.getImageData(0,0,size,size);
              gl.addImage(id,data,{pixelRatio:2});
            }
          }catch(e){}
        }
      });
    })();

    gl.addLayer({
      id: LAYER_EMOJI,
      type: 'symbol',
      source: SRC,
      filter: ['in', ['get', 'markerType'], ['literal', _emojiKeys]],
      layout: {
        'icon-image': ['concat', 'emoji-', ['get', 'markerType']],
        'icon-size': ['interpolate', ['linear'], ['coalesce', ['get', 'emojiSize'], 34], 22, 0.38, 34, 0.52, 50, 0.72, 66, 0.92],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-anchor': 'center',
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
    try { if (gl.getLayer(LAYER_EMOJI)) gl.removeLayer(LAYER_EMOJI); } catch (e) {}
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
      var mt = l._manaMarkerType || 'circle';
      var emoji = _emojiMap[mt] || '';
      var emojiSize = 0;
      if (emoji) {
        // reuse size from marker icon or compute from Area
        if (l._manaEmojiSize) emojiSize = l._manaEmojiSize;
        else if (typeof _emojiSizeFromArea === 'function' && l._manaProperties && l._manaProperties.Area) {
          emojiSize = _emojiSizeFromArea(_parseArea(l._manaProperties.Area));
        } else emojiSize = 34;
      }
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, ll.lat] },
        properties: {
          name: l._manaName || '',
          color: l._manaColor || '#0ea5e9',
          markerType: mt,
          emoji: emoji,
          emojiSize: emojiSize,
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
