// ── persistence.js ─ localStorage persistence, auto-save, share via URL hash ──

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

async function persistSharedMap(geo) {
  const db = getSharedMapsDb();
  if (!db) return null;
  try {
    const slug = slugifyMapName(getMapNameForShare());
    const docRef = db.collection(SHARED_MAPS_COLLECTION).doc(slug);
    await docRef.set({
      slug: slug,
      name: getMapNameForShare(),
      featureCount: geo.features.length,
      geojson: geo,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdAtMs: Date.now()
    }, { merge: true });
    return slug;
  } catch (e) {
    console.warn('persistSharedMap failed:', e);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// SAVE STATE
// ═══════════════════════════════════════════════════════════════
function saveState() {
  try {
    const geo = getEnrichedGeoJSON();
    // Also store style info per feature
    const layers = [];
    drawnItems.eachLayer(l => layers.push(l));
    geo.features.forEach((f, i) => {
      const l = layers[i];
      if (!l) return;
      f.properties._manaName = l._manaName || f.properties.name || '';
      f.properties._manaColor = (l instanceof L.Marker) ? (l._manaColor || '#0ea5e9') : (l.options.color || '#0ea5e9');
      if (!(l instanceof L.Marker)) {
        f.properties._manaWeight = l.options.weight || 2;
        f.properties._manaOpacity = l.options.opacity || 1;
      }
      if (l._manaGroupId) f.properties._manaGroupId = l._manaGroupId;
      if (l._manaGroupName) f.properties._manaGroupName = l._manaGroupName;
      // Persist geometry type for the group
      if (l._manaGroupId && _manaGroupMeta[l._manaGroupId] && _manaGroupMeta[l._manaGroupId].geometryType) {
        f.properties._manaGeometryType = _manaGroupMeta[l._manaGroupId].geometryType;
      }
    });
    const serialized = JSON.stringify(geo);
    try {
      localStorage.setItem('mana-maps-state', serialized);
    } catch (storageError) {
      if (storageError && storageError.name === 'QuotaExceededError') {
        const slimGeo = _buildSlimStateGeoJSON(geo);
        try {
          localStorage.setItem('mana-maps-state', JSON.stringify(slimGeo));
          showToast(LANG === 'en' ? 'Autosave optimized for large map' : 'Auto-guardado optimizado para mapa grande');
        } catch (slimError) {
          localStorage.removeItem('mana-maps-state');
          console.warn('saveState quota exceeded (slim fallback failed):', slimError);
          showToast(LANG === 'en' ? 'Autosave disabled: map too large' : 'Auto-guardado desactivado: mapa demasiado grande');
        }
      } else {
        throw storageError;
      }
    }
    _flashSavePill();
  } catch (e) {
    console.warn('saveState error:', e);
  }
}

function _buildSlimStateGeoJSON(geo) {
  if (!geo || !Array.isArray(geo.features)) return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: geo.features.map(f => ({
      type: 'Feature',
      geometry: f.geometry || null,
      properties: {
        _manaName: f.properties && f.properties._manaName ? f.properties._manaName : '',
        _manaColor: f.properties && f.properties._manaColor ? f.properties._manaColor : '#0ea5e9'
      }
    }))
  };
}

// ═══════════════════════════════════════════════════════════════
// RESTORE STATE
// ═══════════════════════════════════════════════════════════════
function restoreState() {
  try {
    const raw = localStorage.getItem('mana-maps-state');
    if (!raw) return;
    const geo = JSON.parse(raw);
    if (!geo || !geo.features || !geo.features.length) return;
    _importRestoredGeoJSON(geo);
    // P1.5: Show discreet toast on restore
    setTimeout(() => {
      if (typeof showToast === 'function') showToast(LANG === 'en' ? 'Map restored from previous session' : t('persist_restored'));
    }, 500);
  } catch (e) {
    console.warn('restoreState error:', e);
  }
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
// SHARE MAP VIA URL HASH
// ═══════════════════════════════════════════════════════════════
function shareMapURL() {
  const modal = document.getElementById('share-modal');
  if (modal) {
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    return;
  }
  copyMapURL();
}

function buildShareHashURL() {
  try {
    const geo = getEnrichedGeoJSON();
    if (!geo.features.length) {
      manaAlert(LANG === 'en' ? 'No elements to share.' : t('persist_no_elements'), 'warning');
      return null;
    }
    const encoded = encodeURIComponent(JSON.stringify(geo));
    const roomId = (typeof window.manaCollabGetOrCreateRoomId === 'function')
      ? window.manaCollabGetOrCreateRoomId()
      : '';
    if (roomId) {
      window.location.hash = '#room=' + encodeURIComponent(roomId) + '&map=' + encoded;
    } else {
      window.location.hash = '#map=' + encoded;
    }
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      showToast(LANG === 'en' ? 'Link copied ✓' : 'Enlace copiado ✓');
    }).catch(() => {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('Enlace copiado \u2713');
    });
    window.location.hash = '#map=' + encoded;
    return window.location.href;
  } catch (e) {
    manaAlert((LANG === 'en' ? 'Error generating link: ' : 'Error al generar el enlace: ') + e.message, 'error');
    return null;
  }
}

