// ── landing-map-preview.js ─
// Pinta el mapa real de la landing (MapLibre + basemap + capas de datos) con el
// mismo lenguaje visual que la galería. Lee `preview.json` del mismo directorio:
// datos locales, sin Firestore y sin mostrar la tarjeta OG en la cabecera.
(function () {
  'use strict';
  if (window.__manaLandingMapPreview) return;
  window.__manaLandingMapPreview = true;

  var body = document.body;
  var slug = body && body.getAttribute('data-map-slug');
  var media = document.getElementById('map-plate-media');
  var container = document.getElementById('map-plate-map');
  var loading = media && media.querySelector('.map-plate__loading');
  var cta = document.querySelector('.map-plate__cta');
  if (!slug || !media || !container) return;

  var CLUSTER_MIN_POINTS = 120;
  var CLUSTER_MAX_ZOOM = 12;
  var CLUSTER_RADIUS = 55;
  var CLUSTER_ICON = 'mana-cluster-blob';
  var BLOB_PATH = 'M42.3,-74.7C55.1,-65.8,66.1,-55.2,74.7,-42.4C83.2,-29.7,89.3,-14.8,89.7,0.2C90,15.2,84.6,30.5,74.3,40.2C64,49.8,48.7,54,35.6,62.1C22.4,70.2,11.2,82.3,-0.8,83.6C-12.7,84.9,-25.4,75.4,-36.1,65.9C-46.9,56.4,-55.6,46.8,-61.3,35.8C-66.9,24.8,-69.5,12.4,-72,-1.4C-74.5,-15.3,-76.9,-30.5,-70.9,-41C-64.9,-51.4,-50.6,-57.1,-37.4,-65.8C-24.2,-74.5,-12.1,-86.1,1.3,-88.4C14.7,-90.7,29.5,-83.6,42.3,-74.7Z';
  var PREVIEW_TYPE_NAMES = {
    1: 'Point', 2: 'MultiPoint', 3: 'LineString',
    4: 'MultiLineString', 5: 'Polygon', 6: 'MultiPolygon'
  };

  function setLoadingMessage(text) {
    if (loading) loading.textContent = text;
  }

  function fetchPreview() {
    var url = '/gallery/' + encodeURIComponent(slug) + '/preview.json';
    return fetch(url).then(function (res) {
      return res.ok ? res.json() : null;
    }).catch(function () { return null; });
  }

  var _maplibrePromise = null;
  function ensureMapLibre() {
    if (window.maplibregl) return Promise.resolve(true);
    if (_maplibrePromise) return _maplibrePromise;
    _maplibrePromise = new Promise(function (resolve) {
      if (!document.getElementById('maplibre-css')) {
        var css = document.createElement('link');
        css.id = 'maplibre-css';
        css.rel = 'stylesheet';
        css.href = 'https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.css';
        document.head.appendChild(css);
      }
      var script = document.createElement('script');
      script.src = 'https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.js';
      script.async = true;
      script.onload = function () { resolve(!!window.maplibregl); };
      script.onerror = function () { _maplibrePromise = null; resolve(false); };
      document.head.appendChild(script);
    });
    return _maplibrePromise;
  }

  function densityGridGeo(preview) {
    var bbox = preview.b;
    var grid = Math.max(1, Number(preview.g) || 28);
    var minX = Number(bbox[0]), minY = Number(bbox[1]);
    var maxX = Number(bbox[2]), maxY = Number(bbox[3]);
    if (![minX, minY, maxX, maxY].every(isFinite)) return [];
    var cellW = (maxX - minX) / grid;
    var cellH = (maxY - minY) / grid;
    return (preview.c || []).map(function (cell) {
      var x = Number(cell && cell[0]), y = Number(cell && cell[1]);
      if (!isFinite(x) || !isFinite(y)) return null;
      var x0 = minX + x * cellW, x1 = x0 + cellW;
      var y1 = maxY - y * cellH, y0 = y1 - cellH;
      return {
        type: 'Feature',
        properties: {
          _manaColor: cell[3],
          _manaFillOpacity: 0.7,
          _manaBorderColor: 'rgba(255,255,255,.55)'
        },
        geometry: { type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] }
      };
    }).filter(Boolean);
  }

  function compactToGeo(preview) {
    if (!preview) return null;
    if (preview.k === 'd' && Array.isArray(preview.c) && preview.c.length) {
      var cells = densityGridGeo(preview);
      return cells.length ? { type: 'FeatureCollection', features: cells } : null;
    }
    var features = [];
    (preview.f || []).forEach(function (entry) {
      var type = PREVIEW_TYPE_NAMES[entry && entry[0]];
      if (!type || !Array.isArray(entry[1])) return;
      var props = {
        _manaColor: entry[2],
        _manaBorderColor: '#ffffff'
      };
      if (typeof entry[3] === 'number') {
        props._manaFillOpacity = entry[3];
        props._manaOpacity = entry[3];
      }
      features.push({
        type: 'Feature',
        properties: props,
        geometry: { type: type, coordinates: entry[1] }
      });
    });
    return features.length ? { type: 'FeatureCollection', features: features } : null;
  }

  function collectBounds(geo) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    function walk(coords) {
      if (!coords) return;
      if (typeof coords[0] === 'number') {
        var x = Number(coords[0]), y = Number(coords[1]);
        if (!isFinite(x) || !isFinite(y)) return;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        return;
      }
      for (var i = 0; i < coords.length; i++) walk(coords[i]);
    }
    ((geo && geo.features) || []).forEach(function (f) {
      if (f && f.geometry) walk(f.geometry.coordinates);
    });
    return (isFinite(minX) && isFinite(maxX) && isFinite(minY) && isFinite(maxY))
      ? [[minX, minY], [maxX, maxY]]
      : null;
  }

  function collectPointFeatures(features) {
    var out = [];
    for (var i = 0; i < features.length; i++) {
      var f = features[i];
      var g = f && f.geometry;
      if (!g) continue;
      var props = f.properties || {};
      if (g.type === 'Point') {
        out.push({ type: 'Feature', properties: props, geometry: g });
      } else if (g.type === 'MultiPoint') {
        for (var j = 0; j < g.coordinates.length; j++) {
          out.push({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: g.coordinates[j] } });
        }
      }
    }
    return out;
  }

  function ensureClusterIcon(map, cb) {
    if (map.hasImage(CLUSTER_ICON)) return cb();
    try {
      if (typeof Path2D !== 'function') return cb(new Error('Path2D no disponible'));
      var size = 128;
      var canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      var ctx = canvas.getContext('2d');
      var path = new Path2D(BLOB_PATH);
      ctx.translate(size / 2, size / 2);
      ctx.scale(size / 200, size / 200);
      ctx.fillStyle = '#30363B';
      ctx.fill(path);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(1,1,1,0.35)';
      ctx.stroke(path);
      if (typeof createImageBitmap === 'function') {
        createImageBitmap(canvas).then(function (image) {
          try {
            if (!map.hasImage(CLUSTER_ICON)) map.addImage(CLUSTER_ICON, image);
            cb();
          } catch (e) { cb(e); }
        }).catch(function (e) { cb(e); });
      } else {
        if (!map.hasImage(CLUSTER_ICON)) map.addImage(CLUSTER_ICON, ctx.getImageData(0, 0, size, size));
        cb();
      }
    } catch (e) { cb(e); }
  }

  function addClusters(map, points, colorExpr) {
    var sourceId = 'slug-cluster-data';
    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: points },
        cluster: true,
        clusterMaxZoom: CLUSTER_MAX_ZOOM,
        clusterRadius: CLUSTER_RADIUS
      });
    }
    function addPointLayer() {
      if (map.getLayer('slug-points')) return;
      map.addLayer({
        id: 'slug-points', type: 'circle', source: sourceId,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-radius': 6,
          'circle-color': colorExpr,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': ['coalesce', ['get', '_manaOpacity'], 0.95]
        }
      });
    }
    function addClusterLayers() {
      if (map.getLayer('slug-clusters')) return;
      map.addLayer({
        id: 'slug-clusters', type: 'symbol', source: sourceId,
        filter: ['has', 'point_count'],
        layout: {
          'icon-image': CLUSTER_ICON,
          'icon-size': ['interpolate', ['linear'], ['get', 'point_count'], 2, 0.22, 10, 0.27, 50, 0.34, 200, 0.42, 1000, 0.52],
          'icon-anchor': 'center',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true
        }
      });
      map.addLayer({
        id: 'slug-cluster-count', type: 'symbol', source: sourceId,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['Noto Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['get', 'point_count'], 2, 10, 10, 11, 50, 13, 200, 15, 1000, 17],
          'text-anchor': 'center',
          'text-allow-overlap': true,
          'text-ignore-placement': true
        },
        paint: { 'text-color': '#ffffff' }
      });
    }
    function addFallbackClusterLayers() {
      if (map.getLayer('slug-clusters')) return;
      map.addLayer({
        id: 'slug-clusters', type: 'circle', source: sourceId,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#30363B',
          'circle-radius': ['interpolate', ['linear'], ['get', 'point_count'], 2, 13, 10, 17, 50, 22, 200, 28, 1000, 36],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': 'rgba(255,255,255,.7)'
        }
      });
      map.addLayer({
        id: 'slug-cluster-count', type: 'symbol', source: sourceId,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['Noto Sans Bold'],
          'text-size': 12,
          'text-anchor': 'center',
          'text-allow-overlap': true,
          'text-ignore-placement': true
        },
        paint: { 'text-color': '#ffffff' }
      });
    }
    ensureClusterIcon(map, function (err) {
      if (err) addFallbackClusterLayers();
      else addClusterLayers();
      addPointLayer();
    });
  }

  function addLayers(map, geo) {
    var features = (geo && geo.features) || [];
    var pointFeatures = collectPointFeatures(features);
    var useClusters = pointFeatures.length >= CLUSTER_MIN_POINTS;

    if (map.getSource('slug-data')) map.getSource('slug-data').setData(geo);
    else map.addSource('slug-data', { type: 'geojson', data: geo });

    var colorExpr = ['coalesce', ['get', '_manaColor'], ['get', 'color'], '#0ea5e9'];
    var isPolygon = ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']];
    var isLine = ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'MultiLineString']];
    var isPoint = ['any', ['==', ['geometry-type'], 'Point'], ['==', ['geometry-type'], 'MultiPoint']];

    map.addLayer({
      id: 'slug-fills', type: 'fill', source: 'slug-data', filter: isPolygon,
      paint: { 'fill-color': colorExpr, 'fill-opacity': ['coalesce', ['get', '_manaFillOpacity'], 0.24] }
    });
    map.addLayer({
      id: 'slug-fill-outlines', type: 'line', source: 'slug-data', filter: isPolygon,
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': ['coalesce', ['get', '_manaBorderColor'], '#ffffff'],
        'line-width': 1,
        'line-opacity': 0.85
      }
    });
    map.addLayer({
      id: 'slug-line-casing', type: 'line', source: 'slug-data', filter: isLine,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': 3.4, 'line-opacity': 0.8 }
    });
    map.addLayer({
      id: 'slug-lines', type: 'line', source: 'slug-data', filter: isLine,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': colorExpr,
        'line-width': ['coalesce', ['get', '_manaWeight'], 2],
        'line-opacity': ['coalesce', ['get', '_manaOpacity'], 0.92]
      }
    });

    if (useClusters) {
      addClusters(map, pointFeatures, colorExpr);
    } else {
      map.addLayer({
        id: 'slug-points', type: 'circle', source: 'slug-data', filter: isPoint,
        paint: {
          'circle-radius': 6,
          'circle-color': colorExpr,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': ['coalesce', ['get', '_manaOpacity'], 0.95]
        }
      });
    }

    try {
      (map.getStyle().layers || []).forEach(function (l) {
        if (l.type === 'symbol' && l.layout && l.layout['text-field']) {
          try { map.setLayoutProperty(l.id, 'visibility', 'none'); } catch (e) {}
        }
      });
    } catch (e) {}
  }

  function reveal() {
    media.classList.add('is-live');
    if (loading) loading.hidden = true;
  }

  function collapseAttribution() {
    try {
      var el = container.querySelector('.maplibregl-ctrl-attrib');
      if (!el) return;
      el.classList.remove('maplibregl-compact-show');
      el.removeAttribute('open');
    } catch (e) {}
  }

  fetchPreview().then(function (preview) {
    var geo = compactToGeo(preview);
    if (!geo || !geo.features.length) {
      setLoadingMessage('Vista previa no disponible');
      return;
    }
    ensureMapLibre().then(function (maplibreReady) {
      if (!maplibreReady) {
        setLoadingMessage('No se pudo cargar el mapa');
        return;
      }

      var styleUrl = window.MANA_BASEMAPS
        ? window.MANA_BASEMAPS.getStyleUrl(false)
        : 'https://tiles.openfreemap.org/styles/positron';

      var map = new maplibregl.Map({
        container: container,
        style: styleUrl,
        center: [0, 25],
        zoom: 1.4,
        minZoom: 1,
        maxZoom: 18,
        maxBounds: [[-179.9, -86], [179.9, 86]],
        renderWorldCopies: false,
        interactive: false,
        attributionControl: { compact: true }
      });

      var bounds = collectBounds(geo);
      if (bounds) {
        map.fitBounds(bounds, { padding: { top: 32, bottom: 32, left: 40, right: 40 }, duration: 0, maxZoom: 11 });
      }

      map.on('load', function () {
        addLayers(map, geo);
        collapseAttribution();
        map.once('idle', function () { collapseAttribution(); reveal(); });
        setTimeout(reveal, 2500);
      });
      map.on('error', function (e) {
        if (e && e.error && e.error.status === 404) return;
        console.warn('landing map error:', e && e.error ? e.error.message : e);
      });
    });
  }).catch(function () {
    setLoadingMessage('Vista previa no disponible');
  });

  media.addEventListener('click', function (e) {
    if (e.target.closest('.maplibregl-ctrl')) return;
    if (cta && cta.getAttribute('href')) window.location.href = cta.getAttribute('href');
  });
})();
