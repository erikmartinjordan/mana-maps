// ── persistence.js ─ remote/URL restore helpers and share delegation ──

const MANA_FIREBASE_CFG = window.ManaFirebase && window.ManaFirebase.getConfig();
const SHARED_MAPS_COLLECTION = 'sharedMaps';
const MAPS_COLLECTION = 'maps';
const LEGACY_GALLERY_COLLECTION = 'gallery';

function getSharedMapsDb() {
  if (typeof firebase === 'undefined') return null;
  try {
    if (!firebase.apps || !firebase.apps.length) { if (!MANA_FIREBASE_CFG) return null; firebase.initializeApp(MANA_FIREBASE_CFG); }
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
  if (window.updatePrivateSaveIndicator) window.updatePrivateSaveIndicator();
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

function _nextRestoreFrame() {
  return new Promise(function(resolve) {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(function() { resolve(); });
    else setTimeout(resolve, 0);
  });
}

async function _importRestoredGeoJSON(geo) {
  if (!geo || !geo.features) return;

  const restoreBatchSize = 250;
  const isLargeRestore = geo.features.length > 1200;
  if (isLargeRestore && typeof manaAlert === 'function') manaAlert(t('importing_large_file'), 'info');

  // Group features by _manaGroupName for grouped import.
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

  // Import grouped features via loadGeoJSON. Awaiting keeps colors and layer
  // metadata stable while large groups are imported over multiple frames.
  for (const gn in groups) {
    const fc = { type: 'FeatureCollection', features: groups[gn] };
    const firstProps = groups[gn][0].properties || {};
    const firstColor = firstProps._manaColor || firstProps.color || '#0ea5e9';
    const savedGeomType = firstProps._manaGeometryType || null;
    const savedColor = drawColor;
    drawColor = firstColor;
    const importedLayer = await Promise.resolve(loadGeoJSON(fc, gn));
    drawColor = savedColor;
    if (savedGeomType) {
      let gid = _manaGroupCounter;
      if (importedLayer && typeof importedLayer.eachLayer === 'function') {
        importedLayer.eachLayer(function(layer) {
          if (layer && layer._manaGroupId) gid = layer._manaGroupId;
        });
      }
      if (_manaGroupMeta[gid]) {
        _manaGroupMeta[gid].geometryType = savedGeomType;
        if (firstProps._manaGroupTags) _manaGroupMeta[gid].tags = _normalizeManaTags(firstProps._manaGroupTags);
      }
    }
  }

  // Import ungrouped features in chunks so large saved maps do not block the UI.
  if (ungrouped.length) {
    const autoGid = ++_manaGroupCounter;
    _manaLayerNameCounter++;
    const autoGroupName = 'Capa ' + _manaLayerNameCounter;
    registerGroupMeta(autoGid, autoGroupName, '#0ea5e9');

    function addUngroupedFeature(f) {
      const props = f.properties || {};
      const color = props._manaColor || props.color || '#0ea5e9';
      const name = props._manaName || props.name || t('geom_element');
      const g = f.geometry;
      if (!g) return;
      let layer;

      if (g.type === 'Point') {
        const ll = [g.coordinates[1], g.coordinates[0]];
        const restoredMarkerType = props._manaMarkerType || props.markerType || markerType;
        const icon = makeMarkerIcon(color, restoredMarkerType);
        layer = L.marker(ll, { icon });
        layer._manaName = name;
        layer._manaColor = color;
        layer._manaMarkerType = restoredMarkerType;
        layer._manaTags = _normalizeManaTags(props._manaTags);
        const ptAttrs = _extractUserAttrs(props);
        if (ptAttrs) layer._manaProperties = ptAttrs;
        layer.bindPopup('<strong>' + name + '</strong>');
      } else if (g.type === 'LineString') {
        const lls = g.coordinates.map(c => [c[1], c[0]]);
        const weight = props._manaWeight || 2;
        const opacity = props._manaOpacity || 1;
        layer = L.polyline(lls, { color: color, weight: weight, opacity: opacity, fillOpacity: opacity * 0.3 });
        layer._manaName = name;
        layer._manaTags = _normalizeManaTags(props._manaTags);
        const lnAttrs = _extractUserAttrs(props);
        if (lnAttrs) layer._manaProperties = lnAttrs;
      } else if (g.type === 'Polygon') {
        const lls = g.coordinates[0].map(c => [c[1], c[0]]);
        const weight = props._manaWeight || 2;
        const opacity = props._manaOpacity || 1;
        layer = L.polygon(lls, { color: color, weight: weight, opacity: opacity, fillOpacity: opacity * 0.3 });
        layer._manaName = name;
        layer._manaTags = _normalizeManaTags(props._manaTags);
        const pgAttrs = _extractUserAttrs(props);
        if (pgAttrs) layer._manaProperties = pgAttrs;
      }

      if (layer) {
        layer._manaGroupId = autoGid;
        layer._manaGroupName = autoGroupName;
        drawnItems.addLayer(layer);
        addLayerToGroupMeta(autoGid, layer);
      }
    }

    for (let idx = 0; idx < ungrouped.length; idx += restoreBatchSize) {
      const end = Math.min(idx + restoreBatchSize, ungrouped.length);
      for (let i = idx; i < end; i++) addUngroupedFeature(ungrouped[i]);
      if (end < ungrouped.length) await _nextRestoreFrame();
    }

    const firstProps = ungrouped[0].properties || {};
    const firstColor = firstProps && (firstProps._manaColor || firstProps.color);
    if (firstColor) _manaGroupMeta[autoGid].color = firstColor;
    if (firstProps._manaGroupTags && _manaGroupMeta[autoGid]) _manaGroupMeta[autoGid].tags = _normalizeManaTags(firstProps._manaGroupTags);
  }

  stats();
  if (typeof renderLayers === 'function') renderLayers();
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


    async function incrementPublishedMapView(db, slug, payload) {
      if (!db || !slug || !payload || !payload.isPublished) return;
      var storageKey = 'mana-map-viewed:' + slug;
      try {
        if (sessionStorage.getItem(storageKey)) return;
        sessionStorage.setItem(storageKey, '1');
      } catch (e) {}

      if (window.manaMaps && typeof window.manaMaps.incrementMapView === 'function') {
        window.manaMaps.incrementMapView(slug, payload.authorHandle || '').catch(function(e) {
          console.warn('public map view counter failed:', e);
        });
        return;
      }

      if (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue) {
        db.collection(MAPS_COLLECTION).doc(slug)
          .update({ views: firebase.firestore.FieldValue.increment(1) })
          .catch(function(e) { console.warn('public map view counter failed:', e); });
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
          await _importRestoredGeoJSON(personalMap.geojson);
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
          await _importRestoredGeoJSON(galleryGeo);
          incrementPublishedMapView(db, gallerySlug, galleryPayload);
          const input = document.getElementById('project-name-input');
          if (input) input.value = galleryPayload.title || galleryPayload.name || '';
          if (window.setCurrentPrivateMapId) window.setCurrentPrivateMapId('');
          return true;
        }
        // Backward compatibility: read legacy /gallery docs
        const legacyDoc = await db.collection(LEGACY_GALLERY_COLLECTION).doc(gallerySlug).get();
        const legacyPayload = legacyDoc && legacyDoc.exists ? legacyDoc.data() : null;
        if (legacyPayload && legacyPayload.geojson && legacyPayload.geojson.features && legacyPayload.geojson.features.length) {
          await _importRestoredGeoJSON(legacyPayload.geojson);
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
          await _importRestoredGeoJSON(payload.geojson);
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
          await _importRestoredGeoJSON(geo);
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
async function replaceMapWithGeoJSON(geo) {
  if (!geo || !geo.features) return;

  drawnItems.clearLayers();
  for (const gid in _manaGroupMeta) delete _manaGroupMeta[gid];
  _activeGroupId = null;
  _manaGroupCounter = 0;
  _manaLayerNameCounter = 0;

  await _importRestoredGeoJSON(geo);
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
  if (window.updatePrivateSaveIndicator) window.updatePrivateSaveIndicator();
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
