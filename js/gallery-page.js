// ── gallery-page.js ─ renders /gallery ─

(function() {
  const MAPS_COLLECTION = 'maps';
  const LIKES_STORAGE_KEY = 'mana-gallery-likes';
  const firebaseConfig = window.ManaFirebase && window.ManaFirebase.getConfig();


  function escHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

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

  // ═══════════════════════════════════════════════════════════════
  // TOAST (self-contained, the gallery page has no toast infra)
  // ═══════════════════════════════════════════════════════════════

  var _toastTimer = null;

  function galleryToast(message, opts) {
    var options = opts || {};
    var toast = document.getElementById('gallery-toast');
    if (!toast) {
      var style = document.createElement('style');
      style.textContent = '.gallery-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%) translateY(16px);z-index:10001;padding:11px 18px;border-radius:14px;background:rgba(17,18,20,.94);color:#fff;font-family:DM Sans,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:13px;font-weight:600;box-shadow:0 16px 44px rgba(0,0,0,.26);opacity:0;pointer-events:none;transition:opacity .22s,transform .22s;max-width:min(420px,calc(100vw - 32px));text-align:center}.gallery-toast.open{opacity:1;transform:translateX(-50%) translateY(0)}.gallery-toast a{color:#7dd3fc;font-weight:700;text-decoration:none;margin-left:6px}.gallery-toast a:hover{text-decoration:underline}';
      document.head.appendChild(style);
      toast = document.createElement('div');
      toast.id = 'gallery-toast';
      toast.className = 'gallery-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      document.body.appendChild(toast);
    }
    toast.innerHTML = escHtml(message) + (options.linkUrl && options.linkLabel
      ? '<a href="' + options.linkUrl + '">' + escHtml(options.linkLabel) + ' &rarr;</a>'
      : '');
    requestAnimationFrame(function() { toast.classList.add('open'); });
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function() { toast.classList.remove('open'); }, options.duration || 3800);
  }

  // ═══════════════════════════════════════════════════════════════
  // REMOTE DATA
  // ═══════════════════════════════════════════════════════════════

  async function remoteMaps() {
    if (typeof firebase === 'undefined') return [];
    try {
      if (!firebase.apps || !firebase.apps.length) { if (!firebaseConfig) return []; firebase.initializeApp(firebaseConfig); }
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
      if (!firebase.apps || !firebase.apps.length) { if (!firebaseConfig) return null; firebase.initializeApp(firebaseConfig); }
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
      if (!firebase.apps || !firebase.apps.length) { if (!firebaseConfig) return null; firebase.initializeApp(firebaseConfig); }
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

  // ═══════════════════════════════════════════════════════════════
  // THUMBNAILS (shared preview library)
  // ═══════════════════════════════════════════════════════════════

  function renderThumb(item) {
    if (!window.ManaMapPreview) return '';
    var built = window.ManaMapPreview.build(getPublishedGeo(item));
    return window.ManaMapPreview.renderSVG(built || item.mapPreview);
  }

  // ═══════════════════════════════════════════════════════════════
  // LIKED STATE (Firestore rules only allow +1, so likes are one-shot)
  // ═══════════════════════════════════════════════════════════════

  function getLikedMapIds() {
    try {
      var raw = localStorage.getItem(LIKES_STORAGE_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function hasLiked(mapId) {
    return getLikedMapIds().indexOf(mapId) >= 0;
  }

  function markLiked(mapId) {
    try {
      var ids = getLikedMapIds();
      if (ids.indexOf(mapId) < 0) {
        ids.push(mapId);
        localStorage.setItem(LIKES_STORAGE_KEY, JSON.stringify(ids.slice(-500)));
      }
    } catch (e) {}
  }

  function unmarkLiked(mapId) {
    try {
      var ids = getLikedMapIds().filter(function(id) { return id !== mapId; });
      localStorage.setItem(LIKES_STORAGE_KEY, JSON.stringify(ids));
    } catch (e) {}
  }

  // ═══════════════════════════════════════════════════════════════
  // CARDS
  // ═══════════════════════════════════════════════════════════════

  function renderCards(items) {
    const list = document.getElementById('gallery-list');
    if (!list) return;
    list.classList.remove('empty-state');
    if (!items.length) {
      list.classList.add('empty-state');
      list.innerHTML = '<div class="empty">' +
        '<div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg></div>' +
        '<div class="empty-title">Todavía no hay mapas publicados</div>' +
        '<div class="empty-sub">Sé el primero: crea un mapa y compártelo desde el botón "Compartir" del editor.</div>' +
        '<a class="btn btn-primary" href="/map/">Crear mapa</a>' +
      '</div>';
      return;
    }

    list.innerHTML = items.map(function(item) {
      const created = item.createdAtMs || (item.createdAt && item.createdAt.toMillis ? item.createdAt.toMillis() : 0);
      const thumb = renderThumb(item);
      const likes = item.likes || 0;
      const authorHandle = item.authorHandle || '';
      const mapSlug = item.slug || item.id;
      var mode = item.shareMode || 'view';
      var likedClass = hasLiked(mapSlug) ? ' liked' : '';
      return '' +
        '<div class="card">' +
          '<a class="card-link" href="/map/index.html?gallery=' + encodeURIComponent(mapSlug) + '&map=' + encodeURIComponent(mapSlug) + '&room=' + encodeURIComponent(mapSlug) + '&mode=' + encodeURIComponent(mode) + '">' +
            '<div class="thumb">' + thumb + '</div>' +
            '<h3 class="title">' + escHtml(item.title || item.name || 'Mapa sin título') + '</h3>' +
          '</a>' +
          '<div class="meta">' +
            (authorHandle ? '<a class="meta-author" href="/@' + encodeURIComponent(authorHandle) + '">@' + escHtml(authorHandle) + '</a><span>·</span>' : '') +
            '<span>' + (item.featureCount || 0) + ' elementos</span>' +
            '<span>·</span>' +
            '<span>' + safeDate(created) + '</span>' +
          '</div>' +
          '<div class="card-actions">' +
            '<button class="card-action-btn card-like-btn' + likedClass + '" data-map-id="' + mapSlug + '" data-author="' + escHtml(authorHandle) + '" onclick="galleryLike(this)" aria-label="Me gusta">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>' +
              '<span class="like-count">' + likes + '</span>' +
            '</button>' +
            '<button class="card-action-btn card-fork-btn" data-map-id="' + mapSlug + '" data-author="' + escHtml(authorHandle) + '" onclick="galleryFork(this)">' +
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
    var author = btn.getAttribute('data-author') || '';
    if (!mapId) return;

    // Auth gate: only authenticated users can like
    if (window.manaAuth) {
      var user = window.manaAuth.getCurrentUser();
      if (!user || user.isAnonymous) {
        window.manaAuth.openAuthModal();
        return;
      }
    }

    // One like per map per browser: Firestore rules only allow +1 increments.
    if (hasLiked(mapId)) {
      galleryToast('Ya has marcado este mapa como favorito');
      btn.classList.add('liked');
      return;
    }

    // Optimistic UI update
    var countEl = btn.querySelector('.like-count');
    var current = parseInt(countEl.textContent || '0', 10);
    countEl.textContent = current + 1;
    btn.classList.add('liked');
    markLiked(mapId);

    // Persist like (works for every published map, author handle is optional)
    if (window.manaMaps && typeof window.manaMaps.likeMap === 'function') {
      try {
        await window.manaMaps.likeMap(mapId, author);
      } catch (e) {
        console.warn('like failed:', e);
        countEl.textContent = current; // rollback
        btn.classList.remove('liked');
        unmarkLiked(mapId);
        galleryToast('No se pudo guardar tu like. Inténtalo de nuevo.');
      }
    }
  };

  window.galleryFork = async function(btn) {
    var mapId = btn.getAttribute('data-map-id');
    var author = btn.getAttribute('data-author') || '';
    if (!mapId) return;

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
      if (window.manaMaps && typeof window.manaMaps.forkMap === 'function') {
        await window.manaMaps.forkMap(mapId, author);
        btn.querySelector('span').textContent = '✓';
        btn.classList.add('forked');
        galleryToast('Fork guardado en tus mapas', { linkUrl: '/my-maps/', linkLabel: 'Abrir Mis mapas', duration: 5200 });
        return;
      }
      throw new Error('fork-unavailable');
    } catch (e) {
      console.warn('fork failed:', e);
      btn.querySelector('span').textContent = 'Fork';
      btn.disabled = false;
      galleryToast('No se pudo hacer fork de este mapa.');
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // FEATURED MAP — pure MapLibre GL (no Leaflet bridge => no zoom desync)
  // ═══════════════════════════════════════════════════════════════

  var _featuredMap = null;

  function collectGeoBounds(geo) {
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    function walk(coords) {
      if (!Array.isArray(coords)) return;
      if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
        var x = coords[0], y = coords[1];
        if (!isFinite(x) || !isFinite(y)) return;
        // Normalize antimeridian-crossing longitudes into a sane range.
        if (x < -180) x += 360; else if (x > 180) x -= 360;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, Math.max(-86, y)); maxY = Math.max(maxY, Math.min(86, y));
        return;
      }
      coords.forEach(walk);
    }
    (geo.features || []).forEach(function(f) {
      if (f && f.geometry && Array.isArray(f.geometry.coordinates)) walk(f.geometry.coordinates);
    });
    if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minY) || !isFinite(maxY)) return null;
    return [[minX, minY], [maxX, maxY]];
  }

  function featuredPopupHtml(props) {
    var name = props && (props._manaName || props.name || props.Name);
    if (!name) return '';
    return '<div class="featured-popup">' + escHtml(String(name)) + '</div>';
  }

  function addFeaturedDataLayers(map, geo) {
    if (!map.getSource('featured-data')) {
      map.addSource('featured-data', { type: 'geojson', data: geo });
    } else {
      map.getSource('featured-data').setData(geo);
    }
    var colorExpr = ['coalesce', ['get', '_manaColor'], ['get', 'color'], '#0ea5e9'];
    var isPolygon = ['==', ['geometry-type'], 'Polygon'];
    var isLine = ['==', ['geometry-type'], 'LineString'];
    var isPoint = ['==', ['geometry-type'], 'Point'];

    map.addLayer({
      id: 'featured-fills', type: 'fill', source: 'featured-data', filter: isPolygon,
      paint: { 'fill-color': colorExpr, 'fill-opacity': 0.16 }
    });
    map.addLayer({
      id: 'featured-fill-outlines', type: 'line', source: 'featured-data', filter: isPolygon,
      layout: { 'line-join': 'round' },
      paint: { 'line-color': colorExpr, 'line-opacity': 0.9, 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 1, 10, 2.4] }
    });
    map.addLayer({
      id: 'featured-line-casing', type: 'line', source: 'featured-data', filter: isLine,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-opacity': 0.85, 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 2.6, 10, 6.4] }
    });
    map.addLayer({
      id: 'featured-lines', type: 'line', source: 'featured-data', filter: isLine,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': colorExpr, 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 1.4, 10, 3.6] }
    });
    map.addLayer({
      id: 'featured-point-halo', type: 'circle', source: 'featured-data', filter: isPoint,
      paint: { 'circle-color': '#ffffff', 'circle-opacity': 0.92, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 4.4, 10, 8.6] }
    });
    map.addLayer({
      id: 'featured-points', type: 'circle', source: 'featured-data', filter: isPoint,
      paint: {
        'circle-color': colorExpr,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 2.8, 10, 6],
        'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.2
      }
    });
    map.addLayer({
      id: 'featured-point-labels', type: 'symbol', source: 'featured-data', filter: isPoint,
      layout: {
        'text-field': ['coalesce', ['get', '_manaName'], ['get', 'name'], ['get', 'Name'], ''],
        'text-font': ['Noto Sans Regular'],
        'text-size': 10.5,
        'text-offset': [0, 1.05],
        'text-anchor': 'top',
        'text-optional': true,
        'text-max-width': 12
      },
      paint: { 'text-color': '#334155', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 }
    });

    var interactiveLayers = ['featured-points', 'featured-lines', 'featured-fills'];
    map.on('mousemove', function(e) {
      var feats = map.queryRenderedFeatures(e.point, { layers: interactiveLayers });
      map.getCanvas().style.cursor = feats.length ? 'pointer' : '';
    });
    map.on('click', function(e) {
      var feats = map.queryRenderedFeatures(e.point, { layers: interactiveLayers });
      if (!feats.length) return;
      var html = featuredPopupHtml(feats[0].properties);
      if (!html) return;
      new maplibregl.Popup({ closeButton: false, offset: 14, maxWidth: '260px' })
        .setLngLat(e.lngLat)
        .setHTML(html)
        .addTo(map);
    });
  }

  async function showFeatured(item) {
    if (!item) return;
    const geo = await getPublishedGeoAsync(item);

    const wrap = document.getElementById('featured-wrap');
    const meta = document.getElementById('featured-meta');
    const target = document.getElementById('featured-map');
    if (!wrap || !meta || !target) return;
    wrap.style.display = 'block';

    const titleEl = document.getElementById('featured-title');
    if (titleEl) titleEl.textContent = item.name || item.title || 'Mapa destacado';

    // Reset any previous instance (realtime updates can re-trigger).
    if (_featuredMap) {
      try { _featuredMap.remove(); } catch (e) {}
      _featuredMap = null;
    }
    target.innerHTML = '';

    if (!geo || !geo.features || !geo.features.length || !window.maplibregl) {
      // Graceful fallback: static high-quality preview, zero interaction.
      var fallbackSvg = window.ManaMapPreview
        ? window.ManaMapPreview.renderSVG(window.ManaMapPreview.build(geo) || item.mapPreview)
        : '';
      target.innerHTML = '<div class="featured-static">' + fallbackSvg + '</div>';
      return;
    }

    var styleUrl = window.MANA_BASEMAPS
      ? window.MANA_BASEMAPS.getStyleUrl(false)
      : 'https://tiles.openfreemap.org/styles/positron';

    var map = new maplibregl.Map({
      container: target,
      style: styleUrl,
      center: [0, 25],
      zoom: 1.4,
      minZoom: 1,
      maxZoom: 18,
      maxBounds: [[-179.9, -86], [179.9, 86]],
      renderWorldCopies: false,
      attributionControl: { compact: true }
    });
    _featuredMap = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.scrollZoom.setWheelZoomRate(1 / 240); // smooth, predictable wheel zoom

    var bounds = collectGeoBounds(geo);
    if (bounds) {
      map.fitBounds(bounds, { padding: { top: 40, bottom: 40, left: 48, right: 48 }, duration: 0, maxZoom: 11 });
    }

    map.on('load', function() { addFeaturedDataLayers(map, geo); });
    map.on('error', function(e) {
      if (e && e.error && e.error.status === 404) return; // ignore missing tiles
      console.warn('featured map error:', e && e.error ? e.error.message : e);
    });

    const created = item.createdAtMs || (item.createdAt && item.createdAt.toMillis ? item.createdAt.toMillis() : 0);
    const author = item.authorHandle ? '@' + item.authorHandle + ' · ' : '';
    meta.textContent = author + (item.featureCount || 0) + ' elementos · ' + safeDate(created);
  }

  // ═══════════════════════════════════════════════════════════════
  // INIT + REALTIME
  // ═══════════════════════════════════════════════════════════════

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
      if (!firebase.apps || !firebase.apps.length) { if (!firebaseConfig) return null; firebase.initializeApp(firebaseConfig); }
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
