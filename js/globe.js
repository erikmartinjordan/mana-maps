// ── globe.js ─ 3D Globe (MapLibre GL JS) ──

var globeMap = null;
var spinActive = false;
var spinRAF = null;

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

    globeMap.addControl(new maplibregl.NavigationControl({
      showCompass: true, showZoom: false
    }), 'top-left');

    globeMap.on('load', function() {
      globeMap.resize();
      try { globeMap.setProjection({type: 'globe'}); } catch(e) { console.warn('setProjection:', e); }
      applyGlobeSky();
      syncToGlobe();
    });

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
  // Generate raster images for emoji so they keep color in the globe (SDF text is monochrome)
  (function(){
    var present = {};
    geo.features.forEach(function(f){ var mt=f.properties._manaMarkerType; if(mt && _emojiMap[mt]) present[mt]=true; });
    Object.keys(present).forEach(function(mt){
      var id = 'emoji-' + mt;
      if (globeMap.hasImage && globeMap.hasImage(id)) return;
      var emoji = _emojiMap[mt];
      var size = 64;
      var canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      var ctx = canvas.getContext('2d');
      ctx.clearRect(0,0,size,size);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = (size*0.72) + 'px Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif';
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 6;
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      try { ctx.strokeText(emoji, size/2, size/2+2); } catch(e){}
      try { ctx.fillText(emoji, size/2, size/2+2); } catch(e){}
      if (globeMap.addImage) {
        try { globeMap.addImage(id, canvas, {pixelRatio: 2, sdf: false}); } catch(e){}
        try {
          if (!globeMap.hasImage(id)) {
            var data = ctx.getImageData(0,0,size,size);
            globeMap.addImage(id, data, {pixelRatio: 2});
          }
        } catch(e){}
      }
    });
  })();
  geo.features.forEach(function(f) {
    f.properties._type = f.geometry.type;
    var mt = f.properties._manaMarkerType;
    if (mt && _emojiMap[mt]) {
      f.properties._manaIcon = 'emoji-' + mt;
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
    filter: ['all', ['==', ['get', '_type'], 'Point'], ['!', ['in', ['get', '_manaMarkerType'], ['literal', ['emoji_fire','emoji_water','emoji_star','emoji_heart','emoji_diamond','emoji_home','emoji_building','emoji_tree','emoji_mountain','emoji_beach','emoji_camping','emoji_flower','emoji_sun','emoji_moon','emoji_car','emoji_bus','emoji_train','emoji_plane','emoji_ship','emoji_bike','emoji_walk','emoji_parking','emoji_fuel','emoji_camera','emoji_music','emoji_soccer','emoji_trophy','emoji_ski','emoji_swim','emoji_paint','emoji_game','emoji_warning','emoji_info','emoji_question','emoji_check','emoji_cross','emoji_lock','emoji_key','emoji_target','emoji_pin','emoji_pushpin','emoji_flag','emoji_gift','emoji_money','emoji_bulb','emoji_party','emoji_trash','emoji_package','emoji_hospital','emoji_school','emoji_church','emoji_museum','emoji_hotel','emoji_store','emoji_bank','emoji_factory','emoji_restaurant','emoji_burger','emoji_pizza','emoji_coffee','emoji_beer','emoji_wine','emoji_cocktail','emoji_sushi','emoji_icecream']]]]],
    paint: { 'circle-radius': 7, 'circle-color': ['get', 'color'], 'circle-stroke-color': _isDarkGlobe ? '#1a1a1a' : '#ffffff', 'circle-stroke-width': 2 }
  });
  globeMap.addLayer({
    id: 'drawn-emoji-points', type: 'symbol', source: 'drawn',
    filter: ['all', ['==', ['get', '_type'], 'Point'], ['in', ['get', '_manaMarkerType'], ['literal', ['emoji_fire','emoji_water','emoji_star','emoji_heart','emoji_diamond','emoji_home','emoji_building','emoji_tree','emoji_mountain','emoji_beach','emoji_camping','emoji_flower','emoji_sun','emoji_moon','emoji_car','emoji_bus','emoji_train','emoji_plane','emoji_ship','emoji_bike','emoji_walk','emoji_parking','emoji_fuel','emoji_camera','emoji_music','emoji_soccer','emoji_trophy','emoji_ski','emoji_swim','emoji_paint','emoji_game','emoji_warning','emoji_info','emoji_question','emoji_check','emoji_cross','emoji_lock','emoji_key','emoji_target','emoji_pin','emoji_pushpin','emoji_flag','emoji_gift','emoji_money','emoji_bulb','emoji_party','emoji_trash','emoji_package','emoji_hospital','emoji_school','emoji_church','emoji_museum','emoji_hotel','emoji_store','emoji_bank','emoji_factory','emoji_restaurant','emoji_burger','emoji_pizza','emoji_coffee','emoji_beer','emoji_wine','emoji_cocktail','emoji_sushi','emoji_icecream']]]],
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
