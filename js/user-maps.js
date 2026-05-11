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
        mapPreview: data.mapPreview || _buildMapPreview(_readInlineGeo(data)),
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
      // Best-effort cleanup of the public index. Do not block deleting the
      // owner's private copy if a legacy public mirror is already missing or
      // was written with older ownership metadata.
      try {
        await _deleteDocumentWithChunks(db.collection(PUBLIC_MAPS_COL).doc(mapId));
      } catch (e) {
        console.warn('public mirror cleanup failed:', e);
      }
    }

    await _deleteDocumentWithChunks(docRef);
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

    const publicGeoString = publishGeo ? JSON.stringify(publishGeo) : '';
    const useChunkedPublicGeo = publicGeoString && _byteSize(publicGeoString) > FIRESTORE_FIELD_MAX_BYTES;

    // Write denormalized public mirror
    const publicPayload = {
      title: data.title || '',
      description: data.description || '',
      authorHandle: handle,
      ownerUid: (_getUser() && _getUser().uid) || '',
      thumbnailUrl: data.thumbnailUrl || '',
      mapPreview: data.mapPreview || _buildMapPreview(publishGeo),
      geojsonText: useChunkedPublicGeo ? null : publicGeoString,
      geojsonChunked: useChunkedPublicGeo ? { collection: 'geoChunks', chunkCount: 0 } : null,
      shareUrl: window.location.origin + '/map/?gallery=' + encodeURIComponent(mapId) + '&map=' + encodeURIComponent(mapId) + '&room=' + encodeURIComponent(mapId) + '&mode=view',
      shareMode: 'view',
      allowPublicEdit: false,
      createdAt: data.createdAt || firebase.firestore.FieldValue.serverTimestamp(),
      likes: data.likes || 0,
      public: true,
      featureCount: data.featureCount || 0,
      isPublished: true
    };

    const publicRef = db.collection(PUBLIC_MAPS_COL).doc(mapId);
    await publicRef.set(publicPayload);
    if (useChunkedPublicGeo) {
      const chunks = _splitChunks(publicGeoString, 900000);
      await publicRef.set({ geojsonChunked: { collection: 'geoChunks', chunkCount: chunks.length } }, { merge: true });
      await Promise.all(chunks.map(function(text, index) {
        return publicRef.collection('geoChunks').doc(String(index)).set({ index: index, text: text });
      }));
    }
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


  async function _deleteDocumentWithChunks(docRef) {
    const chunkCollections = ['geoChunks'];
    for (let c = 0; c < chunkCollections.length; c++) {
      const chunksSnap = await docRef.collection(chunkCollections[c]).get();
      const docs = chunksSnap.docs || [];
      for (let i = 0; i < docs.length; i += 450) {
        const batch = getDb().batch();
        docs.slice(i, i + 450).forEach(function(chunkDoc) { batch.delete(chunkDoc.ref); });
        await batch.commit();
      }
    }
    await docRef.delete();
  }

  function _readInlineGeo(data) {
    if (!data) return null;
    if (data.geojson && data.geojson.features) return data.geojson;
    return _parseGeoJSONText(data.geojsonText);
  }

  function _encodePreviewGeometry(geometry) {
    if (!geometry || !geometry.type || !Array.isArray(geometry.coordinates)) return null;
    return {
      type: geometry.type,
      coordinatesText: JSON.stringify(geometry.coordinates)
    };
  }

  function _samplePreviewFeatures(features) {
    if (!Array.isArray(features)) return [];
    const maxPreviewFeatures = 300;
    if (features.length <= maxPreviewFeatures) return features.slice();
    const sampled = [];
    const step = (features.length - 1) / (maxPreviewFeatures - 1);
    for (let i = 0; i < maxPreviewFeatures; i++) {
      sampled.push(features[Math.round(i * step)]);
    }
    return sampled;
  }

  function _buildMapPreview(geo) {
    if (!geo || !Array.isArray(geo.features) || !geo.features.length) return null;
    var points = [];
    function collectCoordPairs(coords, out) {
      if (!Array.isArray(coords)) return;
      if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
        out.push([coords[0], coords[1]]);
        return;
      }
      coords.forEach(function(child) { collectCoordPairs(child, out); });
    }
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
    return {
      bbox: [minX, minY, maxX, maxY],
      features: _samplePreviewFeatures(geo.features).map(function(feature) {
        var props = feature && feature.properties ? feature.properties : {};
        return {
          geometry: _encodePreviewGeometry(feature ? feature.geometry : null),
          color: props._manaColor || props.color || '#0ea5e9'
        };
      }).filter(function(entry) { return !!entry.geometry; })
    };
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
