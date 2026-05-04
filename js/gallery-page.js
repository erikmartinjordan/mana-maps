// ── gallery-page.js ─ renders /gallery ─

(function() {
  const MAPS_COLLECTION = 'maps';
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

  function isFirestoreIndexError(err) {
    if (!err) return false;
    var msg = String(err && err.message ? err.message : err).toLowerCase();
    return msg.indexOf('requires an index') >= 0;
  }

  function getQueryMapId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('slug') || params.get('map');
  }

  async function remoteMaps() {
    if (typeof firebase === 'undefined') return [];
    try {
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(firebaseConfig);
      const db = firebase.firestore();
      // Firestore read: initial published maps list for gallery bootstrap.
      let snap = null;
      try {
        snap = await db.collection(MAPS_COLLECTION)
          .where('isPublished', '==', true)
          .orderBy('createdAt', 'desc')
          .limit(36)
          .get();
      } catch (createdAtErr) {
        if (!isFirestoreIndexError(createdAtErr)) console.warn('gallery remoteMaps createdAt query failed, retrying with createdAtMs:', createdAtErr);
        try {
          snap = await db.collection(MAPS_COLLECTION)
            .where('isPublished', '==', true)
            .orderBy('createdAtMs', 'desc')
            .limit(36)
            .get();
        } catch (createdAtMsErr) {
          if (!isFirestoreIndexError(createdAtMsErr)) console.warn('gallery remoteMaps createdAtMs query failed, retrying without orderBy:', createdAtMsErr);
          snap = await db.collection(MAPS_COLLECTION)
            .where('isPublished', '==', true)
            .limit(100)
            .get();
        }
      }
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      items.sort(function(a, b) {
        const aTs = a.createdAtMs || (a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0);
        const bTs = b.createdAtMs || (b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0);
        return bTs - aTs;
      });
      return items.slice(0, 36);
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

  async function readChunkedPublishedGeo(db, item) {
    if (!db || !item || !item.geojsonChunked || !item.geojsonChunked.chunkCount) return null;
    try {
      const chunkMeta = item.geojsonChunked;
      const chunkSnap = await db.collection(MAPS_COLLECTION)
        .doc(item.slug || item.id)
        .collection(chunkMeta.collection || 'geoChunks')
        .orderBy('index', 'asc')
        .limit(chunkMeta.chunkCount)
        .get();
      if (!chunkSnap || chunkSnap.empty) return null;
      var raw = '';
      chunkSnap.forEach(function(doc) {
        var data = doc.data() || {};
        raw += typeof data.text === 'string' ? data.text : '';
      });
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && parsed.features ? parsed : null;
    } catch (e) {
      console.warn('gallery read chunked geo failed:', e);
      return null;
    }
  }

  function renderCards(items) {
    const list = document.getElementById('gallery-list');
    if (!list) return;
    list.classList.remove('empty-state');
    if (!items.length) {
      list.classList.add('empty-state');
      list.innerHTML = '<div class="empty">Todavía no hay mapas publicados. Comparte uno desde el botón "Compartir" en /map.</div>';
      return;
    }

    list.innerHTML = items.map(function(item) {
      const created = item.createdAtMs || (item.createdAt && item.createdAt.toMillis ? item.createdAt.toMillis() : 0);
      const geo = getPublishedGeo(item);
      const thumb = renderMapPreviewSVG(item.mapPreview || buildPreviewFromGeo(geo));
      const likes = item.likes || 0;
      const authorHandle = item.authorHandle || item.createdBy || '';
      const mapSlug = item.slug || item.id;
      return '' +
        '<div class="card">' +
          '<a class="card-link" href="/map/?gallery=' + encodeURIComponent(mapSlug) + '&map=' + encodeURIComponent(mapSlug) + '&room=' + encodeURIComponent(mapSlug) + '">' +
            '<div class="thumb">' + thumb + '</div>' +
            '<h3 class="title">' + (item.title || item.name || 'Mapa sin título') + '</h3>' +
          '</a>' +
          '<div class="meta">' +
            (authorHandle ? '<span class="meta-author">@' + authorHandle + '</span><span>·</span>' : '') +
            '<span>' + (item.featureCount || 0) + ' elementos</span>' +
            '<span>·</span>' +
            '<span>' + safeDate(created) + '</span>' +
          '</div>' +
          '<div class="card-actions">' +
            '<button class="card-action-btn card-like-btn" data-map-id="' + mapSlug + '" data-author="' + authorHandle + '" onclick="galleryLike(this)">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>' +
              '<span class="like-count">' + likes + '</span>' +
            '</button>' +
            '<button class="card-action-btn card-fork-btn" data-map-id="' + mapSlug + '" data-author="' + authorHandle + '" onclick="galleryFork(this)">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v1a2 2 0 01-2 2H8a2 2 0 01-2-2V9"/><line x1="12" y1="12" x2="12" y2="15"/></svg>' +
              '<span>Fork</span>' +
            '</button>' +
          '</div>' +
        '</div>';
    }).join('');
  }

  // ═══════════════════════════════════════════════════════════════
  // LIKE & FORK HANDLERS
  // ═══════════════════════════════════════════════════════════════

  window.galleryLike = async function(btn) {
    var mapId = btn.getAttribute('data-map-id');
    var author = btn.getAttribute('data-author');
    if (!mapId) return;

    // Auth gate: only authenticated users can like
    if (window.manaAuth) {
      var user = window.manaAuth.getCurrentUser();
      if (!user || user.isAnonymous) {
        window.manaAuth.openAuthModal();
        return;
      }
    }

    // Optimistic UI update
    var countEl = btn.querySelector('.like-count');
    var current = parseInt(countEl.textContent || '0', 10);
    countEl.textContent = current + 1;
    btn.classList.add('liked');

    // Persist like
    if (window.manaMaps && author) {
      try {
        await window.manaMaps.likeMap(mapId, author);
      } catch (e) {
        console.warn('like failed:', e);
        countEl.textContent = current; // rollback
        btn.classList.remove('liked');
      }
    }
  };

  window.galleryFork = async function(btn) {
    var mapId = btn.getAttribute('data-map-id');
    var author = btn.getAttribute('data-author');
    if (!mapId || !author) return;

    // Auth gate: only authenticated users can fork
    if (window.manaAuth) {
      var user = window.manaAuth.getCurrentUser();
      if (!user || user.isAnonymous) {
        window.manaAuth.openAuthModal();
        return;
      }
    }

    btn.disabled = true;
    btn.querySelector('span').textContent = '...';

    try {
      if (window.manaMaps) {
        await window.manaMaps.forkMap(mapId, author);
        btn.querySelector('span').textContent = '✓';
        btn.classList.add('forked');
      }
    } catch (e) {
      console.warn('fork failed:', e);
      btn.querySelector('span').textContent = 'Fork';
      btn.disabled = false;
    }
  };

  function getPublishedGeo(item) {
    if (!item) return null;
    if (item.geojson && item.geojson.features) return item.geojson;
    if (item.mapData && item.mapData.features) return item.mapData;
    var geoText = item.geojsonText || item.mapDataText;
    if (typeof geoText !== 'string' || !geoText) return null;
    try {
      var parsed = JSON.parse(geoText);
      return parsed && parsed.features ? parsed : null;
    } catch (e) {
      console.warn('gallery parse geojsonText failed:', e);
      return null;
    }
  }

  async function getPublishedGeoAsync(item) {
    var immediate = getPublishedGeo(item);
    if (immediate) return immediate;
    if (!item || !item.geojsonChunked || !item.geojsonChunked.chunkCount) return null;
    if (item._geojsonLoaded && item._geojsonLoaded.features) return item._geojsonLoaded;
    if (typeof firebase === 'undefined') return null;
    try {
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(firebaseConfig);
      var db = firebase.firestore();
      var chunked = await readChunkedPublishedGeo(db, item);
      if (chunked && chunked.features) {
        item._geojsonLoaded = chunked;
        return chunked;
      }
    } catch (e) {
      console.warn('gallery getPublishedGeoAsync failed:', e);
    }
    return null;
  }

  function buildPreviewFromGeo(geo) {
    if (!geo || !Array.isArray(geo.features) || !geo.features.length) return null;
    var points = [];
    geo.features.forEach(function(feature) {
      var geom = feature && feature.geometry;
      if (!geom || !Array.isArray(geom.coordinates)) return;
      if (geom.type === 'Point') points.push(geom.coordinates);
      if (geom.type === 'LineString' || geom.type === 'MultiPoint') geom.coordinates.forEach(function(c) { points.push(c); });
      if (geom.type === 'Polygon' || geom.type === 'MultiLineString') geom.coordinates.forEach(function(ring) {
        if (Array.isArray(ring)) ring.forEach(function(c) { points.push(c); });
      });
      if (geom.type === 'MultiPolygon') geom.coordinates.forEach(function(poly) {
        if (!Array.isArray(poly)) return;
        poly.forEach(function(ring) {
          if (Array.isArray(ring)) ring.forEach(function(c) { points.push(c); });
        });
      });
    });
    if (!points.length) return null;
    var minX = Infinity; var maxX = -Infinity; var minY = Infinity; var maxY = -Infinity;
    points.forEach(function(c) {
      var x = Number(c[0]); var y = Number(c[1]);
      if (!isFinite(x) || !isFinite(y)) return;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    });
    if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minY) || !isFinite(maxY)) return null;
    return {
      bbox: [minX, minY, maxX, maxY],
      features: geo.features.slice(0, 40).map(function(feature) {
        var props = feature && feature.properties ? feature.properties : {};
        return {
          geometry: feature ? feature.geometry : null,
          color: props._manaColor || props.color || '#0ea5e9'
        };
      })
    };
  }

  function renderMapPreviewSVG(preview) {
    if (!preview || !Array.isArray(preview.bbox) || !Array.isArray(preview.features)) return '';
    var bbox = preview.bbox;
    var minX = Number(bbox[0]); var minY = Number(bbox[1]); var maxX = Number(bbox[2]); var maxY = Number(bbox[3]);
    if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return '';
    var spanX = Math.max(maxX - minX, 1e-9);
    var spanY = Math.max(maxY - minY, 1e-9);
    var pad = 0.12;
    function toX(x) { return (((x - minX) / spanX) * (1 - 2 * pad) + pad) * 100; }
    function toY(y) { return (((maxY - y) / spanY) * (1 - 2 * pad) + pad) * 100; }
    function ringToPath(ring) {
      if (!Array.isArray(ring) || !ring.length) return '';
      return ring.map(function(c, idx) {
        var x = toX(Number(c[0])).toFixed(2);
        var y = toY(Number(c[1])).toFixed(2);
        return (idx ? 'L' : 'M') + x + ' ' + y;
      }).join(' ') + ' Z';
    }
    var body = '';
    preview.features.forEach(function(entry) {
      var geom = entry && entry.geometry;
      if (!geom) return;
      var color = entry.color || '#0ea5e9';
      if (geom.type === 'Point' && Array.isArray(geom.coordinates)) {
        body += '<circle cx="' + toX(Number(geom.coordinates[0])).toFixed(2) + '" cy="' + toY(Number(geom.coordinates[1])).toFixed(2) + '" r="2.7" fill="' + color + '" fill-opacity="0.9"/>';
      } else if (geom.type === 'LineString' && Array.isArray(geom.coordinates)) {
        var pts = geom.coordinates.map(function(c) { return toX(Number(c[0])).toFixed(2) + ',' + toY(Number(c[1])).toFixed(2); }).join(' ');
        body += '<polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
      } else if (geom.type === 'Polygon' && Array.isArray(geom.coordinates)) {
        var path = ringToPath(geom.coordinates[0]);
        if (path) body += '<path d="' + path + '" fill="' + color + '" fill-opacity="0.2" stroke="' + color + '" stroke-width="1.3"/>';
      }
    });
    if (!body) return '';
    return '<svg class="thumb-preview" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' + body + '</svg>';
  }

  async function showFeatured(item) {
    const geo = await getPublishedGeoAsync(item);
    if (!item || !geo || !window.L) return;

    const wrap = document.getElementById('featured-wrap');
    const meta = document.getElementById('featured-meta');
    const target = document.getElementById('featured-map');
    if (!wrap || !meta || !target) return;
    wrap.style.display = 'block';

    const map = L.map('featured-map', { zoomControl: false });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    const layer = L.geoJSON(geo).addTo(map);
    const bounds = layer.getBounds();
    if (bounds && bounds.isValid()) map.fitBounds(bounds.pad(0.2));

    const created = item.createdAtMs || (item.createdAt && item.createdAt.toMillis ? item.createdAt.toMillis() : 0);
    meta.textContent = (item.name || 'Mapa sin título') + ' · ' + (item.featureCount || 0) + ' elementos · ' + safeDate(created);
  }

  async function init() {
    const merged = await remoteMaps();
    merged.sort(function(a, b) {
      const aTs = a.createdAtMs || (a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0);
      const bTs = b.createdAtMs || (b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0);
      return bTs - aTs;
    });

    renderCards(merged);
    subscribeToPublishedMaps(merged);

    const mapId = getQueryMapId();
    if (!mapId) return;
    let selected = merged.find(function(i) { return (i.slug || i.id) === mapId; });
    if (!selected) {
      selected = await remoteMapById(mapId);
      if (selected) {
        merged.unshift(selected);
        renderCards(merged);
      }
    }
    if (selected) await showFeatured(selected);
  }

  init();

  function subscribeToPublishedMaps(mergedList) {
    if (typeof firebase === 'undefined') return;
    try {
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(firebaseConfig);
      const db = firebase.firestore();
      // Firestore read: real-time gallery listener for published maps only.
      var baseQuery = db.collection(MAPS_COLLECTION)
        .where('isPublished', '==', true);

      function applySnapshot(snap) {
        const remote = snap.docs.map(function(d) { return { id: d.id, ...d.data() }; });
        remote.sort(function(a, b) {
          const aTs = a.createdAtMs || (a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0);
          const bTs = b.createdAtMs || (b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0);
          return bTs - aTs;
        });
        mergedList.length = 0;
        mergedList.push.apply(mergedList, remote.slice(0, 36));
        renderCards(mergedList);
      }

      baseQuery
        .orderBy('createdAt', 'desc')
        .limit(36)
        .onSnapshot(applySnapshot, function(e) {
          if (!isFirestoreIndexError(e)) {
            console.warn('gallery realtime subscribe failed:', e);
          }
          baseQuery.limit(100).onSnapshot(applySnapshot, function(fallbackErr) {
            console.warn('gallery realtime fallback subscribe failed:', fallbackErr);
          });
        });
    } catch (e) {
      console.warn('gallery realtime unavailable:', e);
    }
  }
})();
