// ── globe.js ─ 3D Globe (MapLibre GL JS) ──

var globeMap = null;
var spinActive = false;
var spinRAF = null;
var globePopup = null;

// El «espacio» exterior del globo lo dibuja MapLibre con la propiedad `sky`.
// Sin definirla usa un azul oscuro que desentona en modo claro; la fijamos por
// tema para que el fondo del contenedor (--map-bg) y la atmósfera sean coherentes.
function getManaGlobeSky(isDark) {
  return isDark ? {
    'sky-color': '#0b1220',
    'horizon-color': '#1e293b',
    'fog-color': '#1a1a1a',
    'fog-ground-blend': 0.5,
    'horizon-fog-blend': 0.5,
    'sky-horizon-blend': 0.5,
    'atmosphere-blend': 0.5
  } : {
    'sky-color': '#bfe3ff',
    'horizon-color': '#eef7ff',
    'fog-color': '#ffffff',
    'fog-ground-blend': 0.5,
    'horizon-fog-blend': 0.5,
    'sky-horizon-blend': 0.5,
    'atmosphere-blend': 0.5
  };
}

function applyGlobeSky() {
  if (!globeMap || typeof globeMap.setSky !== 'function') return;
  var isDark = (typeof isDarkMapTheme === 'function') && isDarkMapTheme();
  try { globeMap.setSky(getManaGlobeSky(isDark)); } catch (e) {}
}

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
      style: getManaBasemapStyleUrl(isDarkMapTheme()),
      center: [map.getCenter().lng, map.getCenter().lat],
      zoom: Math.max(1.5, Math.min(map.getZoom() - 1, 2.2)),
      maxPitch: 85,
      attributionControl: false
    });

    globeMap.on('load', function() {
      globeMap.resize();
      try { globeMap.setProjection({type: 'globe'}); } catch(e) { console.warn('setProjection:', e); }
      applyGlobeSky();
      syncToGlobe();
      updateCompassIcon();
      if (typeof initGlobeHand === 'function') initGlobeHand();
    });

    globeMap.on('click', onGlobeFeatureClick);
    globeMap.on('rotate', updateCompassIcon);

    setTimeout(function() { if (globeMap) globeMap.resize(); }, 300);
    setGlobeAttributionSignature();

    globeMap.on('mousedown', function() { if (spinActive) toggleSpin(); });
    globeMap.on('touchstart', function() { if (spinActive) toggleSpin(); });
    globeMap.on('zoomend', function(){
      if (typeof _updateTileLabelVisibility === 'function') _updateTileLabelVisibility();
      if (globeMap.getZoom() > 2.6 && typeof activeBase !== 'undefined' && activeBase === 'globe' && !window._autoGlobeLock) {
        // No volver a 2D si a ese zoom el mundo seguiría duplicándose.
        var targetZoom = 2.8;
        if (typeof manaMinZoomWithoutDuplication === 'function') {
          targetZoom = Math.max(targetZoom, Math.ceil(manaMinZoomWithoutDuplication()));
        }
        window._autoGlobeLock = true;
        if (typeof setBaseLayer === 'function') {
          var c = globeMap.getCenter();
          setBaseLayer('map');
          setTimeout(function(){ 
            if (typeof map !== 'undefined' && map.setView) map.setView([c.lat, c.lng], targetZoom, {animate:false});
            window._autoGlobeLock = false;
          }, 550);
        }
      }
    });
  } catch(e) {
    console.error('Error initializing 3D globe:', e);
    manaAlert('Globe 3D init error: ' + e.message, 'error');
  }
}

function setGlobeAttributionSignature() {
  var container = document.getElementById('globe');
  if (!container || container.querySelector('.mana-globe-attribution')) return;
  var attr = document.createElement('div');
  attr.className = 'mana-globe-attribution';
  attr.innerHTML =
    '<a class="maplibre-prefix-link" href="https://maplibre.org" target="_blank" rel="noopener noreferrer">' +
      '<span class="leaflet-prefix-dot" aria-hidden="true"></span>MapLibre' +
    '</a> | <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a>';
  container.appendChild(attr);
}

function updateGlobeBaseStyle(isDark) {
  if (!globeMap || !globeMap.setStyle) return;
  var nextStyle = getManaBasemapStyleUrl(isDark);
  if (globeMap._manaStyleUrl === nextStyle) return;
  globeMap._manaStyleUrl = nextStyle;
  globeMap.setStyle(nextStyle);
  globeMap.once('style.load', function() {
    try { globeMap.setProjection({type: 'globe'}); } catch(e) { console.warn('setProjection:', e); }
    applyGlobeSky();
    syncToGlobe();
  });
}

