// ── tracking.js — Firebase event tracking for Maña Maps ──
// Loaded after app modules so it can safely wrap existing globals.
// Works with the Firebase web SDK when present, and falls back to the public
// Firestore REST endpoint on pages that do not load the SDK (gallery, landing).

(function() {
  if (window.__manaTrackingLoaded) return;
  window.__manaTrackingLoaded = true;

  // ── Config resolution ──
  function resolveConfig() {
    if (window.ManaFirebase && typeof window.ManaFirebase.getConfig === 'function') {
      try {
        var c = window.ManaFirebase.getConfig();
        if (c && c.projectId) return c;
      } catch (e) {}
    }
    var cfgs = window.MANA_FIREBASE_CONFIGS;
    if (cfgs) {
      var host = (typeof location !== 'undefined' && location.hostname) || '';
      var env = window.MANA_FIREBASE_ENV || (/pre|localhost|127\.0\.0\.1/.test(host) ? 'pre' : 'pro');
      return cfgs[env] || cfgs.pro || cfgs.pre || null;
    }
    return null;
  }

  var config = resolveConfig();

  // ── Internal traffic opt-out ──
  // Visit any page with ?notrack=1 once (or set localStorage 'mana-notrack')
  // to keep the owner's own sessions out of the metrics.
  try {
    if (new URLSearchParams(location.search).get('notrack') === '1') {
      localStorage.setItem('mana-notrack', '1');
    }
  } catch (e) {}

  var INTERNAL_UIDS = ['VQaLSYq64cQ8GGtCe0JbHkYFKUT2'];
  var disabled = false;
  try { disabled = localStorage.getItem('mana-notrack') === '1'; } catch (e) { disabled = false; }

  function handleErr(err) {
    var code = err && (err.code || err.message || '');
    if (code === 'permission-denied' || String(code).indexOf('Missing or insufficient permissions') !== -1) {
      disabled = true;
      return;
    }
    console.warn('[MañaTrack]', err);
  }

  // ── REST fallback (no web SDK on landing/gallery) ──
  function toFirestoreValue(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') {
      return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    }
    if (typeof v === 'object') {
      var fields = {};
      Object.keys(v).forEach(function(k) { fields[k] = toFirestoreValue(v[k]); });
      return { mapValue: { fields: fields } };
    }
    return { stringValue: String(v) };
  }

  function restWrite(cfg, fields) {
    if (!cfg || !cfg.projectId || !cfg.apiKey || typeof fetch !== 'function') return;
    var url = 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(cfg.projectId) +
      '/databases/(default)/documents/events?key=' + encodeURIComponent(cfg.apiKey);
    try {
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: fields }),
        keepalive: true
      }).catch(function() {});
    } catch (e) {}
  }

  var hasSdk = (typeof firebase !== 'undefined') && !!config;
  var db = null;
  if (hasSdk) {
    try {
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(config);
      db = firebase.firestore();
    } catch (e) { db = null; }
  }

  function track(name, params) {
    if (disabled) return;
    params = params || {};

    if (db) {
      try {
        var ref = db.collection('events');
        if (ref && typeof ref.add === 'function') {
          ref.add({
            name: name,
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            params: params
          }).catch(handleErr);
          return;
        }
      } catch (e) { /* fall through to REST */ }
    }

    if (config) {
      restWrite(config, {
        name: { stringValue: name },
        timestamp: { timestampValue: new Date().toISOString() },
        params: toFirestoreValue(params)
      });
    }
  }

  // Expose globally
  window.trackEvent = track;

  // ── Internal traffic detection via signed-in uid ──
  if (hasSdk && firebase.auth) {
    try {
      firebase.auth().onAuthStateChanged(function(u) {
        if (u && u.uid && INTERNAL_UIDS.indexOf(u.uid) !== -1) {
          disabled = true;
          try { localStorage.setItem('mana-notrack', '1'); } catch (e) {}
        }
      });
    } catch (e) {}
  }

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

  // ── 1. Session start (now with page + referrer) ──
  fetchApproxLocation().then(function(loc) {
    var params = {
      path: location.pathname + location.search,
      referrer: document.referrer || '',
      lang: (document.documentElement && document.documentElement.lang) || '',
      title: document.title || ''
    };
    if (loc) params.location = loc;
    track('sessionstart', params);
  });

  // ── 2. Export — wrap exportAs ──
  if (typeof exportAs === 'function') {
    var _exp = exportAs;
    window.exportAs = function(fmt) {
      track('export', { format: fmt });
      return _exp(fmt);
    };
  }

  // ── 3. Features drawn ──
  if (typeof map !== 'undefined') {
    map.on('draw:created', function(e) {
      track('featuredrawn', { tool: e.layerType || 'unknown' });
    });
  }

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
