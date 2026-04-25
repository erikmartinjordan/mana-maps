// ── gallery-page.js ─ renders /gallery ─

(function() {
  const GALLERY_COLLECTION = 'galleryMaps';
  const LOCAL_GALLERY_KEY = 'mana-gallery-maps';
  const firebaseConfig = {
    apiKey: 'AIzaSyBjtW1SUhgnLyagREHESEl4Vb4zI5yHgDg',
    authDomain: 'mana-maps-pro.firebaseapp.com',
    databaseURL: 'https://mana-maps-pro-default-rtdb.firebaseio.com',
    projectId: 'mana-maps-pro',
    storageBucket: 'mana-maps-pro.firebasestorage.app',
    messagingSenderId: '212469378297',
    appId: '1:212469378297:web:83e17ed0e38dd202944628',
    measurementId: 'G-F1Z7C21BZ6'
  };

  function safeDate(tsMs) {
    if (!tsMs) return 'Sin fecha';
    try {
      return new Date(tsMs).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (_) {
      return 'Sin fecha';
    }
  }

  function getQueryMapId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('map');
  }

  function localMaps() {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_GALLERY_KEY) || '[]');
    } catch (_) {
      return [];
    }
  }

  async function remoteMaps() {
    if (typeof firebase === 'undefined') return [];
    try {
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(firebaseConfig);
      const db = firebase.firestore();
      const snap = await db.collection(GALLERY_COLLECTION).orderBy('createdAt', 'desc').limit(36).get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
      console.warn('gallery remoteMaps fallback local:', e);
      return [];
    }
  }

  function renderCards(items) {
    const list = document.getElementById('gallery-list');
    if (!list) return;
    if (!items.length) {
      list.innerHTML = '<div class="empty">Todavía no hay mapas publicados. Comparte uno desde el botón “Compartir” en /map.</div>';
      return;
    }

    list.innerHTML = items.map(function(item) {
      const created = item.createdAtMs || (item.createdAt && item.createdAt.toMillis ? item.createdAt.toMillis() : 0);
      return '' +
        '<a class="card" href="/gallery/?map=' + encodeURIComponent(item.id) + '">' +
          '<div class="thumb"><span class="dot d1"></span><span class="dot d2"></span><span class="dot d3"></span></div>' +
          '<h3 class="title">' + (item.name || 'Mapa sin título') + '</h3>' +
          '<div class="meta">' +
            '<span>' + (item.featureCount || 0) + ' elementos</span>' +
            '<span>·</span>' +
            '<span>' + safeDate(created) + '</span>' +
          '</div>' +
        '</a>';
    }).join('');
  }

  function showFeatured(item) {
    if (!item || !item.geojson || !window.L) return;

    const wrap = document.getElementById('featured-wrap');
    const meta = document.getElementById('featured-meta');
    const target = document.getElementById('featured-map');
    if (!wrap || !meta || !target) return;
    wrap.style.display = 'block';

    const map = L.map('featured-map', { zoomControl: false });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    const layer = L.geoJSON(item.geojson).addTo(map);
    const bounds = layer.getBounds();
    if (bounds && bounds.isValid()) map.fitBounds(bounds.pad(0.2));

    const created = item.createdAtMs || (item.createdAt && item.createdAt.toMillis ? item.createdAt.toMillis() : 0);
    meta.textContent = (item.name || 'Mapa sin título') + ' · ' + (item.featureCount || 0) + ' elementos · ' + safeDate(created);
  }

  async function init() {
    const [remote, local] = await Promise.all([remoteMaps(), Promise.resolve(localMaps())]);
    const localById = Object.fromEntries(local.map(x => [x.id, x]));
    const merged = [...remote];
    local.forEach(function(item) {
      if (!merged.find(function(r) { return r.id === item.id; })) merged.push(item);
    });
    merged.sort(function(a, b) {
      const aTs = a.createdAtMs || (a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0);
      const bTs = b.createdAtMs || (b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0);
      return bTs - aTs;
    });

    renderCards(merged);

    const mapId = getQueryMapId();
    if (!mapId) return;
    const selected = merged.find(function(i) { return i.id === mapId; }) || localById[mapId];
    if (selected) showFeatured(selected);
  }

  init();
})();