// Anchors for globe-native labels. Areas use the centre of their bounding box
// (matching the 2D MultiPolygon anchor) instead of one label per polygon part,
// which duplicated names like «Canadá» on every island. Lines take their midpoint.
function _manaGlobeLabelAnchor(geom) {
  if (!geom || !geom.coordinates) return null;
  if (geom.type === 'LineString') {
    var c = geom.coordinates;
    return c.length ? c[Math.floor(c.length / 2)] : null;
  }
  if (geom.type === 'MultiLineString') {
    var l = geom.coordinates[0];
    return l && l.length ? l[Math.floor(l.length / 2)] : null;
  }
  var pts = [];
  (function walk(a) {
    if (!Array.isArray(a)) return;
    if (typeof a[0] === 'number') { pts.push(a); return; }
    for (var i = 0; i < a.length; i++) walk(a[i]);
  })(geom.coordinates);
  if (!pts.length) return null;
  var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (var j = 0; j < pts.length; j++) {
    x0 = Math.min(x0, pts[j][0]); y0 = Math.min(y0, pts[j][1]);
    x1 = Math.max(x1, pts[j][0]); y1 = Math.max(y1, pts[j][1]);
  }
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}

function syncToGlobe() {
  if (!globeMap) return;
  if (globePopup) { globePopup.remove(); globePopup = null; }
  if (globeMap.getLayer('drawn-feature-labels')) globeMap.removeLayer('drawn-feature-labels');
  if (globeMap.getSource('drawn-labels')) globeMap.removeSource('drawn-labels');
  if (globeMap.getLayer('drawn-point-labels')) globeMap.removeLayer('drawn-point-labels');
  if (globeMap.getLayer('drawn-emoji-points')) globeMap.removeLayer('drawn-emoji-points');
  if (globeMap.getLayer('drawn-points')) globeMap.removeLayer('drawn-points');
  if (globeMap.getLayer('drawn-lines')) globeMap.removeLayer('drawn-lines');
  if (globeMap.getLayer('drawn-fills')) globeMap.removeLayer('drawn-fills');
  if (globeMap.getSource('drawn')) globeMap.removeSource('drawn');

  var geo = getEnrichedGeoJSON();
  if (!geo.features.length) return;

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
    emoji_museum:'\uD83C\uDFDB\uFE0F', emoji_hotel:'\uD83C\uDFE8', emoji_store:'\uD83C\uDFEA', emoji_bank:'\uD83C\uDFE6', emoji_factory:'\uD83C\uDFED', emoji_restaurant:'\uD83C\uDF7D\uFE0F',
    emoji_burger:'\uD83C\uDF54', emoji_pizza:'\uD83C\uDF55', emoji_coffee:'\u2615', emoji_beer:'\uD83C\uDF7A', emoji_wine:'\uD83C\uDF77', emoji_cocktail:'\uD83C\uDF79',
    emoji_sushi:'\uD83C\uDF63', emoji_icecream:'\uD83C\uDF66', emoji_rain:'\uD83C\uDF27\uFE0F'
  };
  // Generate raster emoji images tinted with the feature color (outline) so the
  // legend ramp matches the globe; cached per (markerType, color).
  function _globeEnsureEmojiImage(mt, color) {
    var id = 'emoji-' + mt + '-' + String(color).replace('#', '').toLowerCase();
    if (globeMap.hasImage && globeMap.hasImage(id)) return id;
    var emoji = _emojiMap[mt];
    if (!emoji) return id;
    var size = 72;
    var cssFont = 'px Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif';
    var cx = size/2, cy = size/2 + 1;
    var emojiPx = size*0.62;
    // Solid silhouette of the emoji (same footprint), tintable to any color.
    function _globeEmojiTint(col) {
      var c = document.createElement('canvas');
      c.width = size; c.height = size;
      var g = c.getContext('2d');
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = emojiPx + cssFont;
      g.fillStyle = '#000';
      try { g.fillText(emoji, cx, cy); } catch(e){}
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
    function _globeEmojiDilate(img, r) {
      var n = Math.max(20, Math.round(r * 8));
      for (var i = 0; i < n; i++) {
        var a = (i / n) * Math.PI * 2;
        ctx.drawImage(img, Math.cos(a) * r, Math.sin(a) * r);
      }
    }
    _globeEmojiDilate(_globeEmojiTint('#ffffff'), emojiPx * 0.106);
    _globeEmojiDilate(_globeEmojiTint(color), emojiPx * 0.0625);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = emojiPx + cssFont;
    try { ctx.fillText(emoji, cx, cy); } catch(e){}
    if (globeMap.addImage) {
      try { globeMap.addImage(id, canvas, {pixelRatio: 2, sdf: false}); } catch(e){}
      try {
        if (!globeMap.hasImage(id)) {
          var data = ctx.getImageData(0,0,size,size);
          globeMap.addImage(id, data, {pixelRatio: 2});
        }
      } catch(e){}
    }
    return id;
  }
  geo.features.forEach(function(f) {
    f.properties._type = f.geometry.type;
    var mt = f.properties._manaMarkerType;
    if (mt && _emojiMap[mt]) {
      var mc = f.properties._manaColor;
      var outline = (typeof mc === 'string' && /^#[0-9a-f]{3,8}$/i.test(mc)) ? mc : '#ffffff';
      f.properties._manaIcon = _globeEnsureEmojiImage(mt, outline);
      f.properties._manaEmoji = _emojiMap[mt];
      var sz = f.properties._manaEmojiSize;
      if (!sz) {
        var areaStr = f.properties.Area || f.properties.area || '';
        var ha = 0;
        if (typeof _parseArea === 'function') ha = _parseArea(areaStr);
        else if (typeof areaStr === 'string') {
          var s = areaStr.replace(/[~, ]/g,'').toLowerCase();
          var mm = s.match(/^([\d.]+)m/); if (mm) ha = parseFloat(mm[1])*1e6;
          else { mm = s.match(/^([\d.]+)k/); if (mm) ha = parseFloat(mm[1])*1e3; }
        }
        if (ha >= 1e7) f.properties._manaEmojiSize = 42;
        else if (ha >= 1e6) f.properties._manaEmojiSize = 36;
        else if (ha >= 1e5) f.properties._manaEmojiSize = 30;
        else if (ha >= 1e4) f.properties._manaEmojiSize = 26;
        else f.properties._manaEmojiSize = 22;
      }
    }
  });

  globeMap.addSource('drawn', { type: 'geojson', data: geo });

  var _isDarkGlobe = (typeof isDarkMapTheme === 'function' && isDarkMapTheme());
  globeMap.addLayer({
    id: 'drawn-fills', type: 'fill', source: 'drawn',
    filter: ['in', ['get', '_type'], ['literal', ['Polygon', 'MultiPolygon']]],
    paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['coalesce', ['get', '_manaFillOpacity'], _isDarkGlobe ? 0.32 : 0.25] }
  });
  globeMap.addLayer({
    id: 'drawn-lines', type: 'line', source: 'drawn',
    filter: ['in', ['get', '_type'], ['literal', ['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon']]],
    paint: { 'line-color': ['coalesce', ['get', '_manaBorderColor'], ['get', 'color']], 'line-width': 2.5 }
  });
  // Separate circle vs emoji points so fire/water stickers keep their shape in 3D
  globeMap.addLayer({
    id: 'drawn-points', type: 'circle', source: 'drawn',
    filter: ['all', ['==', ['get', '_type'], 'Point'], ['!', ['in', ['get', '_manaMarkerType'], ['literal', ['emoji_fire','emoji_collision','emoji_water','emoji_rain','emoji_star','emoji_heart','emoji_diamond','emoji_home','emoji_building','emoji_tree','emoji_mountain','emoji_beach','emoji_camping','emoji_flower','emoji_sun','emoji_moon','emoji_car','emoji_bus','emoji_train','emoji_plane','emoji_ship','emoji_bike','emoji_walk','emoji_parking','emoji_fuel','emoji_camera','emoji_music','emoji_soccer','emoji_trophy','emoji_ski','emoji_swim','emoji_paint','emoji_game','emoji_warning','emoji_info','emoji_question','emoji_check','emoji_cross','emoji_lock','emoji_key','emoji_target','emoji_pin','emoji_pushpin','emoji_flag','emoji_gift','emoji_money','emoji_bulb','emoji_party','emoji_trash','emoji_package','emoji_hospital','emoji_school','emoji_church','emoji_museum','emoji_hotel','emoji_store','emoji_bank','emoji_factory','emoji_restaurant','emoji_burger','emoji_pizza','emoji_coffee','emoji_beer','emoji_wine','emoji_cocktail','emoji_sushi','emoji_icecream']]]]],
    paint: { 'circle-radius': 7, 'circle-color': ['get', 'color'], 'circle-stroke-color': _isDarkGlobe ? '#1a1a1a' : '#ffffff', 'circle-stroke-width': 2 }
  });
  globeMap.addLayer({
    id: 'drawn-emoji-points', type: 'symbol', source: 'drawn',
    filter: ['all', ['==', ['get', '_type'], 'Point'], ['in', ['get', '_manaMarkerType'], ['literal', ['emoji_fire','emoji_collision','emoji_water','emoji_rain','emoji_star','emoji_heart','emoji_diamond','emoji_home','emoji_building','emoji_tree','emoji_mountain','emoji_beach','emoji_camping','emoji_flower','emoji_sun','emoji_moon','emoji_car','emoji_bus','emoji_train','emoji_plane','emoji_ship','emoji_bike','emoji_walk','emoji_parking','emoji_fuel','emoji_camera','emoji_music','emoji_soccer','emoji_trophy','emoji_ski','emoji_swim','emoji_paint','emoji_game','emoji_warning','emoji_info','emoji_question','emoji_check','emoji_cross','emoji_lock','emoji_key','emoji_target','emoji_pin','emoji_pushpin','emoji_flag','emoji_gift','emoji_money','emoji_bulb','emoji_party','emoji_trash','emoji_package','emoji_hospital','emoji_school','emoji_church','emoji_museum','emoji_hotel','emoji_store','emoji_bank','emoji_factory','emoji_restaurant','emoji_burger','emoji_pizza','emoji_coffee','emoji_beer','emoji_wine','emoji_cocktail','emoji_sushi','emoji_icecream']]]],
    layout: {
      'icon-image': ['get', '_manaIcon'],
      'icon-size': ['interpolate', ['linear'], ['coalesce', ['get', '_manaEmojiSize'], 28], 22, 0.48, 42, 0.95],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-anchor': 'center'
    }
  });
  globeMap.addLayer({
    id: 'drawn-point-labels', type: 'symbol', source: 'drawn',
    filter: ['==', ['get', '_type'], 'Point'],
    layout: {
      'text-field': ['get', 'name'], 'text-size': 11,
      'text-offset': [0, 1.8], 'text-anchor': 'top',
      'text-font': ['Open Sans Regular']
    },
    paint: { 'text-color': _isDarkGlobe ? '#e8e6e3' : '#30363b', 'text-halo-color': _isDarkGlobe ? '#1a1a1a' : '#ffffff', 'text-halo-width': 1.5 }
  });

  // Cartographic labels for areas and lines, drawn by MapLibre so they follow
  // the globe projection instead of warping at the sphere's edge.
  var labelFeatures = [];
  geo.features.forEach(function(f) {
    var g = f && f.geometry;
    if (!g || g.type === 'Point' || g.type === 'MultiPoint') return;
    var props = f.properties || {};
    var ls = props._manaLabelStyle || {};
    if (ls.enabled === false) return;
    var text = props[ls.field] || props.name || '';
    if (!text) return;
    var anchor = _manaGlobeLabelAnchor(g);
    if (!anchor) return;
    labelFeatures.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: anchor },
      properties: {
        text: String(text),
        _labelSize: Number(ls.fontSize) || 11,
        _labelColor: ls.color || (_isDarkGlobe ? '#e8e6e3' : '#30363b'),
        _labelHalo: ls.haloColor || (_isDarkGlobe ? '#1a1a1a' : '#ffffff')
      }
    });
  });
  if (labelFeatures.length) {
    globeMap.addSource('drawn-labels', { type: 'geojson', data: { type: 'FeatureCollection', features: labelFeatures } });
    globeMap.addLayer({
      id: 'drawn-feature-labels', type: 'symbol', source: 'drawn-labels',
      layout: {
        'text-field': ['get', 'text'],
        'text-size': ['get', '_labelSize'],
        'text-font': ['Open Sans Regular'],
        'text-allow-overlap': false,
        'text-ignore-placement': false,
        'text-padding': 3
      },
      paint: {
        'text-color': ['get', '_labelColor'],
        'text-halo-color': ['get', '_labelHalo'],
        'text-halo-width': 1.6
      }
    });
  }

  if (typeof _updateTileLabelVisibility === 'function') _updateTileLabelVisibility();
}