function buildMapShareURL(mapId, encodedGeo, roomId) {
  const share = new URL(window.location.origin + '/map/');
  if (mapId) {
    share.searchParams.set('map', mapId);
  } else if (encodedGeo) {
    share.hash = '#map=' + encodedGeo;
  }
  if (roomId) {
    share.searchParams.set('room', roomId);
    share.hash = '#room=' + encodeURIComponent(roomId);
  }
  return share.toString();
}

async function copyMapURL() {
  const geo = getEnrichedGeoJSON();
  if (!geo || !geo.features || !geo.features.length) {
    manaAlert(LANG === 'en' ? 'No elements to share.' : t('persist_no_elements'), 'warning');
    return;
  }
  const roomId = (typeof window.manaCollabGetOrCreateRoomId === 'function')
    ? window.manaCollabGetOrCreateRoomId()
    : '';
  const sharedMapId = await persistSharedMap(geo);
  const encoded = encodeURIComponent(JSON.stringify(geo));
  const url = buildMapShareURL(sharedMapId, encoded, roomId);
  if (!url) return;
  navigator.clipboard.writeText(url).then(() => {
    showToast(LANG === 'en' ? 'Link copied ✓' : 'Enlace copiado ✓');
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = url;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('Enlace copiado \u2713');
  });
}

async function restoreFromURL() {
  try {
    const search = new URLSearchParams(window.location.search || '');
    const gallerySlug = search.get('gallery') || search.get('slug');
    if (gallerySlug) {
      const db = getSharedMapsDb();
      if (db) {
        // Firestore read: load published map document from /maps for shared gallery links.
        const galleryDoc = await db.collection(MAPS_COLLECTION).doc(gallerySlug).get();
        const galleryPayload = galleryDoc && galleryDoc.exists ? galleryDoc.data() : null;
        const galleryGeo = galleryPayload && (galleryPayload.mapData || galleryPayload.geojson);
        if (galleryPayload && galleryPayload.isPublished && galleryGeo && galleryGeo.features && galleryGeo.features.length) {
          _importRestoredGeoJSON(galleryGeo);
          return true;
        }
        // Backward compatibility: read legacy /gallery docs created before this fix.
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
        // Backward compatibility: old links only had #map=...
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
  localStorage.removeItem('mana-maps-state');
  showToast('Dades guardades eliminades \u2713');
}

// ═══════════════════════════════════════════════════════════════
// P3.11: PROJECT NAME FOR EXPORTS
// ═══════════════════════════════════════════════════════════════
function getProjectName() {
  return localStorage.getItem('mana-project-name') || t('map_name_placeholder');
}

function setProjectName(name) {
  const clean = name.trim() || t('map_name_placeholder');
  localStorage.setItem('mana-project-name', clean);
  const input = document.getElementById('project-name-input');
  if (input) input.value = clean;
  showToast('Nom del projecte: ' + clean);
}

// ═══════════════════════════════════════════════════════════════
// INIT: restore from URL hash first, then localStorage
// ═══════════════════════════════════════════════════════════════
(async function initPersistence() {
  const restoredFromUrl = await restoreFromURL();
  if (!restoredFromUrl) restoreState();
})();
