// ── tracking.js — Firebase event tracking for Maña Maps ──
// Loaded AFTER all app modules so it can safely wrap existing globals.
// Zero changes required to other JS files.

(function() {
  firebase.initializeApp({
    apiKey: "AIzaSyBjtW1SUhgnLyagREHESEl4Vb4zI5yHgDg",
    authDomain: "mana-maps-pro.firebaseapp.com",
    databaseURL: "https://mana-maps-pro-default-rtdb.firebaseio.com",
    projectId: "mana-maps-pro",
    storageBucket: "mana-maps-pro.firebasestorage.app",
    messagingSenderId: "212469378297",
    appId: "1:212469378297:web:83e17ed0e38dd202944628",
    measurementId: "G-F1Z7C21BZ6"
  });

  var db = firebase.firestore();

  // Session ID (unique per tab)
  var sid = sessionStorage.getItem('mana-sid');
  if (!sid) {
    sid = Math.random().toString(36).substr(2, 10);
    sessionStorage.setItem('mana-sid', sid);
  }

  function track(name, params) {
    params = params || {};
    params.sid = sid;
    db.collection('events').add({
      name: name,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      params: params
    }).catch(function() {});
  }

  // Expose globally
  window.trackEvent = track;

  // ── 1. Session start ──
  track('sessionstart');

  // ── 2. Export — wrap exportAs ──
  var _exp = window.exportAs;
  if (_exp) {
    window.exportAs = function(fmt) {
      track('export', { format: fmt });
      return _exp(fmt);
    };
  }

  // ── 3. Features drawn ──
  // Lines & polygons via Leaflet.Draw
  if (window.map) {
    map.on('draw:created', function(e) {
      track('featuredrawn', { tool: e.layerType || 'unknown' });
    });
  }

  // Points via manual tool — wrap setTool + watch layeradd
  var _ptActive = false;
  var _st = window.setTool;
  if (_st) {
    window.setTool = function(t) {
      _ptActive = (t === 'point');
      return _st(t);
    };
  }
  if (window.drawnItems) {
    drawnItems.on('layeradd', function(e) {
      if (_ptActive && !window.chatBusy && e.layer instanceof L.Marker && !e.layer._manaGroupId) {
        _ptActive = false;
        track('featuredrawn', { tool: 'point' });
      }
    });
  }

  // ── 4. Chat messages — wrap sendMsg ──
  var _sm = window.sendMsg;
  if (_sm) {
    window.sendMsg = function() {
      var p = 'local';
      try { if (hasAIKey()) p = manaSettings().provider || 'openai'; } catch(e) {}
      track('chatmessage', { provider: p });
      return _sm();
    };
    var btn = document.getElementById('chat-send');
    if (btn) btn.onclick = window.sendMsg;
  }
})();