// Popups de datos en el globo: el 3D usa MapLibre (no Leaflet), así que hay que
// consultar las capas renderizadas y reutilizar el mismo HTML que el mapa 2D.
function _globePopupLayers() {
  return ['drawn-fills', 'drawn-lines', 'drawn-points', 'drawn-emoji-points'].filter(function(id) {
    try { return !!globeMap.getLayer(id); } catch (e) { return false; }
  });
}

function _globePopupProps(props) {
  var out = {};
  if (!props) return out;
  Object.keys(props).forEach(function(k) {
    if (k.charAt(0) === '_' || k === 'bbox' || k === 'color' || k === 'markerType') return;
    out[k] = props[k];
  });
  return out;
}

function onGlobeFeatureClick(e) {
  if (!globeMap || (typeof activeBase !== 'undefined' && activeBase !== 'globe')) return;
  var layers = _globePopupLayers();
  if (!layers.length) return;

  var features = [];
  try { features = globeMap.queryRenderedFeatures(e.point, { layers: layers }); } catch (err) { return; }
  if (!features || !features.length) return;

  var f = features[0];
  var props = _globePopupProps(f.properties);
  var geomType = (f.geometry && f.geometry.type) || '';
  var html = (typeof buildAttrPopup === 'function')
    ? buildAttrPopup(props, geomType)
    : '<div class="attr-popup"></div>';

  var lngLat = e.lngLat;
  if (f.geometry && f.geometry.type === 'Point' && f.geometry.coordinates) {
    lngLat = { lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] };
  }

  if (!globePopup) {
    globePopup = new maplibregl.Popup({
      maxWidth: '360px',
      className: 'attr-popup-wrapper',
      closeButton: true,
      closeOnClick: true
    });
  }
  globePopup.setLngLat(lngLat).setHTML(html).addTo(globeMap);
}

