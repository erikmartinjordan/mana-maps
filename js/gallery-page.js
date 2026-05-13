// ── gallery-page.js ─ renders /gallery ─

(function() {
  const MAPS_COLLECTION = 'maps';
  const firebaseConfig = window.ManaFirebase && window.ManaFirebase.getConfig();


  function escHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function safeDate(tsMs) {
    if (!tsMs) return 'Sin fecha';
    try {
      return new Date(tsMs).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (_) {
      return 'Sin fecha';
    }
  }

  function isFirestoreIndexError(err) {
    if (!err) return false;
    var msg = String(err && err.message ? err.message : err).toLowerCase();
    return msg.indexOf('requires an index') >= 0;
  }

  function getQueryMapId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('slug') || params.get('map');
  }

  async function remoteMaps() {
    if (typeof firebase === 'undefined') return [];
    try {
      if (!firebase.apps || !firebase.apps.length) { if (!firebaseConfig) return []; firebase.initializeApp(firebaseConfig); }
      const db = firebase.firestore();
      // Firestore read: initial published maps list for gallery bootstrap.
      let snap = null;
      try {
        snap = await db.collection(MAPS_COLLECTION)
          .where('isPublished', '==', true)
          .orderBy('createdAt', 'desc')
          .limit(36)
          .get();
      } catch (createdAtErr) {
        if (!isFirestoreIndexError(createdAtErr)) console.warn('gallery remoteMaps createdAt query failed, retrying with createdAtMs:', createdAtErr);
        try {
          snap = await db.collection(MAPS_COLLECTION)
            .where('isPublished', '==', true)
            .orderBy('createdAtMs', 'desc')
            .limit(36)
            .get();
        } catch (createdAtMsErr) {
          if (!isFirestoreIndexError(createdAtMsErr)) console.warn('gallery remoteMaps createdAtMs query failed, retrying without orderBy:', createdAtMsErr);
          snap = await db.collection(MAPS_COLLECTION)
            .where('isPublished', '==', true)
            .limit(100)
            .get();
        }
      }
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      items.sort(function(a, b) {
        const aTs = a.createdAtMs || (a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0);
        const bTs = b.createdAtMs || (b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0);
        return bTs - aTs;
      });
      return items.slice(0, 36);
    } catch (e) {
      console.warn('gallery remoteMaps fallback local:', e);
      return [];
    }
  }

  async function remoteMapById(id) {
    if (!id || typeof firebase === 'undefined') return null;
    try {
      if (!firebase.apps || !firebase.apps.length) { if (!firebaseConfig) return null; firebase.initializeApp(firebaseConfig); }
      const db = firebase.firestore();
      // Firestore read: fetch one published map by id for direct /gallery?slug= links.
      const doc = await db.collection(MAPS_COLLECTION).doc(id).get();
      if (!doc.exists) return null;
      const data = doc.data() || {};
      if (!data.isPublished) return null;
      return { id: doc.id, ...data };
    } catch (e) {
      console.warn('gallery remoteMapById failed:', e);
      return null;
    }
  }

  async function readChunkedPublishedGeo(db, item) {
    if (!db || !item || !item.geojsonChunked || !item.geojsonChunked.chunkCount) return null;
    try {
      const chunkMeta = item.geojsonChunked;
      const chunkSnap = await db.collection(MAPS_COLLECTION)
        .doc(item.slug || item.id)
        .collection(chunkMeta.collection || 'geoChunks')
        .orderBy('index', 'asc')
        .limit(chunkMeta.chunkCount)
        .get();
      if (!chunkSnap || chunkSnap.empty) return null;
      var raw = '';
      chunkSnap.forEach(function(doc) {
        var data = doc.data() || {};
        raw += typeof data.text === 'string' ? data.text : '';
      });
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && parsed.features ? parsed : null;
    } catch (e) {
      console.warn('gallery read chunked geo failed:', e);
      return null;
    }
  }

  function renderCards(items) {
    const list = document.getElementById('gallery-list');
    if (!list) return;
    list.classList.remove('empty-state');
    if (!items.length) {
      list.classList.add('empty-state');
      list.innerHTML = '<div class="empty">Todavía no hay mapas publicados. Comparte uno desde el botón "Compartir" en /map.</div>';
      return;
    }

    list.innerHTML = items.map(function(item) {
      const created = item.createdAtMs || (item.createdAt && item.createdAt.toMillis ? item.createdAt.toMillis() : 0);
      const geo = getPublishedGeo(item);
      const thumb = renderMapPreviewSVG(buildPreviewFromGeo(geo) || item.mapPreview);
      const likes = item.likes || 0;
      const authorHandle = item.authorHandle || '';
      const mapSlug = item.slug || item.id;
      var mode = item.shareMode || 'view';
      return '' +
        '<div class="card">' +
          '<a class="card-link" href="/map/index.html?gallery=' + encodeURIComponent(mapSlug) + '&map=' + encodeURIComponent(mapSlug) + '&room=' + encodeURIComponent(mapSlug) + '&mode=' + encodeURIComponent(mode) + '">' +
            '<div class="thumb">' + thumb + '</div>' +
            '<h3 class="title">' + escHtml(item.title || item.name || 'Mapa sin título') + '</h3>' +
          '</a>' +
          '<div class="meta">' +
            (authorHandle ? '<a class="meta-author" href="/@' + encodeURIComponent(authorHandle) + '">@' + escHtml(authorHandle) + '</a><span>·</span>' : '') +
            '<span>' + (item.featureCount || 0) + ' elementos</span>' +
            '<span>·</span>' +
            '<span>' + safeDate(created) + '</span>' +
          '</div>' +
          '<div class="card-actions">' +
            '<button class="card-action-btn card-like-btn" data-map-id="' + mapSlug + '" data-author="' + authorHandle + '" onclick="galleryLike(this)">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>' +
              '<span class="like-count">' + likes + '</span>' +
            '</button>' +
            '<button class="card-action-btn card-fork-btn" data-map-id="' + mapSlug + '" data-author="' + authorHandle + '" onclick="galleryFork(this)">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v1a2 2 0 01-2 2H8a2 2 0 01-2-2V9"/><line x1="12" y1="12" x2="12" y2="15"/></svg>' +
              '<span>Fork</span>' +
            '</button>' +
          '</div>' +
        '</div>';
    }).join('');
  }

  // ═══════════════════════════════════════════════════════════════
  // LIKE & FORK HANDLERS
  // ═══════════════════════════════════════════════════════════════

  window.galleryLike = async function(btn) {
    var mapId = btn.getAttribute('data-map-id');
    var author = btn.getAttribute('data-author');
    if (!mapId) return;

    // Auth gate: only authenticated users can like
    if (window.manaAuth) {
      var user = window.manaAuth.getCurrentUser();
      if (!user || user.isAnonymous) {
        window.manaAuth.openAuthModal();
        return;
      }
    }

    // Optimistic UI update
    var countEl = btn.querySelector('.like-count');
    var current = parseInt(countEl.textContent || '0', 10);
    countEl.textContent = current + 1;
    btn.classList.add('liked');

    // Persist like
    if (window.manaMaps && author) {
      try {
        await window.manaMaps.likeMap(mapId, author);
      } catch (e) {
        console.warn('like failed:', e);
        countEl.textContent = current; // rollback
        btn.classList.remove('liked');
      }
    }
  };

  window.galleryFork = async function(btn) {
    var mapId = btn.getAttribute('data-map-id');
    var author = btn.getAttribute('data-author');
    if (!mapId || !author) return;

    // Auth gate: only authenticated users can fork
    if (window.manaAuth) {
      var user = window.manaAuth.getCurrentUser();
      if (!user || user.isAnonymous) {
        window.manaAuth.openAuthModal();
        return;
      }
    }

    btn.disabled = true;
    btn.querySelector('span').textContent = '...';

    try {
      if (window.manaMaps) {
        await window.manaMaps.forkMap(mapId, author);
        btn.querySelector('span').textContent = '✓';
        btn.classList.add('forked');
      }
    } catch (e) {
      console.warn('fork failed:', e);
      btn.querySelector('span').textContent = 'Fork';
      btn.disabled = false;
    }
  };

  function getPublishedGeo(item) {
    if (!item) return null;
    if (item.geojson && item.geojson.features) return item.geojson;
    if (item.mapData && item.mapData.features) return item.mapData;
    var geoText = item.geojsonText || item.mapDataText;
    if (typeof geoText !== 'string' || !geoText) return null;
    try {
      var parsed = JSON.parse(geoText);
      return parsed && parsed.features ? parsed : null;
    } catch (e) {
      console.warn('gallery parse geojsonText failed:', e);
      return null;
    }
  }

  async function getPublishedGeoAsync(item) {
    var immediate = getPublishedGeo(item);
    if (immediate) return immediate;
    if (!item || !item.geojsonChunked || !item.geojsonChunked.chunkCount) return null;
    if (item._geojsonLoaded && item._geojsonLoaded.features) return item._geojsonLoaded;
    if (typeof firebase === 'undefined') return null;
    try {
      if (!firebase.apps || !firebase.apps.length) { if (!firebaseConfig) return null; firebase.initializeApp(firebaseConfig); }
      var db = firebase.firestore();
      var chunked = await readChunkedPublishedGeo(db, item);
      if (chunked && chunked.features) {
        item._geojsonLoaded = chunked;
        return chunked;
      }
    } catch (e) {
      console.warn('gallery getPublishedGeoAsync failed:', e);
    }
    return null;
  }

  const PREVIEW_MAX_FEATURES = 96;
  const PREVIEW_MAX_COORDS_PER_GEOMETRY = 40;
  const PREVIEW_GRID_SIZE = 10;
  const PREVIEW_DENSITY_GRID_SIZE = 28;

  function roundPreviewNumber(value) {
    var num = Number(value);
    if (!isFinite(num)) return null;
    return Number(num.toFixed(6));
  }

  function collectCoordPairs(coords, out) {
    if (!Array.isArray(coords)) return;
    if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      var x = roundPreviewNumber(coords[0]);
      var y = roundPreviewNumber(coords[1]);
      if (x !== null && y !== null) out.push([x, y]);
      return;
    }
    coords.forEach(function(child) { collectCoordPairs(child, out); });
  }

  function sampleArrayEvenly(items, maxItems) {
    if (!Array.isArray(items) || items.length <= maxItems) return items || [];
    if (maxItems <= 1) return [items[0]];
    var sampled = [];
    for (var i = 0; i < maxItems; i++) {
      sampled.push(items[Math.round(i * (items.length - 1) / (maxItems - 1))]);
    }
    return sampled;
  }

  function sanitizePreviewPoint(coord) {
    if (!Array.isArray(coord) || coord.length < 2) return null;
    var x = roundPreviewNumber(coord[0]);
    var y = roundPreviewNumber(coord[1]);
    return x === null || y === null ? null : [x, y];
  }

  function sanitizePreviewLine(coords, maxCoords) {
    if (!Array.isArray(coords)) return [];
    return sampleArrayEvenly(coords, maxCoords).map(sanitizePreviewPoint).filter(Boolean);
  }

  function sanitizePreviewPolygon(poly, maxCoords) {
    if (!Array.isArray(poly)) return [];
    return poly.map(function(ring) {
      return sanitizePreviewLine(ring, maxCoords);
    }).filter(function(ring) { return ring.length >= 3; });
  }

  function simplifyPreviewGeometry(geometry) {
    if (!geometry || !geometry.type || !Array.isArray(geometry.coordinates)) return null;
    var coords = geometry.coordinates;
    if (geometry.type === 'Point') {
      coords = sanitizePreviewPoint(coords);
    } else if (geometry.type === 'MultiPoint' || geometry.type === 'LineString') {
      coords = sanitizePreviewLine(coords, PREVIEW_MAX_COORDS_PER_GEOMETRY);
    } else if (geometry.type === 'MultiLineString' || geometry.type === 'Polygon') {
      coords = sanitizePreviewPolygon(coords, PREVIEW_MAX_COORDS_PER_GEOMETRY);
    } else if (geometry.type === 'MultiPolygon') {
      coords = coords.map(function(poly) {
        return sanitizePreviewPolygon(poly, PREVIEW_MAX_COORDS_PER_GEOMETRY);
      }).filter(function(poly) { return poly.length; });
    } else {
      return null;
    }
    if (!coords || (Array.isArray(coords) && !coords.length)) return null;
    return { type: geometry.type, coordinatesText: JSON.stringify(coords) };
  }

  function featureCenter(feature) {
    var geom = feature && feature.geometry;
    if (!geom || !Array.isArray(geom.coordinates)) return null;
    var coords = [];
    collectCoordPairs(geom.coordinates, coords);
    if (!coords.length) return null;
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    coords.forEach(function(c) {
      minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0]);
      minY = Math.min(minY, c[1]); maxY = Math.max(maxY, c[1]);
    });
    return isFinite(minX) && isFinite(maxX) && isFinite(minY) && isFinite(maxY)
      ? [(minX + maxX) / 2, (minY + maxY) / 2]
      : null;
  }

  function previewFeatureIndexes(features, maxFeatures, bbox) {
    var count = Array.isArray(features) ? features.length : 0;
    if (!count) return [];
    var target = Math.min(count, maxFeatures);
    if (count <= target) return features.map(function(_, index) { return index; });

    var minX = Number(bbox && bbox[0]); var minY = Number(bbox && bbox[1]);
    var maxX = Number(bbox && bbox[2]); var maxY = Number(bbox && bbox[3]);
    if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
      return sampleArrayEvenly(features.map(function(_, index) { return index; }), target);
    }
    var spanX = Math.max(maxX - minX, 1e-9);
    var spanY = Math.max(maxY - minY, 1e-9);
    var buckets = {};

    features.forEach(function(feature, index) {
      var center = featureCenter(feature);
      if (!center) return;
      var gx = Math.max(0, Math.min(PREVIEW_GRID_SIZE - 1, Math.floor(((center[0] - minX) / spanX) * PREVIEW_GRID_SIZE)));
      var gy = Math.max(0, Math.min(PREVIEW_GRID_SIZE - 1, Math.floor(((center[1] - minY) / spanY) * PREVIEW_GRID_SIZE)));
      var key = gx + ':' + gy;
      var cellCenterX = minX + ((gx + 0.5) / PREVIEW_GRID_SIZE) * spanX;
      var cellCenterY = minY + ((gy + 0.5) / PREVIEW_GRID_SIZE) * spanY;
      var dist = Math.pow(center[0] - cellCenterX, 2) + Math.pow(center[1] - cellCenterY, 2);
      if (!buckets[key]) buckets[key] = [];
      buckets[key].push({ index: index, dist: dist });
    });

    var bucketList = Object.keys(buckets).sort().map(function(key) {
      return buckets[key].sort(function(a, b) { return a.dist - b.dist; });
    });
    if (!bucketList.length) return sampleArrayEvenly(features.map(function(_, index) { return index; }), target);

    var selected = [];
    var used = {};
    var cursor = 0;
    while (selected.length < target) {
      var added = false;
      bucketList.forEach(function(bucket) {
        if (selected.length >= target) return;
        var candidate = bucket[cursor];
        if (candidate && !used[candidate.index]) {
          used[candidate.index] = true;
          selected.push(candidate.index);
          added = true;
        }
      });
      if (!added) break;
      cursor++;
    }
    if (selected.length < target) {
      sampleArrayEvenly(features.map(function(_, index) { return index; }), target).forEach(function(index) {
        if (selected.length < target && !used[index]) {
          used[index] = true;
          selected.push(index);
        }
      });
    }
    return selected.sort(function(a, b) { return a - b; });
  }

  function buildDensityCells(features, bbox) {
    var minX = Number(bbox && bbox[0]); var minY = Number(bbox && bbox[1]);
    var maxX = Number(bbox && bbox[2]); var maxY = Number(bbox && bbox[3]);
    if (!Array.isArray(features) || !isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return [];
    var spanX = Math.max(maxX - minX, 1e-9);
    var spanY = Math.max(maxY - minY, 1e-9);
    var cells = {};
    features.forEach(function(feature) {
      var center = featureCenter(feature);
      if (!center) return;
      var x = Math.max(0, Math.min(PREVIEW_DENSITY_GRID_SIZE - 1, Math.floor(((center[0] - minX) / spanX) * PREVIEW_DENSITY_GRID_SIZE)));
      var y = Math.max(0, Math.min(PREVIEW_DENSITY_GRID_SIZE - 1, Math.floor(((maxY - center[1]) / spanY) * PREVIEW_DENSITY_GRID_SIZE)));
      var key = x + ':' + y;
      var props = feature && feature.properties ? feature.properties : {};
      var color = props._manaColor || props.color || '#0ea5e9';
      if (!cells[key]) cells[key] = { x: x, y: y, n: 0, c: color };
      cells[key].n += 1;
    });
    return Object.keys(cells).map(function(key) { return cells[key]; });
  }

  function encodePreviewGeometry(geometry) {
    return simplifyPreviewGeometry(geometry);
  }

  function buildPreviewFromGeo(geo) {
    if (!geo || !Array.isArray(geo.features) || !geo.features.length) return null;
    var points = [];
    geo.features.forEach(function(feature) {
      var geom = feature && feature.geometry;
      if (!geom || !Array.isArray(geom.coordinates)) return;
      collectCoordPairs(geom.coordinates, points);
    });
    if (!points.length) return null;
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    points.forEach(function(c) {
      var x = Number(c[0]), y = Number(c[1]);
      if (!isFinite(x) || !isFinite(y)) return;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    });
    if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minY) || !isFinite(maxY)) return null;
    var bbox = [minX, minY, maxX, maxY];
    var isLargePreview = geo.features.length > PREVIEW_MAX_FEATURES;
    var cells = isLargePreview ? buildDensityCells(geo.features, bbox) : [];
    var entries = isLargePreview ? [] : previewFeatureIndexes(geo.features, PREVIEW_MAX_FEATURES, bbox).map(function(index) {
      var feature = geo.features[index];
      var props = feature && feature.properties ? feature.properties : {};
      return {
        geometry: encodePreviewGeometry(feature ? feature.geometry : null),
        color: props._manaColor || props.color || '#0ea5e9'
      };
    }).filter(function(entry) { return !!entry.geometry; });
    return (cells.length || entries.length) ? {
      bbox: bbox,
      kind: cells.length ? 'density-grid' : 'geometry',
      gridSize: cells.length ? PREVIEW_DENSITY_GRID_SIZE : null,
      cells: cells.length ? cells : null,
      features: entries
    } : null;
  }

  function renderMapPreviewSVG(preview) {
    if (!preview || !Array.isArray(preview.bbox) || !Array.isArray(preview.features)) return '';
    var bbox = preview.bbox;
    var minX = Number(bbox[0]); var minY = Number(bbox[1]); var maxX = Number(bbox[2]); var maxY = Number(bbox[3]);
    if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return '';
    var spanX = Math.max(maxX - minX, 1e-9);
    var spanY = Math.max(maxY - minY, 1e-9);
    var pad = 0.12;
    function toX(x) { return (((x - minX) / spanX) * (1 - 2 * pad) + pad) * 100; }
    function toY(y) { return (((maxY - y) / spanY) * (1 - 2 * pad) + pad) * 100; }
    function color(value) { return /^#[0-9a-f]{3,8}$/i.test(value || '') ? value : '#0ea5e9'; }
    function renderDensityCells() {
      if (!Array.isArray(preview.cells) || !preview.cells.length) return '';
      var grid = Math.max(1, Number(preview.gridSize) || 28);
      var size = 100 / grid;
      var maxCount = preview.cells.reduce(function(max, cell) {
        var count = Number(cell && cell.n) || 1;
        return Math.max(max, count);
      }, 1);
      return preview.cells.map(function(cell) {
        var x = Number(cell && cell.x); var y = Number(cell && cell.y);
        if (!isFinite(x) || !isFinite(y)) return '';
        var count = Math.max(1, Number(cell.n) || 1);
        var opacity = Math.min(0.88, 0.28 + (count / maxCount) * 0.48);
        return '<rect x="' + (x * size).toFixed(2) + '" y="' + (y * size).toFixed(2) + '" width="' + Math.max(size, 1.2).toFixed(2) + '" height="' + Math.max(size, 1.2).toFixed(2) + '" rx="0.9" fill="' + color(cell.c) + '" fill-opacity="' + opacity.toFixed(2) + '"/>';
      }).join('');
    }
    function decodePreviewGeometry(geom) {
      if (!geom) return null;
      if (Array.isArray(geom.coordinates)) return geom;
      if (typeof geom.coordinatesText === 'string' && geom.coordinatesText) {
        try { return { type: geom.type, coordinates: JSON.parse(geom.coordinatesText) }; }
        catch (e) { return null; }
      }
      return null;
    }
    function pointToString(coord) {
      if (!Array.isArray(coord) || coord.length < 2) return '';
      var x = Number(coord[0]); var y = Number(coord[1]);
      if (!isFinite(x) || !isFinite(y)) return '';
      return toX(x).toFixed(2) + ',' + toY(y).toFixed(2);
    }
    function lineToPoints(line) {
      if (!Array.isArray(line)) return '';
      return line.map(pointToString).filter(Boolean).join(' ');
    }
    function ringToPath(ring) {
      if (!Array.isArray(ring) || !ring.length) return '';
      var parts = ring.map(function(c, idx) {
        var point = pointToString(c);
        if (!point) return '';
        return (idx ? 'L' : 'M') + point.replace(',', ' ');
      }).filter(Boolean);
      return parts.length ? parts.join(' ') + ' Z' : '';
    }
    function renderPolygon(poly, stroke) {
      if (!Array.isArray(poly) || !poly.length) return '';
      var path = ringToPath(poly[0]);
      return path ? '<path d="' + path + '" fill="' + stroke + '" fill-opacity="0.2" stroke="' + stroke + '" stroke-width="1.3"/>' : '';
    }
    var body = renderDensityCells();
    preview.features.forEach(function(entry) {
      var geom = decodePreviewGeometry(entry && entry.geometry);
      if (!geom) return;
      var stroke = color(entry.color);
      if (geom.type === 'Point' && Array.isArray(geom.coordinates)) {
        var p = pointToString(geom.coordinates).split(',');
        if (p.length === 2) body += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="2.7" fill="' + stroke + '" fill-opacity="0.9"/>';
      } else if (geom.type === 'MultiPoint' && Array.isArray(geom.coordinates)) {
        geom.coordinates.forEach(function(coord) {
          var p = pointToString(coord).split(',');
          if (p.length === 2) body += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="2.3" fill="' + stroke + '" fill-opacity="0.9"/>';
        });
      } else if (geom.type === 'LineString' && Array.isArray(geom.coordinates)) {
        var pts = lineToPoints(geom.coordinates);
        if (pts) body += '<polyline points="' + pts + '" fill="none" stroke="' + stroke + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
      } else if (geom.type === 'MultiLineString' && Array.isArray(geom.coordinates)) {
        geom.coordinates.forEach(function(line) {
          var pts = lineToPoints(line);
          if (pts) body += '<polyline points="' + pts + '" fill="none" stroke="' + stroke + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
        });
      } else if (geom.type === 'Polygon' && Array.isArray(geom.coordinates)) {
        body += renderPolygon(geom.coordinates, stroke);
      } else if (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates)) {
        geom.coordinates.forEach(function(poly) { body += renderPolygon(poly, stroke); });
      }
    });
    if (!body) return '';
    return '<svg class="thumb-preview" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' + body + '</svg>';
  }

  async function showFeatured(item) {
    const geo = await getPublishedGeoAsync(item);
    if (!item || !geo || !window.L) return;

    const wrap = document.getElementById('featured-wrap');
    const meta = document.getElementById('featured-meta');
    const target = document.getElementById('featured-map');
    if (!wrap || !meta || !target) return;
    wrap.style.display = 'block';

    const map = L.map('featured-map', { zoomControl: false });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    const layer = L.geoJSON(geo).addTo(map);
    const bounds = layer.getBounds();
    if (bounds && bounds.isValid()) map.fitBounds(bounds.pad(0.2));

    const created = item.createdAtMs || (item.createdAt && item.createdAt.toMillis ? item.createdAt.toMillis() : 0);
    meta.textContent = (item.name || 'Mapa sin título') + ' · ' + (item.featureCount || 0) + ' elementos · ' + safeDate(created);
  }

  async function init() {
    const merged = await remoteMaps();
    merged.sort(function(a, b) {
      const aTs = a.createdAtMs || (a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0);
      const bTs = b.createdAtMs || (b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0);
      return bTs - aTs;
    });

    renderCards(merged);
    subscribeToPublishedMaps(merged);

    const mapId = getQueryMapId();
    if (!mapId) return;
    let selected = merged.find(function(i) { return (i.slug || i.id) === mapId; });
    if (!selected) {
      selected = await remoteMapById(mapId);
      if (selected) {
        merged.unshift(selected);
        renderCards(merged);
      }
    }
    if (selected) await showFeatured(selected);
  }

  init();

  function subscribeToPublishedMaps(mergedList) {
    if (typeof firebase === 'undefined') return;
    try {
      if (!firebase.apps || !firebase.apps.length) { if (!firebaseConfig) return null; firebase.initializeApp(firebaseConfig); }
      const db = firebase.firestore();
      // Firestore read: real-time gallery listener for published maps only.
      var baseQuery = db.collection(MAPS_COLLECTION)
        .where('isPublished', '==', true);

      function applySnapshot(snap) {
        const remote = snap.docs.map(function(d) { return { id: d.id, ...d.data() }; });
        remote.sort(function(a, b) {
          const aTs = a.createdAtMs || (a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0);
          const bTs = b.createdAtMs || (b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0);
          return bTs - aTs;
        });
        mergedList.length = 0;
        mergedList.push.apply(mergedList, remote.slice(0, 36));
        renderCards(mergedList);
      }

      baseQuery
        .orderBy('createdAt', 'desc')
        .limit(36)
        .onSnapshot(applySnapshot, function(e) {
          if (!isFirestoreIndexError(e)) {
            console.warn('gallery realtime subscribe failed:', e);
          }
          baseQuery.limit(100).onSnapshot(applySnapshot, function(fallbackErr) {
            console.warn('gallery realtime fallback subscribe failed:', fallbackErr);
          });
        });
    } catch (e) {
      console.warn('gallery realtime unavailable:', e);
    }
  }
})();
