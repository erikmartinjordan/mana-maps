// ── persistence.js ─ remote/URL restore helpers and share delegation ──

const MANA_FIREBASE_CFG = {
  apiKey: 'AIzaSyBjtW1SUhgnLyagREHESEl4Vb4zI5yHgDg',
  authDomain: 'mana-maps-pro.firebaseapp.com',
  databaseURL: 'https://mana-maps-pro-default-rtdb.firebaseio.com',
  projectId: 'mana-maps-pro',
  storageBucket: 'mana-maps-pro.firebasestorage.app',
  messagingSenderId: '212469378297',
  appId: '1:212469378297:web:83e17ed0e38dd202944628',
  measurementId: 'G-F1Z7C21BZ6'
};
const SHARED_MAPS_COLLECTION = 'sharedMaps';
const MAPS_COLLECTION = 'maps';
const LEGACY_GALLERY_COLLECTION = 'gallery';

function getSharedMapsDb() {
  if (typeof firebase === 'undefined') return null;
  try {
    if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(MANA_FIREBASE_CFG);
    return firebase.firestore();
  } catch (e) {
    console.warn('shared maps db unavailable:', e);
    return null;
  }
}

function slugifyMapName(name) {
  const base = (name || 'mapa')
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

function getMapNameForShare() {
  const input = document.getElementById('project-name-input');
  const value = (input && input.value ? input.value : '').trim();
  return value || (typeof t === 'function' ? t('map_name_placeholder') : 'Mapa sin título');
}

// ═══════════════════════════════════════════════════════════════
// SAVE STATE
// ═══════════════════════════════════════════════════════════════
function saveState() {
  // Map contents are saved explicitly to Firestore via the Save button.
  // Do not persist map data in localStorage.
}

function _buildSlimStateGeoJSON(geo) {
  return { type: 'FeatureCollection', features: [] };
}

// ═══════════════════════════════════════════════════════════════
// RESTORE STATE
// ═══════════════════════════════════════════════════════════════
function restoreState() {
  // Local map restore intentionally disabled: saved maps now live only in Firestore.
}


// Build clean user attributes from saved properties (filtering internal keys)
function _extractUserAttrs(props) {
  var attrs = {};
  for (var k in props) {
    if (k.charAt(0) === '_' || k === 'color' || k === 'bbox' || k === 'name' || k === 'Name' || k === 'NAME') continue;
    if (props[k] !== null && props[k] !== undefined) attrs[k] = props[k];
  }
  return Object.keys(attrs).length ? attrs : null;
}

function _importRestoredGeoJSON(geo) {
  if (!geo || !geo.features) return;

  // Group features by _manaGroupName for grouped import
  const groups = {};
  const ungrouped = [];

  geo.features.forEach(f => {
    const props = f.properties || {};
    if (props._manaGroupName) {
      const gn = props._manaGroupName;
      if (!groups[gn]) groups[gn] = [];
      groups[gn].push(f);
    } else {
      ungrouped.push(f);
    }
  });

  // Import grouped features via loadGeoJSON
  for (const gn in groups) {
    const fc = { type: 'FeatureCollection', features: groups[gn] };
    // Set drawColor from first feature
    const firstColor = groups[gn][0].properties._manaColor || '#0ea5e9';
    const savedGeomType = groups[gn][0].properties._manaGeometryType || null;
    const savedColor = drawColor;
    drawColor = firstColor;
    loadGeoJSON(fc, gn);
    drawColor = savedColor;
    // Restore geometryType on the newly created group
    if (savedGeomType) {
      const lastGid = _manaGroupCounter;
      if (_manaGroupMeta[lastGid]) _manaGroupMeta[lastGid].geometryType = savedGeomType;
    }
  }

  // Import ungrouped features — auto-wrap them in a group
  if (ungrouped.length) {
    const autoGid = ++_manaGroupCounter;
    _manaLayerNameCounter++;
    registerGroupMeta(autoGid, 'Capa ' + _manaLayerNameCounter, '#0ea5e9');

    ungrouped.forEach(f => {
      const props = f.properties || {};
      const color = props._manaColor || props.color || '#0ea5e9';
      const name = props._manaName || props.name || t('geom_element');
      const g = f.geometry;
      if (!g) return;
      let layer;

      if (g.type === 'Point') {
        const ll = [g.coordinates[1], g.coordinates[0]];
        const icon = makeMarkerIcon(color, markerType);
        layer = L.marker(ll, { icon });
        layer._manaName = name;
        layer._manaColor = color;
        const ptAttrs = _extractUserAttrs(props);
        if (ptAttrs) layer._manaProperties = ptAttrs;
        layer.bindPopup('<strong>' + name + '</strong>');
      } else if (g.type === 'LineString') {
        const lls = g.coordinates.map(c => [c[1], c[0]]);
        const weight = props._manaWeight || 2;
        const opacity = props._manaOpacity || 1;
        layer = L.polyline(lls, { color: color, weight: weight, opacity: opacity, fillOpacity: opacity * 0.3 });
        layer._manaName = name;
        const lnAttrs = _extractUserAttrs(props);
        if (lnAttrs) layer._manaProperties = lnAttrs;
      } else if (g.type === 'Polygon') {
        const lls = g.coordinates[0].map(c => [c[1], c[0]]);
        const weight = props._manaWeight || 2;
        const opacity = props._manaOpacity || 1;
        layer = L.polygon(lls, { color: color, weight: weight, opacity: opacity, fillOpacity: opacity * 0.3 });
        layer._manaName = name;
        const pgAttrs = _extractUserAttrs(props);
        if (pgAttrs) layer._manaProperties = pgAttrs;
      }

      if (layer) {
        layer._manaGroupId = autoGid;
        layer._manaGroupName = 'Capa ' + _manaLayerNameCounter;
        drawnItems.addLayer(layer);
        addLayerToGroupMeta(autoGid, layer);
      }
    });

    // Update group color from first feature
    const firstColor = ungrouped[0].properties && (ungrouped[0].properties._manaColor || ungrouped[0].properties.color);
    if (firstColor) _manaGroupMeta[autoGid].color = firstColor;
  }

  stats();
}


// ═══════════════════════════════════════════════════════════════
// AUTO-SAVE PILL FLASH
// ═══════════════════════════════════════════════════════════════
let _savePillTimer = null;

function _flashSavePill() {
  const pill = document.getElementById('autosave-pill');
  if (!pill) return;
  pill.textContent = 'Guardado \u2713';
  pill.classList.add('flash');
  if (_savePillTimer) clearTimeout(_savePillTimer);
  _savePillTimer = setTimeout(() => {
    pill.classList.remove('flash');
    pill.textContent = t('persist_autosave');
  }, 1500);
}


// ═══════════════════════════════════════════════════════════════
// SHARE MAP — delegates to gallery.js shareMap()
// ═══════════════════════════════════════════════════════════════
function shareMapURL() {
  if (typeof window.shareMap === 'function') {
    window.shareMap();
    return;
  }
  // Fallback if gallery.js not loaded yet
  manaAlert(LANG === 'en' ? 'Share not available yet. Try again.' : 'Compartir no disponible aún. Inténtalo de nuevo.', 'warning');
}


function getRequestedShareMode(payload) {
  try {
    const search = new URLSearchParams(window.location.search || '');
    const requested = (search.get('mode') || '').toLowerCase();
    if (requested === 'edit' && payload && (payload.shareMode === 'edit' || payload.allowPublicEdit === true)) return 'edit';
    return 'view';
  } catch (e) {
    return 'view';
  }
}

function setSharedMapAccess(mode, payload) {
  window.manaSharedAccess = {
    mode: mode === 'edit' ? 'edit' : 'view',
    canEdit: mode === 'edit',
    payload: payload || null
  };
  document.documentElement.classList.toggle('mana-view-only', mode !== 'edit');
  document.body.classList.toggle('mana-view-only', mode !== 'edit');
  if (mode !== 'edit') {
    setTimeout(function() {
      document.querySelectorAll('.draw-btn, .tool-icon[data-panel="draw"], #project-name-input').forEach(function(el) {
        if (el.id !== 'search-input') el.setAttribute('disabled', 'disabled');
      });
      var hint = document.getElementById('draw-hint');
      if (hint) {
        hint.textContent = (typeof LANG !== 'undefined' && LANG === 'en') ? 'View-only shared map' : 'Mapa compartido de solo lectura';
        hint.style.display = 'block';
      }
    }, 300);
  }
}

async function waitForPersonalMaps(timeoutMs) {
  return new Promise(function(resolve) {
    var startedAt = Date.now();
    var timer = setInterval(function() {
      if (window.manaMaps && typeof window.manaMaps.getMap === 'function' && window.manaAuth && window.manaAuth.getHandle()) {
        clearInterval(timer);
        resolve(true);
        return;
      }
      if (Date.now() - startedAt >= (timeoutMs || 5000)) {
        clearInterval(timer);
        resolve(false);
      }
    }, 100);
  });
}

// ═══════════════════════════════════════════════════════════════
// RESTORE FROM URL (shared map links)
// ═══════════════════════════════════════════════════════════════
async function restoreFromURL() {
  try {
    async function readChunkedPublishedGeo(db, slug, payload) {
      if (!db || !slug || !payload || !payload.geojsonChunked || !payload.geojsonChunked.chunkCount) return null;
      try {
        const chunkMeta = payload.geojsonChunked;
        const chunkSnap = await db.collection(MAPS_COLLECTION)
          .doc(slug)
          .collection(chunkMeta.collection || 'geoChunks')
          .orderBy('index', 'asc')
          .limit(chunkMeta.chunkCount)
          .get();
        if (!chunkSnap || chunkSnap.empty) return null;
        let raw = '';
        chunkSnap.forEach(function(doc) {
          const data = doc.data() || {};
          raw += typeof data.text === 'string' ? data.text : '';
        });
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && parsed.features ? parsed : null;
      } catch (e) {
        console.warn('restoreFromURL read chunked geo failed:', e);
        return null;
      }
    }

    async function readPublishedGeo(db, slug, payload) {
      if (!payload) return null;
      if (payload.mapData && payload.mapData.features) return payload.mapData;
      if (payload.geojson && payload.geojson.features) return payload.geojson;
      const raw = payload.mapDataText || payload.geojsonText;
      if (typeof raw === 'string' && raw) {
        try {
          const parsed = JSON.parse(raw);
          return parsed && parsed.features ? parsed : null;
        } catch (e) {
          console.warn('restoreFromURL parse published geo failed:', e);
        }
      }
      return readChunkedPublishedGeo(db, slug, payload);
    }

    const search = new URLSearchParams(window.location.search || '');
    const personalMapId = search.get('load');
    if (personalMapId) {
      await waitForPersonalMaps(5000);
      if (window.manaMaps && typeof window.manaMaps.getMap === 'function') {
        const personalMap = await window.manaMaps.getMap(personalMapId);
        if (personalMap && personalMap.geojson && personalMap.geojson.features && personalMap.geojson.features.length) {
          _importRestoredGeoJSON(personalMap.geojson);
          const input = document.getElementById('project-name-input');
          if (input) input.value = personalMap.title || '';
          if (window.setCurrentPrivateMapId) window.setCurrentPrivateMapId(personalMapId);
          return true;
        }
      }
    }

    const gallerySlug = search.get('gallery') || search.get('slug');
    if (gallerySlug) {
      const db = getSharedMapsDb();
      if (db) {
        const galleryDoc = await db.collection(MAPS_COLLECTION).doc(gallerySlug).get();
        const galleryPayload = galleryDoc && galleryDoc.exists ? galleryDoc.data() : null;
        const galleryGeo = await readPublishedGeo(db, gallerySlug, galleryPayload);
        if (galleryPayload && galleryPayload.isPublished && galleryGeo && galleryGeo.features && galleryGeo.features.length) {
          const accessMode = getRequestedShareMode(galleryPayload);
          setSharedMapAccess(accessMode, galleryPayload);
          _importRestoredGeoJSON(galleryGeo);
          const input = document.getElementById('project-name-input');
          if (input) input.value = galleryPayload.title || galleryPayload.name || '';
          if (window.setCurrentPrivateMapId) window.setCurrentPrivateMapId('');
          return true;
        }
        // Backward compatibility: read legacy /gallery docs
        const legacyDoc = await db.collection(LEGACY_GALLERY_COLLECTION).doc(gallerySlug).get();
        const legacyPayload = legacyDoc && legacyDoc.exists ? legacyDoc.data() : null;
        if (legacyPayload && legacyPayload.geojson && legacyPayload.geojson.features && legacyPayload.geojson.features.length) {
          _importRestoredGeoJSON(legacyPayload.geojson);
          return true;
        }
      }
    }

    const mapId = search.get('map');
    if (mapId) {
      const db = getSharedMapsDb();
      if (db) {
        const doc = await db.collection(SHARED_MAPS_COLLECTION).doc(mapId).get();
        const payload = doc && doc.exists ? doc.data() : null;
        if (payload && payload.geojson && payload.geojson.features && payload.geojson.features.length) {
          _importRestoredGeoJSON(payload.geojson);
          return true;
        }
      }
    }

    const hash = window.location.hash;
    if (hash && hash.length >= 2) {
      let encoded = '';
      if (hash.startsWith('#map=')) {
        encoded = hash.substring(5);
      } else {
        const params = new URLSearchParams(hash.substring(1));
        encoded = params.get('map') || '';
      }
      if (encoded) {
        const geo = JSON.parse(decodeURIComponent(encoded));
        if (geo && geo.features && geo.features.length) {
          _importRestoredGeoJSON(geo);
          return true;
        }
      }
    }
  } catch (e) {
    console.warn('restoreFromURL error:', e);
  }
  return false;
}

// Replace current map contents without confirmation (used by real-time sync).
function replaceMapWithGeoJSON(geo) {
  if (!geo || !geo.features) return;

  drawnItems.clearLayers();
  for (const gid in _manaGroupMeta) delete _manaGroupMeta[gid];
  _activeGroupId = null;
  _manaGroupCounter = 0;
  _manaLayerNameCounter = 0;

  _importRestoredGeoJSON(geo);
  if (typeof renderLayers === 'function') renderLayers();
  if (typeof saveState === 'function') saveState();
}



// ═══════════════════════════════════════════════════════════════
// P1.5: CLEAR SAVED DATA
// ═══════════════════════════════════════════════════════════════
function clearSavedData() {
  try {
    localStorage.removeItem('mana-maps-state');
    localStorage.removeItem('mana-private-map-id');
    localStorage.removeItem('mana-project-name');
  } catch (e) {}
  showToast(LANG === 'en' ? 'Local map data cleared ✓' : 'Datos locales del mapa eliminados ✓');
}

// ═══════════════════════════════════════════════════════════════
// P3.11: PROJECT NAME FOR EXPORTS
// ═══════════════════════════════════════════════════════════════
function getProjectName() {
  const input = document.getElementById('project-name-input');
  const value = input && input.value ? input.value.trim() : '';
  return value || t('map_name_placeholder');
}

function setProjectName(name) {
  const clean = name.trim() || t('map_name_placeholder');
  const input = document.getElementById('project-name-input');
  if (input) input.value = clean;
  showToast('Nom del projecte: ' + clean);
}

function clearLegacyLocalMapData() {
  try {
    localStorage.removeItem('mana-maps-state');
    localStorage.removeItem('mana-private-map-id');
    localStorage.removeItem('mana-project-name');
  } catch (e) {}
}

// ═══════════════════════════════════════════════════════════════
// INIT: restore from URL/Firestore only
// ═══════════════════════════════════════════════════════════════
(async function initPersistence() {
  const needsRemoteRestore = (() => {
    try {
      const search = new URLSearchParams(window.location.search || '');
      return !!(search.get('gallery') || search.get('slug') || search.get('map') || search.get('load'));
    } catch (_) {
      return false;
    }
  })();

  if (needsRemoteRestore) {
    await waitForFirebaseSdk(5000);
  }

  await restoreFromURL();
  clearLegacyLocalMapData();
})();

function waitForFirebaseSdk(timeoutMs) {
  return new Promise(function(resolve) {
    if (typeof firebase !== 'undefined' && firebase && typeof firebase.firestore === 'function') {
      resolve(true);
      return;
    }
    var startedAt = Date.now();
    var poll = setInterval(function() {
      if (typeof firebase !== 'undefined' && firebase && typeof firebase.firestore === 'function') {
        clearInterval(poll);
        resolve(true);
        return;
      }
      if (Date.now() - startedAt >= (timeoutMs || 5000)) {
        clearInterval(poll);
        resolve(false);
      }
    }, 100);
  });
}