function globeZoomIn() {
  if (typeof activeBase !== 'undefined' && activeBase === 'globe' && globeMap) { globeMap.zoomIn(); return; }
  if (typeof map !== 'undefined' && map) map.zoomIn();
}
function globeZoomOut() {
  if (typeof activeBase !== 'undefined' && activeBase === 'globe' && globeMap) { globeMap.zoomOut(); return; }
  if (typeof map !== 'undefined' && map) map.zoomOut();
}

// Orientar al norte (compass del cluster de controles): rumbo y pitch a 0.
function resetGlobeNorth() {
  if (globeMap) globeMap.easeTo({ bearing: 0, pitch: 0, duration: 500 });
}

// Gira el icono del compass para reflejar el rumbo actual.
function updateCompassIcon() {
  var svg = document.querySelector('#pb-north svg');
  if (svg && globeMap) svg.style.transform = 'rotate(' + (-globeMap.getBearing()) + 'deg)';
}

// Pillbar: alterna mapa 2D ↔ globo 3D.
function toggle2D3D() {
  if (typeof setBaseLayer !== 'function') return;
  if (typeof activeBase !== 'undefined' && activeBase === 'globe') {
    if (globePopup) { globePopup.remove(); globePopup = null; }
    setBaseLayer('map');
  } else {
    setBaseLayer('globe');
  }
}

