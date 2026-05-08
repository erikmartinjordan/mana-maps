// ── collab.js ─ Real-time collaboration presence + basic map sync (Firestore) ──
(function() {
  var CFG = window.ManaFirebase && window.ManaFirebase.getConfig();

  var APP_PREFIX = 'mana-collab-';
  var APPLYING_REMOTE = false;
  var PUSH_TIMER = null;
  var HEARTBEAT_TIMER = null;
  var PRESENCE_UNSUBSCRIBE = null;
  var CURSOR_PUSH_TIMER = null;
  var LAST_CURSOR_SENT_AT = 0;
  var LAST_REMOTE_APPLIED_AT_MS = 0;
  var ROOM_ID = null;
  var REMOTE_CURSOR_MARKERS = {};
  var REMOTE_CURSOR_LAYER = null;
  var CLIENT_ID = sessionStorage.getItem(APP_PREFIX + 'client-id') || Math.random().toString(36).slice(2, 10);
  var PRESENCE_USER_ID = CLIENT_ID;
  sessionStorage.setItem(APP_PREFIX + 'client-id', CLIENT_ID);

  var userName = localStorage.getItem(APP_PREFIX + 'user-name');
  if (!userName) {
    userName = (typeof LANG !== 'undefined' && LANG === 'en' ? 'User ' : 'Usuario ') + CLIENT_ID.slice(0, 4).toUpperCase();
    localStorage.setItem(APP_PREFIX + 'user-name', userName);
  }

  function tCollab(es, en) {
    return (typeof LANG !== 'undefined' && LANG === 'en') ? en : es;
  }

  function parseHashParams() {
    var hash = window.location.hash || '';
    var search = new URLSearchParams(window.location.search || '');
    if (!hash) return { room: search.get('room') || '', map: search.get('map') || '' };
    if (hash.indexOf('#map=') === 0) return { room: search.get('room') || '', map: hash.substring(5) };
    var p = new URLSearchParams(hash.substring(1));
    return {
      room: p.get('room') || search.get('room') || '',
      map: p.get('map') || search.get('map') || ''
    };
  }

  function randomRoomId() {
    return 'r-' + Math.random().toString(36).slice(2, 10);
  }

  function getOrCreateRoomId() {
    if (ROOM_ID) return ROOM_ID;
    var fromHash = parseHashParams().room;
    if (fromHash) {
      ROOM_ID = fromHash;
      return ROOM_ID;
    }
    var fromLocal = localStorage.getItem(APP_PREFIX + 'room-id');
    if (fromLocal) {
      ROOM_ID = fromLocal;
      return ROOM_ID;
    }
    ROOM_ID = randomRoomId();
    localStorage.setItem(APP_PREFIX + 'room-id', ROOM_ID);
    return ROOM_ID;
  }

  window.manaCollabGetOrCreateRoomId = getOrCreateRoomId;

  function ensureFirebase() {
    if (typeof firebase === 'undefined') return null;
    try {
      if (!firebase.apps || !firebase.apps.length) { if (!CFG) return null; firebase.initializeApp(CFG); }
      return firebase.firestore();
    } catch (e) {
      console.warn('[collab] Firebase unavailable', e);
      return null;
    }
  }

  function waitForAuthUser(timeoutMs) {
    return new Promise(function(resolve) {
      if (!firebase || !firebase.auth || typeof firebase.auth !== 'function') {
        resolve(null);
        return;
      }
      var auth = firebase.auth();
      if (auth.currentUser && auth.currentUser.uid) {
        resolve(auth.currentUser);
        return;
      }
      var settled = false;
      var timer = setTimeout(function() {
        if (settled) return;
        settled = true;
        if (typeof unsubscribe === 'function') unsubscribe();
        resolve(auth.currentUser || null);
      }, timeoutMs || 5000);
      var unsubscribe = auth.onAuthStateChanged(function(user) {
        if (settled || !user) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(user);
      }, function() {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(null);
      });
    });
  }

  async function ensurePresenceUid() {
    try {
      if (firebase && firebase.auth && typeof firebase.auth === 'function') {
        if (firebase.auth().currentUser && firebase.auth().currentUser.uid) {
          PRESENCE_USER_ID = firebase.auth().currentUser.uid;
          return PRESENCE_USER_ID;
        }
        var authUser = await waitForAuthUser(6000);
        if (authUser && authUser.uid) {
          PRESENCE_USER_ID = authUser.uid;
          return PRESENCE_USER_ID;
        }
      }
    } catch (e) {
      console.warn('[collab] ensurePresenceUid fallback', e);
    }
    return null;
  }

  function getDeterministicColor(uid) {
    var palette = ['#0ea5e9', '#10b981', '#f59e0b', '#a855f7', '#ef4444', '#14b8a6', '#6366f1', '#f43f5e'];
    var source = uid || 'anon';
    var hash = 0;
    for (var i = 0; i < source.length; i++) hash = ((hash << 5) - hash + source.charCodeAt(i)) | 0;
    return palette[Math.abs(hash) % palette.length];
  }

  function getInitials(name) {
    var safe = (name || 'U').trim();
    if (!safe) return 'U';
    var parts = safe.split(/\s+/).slice(0, 2);
    return parts.map(function(p) { return p.charAt(0).toUpperCase(); }).join('') || 'U';
  }

  function getPresenceEl() {
    var el = document.getElementById('presence-avatars');
    if (el) return el;
    var topbarRight = document.querySelector('#topbar .topbar-right');
    if (!topbarRight) return null;
    el = document.createElement('div');
    el.id = 'presence-avatars';
    el.className = 'presence-avatars';
    el.setAttribute('aria-label', tCollab('Usuarios en línea', 'Users online'));
    el.innerHTML = '<div class="presence-avatars-list"></div><span class="presence-avatars-count"></span>';
    topbarRight.insertBefore(el, topbarRight.firstChild);
    return el;
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderPresence(users) {
    var el = getPresenceEl();
    if (!el) return;
    var avatars = el.querySelector('.presence-avatars-list');
    var count = el.querySelector('.presence-avatars-count');
    if (!avatars || !count) return;
    if (!users.length) {
      avatars.innerHTML = '';
      count.textContent = '';
      el.style.display = 'none';
      return;
    }
    el.style.display = 'inline-flex';
    avatars.innerHTML = users.slice(0, 8).map(function(u) {
      var bg = u.color || getDeterministicColor(u.uid || u.clientId);
      var initial = getInitials(u.displayName || u.name || 'User');
      var title = u.displayName || u.name || 'User';
      return '<span class="presence-avatar" style="background:' + bg + '" title="' + title + '">' + initial + '</span>';
    }).join('');
    count.textContent = users.length;
  }

  function ensureCursorLayer() {
    if (REMOTE_CURSOR_LAYER || typeof L === 'undefined' || typeof map === 'undefined' || !map) return REMOTE_CURSOR_LAYER;
    REMOTE_CURSOR_LAYER = L.layerGroup().addTo(map);
    return REMOTE_CURSOR_LAYER;
  }

  function renderRemoteCursors(users) {
    var layer = ensureCursorLayer();
    if (!layer || typeof L === 'undefined') return;
    var active = {};
    var now = Date.now();

    users.forEach(function(u) {
      if (!u || !u.uid || u.uid === PRESENCE_USER_ID) return;
      var c = u.cursor;
      if (!c || typeof c.lat !== 'number' || typeof c.lng !== 'number') return;
      var seenAt = c.updatedAtMs || u.lastSeenMs || 0;
      if (!seenAt || now - seenAt > 12000) return;

      active[u.uid] = true;
      var label = escapeHtml(u.displayName || u.name || 'User');
      var activity = escapeHtml(u.activity || '');
      var markerHtml = '<div class="collab-live-cursor" style="--cursor-color:' + (u.color || '#0ea5e9') + '">' +
        '<div class="collab-live-cursor-pointer"></div>' +
        '<div class="collab-live-cursor-label">' + label + (activity ? '<span>' + activity + '</span>' : '') + '</div>' +
      '</div>';

      if (!REMOTE_CURSOR_MARKERS[u.uid]) {
        REMOTE_CURSOR_MARKERS[u.uid] = L.marker([c.lat, c.lng], {
          interactive: false,
          icon: L.divIcon({
            className: 'collab-live-cursor-marker',
            html: markerHtml,
            iconSize: [210, 42],
            iconAnchor: [4, 4]
          })
        }).addTo(layer);
      } else {
        REMOTE_CURSOR_MARKERS[u.uid].setLatLng([c.lat, c.lng]);
        REMOTE_CURSOR_MARKERS[u.uid].setIcon(L.divIcon({
          className: 'collab-live-cursor-marker',
          html: markerHtml,
          iconSize: [210, 42],
          iconAnchor: [4, 4]
        }));
      }
    });

    Object.keys(REMOTE_CURSOR_MARKERS).forEach(function(uid) {
      if (active[uid]) return;
      layer.removeLayer(REMOTE_CURSOR_MARKERS[uid]);
      delete REMOTE_CURSOR_MARKERS[uid];
    });
  }

  var currentActivity = '';
  function updatePresenceStatus(activity) {
    currentActivity = activity || '';
    if (!window._manaCollabPresenceRef) return;
    var presenceUid = PRESENCE_USER_ID;
    window._manaCollabPresenceRef.set({
      // Firestore write: heartbeat for this viewer in maps/{mapId}/presence/{userId}.
      uid: presenceUid,
      displayName: userName,
      color: getDeterministicColor(presenceUid),
      name: userName,
      activity: currentActivity,
      clientId: CLIENT_ID,
      lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAtMs: Date.now(),
      lastSeenMs: Date.now()
    }, { merge: true }).catch(function(err) {
      console.warn('[collab] presence update failed', err);
    });
  }

  function updatePresenceCursor(latlng) {
    if (!window._manaCollabPresenceRef) return;
    var payload = {
      cursor: latlng ? { lat: latlng.lat, lng: latlng.lng, updatedAtMs: Date.now() } : null,
      lastSeenMs: Date.now(),
      updatedAtMs: Date.now()
    };
    window._manaCollabPresenceRef.set(payload, { merge: true }).catch(function(err) {
      console.warn('[collab] cursor update failed', err);
    });
  }

  function scheduleCursorSync(latlng) {
    var now = Date.now();
    var minInterval = 120;
    if (now - LAST_CURSOR_SENT_AT >= minInterval) {
      LAST_CURSOR_SENT_AT = now;
      updatePresenceCursor(latlng);
      return;
    }
    if (CURSOR_PUSH_TIMER) clearTimeout(CURSOR_PUSH_TIMER);
    CURSOR_PUSH_TIMER = setTimeout(function() {
      LAST_CURSOR_SENT_AT = Date.now();
      updatePresenceCursor(latlng);
    }, minInterval);
  }

  function hookActivitySignals() {
    if (typeof setTool === 'function') {
      var _setTool = setTool;
      window.setTool = function(tool) {
        updatePresenceStatus(tCollab('Usando ' + tool, 'Using ' + tool));
        return _setTool(tool);
      };
    }
    if (typeof startEdit === 'function') {
      var _startEdit = startEdit;
      window.startEdit = function() {
        updatePresenceStatus(tCollab('Editando geometrías', 'Editing geometries'));
        return _startEdit();
      };
    }
    if (typeof stopEdit === 'function') {
      var _stopEdit = stopEdit;
      window.stopEdit = function() {
        updatePresenceStatus(tCollab('Navegando mapa', 'Browsing map'));
        return _stopEdit();
      };
    }
    if (typeof map !== 'undefined' && map && map.on) {
      map.on('draw:created', function() { updatePresenceStatus(tCollab('Añadió elemento', 'Added feature')); });
      map.on('draw:edited', function() { updatePresenceStatus(tCollab('Editó elemento', 'Edited feature')); });
      map.on('draw:deleted', function() { updatePresenceStatus(tCollab('Eliminó elemento', 'Deleted feature')); });
      map.on('moveend', function() { if (!currentActivity) updatePresenceStatus(tCollab('Navegando mapa', 'Browsing map')); });
      map.on('mousemove', function(e) { scheduleCursorSync(e && e.latlng ? e.latlng : null); });
      map.on('mouseout', function() { scheduleCursorSync(null); });
    }
    if (typeof drawnItems !== 'undefined' && drawnItems && drawnItems.on) {
      drawnItems.on('click', function(e) {
        var n = (e.layer && e.layer._manaName) ? e.layer._manaName : tCollab('elemento', 'feature');
        updatePresenceStatus(tCollab('Editando: ' + n, 'Editing: ' + n));
      });
    }
  }

  function hookRealtimeSync(db) {
    if (typeof saveState !== 'function' || typeof getEnrichedGeoJSON !== 'function') return;
    var originalSave = saveState;

    function sanitizeFirestorePayload(value) {
      try {
        return JSON.parse(JSON.stringify(value));
      } catch (e) {
        console.warn('[collab] sanitize payload failed', e);
        return null;
      }
    }

    function pushStateNow() {
      if (window.manaSharedAccess && window.manaSharedAccess.canEdit === false) return;
      if (APPLYING_REMOTE || !window._manaCollabRoomRef) return;
      var geo;
      try {
        geo = getEnrichedGeoJSON();
      } catch (e) {
        console.warn('[collab] getEnrichedGeoJSON failed', e);
        return;
      }
      var cleanGeo = sanitizeFirestorePayload(geo);
      if (!cleanGeo || !cleanGeo.features) return;
      window._manaCollabRoomRef.set({
        state: cleanGeo,
        lastEditor: userName,
        lastEditorId: CLIENT_ID,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAtMs: Date.now()
      }, { merge: true }).catch(function(err) {
        console.warn('[collab] push state failed', err);
      });

      if (window._manaCollabMapRef) {
        window._manaCollabMapRef.set({
          mapData: cleanGeo,
          geojson: cleanGeo,
          featureCount: Array.isArray(cleanGeo.features) ? cleanGeo.features.length : 0,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAtMs: Date.now(),
          lastEditor: userName,
          lastEditorId: CLIENT_ID
        }, { merge: true }).catch(function(err) {
          console.warn('[collab] push map snapshot failed', err);
        });
      }
    }

    function schedulePush() {
      if (PUSH_TIMER) clearTimeout(PUSH_TIMER);
      PUSH_TIMER = setTimeout(pushStateNow, 700);
    }

    window.saveState = function() {
      originalSave();
      if (window.manaSharedAccess && window.manaSharedAccess.canEdit === false) return;
      if (!APPLYING_REMOTE) schedulePush();
    };

    function applyRemoteState(remoteGeo, meta) {
      if (!remoteGeo || !remoteGeo.features) return;
      if (!meta || meta.lastEditorId === CLIENT_ID) return;
      if (typeof replaceMapWithGeoJSON !== 'function') return;
      var remoteUpdatedAtMs = Number(meta.updatedAtMs || 0);
      if (remoteUpdatedAtMs && remoteUpdatedAtMs <= LAST_REMOTE_APPLIED_AT_MS) return;
      LAST_REMOTE_APPLIED_AT_MS = Math.max(LAST_REMOTE_APPLIED_AT_MS, remoteUpdatedAtMs || Date.now());
      APPLYING_REMOTE = true;
      try {
        replaceMapWithGeoJSON(remoteGeo);
        updatePresenceStatus(tCollab('Sincronizado desde ' + (meta.lastEditor || 'otro usuario'), 'Synced from ' + (meta.lastEditor || 'another user')));
      } finally {
        setTimeout(function() { APPLYING_REMOTE = false; }, 50);
      }
    }

    window._manaCollabRoomRef.onSnapshot(function(doc) {
      var data = doc && doc.data ? doc.data() : null;
      if (!data) return;
      applyRemoteState(data.state, data);
    }, function(err) {
      console.warn('[collab] room sync subscription failed', err);
    });

    if (window._manaCollabMapRef) {
      window._manaCollabMapRef.onSnapshot(function(doc) {
        var data = doc && doc.data ? doc.data() : null;
        if (!data) return;
        applyRemoteState(data.mapData || data.geojson, data);
      }, function(err) {
        console.warn('[collab] map sync subscription failed', err);
      });
    }
  }

  async function init() {
    var db = ensureFirebase();
    if (!db) return;
    var presenceUid = await ensurePresenceUid();
    var canUsePresence = !!presenceUid;
    if (!canUsePresence) console.warn('[collab] no authenticated user; continuing map sync without presence');
    var params = parseHashParams();
    var activeMapId = params.map || new URLSearchParams(window.location.search || '').get('gallery') || params.room;
    if (!activeMapId) return;
    ROOM_ID = params.room || activeMapId;

    window._manaCollabRoomRef = db.collection('collabRooms').doc(ROOM_ID);
    var mapRef = db.collection('maps').doc(activeMapId);
    window._manaCollabMapRef = mapRef;
    window._manaCollabPresenceRef = canUsePresence ? mapRef.collection('presence').doc(PRESENCE_USER_ID) : null;

    if (canUsePresence) {
      var presenceCol = mapRef.collection('presence');
      if (PRESENCE_UNSUBSCRIBE) PRESENCE_UNSUBSCRIBE();
      // Firestore read: subscribe to active viewers/editors for this shared map.
      PRESENCE_UNSUBSCRIBE = presenceCol.onSnapshot(function(snap) {
        var now = Date.now();
        var users = [];
        snap.forEach(function(doc) {
          var d = doc.data() || {};
          var lastSeenMs = d.lastSeenMs || d.updatedAtMs || 0;
          if (!lastSeenMs || now - lastSeenMs > 60000) return;
          users.push({
            uid: d.uid || doc.id,
            displayName: d.displayName || d.name || 'User',
            color: d.color || getDeterministicColor(d.uid || doc.id),
            activity: d.activity || '',
            cursor: d.cursor || null,
            lastSeenMs: lastSeenMs
          });
        });
        renderPresence(users);
        renderRemoteCursors(users);
      }, function(err) {
        console.warn('[collab] presence subscribe failed; disabling presence', err);
        renderPresence([]);
      });
    }

    if (canUsePresence) {
      updatePresenceStatus(tCollab('Navegando mapa', 'Browsing map'));
      if (HEARTBEAT_TIMER) clearInterval(HEARTBEAT_TIMER);
      HEARTBEAT_TIMER = setInterval(function() {
        updatePresenceStatus(currentActivity || tCollab('Navegando mapa', 'Browsing map'));
      }, 30000);
    }

    window.addEventListener('beforeunload', function() {
      if (window._manaCollabPresenceRef) {
        // Firestore write: remove presence entry when tab/page is closing.
        window._manaCollabPresenceRef.delete().catch(function() {});
      }
      if (CURSOR_PUSH_TIMER) clearTimeout(CURSOR_PUSH_TIMER);
    });

    hookActivitySignals();
    hookRealtimeSync(db);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
