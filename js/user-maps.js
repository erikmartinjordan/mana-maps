// ── user-maps.js ─ Personal map CRUD under /users/{handle}/maps/{mapId} ──
// Depends on: auth.js (window.manaAuth)
// Exposes: window.manaMaps

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════
  // CONSTANTS
  // ═══════════════════════════════════════════════════════════════

  const USERS_COL = 'users';
  const PUBLIC_MAPS_COL = 'maps';
  const FIRESTORE_FIELD_MAX_BYTES = 1048487;

  // ═══════════════════════════════════════════════════════════════
  // FIREBASE HELPERS
  // ═══════════════════════════════════════════════════════════════

  function getDb() {
    if (typeof firebase === 'undefined') return null;
    return firebase.firestore();
  }

  function txt(es, en) {
    return (typeof LANG !== 'undefined' && LANG === 'en') ? en : es;
  }

  function _sanitizePlainObject(value) {
    try { return JSON.parse(JSON.stringify(value)); }
    catch (e) { return null; }
  }

  function _parseGeoJSONText(text) {
    if (typeof text !== 'string' || !text) return null;
    try {
      const parsed = JSON.parse(text);
      return parsed && parsed.features ? parsed : null;
    } catch (e) {
      console.warn('parse stored GeoJSON text failed:', e);
      return null;
    }
  }

  function _getHandle() {
    return window.manaAuth ? window.manaAuth.getHandle() : null;
  }

  function _getUser() {
    return window.manaAuth ? window.manaAuth.getCurrentUser() : null;
  }

  // ═══════════════════════════════════════════════════════════════
  // SAVE MAP
  // ═══════════════════════════════════════════════════════════════

  /**
   * Save a map to /users/{handle}/maps/{mapId}
   * @param {object} options
   * @param {string} options.mapId - existing ID to update, or null for new
   * @param {string} options.title - map title
   * @param {string} options.description - optional description
   * @param {object} options.geojson - full GeoJSON FeatureCollection
   * @returns {Promise<{mapId: string, isNew: boolean}>}
   */
  async function saveMap(options) {
    const handle = _getHandle();
    if (!handle) throw new Error('not-authenticated');

    const db = getDb();
    if (!db) throw new Error('firestore-unavailable');

    const { title, description, geojson } = options;
    let mapId = options.mapId;
    const isNew = !mapId;

    if (!geojson || !geojson.features || !geojson.features.length) {
      throw new Error('empty-map');
    }

    if (isNew) {
      mapId = _generateMapId(title);
    }

    const sanitizedGeo = _sanitizePlainObject(geojson);
    if (!sanitizedGeo || !sanitizedGeo.features || !sanitizedGeo.features.length) {
      throw new Error('invalid-geojson');
    }
    const geoString = JSON.stringify(sanitizedGeo);
    const geoSize = _byteSize(geoString);

    const payload = {
      title: title || txt('Mapa sin título', 'Untitled map'),
      description: description || '',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      featureCount: sanitizedGeo.features.length,
      mapPreview: _buildMapPreview(sanitizedGeo)
    };

    // Store GeoJSON: inline if small, chunked if large
    if (geoSize <= FIRESTORE_FIELD_MAX_BYTES) {
      payload.geojsonText = geoString;
      payload.geojson = null;
      payload.geojsonChunked = null;
    } else {
      payload.geojsonText = null;
      payload.geojson = null;
      payload.geojsonChunked = { collection: 'geoChunks', chunkCount: 0 };
    }

    if (isNew) {
      payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      payload.public = false;
      payload.likes = 0;
    }

    const docRef = db.collection(USERS_COL).doc(handle)
      .collection('maps').doc(mapId);

    await docRef.set(payload, { merge: true });

    // Handle chunked GeoJSON
    if (geoSize > FIRESTORE_FIELD_MAX_BYTES) {
      const chunks = _splitChunks(geoString, 900000);
      const progress = typeof options.onUploadProgress === 'function' ? options.onUploadProgress : null;
      if (progress) progress({ uploadedChunks: 0, totalChunks: chunks.length, percent: 5 });
      await docRef.set({ geojsonChunked: { collection: 'geoChunks', chunkCount: chunks.length } }, { merge: true });
      let completedChunks = 0;
      const writes = chunks.map(function (text, index) {
        return docRef.collection('geoChunks').doc(String(index)).set({ index: index, text: text }).then(function () {
          completedChunks += 1;
          if (progress) progress({
            uploadedChunks: completedChunks,
            totalChunks: chunks.length,
            percent: Math.round((completedChunks / chunks.length) * 100)
          });
        });
      });
      await Promise.all(writes);
      if (progress) progress({ uploadedChunks: chunks.length, totalChunks: chunks.length, percent: 100, done: true });
    }

    return { mapId: mapId, isNew: isNew };
  }

  // ═══════════════════════════════════════════════════════════════
  // LIST USER MAPS
  // ═══════════════════════════════════════════════════════════════

  /**
   * List all maps for the current user.
   * @returns {Promise<Array<{id, title, description, createdAt, updatedAt, public, likes, featureCount}>>}
   */
  async function listMaps() {
    const handle = _getHandle();
    if (!handle) return [];

    const db = getDb();
    if (!db) return [];

    const snapshot = await db.collection(USERS_COL).doc(handle)
      .collection('maps')
      .orderBy('updatedAt', 'desc')
      .get();

    return snapshot.docs.map(function (doc) {
      const data = doc.data();
      return {
        id: doc.id,
        title: data.title || '',
        description: data.description || '',
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        public: data.public || false,
        likes: data.likes || 0,
        featureCount: data.featureCount || 0,
        mapPreview: _buildMapPreview(_readInlineGeo(data)) || data.mapPreview,
        thumbnailUrl: data.thumbnailUrl || ''
      };
    });
  }

  /**
   * Count maps for quota checking.
   * @returns {Promise<number>}
   */
  async function countMaps() {
    const handle = _getHandle();
    if (!handle) return 0;
    const db = getDb();
    if (!db) return 0;

    const snapshot = await db.collection(USERS_COL).doc(handle)
      .collection('maps')
      .get();

    return snapshot.size;
  }

  // ═══════════════════════════════════════════════════════════════
  // GET MAP
  // ═══════════════════════════════════════════════════════════════

  /**
   * Load a single map by ID (including GeoJSON).
   * @param {string} mapId
   * @returns {Promise<object|null>}
   */
  async function getMap(mapId) {
    const handle = _getHandle();
    if (!handle || !mapId) return null;

    const db = getDb();
    if (!db) return null;

    const docRef = db.collection(USERS_COL).doc(handle)
      .collection('maps').doc(mapId);
    const doc = await docRef.get();
    if (!doc.exists) return null;

    const data = doc.data();
    if (!data.geojson && data.geojsonText) data.geojson = _parseGeoJSONText(data.geojsonText);

    // Load chunked GeoJSON if needed
    if (!data.geojson && data.geojsonChunked && data.geojsonChunked.chunkCount) {
      const chunkSnap = await docRef.collection(data.geojsonChunked.collection || 'geoChunks')
        .orderBy('index', 'asc')
        .limit(data.geojsonChunked.chunkCount)
        .get();
      let raw = '';
      chunkSnap.forEach(function (chunkDoc) {
        raw += chunkDoc.data().text || '';
      });
      try { data.geojson = JSON.parse(raw); } catch (e) { data.geojson = null; }
    }

    return { id: doc.id, ...data };
  }

  // ═══════════════════════════════════════════════════════════════
  // DELETE MAP
  // ═══════════════════════════════════════════════════════════════

  /**
   * Delete a map from the user's collection. Also removes public mirror if published.
   * @param {string} mapId
   */
  async function deleteMap(mapId) {
    const handle = _getHandle();
    if (!handle || !mapId) return;

    const db = getDb();
    if (!db) return;

    const docRef = db.collection(USERS_COL).doc(handle)
      .collection('maps').doc(mapId);
    const doc = await docRef.get();

    if (doc.exists && doc.data().public) {
      // Remove from public index
      await db.collection(PUBLIC_MAPS_COL).doc(mapId).delete();
    }

    // Delete geo chunks subcollection
    const chunksSnap = await docRef.collection('geoChunks').get();
    const batch = db.batch();
    chunksSnap.forEach(function (chunkDoc) { batch.delete(chunkDoc.ref); });
    batch.delete(docRef);
    await batch.commit();
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLISH / UNPUBLISH
  // ═══════════════════════════════════════════════════════════════

  /**
   * Publish a map to the public gallery.
   * Sets public: true on user's map and writes a denormalized mirror to /maps/{mapId}.
   * @param {string} mapId
   */
  async function publishMap(mapId) {
    const handle = _getHandle();
    if (!handle || !mapId) return;

    const db = getDb();
    if (!db) return;

    const userDocRef = db.collection(USERS_COL).doc(handle)
      .collection('maps').doc(mapId);
    const doc = await userDocRef.get();
    if (!doc.exists) return;

    const data = doc.data();
    let publishGeo = _readInlineGeo(data);
    if (!publishGeo && data.geojsonChunked && data.geojsonChunked.chunkCount) {
      const chunkSnap = await userDocRef.collection(data.geojsonChunked.collection || 'geoChunks')
        .orderBy('index', 'asc')
        .limit(data.geojsonChunked.chunkCount)
        .get();
      let raw = '';
      chunkSnap.forEach(function (chunkDoc) { raw += chunkDoc.data().text || ''; });
      try { publishGeo = raw ? JSON.parse(raw) : null; } catch (e) { publishGeo = null; }
    }

    // Set public on user's map
    await userDocRef.update({ public: true });

    // Write denormalized public mirror
    const publicPayload = {
      title: data.title || '',
      description: data.description || '',
      authorHandle: handle,
      thumbnailUrl: data.thumbnailUrl || '',
      mapPreview: _buildMapPreview(publishGeo) || data.mapPreview,
      geojsonText: publishGeo ? JSON.stringify(publishGeo) : '',
      shareUrl: window.location.origin + '/map/?gallery=' + encodeURIComponent(mapId) + '&map=' + encodeURIComponent(mapId) + '&room=' + encodeURIComponent(mapId) + '&mode=view',
      shareMode: 'view',
      allowPublicEdit: false,
      createdAt: data.createdAt || firebase.firestore.FieldValue.serverTimestamp(),
      likes: data.likes || 0,
      public: true,
      featureCount: data.featureCount || 0,
      isPublished: true
    };

    await db.collection(PUBLIC_MAPS_COL).doc(mapId).set(publicPayload);
  }

  /**
   * Unpublish a map from the public gallery.
   * Sets public: false on user's map and deletes /maps/{mapId}.
   * @param {string} mapId
   */
  async function unpublishMap(mapId) {
    const handle = _getHandle();
    if (!handle || !mapId) return;

    const db = getDb();
    if (!db) return;

    const userDocRef = db.collection(USERS_COL).doc(handle)
      .collection('maps').doc(mapId);

    await userDocRef.update({ public: false });
    await db.collection(PUBLIC_MAPS_COL).doc(mapId).delete();
  }

  // ═══════════════════════════════════════════════════════════════
  // FORK MAP (copy from public gallery to user's collection)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Fork a public map into the current user's collection as a new private map.
   * @param {string} sourceMapId - the public map ID
   * @param {string} sourceHandle - the author's handle
   * @returns {Promise<{mapId: string}>}
   */
  async function forkMap(sourceMapId, sourceHandle) {
    const handle = _getHandle();
    if (!handle) throw new Error('not-authenticated');

    const db = getDb();
    if (!db) throw new Error('firestore-unavailable');

    // Read from source user's maps
    const sourceRef = db.collection(USERS_COL).doc(sourceHandle)
      .collection('maps').doc(sourceMapId);
    const sourceDoc = await sourceRef.get();

    if (!sourceDoc.exists) throw new Error('source-not-found');
    const sourceData = sourceDoc.data();

    if (!sourceData.public) throw new Error('source-not-public');

    // Load GeoJSON (inline or chunked)
    let geojson = sourceData.geojson;
    if (!geojson && sourceData.geojsonChunked && sourceData.geojsonChunked.chunkCount) {
      const chunkSnap = await sourceRef.collection(sourceData.geojsonChunked.collection || 'geoChunks')
        .orderBy('index', 'asc')
        .limit(sourceData.geojsonChunked.chunkCount)
        .get();
      let raw = '';
      chunkSnap.forEach(function (doc) { raw += doc.data().text || ''; });
      try { geojson = JSON.parse(raw); } catch (e) { geojson = null; }
    }

    if (!geojson || !geojson.features) throw new Error('no-geojson');

    // Save as new private map for current user
    const result = await saveMap({
      mapId: null,
      title: (sourceData.title || 'Forked map') + ' (fork)',
      description: txt(
        'Bifurcado de @' + sourceHandle,
        'Forked from @' + sourceHandle
      ),
      geojson: geojson
    });

    return result;
  }

  // ═══════════════════════════════════════════════════════════════
  // LIKE MAP (increment likes counter on public index + user doc)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Like a public map. Increments likes on both /maps/{mapId} and the
   * author's /users/{handle}/maps/{mapId}.
   * @param {string} mapId
   * @param {string} authorHandle
   */
  async function likeMap(mapId, authorHandle) {
    const db = getDb();
    if (!db) return;

    const increment = firebase.firestore.FieldValue.increment(1);

    // Increment on public mirror
    await db.collection(PUBLIC_MAPS_COL).doc(mapId).update({ likes: increment });

    // Increment on author's personal copy
    await db.collection(USERS_COL).doc(authorHandle)
      .collection('maps').doc(mapId)
      .update({ likes: increment });
  }

  // ═══════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════


  function _readInlineGeo(data) {
    if (!data) return null;
    if (data.geojson && data.geojson.features) return data.geojson;
    return _parseGeoJSONText(data.geojsonText);
  }

  const PREVIEW_MAX_FEATURES = 96;
  const PREVIEW_MAX_COORDS_PER_GEOMETRY = 40;
  const PREVIEW_GRID_SIZE = 10;

  function _roundPreviewNumber(value) {
    var num = Number(value);
    if (!isFinite(num)) return null;
    return Number(num.toFixed(6));
  }

  function _collectCoordPairs(coords, out) {
    if (!Array.isArray(coords)) return;
    if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      var x = _roundPreviewNumber(coords[0]);
      var y = _roundPreviewNumber(coords[1]);
      if (x !== null && y !== null) out.push([x, y]);
      return;
    }
    coords.forEach(function(child) { _collectCoordPairs(child, out); });
  }

  function _sampleArrayEvenly(items, maxItems) {
    if (!Array.isArray(items) || items.length <= maxItems) return items || [];
    if (maxItems <= 1) return [items[0]];
    var sampled = [];
    for (var i = 0; i < maxItems; i++) {
      sampled.push(items[Math.round(i * (items.length - 1) / (maxItems - 1))]);
    }
    return sampled;
  }

  function _sanitizePreviewPoint(coord) {
    if (!Array.isArray(coord) || coord.length < 2) return null;
    var x = _roundPreviewNumber(coord[0]);
    var y = _roundPreviewNumber(coord[1]);
    return x === null || y === null ? null : [x, y];
  }

  function _sanitizePreviewLine(coords, maxCoords) {
    if (!Array.isArray(coords)) return [];
    return _sampleArrayEvenly(coords, maxCoords).map(_sanitizePreviewPoint).filter(Boolean);
  }

  function _sanitizePreviewPolygon(poly, maxCoords) {
    if (!Array.isArray(poly)) return [];
    return poly.map(function(ring) {
      return _sanitizePreviewLine(ring, maxCoords);
    }).filter(function(ring) { return ring.length >= 3; });
  }

  function _simplifyPreviewGeometry(geometry) {
    if (!geometry || !geometry.type || !Array.isArray(geometry.coordinates)) return null;
    var coords = geometry.coordinates;
    if (geometry.type === 'Point') {
      coords = _sanitizePreviewPoint(coords);
    } else if (geometry.type === 'MultiPoint' || geometry.type === 'LineString') {
      coords = _sanitizePreviewLine(coords, PREVIEW_MAX_COORDS_PER_GEOMETRY);
    } else if (geometry.type === 'MultiLineString' || geometry.type === 'Polygon') {
      coords = _sanitizePreviewPolygon(coords, PREVIEW_MAX_COORDS_PER_GEOMETRY);
    } else if (geometry.type === 'MultiPolygon') {
      coords = coords.map(function(poly) {
        return _sanitizePreviewPolygon(poly, PREVIEW_MAX_COORDS_PER_GEOMETRY);
      }).filter(function(poly) { return poly.length; });
    } else {
      return null;
    }
    if (!coords || (Array.isArray(coords) && !coords.length)) return null;
    return { type: geometry.type, coordinatesText: JSON.stringify(coords) };
  }

  function _featureCenter(feature) {
    var geom = feature && feature.geometry;
    if (!geom || !Array.isArray(geom.coordinates)) return null;
    var coords = [];
    _collectCoordPairs(geom.coordinates, coords);
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

  function _previewFeatureIndexes(features, maxFeatures, bbox) {
    var count = Array.isArray(features) ? features.length : 0;
    if (!count) return [];
    var target = Math.min(count, maxFeatures);
    if (count <= target) return features.map(function(_, index) { return index; });

    var minX = Number(bbox && bbox[0]); var minY = Number(bbox && bbox[1]);
    var maxX = Number(bbox && bbox[2]); var maxY = Number(bbox && bbox[3]);
    if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
      return _sampleArrayEvenly(features.map(function(_, index) { return index; }), target);
    }
    var spanX = Math.max(maxX - minX, 1e-9);
    var spanY = Math.max(maxY - minY, 1e-9);
    var buckets = {};

    features.forEach(function(feature, index) {
      var center = _featureCenter(feature);
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
    if (!bucketList.length) return _sampleArrayEvenly(features.map(function(_, index) { return index; }), target);

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
      _sampleArrayEvenly(features.map(function(_, index) { return index; }), target).forEach(function(index) {
        if (selected.length < target && !used[index]) {
          used[index] = true;
          selected.push(index);
        }
      });
    }
    return selected.sort(function(a, b) { return a - b; });
  }

  function _encodePreviewGeometry(geometry) {
    return _simplifyPreviewGeometry(geometry);
  }

  function _buildMapPreview(geo) {
    if (!geo || !Array.isArray(geo.features) || !geo.features.length) return null;
    var points = [];
    geo.features.forEach(function(feature) {
      var geom = feature && feature.geometry;
      if (!geom || !Array.isArray(geom.coordinates)) return;
      _collectCoordPairs(geom.coordinates, points);
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
    var entries = _previewFeatureIndexes(geo.features, PREVIEW_MAX_FEATURES, bbox).map(function(index) {
      var feature = geo.features[index];
      var props = feature && feature.properties ? feature.properties : {};
      return {
        geometry: _encodePreviewGeometry(feature ? feature.geometry : null),
        color: props._manaColor || props.color || '#0ea5e9'
      };
    }).filter(function(entry) { return !!entry.geometry; });
    return entries.length ? {
      bbox: bbox,
      features: entries
    } : null;
  }

  function _generateMapId(title) {
    const base = (title || 'mapa')
      .toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40);
    const rnd = Math.random().toString(36).slice(2, 8);
    return (base || 'mapa') + '-' + rnd;
  }

  function _byteSize(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str).length;
    return unescape(encodeURIComponent(str)).length;
  }

  function _splitChunks(text, chunkSize) {
    const chunks = [];
    let i = 0;
    while (i < text.length) {
      chunks.push(text.slice(i, i + chunkSize));
      i += chunkSize;
    }
    return chunks;
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════

  window.manaMaps = {
    saveMap: saveMap,
    listMaps: listMaps,
    countMaps: countMaps,
    getMap: getMap,
    deleteMap: deleteMap,
    publishMap: publishMap,
    unpublishMap: unpublishMap,
    forkMap: forkMap,
    likeMap: likeMap
  };

})();
