// ── gallery-page.js ─ renders /gallery ─

(function() {
  const MAPS_COLLECTION = 'maps';
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
    return params.get('slug') || params.get('map');
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
      // Firestore read: initial published maps list for gallery bootstrap.
      const snap = await db.collection(MAPS_COLLECTION)
        .where('isPublished', '==', true)
        .orderBy('createdAt', 'desc')
        .limit(36)
        .get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
      console.warn('gallery remoteMaps fallback local:', e);
      return [];
    }
  }

  async function remoteMapById(id) {
    if (!id || typeof firebase === 'undefined') return null;
    try {
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(firebaseConfig);
      const db = firebase.firestore();
      // Firestore read: fetch one published map by id for direct /gallery?slug= links.
      const doc = await db.collection(MAPS_COLLECTION).doc(id).get();
      if (!doc.exists) return null;
      const data = doc.data() || {};
      if (!data.isPublished) return null;
      return { id: doc.id, ...data };
    } catch (e) {
      console.warn('gallery remoteMapById failed:', e);
      return null;
    }
  }

  function renderCards(items) {
    const list = document.getElementById('gallery-list');
    if (!list) return;
    list.classList.remove('empty-state');
    if (!items.length) {
      list.classList.add('empty-state');
      list.innerHTML = '<div class="empty">Todavía no hay mapas publicados. Comparte uno desde el botón “Compartir” en /map.</div>';
      return;
    }

    list.innerHTML = items.map(function(item) {
      const created = item.createdAtMs || (item.createdAt && item.createdAt.toMillis ? item.createdAt.toMillis() : 0);
      return '' +
        '<a class="card" href="/map/?gallery=' + encodeURIComponent(item.slug || item.id) + '&map=' + encodeURIComponent(item.slug || item.id) + '&room=' + encodeURIComponent(item.slug || item.id) + '">' +
          '<div class="thumb"><span class="dot d1"></span><span class="dot d2"></span><span class="dot d3"></span></div>' +
          '<h3 class="title">' + (item.title || item.name || 'Mapa sin título') + '</h3>' +
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
    subscribeToPublishedMaps(local, merged);

    const mapId = getQueryMapId();
    if (!mapId) return;
    let selected = merged.find(function(i) { return (i.slug || i.id) === mapId; }) || localById[mapId];
    if (!selected) {
      selected = await remoteMapById(mapId);
      if (selected) {
        merged.unshift(selected);
        renderCards(merged);
      }
    }
    if (selected) showFeatured(selected);
  }

  init();

  function subscribeToPublishedMaps(localCache, mergedList) {
    if (typeof firebase === 'undefined') return;
    try {
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(firebaseConfig);
      const db = firebase.firestore();
      // Firestore read: real-time gallery listener for published maps only.
      db.collection(MAPS_COLLECTION)
        .where('isPublished', '==', true)
        .orderBy('createdAt', 'desc')
        .limit(36)
        .onSnapshot(function(snap) {
          const remote = snap.docs.map(function(d) { return { id: d.id, ...d.data() }; });
          const merged = [...remote];
          localCache.forEach(function(item) {
            if (!merged.find(function(r) { return r.id === item.id; })) merged.push(item);
          });
          merged.sort(function(a, b) {
            const aTs = a.createdAtMs || (a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0);
            const bTs = b.createdAtMs || (b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0);
            return bTs - aTs;
          });
          mergedList.length = 0;
          mergedList.push.apply(mergedList, merged);
          renderCards(mergedList);
        }, function(e) {
          console.warn('gallery realtime subscribe failed:', e);
        });
    } catch (e) {
      console.warn('gallery realtime unavailable:', e);
    }
  }
})();
