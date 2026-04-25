// ── collab.js ─ Real-time collaboration presence + basic map sync (Firestore) ──
(function() {
  var CFG = {
    apiKey: "AIzaSyBjtW1SUhgnLyagREHESEl4Vb4zI5yHgDg",
    authDomain: "mana-maps-pro.firebaseapp.com",
    databaseURL: "https://mana-maps-pro-default-rtdb.firebaseio.com",
    projectId: "mana-maps-pro",
    storageBucket: "mana-maps-pro.firebasestorage.app",
    messagingSenderId: "212469378297",
    appId: "1:212469378297:web:83e17ed0e38dd202944628",
    measurementId: "G-F1Z7C21BZ6"
  };

  var APP_PREFIX = 'mana-collab-';
  var APPLYING_REMOTE = false;
  var PUSH_TIMER = null;
  var HEARTBEAT_TIMER = null;
  var PRESENCE_UNSUBSCRIBE = null;
  var ROOM_ID = null;
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
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(CFG);
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
        await firebase.auth().signInAnonymously();
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
      map.on('moveend', function() { if (!currentActivity) updatePresenceStatus(tCollab('Navegando mapa', 'Browsing map')); });
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

    function pushStateNow() {
      if (APPLYING_REMOTE || !window._manaCollabRoomRef) return;
      var geo;
      try {
        geo = getEnrichedGeoJSON();
      } catch (e) {
        console.warn('[collab] getEnrichedGeoJSON failed', e);
        return;
      }
      window._manaCollabRoomRef.set({
        state: geo,
        lastEditor: userName,
        lastEditorId: CLIENT_ID,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAtMs: Date.now()
      }, { merge: true }).catch(function(err) {
        console.warn('[collab] push state failed', err);
      });
    }

    function schedulePush() {
      if (PUSH_TIMER) clearTimeout(PUSH_TIMER);
      PUSH_TIMER = setTimeout(pushStateNow, 700);
    }

    window.saveState = function() {
      originalSave();
      if (!APPLYING_REMOTE) schedulePush();
    };

    window._manaCollabRoomRef.onSnapshot(function(doc) {
      var data = doc && doc.data ? doc.data() : null;
      if (!data || !data.state) return;
      if (data.lastEditorId === CLIENT_ID) return;
      if (typeof replaceMapWithGeoJSON !== 'function') return;
      APPLYING_REMOTE = true;
      try {
        replaceMapWithGeoJSON(data.state);
        updatePresenceStatus(tCollab('Sincronizado desde ' + (data.lastEditor || 'otro usuario'), 'Synced from ' + (data.lastEditor || 'another user')));
      } finally {
        setTimeout(function() { APPLYING_REMOTE = false; }, 50);
      }
    });
  }

  async function init() {
    var db = ensureFirebase();
    if (!db) return;
    var presenceUid = await ensurePresenceUid();
    if (!presenceUid) {
      console.warn('[collab] no authenticated user; skipping presence sync');
      return;
    }
    var params = parseHashParams();
    var activeMapId = params.map || new URLSearchParams(window.location.search || '').get('gallery') || params.room;
    if (!activeMapId) return;
    ROOM_ID = params.room || activeMapId;

    window._manaCollabRoomRef = db.collection('collabRooms').doc(ROOM_ID);
    var mapRef = db.collection('maps').doc(activeMapId);
    window._manaCollabPresenceRef = mapRef.collection('presence').doc(PRESENCE_USER_ID);

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
          activity: d.activity || ''
        });
      });
      renderPresence(users);
    });

    updatePresenceStatus(tCollab('Navegando mapa', 'Browsing map'));
    if (HEARTBEAT_TIMER) clearInterval(HEARTBEAT_TIMER);
    HEARTBEAT_TIMER = setInterval(function() {
      updatePresenceStatus(currentActivity || tCollab('Navegando mapa', 'Browsing map'));
    }, 30000);

    window.addEventListener('beforeunload', function() {
      if (window._manaCollabPresenceRef) {
        // Firestore write: remove presence entry when tab/page is closing.
        window._manaCollabPresenceRef.delete().catch(function() {});
      }
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
