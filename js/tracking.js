// ── tracking.js — Firebase event tracking for Maña Maps ──
// Loaded AFTER all app modules so it can safely wrap existing globals.
// Zero changes required to other JS files.

(function() {
  var firebaseConfig = window.ManaFirebase && window.ManaFirebase.getConfig();
  if (typeof firebase === 'undefined' || !firebaseConfig) {
    window.trackEvent = function() {};
    return;
  }
  if (!firebase.apps || !firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  var db = firebase.firestore();
  var trackingDisabled = false;

  function track(name, params) {
    if (trackingDisabled) return;
    params = params || {};
    db.collection('events').add({
      name: name,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      params: params
    }).catch(function(err) {
      var code = err && (err.code || err.message || '');
      if (code === 'permission-denied' || code.indexOf('Missing or insufficient permissions') !== -1) {
        trackingDisabled = true;
        return;
      }
      console.warn('[MañaTrack]', name, err);
    });
  }

  // Expose globally
  window.trackEvent = track;

  // ── 0. Approximate location (IP → country/city) ──
  // Solo se guarda país, ciudad, coords redondeadas a nivel ciudad y la hora
  // local de conexión. Nunca se almacena la IP. Si el servicio falla, el
  // evento se registra sin ubicación.
  function roundCoord(n) {
    var v = Number(n);
    if (!isFinite(v)) return null;
    return Math.round(v * 100) / 100;
  }

  function localTime(date) {
    return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
  }

  function fetchApproxLocation() {
    if (typeof fetch !== 'function') return Promise.resolve(null);
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function() { controller.abort(); }, 4000) : null;
    return fetch('https://ipwho.is/', controller ? { signal: controller.signal } : undefined)
      .then(function(res) { return res.ok ? res.json() : null; })
      .then(function(data) {
        if (timer) clearTimeout(timer);
        if (!data || data.success === false) return null;
        if (typeof data.latitude !== 'number' || typeof data.longitude !== 'number') return null;
        var city = (data.city || '').trim();
        var country = (data.country || '').trim();
        if (!city && !country) return null;
        return {
          country: country,
          city: city,
          lat: roundCoord(data.latitude),
          lng: roundCoord(data.longitude),
          time: localTime(new Date())
        };
      })
      .catch(function() {
        if (timer) clearTimeout(timer);
        return null;
      });
  }

  // ── 1. Session start ──
  fetchApproxLocation().then(function(loc) {
    track('sessionstart', loc ? { location: loc } : {});
  });

  // ── 2. Export — wrap exportAs ──
  // exportAs is a function declaration → available both as global and window.*
  if (typeof exportAs === 'function') {
    var _exp = exportAs;
    window.exportAs = function(fmt) {
      track('export', { format: fmt });
      return _exp(fmt);
    };
  }

  // ── 3. Features drawn ──
  // map & drawnItems are declared with const → NOT on window, but accessible
  // as global lexical variables via typeof check
  if (typeof map !== 'undefined') {
    map.on('draw:created', function(e) {
      track('featuredrawn', { tool: e.layerType || 'unknown' });
    });
  }

  // Points via manual tool — wrap setTool + watch layeradd
  var _ptActive = false;
  if (typeof setTool === 'function') {
    var _st = setTool;
    window.setTool = function(t) {
      _ptActive = (t === 'point');
      return _st(t);
    };
  }
  if (typeof drawnItems !== 'undefined') {
    drawnItems.on('layeradd', function(e) {
      if (_ptActive && !window.chatBusy && e.layer instanceof L.Marker && !e.layer._manaGroupId) {
        _ptActive = false;
        track('featuredrawn', { tool: 'point' });
      }
    });
  }

  // ── 4. Chat messages — wrap sendMsg ──
  if (typeof sendMsg === 'function') {
    var _sm = sendMsg;
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