// Refleja el modo actual (2D/3D) en el pillbar inferior. El icono de
// auto-rotación y el norte solo tienen sentido en 3D: en 2D se ocultan.
function updateMapPillbar(base) {
  var btn = document.getElementById('pb-mode');
  var pb = document.getElementById('map-pillbar');
  var is3d = base === 'globe';
  if (btn) {
    var label = btn.querySelector('.pb-mode-label');
    if (label) label.textContent = is3d ? '3D' : '2D';
    btn.classList.toggle('is-3d', is3d);
  }
  if (pb) pb.classList.toggle('is-2d', !is3d);
}

function toggleSpin() {
  spinActive = !spinActive;
  var btn = document.getElementById('pb-spin');
  if (btn) btn.classList.toggle('active', spinActive);
  var ind = document.getElementById('globe-spin-indicator');
  if (ind) ind.style.display = spinActive ? 'inline-flex' : 'none';
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

// Pillbar: lente de cristal que se desliza al botón señalado y que además se
// puede AGARRAR y arrastrar; al soltar encaja en el botón más cercano y
// ejecuta su acción. Etiqueta flotante con la acción (estilo del mapa).
function initPillbarHover() {
  var pb = document.getElementById('map-pillbar');
  if (!pb) return;
  var content = pb.querySelector('.pb-content');
  if (!content || content.querySelector('.pb-knob')) return;
  var knob = document.createElement('span');
  knob.className = 'pb-knob';
  knob.setAttribute('aria-hidden', 'true');
  content.insertBefore(knob, content.firstChild);
  var hint = document.createElement('div');
  hint.className = 'pb-hint';
  hint.setAttribute('aria-hidden', 'true');
  var wrap = document.getElementById('map-wrap') || document.body;
  wrap.appendChild(hint);

  function btns() { return Array.prototype.slice.call(content.querySelectorAll('.pb-btn')).filter(function (b) { return b.offsetParent !== null; }); }
  function toKnob(btn) { knob.style.left = btn.offsetLeft + 'px'; knob.style.width = btn.offsetWidth + 'px'; knob.classList.add('on'); }
  function showHint(btn) {
    var txt = btn.getAttribute('title') || btn.getAttribute('aria-label') || '';
    if (!txt) { hint.classList.remove('on'); return; }
    var wr = wrap.getBoundingClientRect(), pr = pb.getBoundingClientRect(), br = btn.getBoundingClientRect();
    hint.textContent = txt;
    hint.style.left = (br.left - wr.left + br.width / 2) + 'px';
    hint.style.bottom = (wr.bottom - pr.top + 9) + 'px';
    hint.classList.add('on');
  }
  function hide() { knob.classList.remove('on'); hint.classList.remove('on'); }
  function btnAt(e) { var b = e.target && e.target.closest ? e.target.closest('.pb-btn') : null; return (b && content.contains(b)) ? b : null; }
  function nearest(clientX) {
    var bs = btns(), best = null, bd = 1e9;
    bs.forEach(function (b) { var r = b.getBoundingClientRect(); var d = Math.abs((r.left + r.width / 2) - clientX); if (d < bd) { bd = d; best = b; } });
    return best;
  }

  var down = false, moved = false, startX = 0, suppressClick = false;

  // Hover: la lente se desliza al botón + etiqueta.
  content.addEventListener('pointerover', function (e) { if (down) return; var b = btnAt(e); if (b) { toKnob(b); showHint(b); } });
  pb.addEventListener('pointerleave', function () { if (!down) hide(); });

  content.addEventListener('pointerdown', function (e) {
    down = true; moved = false; startX = e.clientX;
  });
  content.addEventListener('pointermove', function (e) {
    if (!down) return;
    if (!moved && Math.abs(e.clientX - startX) < 6) return;
    if (!moved) {
      moved = true;
      // Capturar solo al iniciar el arrastre: en un toque NO se captura, así el
      // click nativo llega al botón y su acción funciona.
      try { content.setPointerCapture(e.pointerId); } catch (err) {}
    }
    pb.classList.add('pb-grabbing');
    hint.classList.remove('on');
    var bs = btns(); if (!bs.length) return;
    var cr = content.getBoundingClientRect();
    var first = bs[0], last = bs[bs.length - 1];
    var kw = parseFloat(knob.style.width) || first.offsetWidth;
    var minL = first.offsetLeft, maxL = last.offsetLeft + last.offsetWidth - kw;
    var l = Math.max(minL, Math.min(e.clientX - cr.left - kw / 2, maxL));
    knob.style.left = l + 'px';
    knob.classList.add('on');
  });
  function endDrag(e) {
    if (!down) return;
    down = false;
    pb.classList.remove('pb-grabbing');
    if (!moved) return; // tap: deja actuar al click nativo
    var b = nearest(e.clientX);
    if (!b) return;
    toKnob(b);
    // El pointerup se captura en .pb-content, así que no hay click nativo en el
    // botón: ejecutamos su acción directamente y silenciamos el click sobrante.
    suppressClick = true;
    setTimeout(function () { suppressClick = false; }, 350);
    var fn = b.onclick;
    if (typeof fn === 'function') { try { fn.call(b, { type: 'click' }); } catch (err) {} }
  }
  content.addEventListener('pointerup', endDrag);
  content.addEventListener('pointercancel', endDrag);
  pb.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('.pb-btn') : null;
    if (suppressClick && t) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  pb.addEventListener('focusin', function (e) { var b = btnAt(e); if (b) { toKnob(b); showHint(b); } });
  pb.addEventListener('focusout', hide);
}

// Estado inicial del pillbar (map-core carga antes que globe.js).
try { updateMapPillbar(typeof activeBase !== 'undefined' ? activeBase : 'map'); } catch (e) {}
try { initPillbarHover(); } catch (e) {}
