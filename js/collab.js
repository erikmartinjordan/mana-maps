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
  var ROOM_ID = null;
  var CLIENT_ID = sessionStorage.getItem(APP_PREFIX + 'client-id') || Math.random().toString(36).slice(2, 10);
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

  function getPresenceEl() {
    var el = document.getElementById('collab-presence-pill');
    if (el) return el;
    var topbarRight = document.querySelector('#topbar .topbar-right');
    if (!topbarRight) return null;
    el = document.createElement('button');
    el.id = 'collab-presence-pill';
    el.className = 'collab-presence-pill';
    el.type = 'button';
    el.title = tCollab('Editar nombre', 'Edit name');
    el.innerHTML = '<span class="collab-avatars"></span><span class="collab-count"></span>';
    el.onclick = function() {
      var next = prompt(tCollab('Tu nombre para edición colaborativa:', 'Your collaboration name:'), userName);
      if (!next) return;
      userName = next.trim().slice(0, 24) || userName;
      localStorage.setItem(APP_PREFIX + 'user-name', userName);
      updatePresenceStatus(currentActivity || tCollab('Navegando mapa', 'Browsing map'));
    };
    topbarRight.insertBefore(el, topbarRight.firstChild);
    return el;
  }

  function renderPresence(users) {
    var el = getPresenceEl();
    if (!el) return;
    var avatars = el.querySelector('.collab-avatars');
    var count = el.querySelector('.collab-count');
    if (!avatars || !count) return;
    if (users.length <= 1) {
      avatars.innerHTML = '';
      count.textContent = '';
      el.classList.remove('is-active');
      el.style.display = 'none';
      return;
    }
    el.style.display = 'inline-flex';
    el.classList.add('is-active');
    var palette = ['#0ea5e9', '#10b981', '#f59e0b', '#a855f7', '#ef4444', '#14b8a6'];
    avatars.innerHTML = users.slice(0, 4).map(function(u, idx) {
      var bg = palette[idx % palette.length];
      var initial = (u.name || 'U').trim().charAt(0).toUpperCase() || 'U';
      return '<span class="collab-avatar" style="background:' + bg + '" title="' + (u.name || 'User') + '">' + initial + '</span>';
    });
    count.textContent = users.length;
  }

  var currentActivity = '';
  function updatePresenceStatus(activity) {
    currentActivity = activity || '';
    if (!window._manaCollabPresenceRef) return;
    window._manaCollabPresenceRef.set({
      name: userName,
      activity: currentActivity,
      clientId: CLIENT_ID,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAtMs: Date.now()
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

  function init() {
    var db = ensureFirebase();
    if (!db) return;
    var params = parseHashParams();
    if (!params.room) return;
    ROOM_ID = params.room;

    window._manaCollabRoomRef = db.collection('collabRooms').doc(ROOM_ID);
    window._manaCollabPresenceRef = window._manaCollabRoomRef.collection('presence').doc(CLIENT_ID);

    var presenceCol = window._manaCollabRoomRef.collection('presence');
    presenceCol.onSnapshot(function(snap) {
      var now = Date.now();
      var users = [];
      snap.forEach(function(doc) {
        var d = doc.data() || {};
        if (!d.updatedAtMs || now - d.updatedAtMs > 35000) return;
        users.push({ name: d.name || 'User', activity: d.activity || '' });
      });
      renderPresence(users);
    });

    updatePresenceStatus(tCollab('Navegando mapa', 'Browsing map'));
    if (HEARTBEAT_TIMER) clearInterval(HEARTBEAT_TIMER);
    HEARTBEAT_TIMER = setInterval(function() {
      updatePresenceStatus(currentActivity || tCollab('Navegando mapa', 'Browsing map'));
    }, 15000);

    window.addEventListener('beforeunload', function() {
      if (window._manaCollabPresenceRef) {
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
