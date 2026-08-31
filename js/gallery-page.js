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

  // Fuente y año de los datos del mapa (dataSource + dataDate/dataYear). Se
  // muestra en las tarjetas para dar credibilidad y aportar contexto SEO.
  function dataSourceLabel(item) {
    if (!item) return '';
    var src = item.dataSource || '';
    var year = '';
    if (item.dataDate) {
      year = String(item.dataDate).slice(0, 4);
    } else if (item.dataYear) {
      year = String(item.dataYear);
    }
    if (!src && !year) return '';
    var parts = [];
    if (src) parts.push('Fuente: ' + src);
    if (year) parts.push(year);
    return parts.join(' · ');
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
      if (!snap || !snap.docs) return [];
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      items.sort(function(a, b) {
        const aTs = a.createdAtMs || (a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0);
        const bTs = b.createdAtMs || (b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0);
        return bTs - aTs;
      });
      const seen = {};
      return items.filter(function(item) {
        var key = item.slug || item.id;
        if (!key || seen[key]) return false;
        seen[key] = true;
        return true;
      }).slice(0, 40);
    } catch (e) {
      console.warn('gallery remoteMaps error:', e);
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

  function thumbAccessibleLabel(item) {
    var title = item && (item.title || item.name) || 'Mapa sin título';
    var mapId = item && (item.slug || item.id);
    // Include the stable map identifier so two maps with the same title still
    // expose different names to assistive technology.
    return 'Vista previa del mapa «' + title + '»' + (mapId ? ' (' + mapId + ')' : '');
  }

  function renderThumb(item) {
    if (!window.ManaMapPreview) return '';
    var built = window.ManaMapPreview.build(getPublishedGeo(item));
    var svg = window.ManaMapPreview.renderSVG(built || item.mapPreview);
    if (!svg) return '';
    return svg.replace(
      '<svg class="thumb-preview"',
      '<svg class="thumb-preview" role="img" aria-label="' + escHtml(thumbAccessibleLabel(item)) + '"'
    );
  }

  // Sizes the thumb box to the map's aspect ratio so the preview fills the
  // whole card instead of leaving empty margins. aspectOf already returns the
  // clamped canvas aspect that renderSVG uses; content-box makes the ratio
  // apply to the area inside the 1px border so the match is exact.
  function thumbAspectStyle(item) {
    if (!window.ManaMapPreview || !window.ManaMapPreview.aspectOf) return '';
    var preview = window.ManaMapPreview.build(getPublishedGeo(item)) || item.mapPreview;
    var aspect = window.ManaMapPreview.aspectOf(preview);
    if (!isFinite(aspect) || aspect <= 0) return '';
    return ' style="aspect-ratio:' + aspect + ';height:auto;box-sizing:content-box"';
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
      var sourceLabel = dataSourceLabel(item);
      var tags = Array.isArray(item.tags) ? item.tags : [];
      var tagsHtml = tags.length
        ? '<div class="card-tags">' + tags.map(function(t) { return '<span class="card-tag">' + escHtml(t) + '</span>'; }).join('') + '</div>'
        : '';
      var desc = item.description || '';
      var descHtml = desc ? '<p class="card-desc">' + escHtml(desc) + '</p>' : '';
      return '' +
        '<div class="card">' +
          '<a class="card-link" href="/map/index.html?gallery=' + encodeURIComponent(mapSlug) + '&map=' + encodeURIComponent(mapSlug) + '&room=' + encodeURIComponent(mapSlug) + '&mode=' + encodeURIComponent(mode) + '">' +
            '<div class="thumb"' + thumbAspectStyle(item) + '>' + thumb + '</div>' +
            '<h3 class="title">' + escHtml(item.title || item.name || 'Mapa sin título') + '</h3>' +
          '</a>' +
          '<div class="meta">' +
            (authorHandle ? '<a class="meta-author" href="/@' + encodeURIComponent(authorHandle) + '">@' + escHtml(authorHandle) + '</a><span>·</span>' : '') +
            '<span>' + (item.featureCount || 0) + ' elementos</span>' +
            '<span>·</span>' +
            '<span>' + safeDate(created) + '</span>' +
          '</div>' +
          (sourceLabel ? '<div class="meta-source" title="Fuente y año de los datos">' + escHtml(sourceLabel) + '</div>' : '') +
          tagsHtml +
          descHtml +
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
  // FILTER BY TAG
  // ═══════════════════════════════════════════════════════════════

  var _allMaps = [];
  var _activeFilter = null;

  function getTagLabel(tag) {
    return tag.charAt(0).toUpperCase() + tag.slice(1);
  }

  function getTagSlug(tag) {
    return tag.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '-');
  }

  function collectTags(maps) {
    var tagSet = {};
    maps.forEach(function(m) {
      var tags = Array.isArray(m.tags) ? m.tags : [];
      tags.forEach(function(t) { tagSet[t] = true; });
    });
    return Object.keys(tagSet).sort(function(a, b) {
      return getTagLabel(a).localeCompare(getTagLabel(b), 'es');
    });
  }

  function renderFilterBar(maps) {
    var bar = document.getElementById('filter-bar');
    var statusEl = document.getElementById('filter-status');
    if (!bar) return;
    var tags = collectTags(maps);
    if (!tags.length) {
      bar.hidden = true;
      return;
    }

    // Build tag→count map for display
    var counts = {};
    tags.forEach(function(t) { counts[t] = 0; });
    maps.forEach(function(m) {
      var mt = Array.isArray(m.tags) ? m.tags : [];
      mt.forEach(function(t) { if (counts[t] !== undefined) counts[t]++; });
    });

    // Read initial filter from URL
    var params = new URLSearchParams(window.location.search);
    var initialTag = params.get('tag');
    if (initialTag) {
      // Find the actual tag matching the slug
      var matched = tags.find(function(t) { return getTagSlug(t) === initialTag; });
      if (matched) _activeFilter = matched;
    }

    var html = '<span class="filter-bar-label">Categorías:</span>';
    tags.forEach(function(tag) {
      var slug = getTagSlug(tag);
      var active = _activeFilter === tag;
      html += '<button class="filter-btn' + (active ? ' active' : '') + '" data-tag="' + escHtml(tag) + '" data-slug="' + escHtml(slug) + '" aria-pressed="' + active + '">' +
        escHtml(getTagLabel(tag)) +
        ' <span class="filter-count">' + counts[tag] + '</span>' +
      '</button>';
    });
    html += '<button class="filter-clear' + (_activeFilter ? ' visible' : '') + '" id="filter-clear-btn" aria-label="Mostrar todos los mapas">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
      ' Limpiar' +
    '</button>';
    bar.innerHTML = html;
    bar.hidden = false;

    // Attach click handlers
    bar.querySelectorAll('.filter-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var tag = btn.getAttribute('data-tag');
        if (_activeFilter === tag) {
          _activeFilter = null;
        } else {
          _activeFilter = tag;
        }
        applyFilter();
      });
    });

    var clearBtn = bar.querySelector('#filter-clear-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', function() {
        _activeFilter = null;
        applyFilter();
      });
    }

    // Apply initial filter from URL
    if (_activeFilter) applyFilter();
  }

  function applyFilter() {
    var bar = document.getElementById('filter-bar');
    var statusEl = document.getElementById('filter-status');
    var list = document.getElementById('gallery-list');

    // Update button states
    if (bar) {
      bar.querySelectorAll('.filter-btn').forEach(function(btn) {
        var tag = btn.getAttribute('data-tag');
        var active = _activeFilter === tag;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active);
      });
      var clearBtn = bar.querySelector('#filter-clear-btn');
      if (clearBtn) clearBtn.classList.toggle('visible', !!_activeFilter);
    }

    // Update URL
    var url = new URL(window.location.href);
    if (_activeFilter) {
      url.searchParams.set('tag', getTagSlug(_activeFilter));
    } else {
      url.searchParams.delete('tag');
    }
    window.history.replaceState(null, '', url);

    // Filter the cards
    var filtered = _activeFilter
      ? _allMaps.filter(function(m) {
          var tags = Array.isArray(m.tags) ? m.tags : [];
          return tags.indexOf(_activeFilter) >= 0;
        })
      : _allMaps;

    renderCards(filtered);

    // Announce to screen readers
    if (statusEl) {
      if (_activeFilter) {
        statusEl.textContent = 'Mostrando ' + filtered.length + ' mapa' + (filtered.length !== 1 ? 's' : '') + ' en «' + getTagLabel(_activeFilter) + '».';
      } else {
        statusEl.textContent = 'Mostrando todos los mapas (' + filtered.length + ').';
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // LIKE & FORK HANDLERS
  // ═══════════════════════════════════════════════════════════════

  window.galleryLike = function(btn) {
    var mapId = btn.getAttribute('data-map-id');
    var author = btn.getAttribute('data-author') || '';
    if (!mapId) return;

    var doLike = async function() {
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

    // Auth gate: only authenticated users can like. requireAuth re-runs the
    // action right after login so the like is not lost.
    if (window.manaAuth && typeof window.manaAuth.requireAuth === 'function') {
      window.manaAuth.requireAuth(doLike);
      return;
    }
    doLike();
  };

  window.galleryFork = function(btn) {
    var mapId = btn.getAttribute('data-map-id');
    var author = btn.getAttribute('data-author') || '';
    if (!mapId) return;

    var doFork = async function() {
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

    // Auth gate: only authenticated users can fork.
    if (window.manaAuth && typeof window.manaAuth.requireAuth === 'function') {
      window.manaAuth.requireAuth(doFork);
      return;
    }
    doFork();
  };

  // ═══════════════════════════════════════════════════════════════
  // FEATURED MAP — pure MapLibre GL (no Leaflet bridge => no zoom desync)
  // ═══════════════════════════════════════════════════════════════

  var _featuredMap = null;

  function ensureLegendStyles() {
    if (document.getElementById('featured-legend-style')) return;
    var st = document.createElement('style');
    st.id = 'featured-legend-style';
    st.textContent =
      '.featured-legend{position:absolute;left:12px;bottom:34px;z-index:6;background:rgba(255,255,255,.93);' +
      'backdrop-filter:blur(6px);border:1px solid rgba(16,24,40,.14);border-radius:12px;padding:10px 13px;' +
      "font-family:'DM Sans',sans-serif;font-size:11px;color:#334155;box-shadow:0 6px 20px rgba(15,23,42,.14);line-height:1.35}" +
      '.featured-legend-title{font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#64748b;margin-bottom:7px}' +
      '.featured-legend-steps{display:flex;border-radius:4px;overflow:hidden;border:1px solid rgba(16,24,40,.18)}' +
      '.featured-legend-steps span{width:26px;height:11px;display:block}' +
      '.featured-legend-scale{display:flex;justify-content:space-between;margin-top:4px;font-weight:600;color:#475569}' +
      '.featured-legend-item{display:flex;align-items:center;gap:6px;margin-top:8px;font-weight:600;color:#475569}' +
      '.featured-legend-item i{width:12px;height:12px;border-radius:3px;border:1px solid rgba(16,24,40,.22);flex-shrink:0}' +
      '@media (max-width:560px){.featured-legend{left:8px;bottom:52px;padding:8px 10px;font-size:10px}.featured-legend-steps span{width:20px}}';
    document.head.appendChild(st);
  }

  // Leyenda genérica para coropletas: agrupa polígonos por _manaGroupName y,
  // si un grupo tiene >=3 colores distintos con «Profundidad media» parseable,
  // pinta una escala discreta min→max. Devuelve '' si no aplica.
  function buildDepthLegend(geo) {
    var groups = {};
    (geo.features || []).forEach(function(f) {
      var p = f && f.properties;
      if (!p) return;
      var gname = p._manaGroupName;
      if (!gname || !p._manaColor) return;
      if (!groups[gname]) groups[gname] = { colors: {}, depths: [] };
      var bucket = groups[gname];
      if (!bucket.colors[p._manaColor]) {
        bucket.colors[p._manaColor] = true;
        var m = /([\d.,\s]+)\s*m/.exec(String(p['Profundidad media'] || ''));
        if (m) {
          var val = parseFloat(m[1].replace(/[.\s]/g, '').replace(',', '.'));
          if (isFinite(val)) bucket.depths.push({ v: val, c: p._manaColor });
        }
      }
    });
    var rampGroup = null, plainGroup = null;
    Object.keys(groups).forEach(function(gname) {
      var uniqDepths = {};
      groups[gname].depths.forEach(function(d) { uniqDepths[d.c] = d; });
      var steps = Object.keys(uniqDepths).map(function(k) { return uniqDepths[k]; }).sort(function(a, b) { return a.v - b.v; });
      groups[gname].steps = steps;
      if (steps.length >= 3 && !rampGroup) rampGroup = { name: gname, steps: steps };
      else if (!plainGroup && steps.length === 0 && Object.keys(groups[gname].colors).length === 1) {
        plainGroup = { name: gname, color: Object.keys(groups[gname].colors)[0] };
      }
    });
    if (!rampGroup) return '';
    var html = '<div class="featured-legend" role="img" aria-label="Leyenda: intensidad del azul según profundidad media">' +
      '<div class="featured-legend-title">Profundidad media</div>' +
      '<div class="featured-legend-steps">';
    rampGroup.steps.forEach(function(s) { html += '<span style="background:' + s.c + '"></span>'; });
    html += '</div>' +
      '<div class="featured-legend-scale"><span>' + escHtml(formatMeters(rampGroup.steps[0].v)) + '</span>' +
      '<span>' + escHtml(formatMeters(rampGroup.steps[rampGroup.steps.length - 1].v)) + '</span></div>';
    if (plainGroup) {
      html += '<div class="featured-legend-item"><i style="background:' + plainGroup.color + '"></i>' + escHtml(plainGroup.name) + '</div>';
    }
    html += '</div>';
    return html;
  }

  function formatMeters(v) {
    return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' m';
  }

  // Leyenda para mapas de líneas por año (p. ej. fibra submarina): agrupa
  // por _manaGroupName y pinta rampa claro→oscuro ordenada por «Año».
  // Devuelve '' si no hay clave Año parseable con >=3 colores.
  function buildYearLegend(geo) {
    var groups = {};
    (geo.features || []).forEach(function(f) {
      var p = f && f.properties;
      if (!p) return;
      var gname = p._manaGroupName;
      if (!gname || !p._manaColor) return;
      var rawYear = p['Año'] != null ? p['Año'] : p.ready_for_service;
      var year = parseInt(String(rawYear).replace(/[^\d-]/g, ''), 10);
      if (!isFinite(year) || year < 1900 || year > 2100) return;
      if (!groups[gname]) groups[gname] = { colors: {}, years: [] };
      var bucket = groups[gname];
      if (!bucket.colors[p._manaColor]) {
        bucket.colors[p._manaColor] = true;
        bucket.years.push({ v: year, c: p._manaColor });
      }
    });
    var rampGroup = null, plainGroup = null;
    Object.keys(groups).forEach(function(gname) {
      var uniq = {};
      groups[gname].years.forEach(function(d) { uniq[d.c] = d; });
      var steps = Object.keys(uniq).map(function(k) { return uniq[k]; }).sort(function(a, b) { return a.v - b.v; });
      groups[gname].steps = steps;
      if (steps.length >= 3 && !rampGroup) rampGroup = { name: gname, steps: steps };
      else if (!plainGroup && steps.length === 0 && Object.keys(groups[gname].colors).length === 1) {
        plainGroup = { name: gname, color: Object.keys(groups[gname].colors)[0] };
      }
    });
    if (!rampGroup) return '';
    var html = '<div class="featured-legend" role="img" aria-label="Leyenda: color por año de puesta en servicio, claro antiguo → oscuro reciente">' +
      '<div class="featured-legend-title">Año de puesta en servicio</div>' +
      '<div class="featured-legend-steps">';
    rampGroup.steps.forEach(function(s) { html += '<span style="background:' + s.c + '"></span>'; });
    html += '</div>' +
      '<div class="featured-legend-scale"><span>' + escHtml(String(rampGroup.steps[0].v)) + '</span>' +
      '<span>' + escHtml(String(rampGroup.steps[rampGroup.steps.length - 1].v)) + '</span></div>';
    if (plainGroup) {
      html += '<div class="featured-legend-item"><i style="background:' + plainGroup.color + '"></i>' + escHtml(plainGroup.name) + '</div>';
    }
    html += '</div>';
    return html;
  }

  // Leyenda para salario mínimo por USD: agrupa por _manaGroupName y
  // pinta rampa claro→oscuro ordenada por «Salario mínimo USD anual».
  function buildWageLegend(geo) {
    var groups = {};
    (geo.features || []).forEach(function(f) {
      var p = f && f.properties;
      if (!p) return;
      var gname = p._manaGroupName;
      if (!gname || !p._manaColor) return;
      var raw = p['Salario mínimo USD anual'];
      if (raw == null) return;
      var usd = parseFloat(String(raw).replace(/[^\d.-]/g, ''));
      if (!isFinite(usd) || usd <= 0) return;
      if (!groups[gname]) groups[gname] = { colors: {}, wages: [] };
      var bucket = groups[gname];
      if (!bucket.colors[p._manaColor]) {
        bucket.colors[p._manaColor] = true;
        bucket.wages.push({ v: usd, c: p._manaColor });
      }
    });
    var rampGroup = null;
    Object.keys(groups).forEach(function(gname) {
      var uniq = {};
      groups[gname].wages.forEach(function(d) { uniq[d.c] = d; });
      var steps = Object.keys(uniq).map(function(k) { return uniq[k]; }).sort(function(a, b) { return a.v - b.v; });
      groups[gname].steps = steps;
      if (steps.length >= 3 && !rampGroup) rampGroup = { name: gname, steps: steps };
    });
    if (!rampGroup) return '';
    function fmtUSD(v) { return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' $'; }
    var html = '<div class="featured-legend" role="img" aria-label="Leyenda: intensidad del azul según salario mínimo en USD, claro bajo → oscuro alto">' +
      '<div class="featured-legend-title">Salario mínimo (USD/año)</div>' +
      '<div class="featured-legend-steps">';
    rampGroup.steps.forEach(function(s) { html += '<span style="background:' + s.c + '"></span>'; });
    html += '</div>' +
      '<div class="featured-legend-scale"><span>' + escHtml(fmtUSD(rampGroup.steps[0].v)) + '</span>' +
      '<span>' + escHtml(fmtUSD(rampGroup.steps[rampGroup.steps.length - 1].v)) + '</span></div>' +
      '</div>';
    return html;
  }

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
    if (!props) return '';
    var name = props._manaName || props.name || props.Name;
    if (!name) return '';
    var html = '<div class="featured-popup"><strong>' + escHtml(String(name)) + '</strong>';
    // Show salary info: nuevo mapa usa "Salario mínimo" (local) + "Salario mínimo USD"
    if (props['Salario mínimo USD'] && props['Salario mínimo']) {
      html += '<br><span style="font-size:12px;color:#475569">' + escHtml(props['Salario mínimo']) + '</span>';
      html += '<br><span style="font-size:12px;color:#1e40af;font-weight:600">' + escHtml(props['Salario mínimo USD']) + '</span>';
      if (props['Continente']) html += '<br><span style="font-size:11px;color:#64748b">' + escHtml(props['Continente']) + ' · ' + escHtml(props['Moneda'] || '') + '</span>';
    } else if (props['Salario mínimo USD']) {
      html += '<br><span style="font-size:12px;color:#475569">' + escHtml(props['Salario mínimo USD']) + '</span>';
      if (props['Salario mínimo']) html += '<br><span style="font-size:11px;color:#64748b">' + escHtml(props['Salario mínimo']) + '</span>';
    } else if (props._wageFormatted && props._wageFormatted !== 'N/A') {
      html += '<br><span style="font-size:12px;color:#475569">' + escHtml(props._wageFormatted) + ' anuales';
      if (props._wageMonthly && props._wageMonthly !== 'N/A') {
        html += ' · ' + escHtml(props._wageMonthly);
      }
      html += '</span>';
    }
    // Show fiber cable info if available
    if (props._lengthFormatted) {
      html += '<br><span style="font-size:12px;color:#475569">' + escHtml(props._lengthFormatted);
      if (props['Año']) html += ' · ' + escHtml(String(props['Año']));
      else if (props.ready_for_service) html += ' · ' + escHtml(String(props.ready_for_service));
      html += '</span>';
    } else if (props['Año']) {
      html += '<br><span style="font-size:12px;color:#475569">Año: ' + escHtml(String(props['Año'])) + '</span>';
    }
    if (props._countriesES) {
      html += '<br><span style="font-size:11px;color:#64748b">' + escHtml(props._countriesES) + '</span>';
    }
    // Show generic properties for other maps (curated Spanish keys first,
    // then any remaining human-readable string props).
    if (!props._wageFormatted && !props._lengthFormatted && !props['Año']) {
      var extra = [];
      var seenKeys = {};
      ['Superficie', 'Profundidad media', 'Profundidad máxima', 'Dato', 'Deaths', 'Area', 'Año', 'Year', 'Location'].forEach(function(k) {
        if (props[k] !== undefined && props[k] !== '') { extra.push(props[k]); seenKeys[k] = true; }
      });
      Object.keys(props).forEach(function(k) {
        if (seenKeys[k] || k.charAt(0) === '_' || k === 'name' || k === 'Name' || k === 'Description') return;
        var v = props[k];
        if (typeof v === 'string' && v.length < 60) extra.push(v);
      });
      if (extra.length) {
        html += '<br><span style="font-size:12px;color:#475569">' + escHtml(extra.join(' · ')) + '</span>';
      }
    }
    html += '</div>';
    return html;
  }

  function addFeaturedDataLayers(map, geo) {
    if (!map.getSource('featured-data')) {
      map.addSource('featured-data', { type: 'geojson', data: geo });
    } else {
      map.getSource('featured-data').setData(geo);
    }
    var colorExpr = ['coalesce', ['get', '_manaColor'], ['get', 'color'], '#0ea5e9'];
    var isPolygon = ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']];
    var isLine = ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'MultiLineString']];
    var isPoint = ['any', ['==', ['geometry-type'], 'Point'], ['==', ['geometry-type'], 'MultiPoint']];

    map.addLayer({
      id: 'featured-fills', type: 'fill', source: 'featured-data', filter: isPolygon,
      paint: { 'fill-color': colorExpr, 'fill-opacity': ['coalesce', ['get', '_manaFillOpacity'], 0.16] }
    });
    map.addLayer({
      id: 'featured-fill-outlines', type: 'line', source: 'featured-data', filter: isPolygon,
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': ['coalesce', ['get', '_manaBorderColor'], colorExpr],
        'line-opacity': 0.9,
        'line-width': ['interpolate', ['linear'], ['zoom'], 2, ['coalesce', ['get', '_manaWeight'], 1], 10, ['*', ['coalesce', ['get', '_manaWeight'], 1], 2]]
      }
    });
    map.addLayer({
      id: 'featured-fill-labels', type: 'symbol', source: 'featured-data', filter: isPolygon,
      layout: {
        'text-field': ['coalesce', ['get', '_manaName'], ['get', 'name'], ''],
        'text-font': ['Noto Sans Regular'],
        'text-size': 12,
        'text-letter-spacing': 0.04,
        'text-optional': true,
        'text-max-width': 12
      },
      paint: { 'text-color': '#274b63', 'text-halo-color': '#ffffff', 'text-halo-width': 2 }
    });
    map.addLayer({
      id: 'featured-line-casing', type: 'line', source: 'featured-data', filter: isLine,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-opacity': 0.85, 'line-width': ['interpolate', ['linear'], ['zoom'], 2, ['+', ['coalesce', ['get', '_manaWeight'], 2.8], 0.8], 10, ['+', ['*', ['coalesce', ['get', '_manaWeight'], 2.8], 2.0], 0.8]] }
    });
    map.addLayer({
      id: 'featured-lines', type: 'line', source: 'featured-data', filter: isLine,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': colorExpr, 'line-opacity': ['coalesce', ['get', '_manaFillOpacity'], ['get', '_manaOpacity'], 0.95], 'line-width': ['interpolate', ['linear'], ['zoom'], 2, ['coalesce', ['get', '_manaWeight'], 2.8], 10, ['*', ['coalesce', ['get', '_manaWeight'], 2.8], 1.9]] }
    });
    map.addLayer({
      id: 'featured-line-labels', type: 'symbol', source: 'featured-data', filter: isLine,
      layout: {
        'symbol-placement': 'line',
        'text-field': ['coalesce', ['get', '_manaName'], ['get', 'name'], ''],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 3, 8, 10, 11],
        'text-optional': true,
        'text-max-width': 14
      },
      paint: { 'text-color': '#1e293b', 'text-halo-color': '#ffffff', 'text-halo-width': 2 }
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
    var _hoverPopup = null;

    function hoverPopupHtml(props) {
      if (!props) return '';
      var name = props._manaName || props.name || props.Name;
      if (!name) return '';
      // Compact one-liner for hover: prioriza salario local + USD
      if (props['Salario mínimo'] && props['Salario mínimo USD']) {
        return '<div class="featured-popup"><strong>' + escHtml(String(name)) + '</strong><br>' + escHtml(props['Salario mínimo']) + ' · ' + escHtml(props['Salario mínimo USD']) + '</div>';
      }
      if (props['Salario mínimo USD']) {
        return '<div class="featured-popup"><strong>' + escHtml(String(name)) + '</strong><br>' + escHtml(props['Salario mínimo USD']) + '</div>';
      }
      var parts = [String(name)];
      if (props._wageFormatted && props._wageFormatted !== 'N/A') parts.push(props._wageFormatted);
      if (props._lengthFormatted) parts.push(props._lengthFormatted);
      if (props['Año']) parts.push(String(props['Año']));
      else if (props.ready_for_service) parts.push(String(props.ready_for_service));
      return '<div class="featured-popup">' + escHtml(parts.join(' · ')) + '</div>';
    }

    map.on('mousemove', function(e) {
      var feats = map.queryRenderedFeatures(e.point, { layers: interactiveLayers });
      map.getCanvas().style.cursor = feats.length ? 'pointer' : '';
      // Show hover tooltip
      if (feats.length) {
        var html = hoverPopupHtml(feats[0].properties);
        if (html) {
          if (!_hoverPopup) {
            _hoverPopup = new maplibregl.Popup({ closeButton: false, offset: 8, maxWidth: '260px', closeOnClick: false, closeOnMove: true })
              .setLngLat(e.lngLat)
              .setHTML(html)
              .addTo(map);
          } else {
            _hoverPopup.setLngLat(e.lngLat).setHTML(html);
          }
        }
      } else if (_hoverPopup) {
        _hoverPopup.remove();
        _hoverPopup = null;
      }
    });
    map.on('click', function(e) {
      var feats = map.queryRenderedFeatures(e.point, { layers: interactiveLayers });
      if (!feats.length) return;
      // Remove hover popup before showing click popup
      if (_hoverPopup) { _hoverPopup.remove(); _hoverPopup = null; }
      var html = featuredPopupHtml(feats[0].properties);
      if (!html) return;
      new maplibregl.Popup({ closeButton: false, offset: 14, maxWidth: '280px' })
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
        ? renderThumb(item)
        : '';
      target.innerHTML = '<div class="featured-static">' + fallbackSvg + '</div>';
      return;
    }

    ensureLegendStyles();
    var legendHtml = buildDepthLegend(geo) || buildYearLegend(geo) || buildWageLegend(geo);
    if (legendHtml) target.insertAdjacentHTML('beforeend', legendHtml);

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
    // Disable animated scroll zoom: snap instantly to avoid visual drift of features
    map.scrollZoom.disable();
    map.getContainer().addEventListener('wheel', function(e) {
      e.preventDefault();
      var z = map.getZoom();
      var r = map.getContainer().getBoundingClientRect();
      var c = map.unproject([e.clientX - r.left, e.clientY - r.top]);
      var nz = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), z - e.deltaY * 0.01));
      map.jumpTo({ zoom: nz, center: c });
    }, { passive: false });

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

    _allMaps = merged;
    renderFilterBar(merged);
    if (_activeFilter) applyFilter(); else renderCards(merged);
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
        const seen = {};
        const unique = remote.filter(function(item) {
          const key = item.slug || item.id;
          if (!key || seen[key]) return false;
          seen[key] = true;
          return true;
        });
        mergedList.length = 0;
        mergedList.push.apply(mergedList, unique.slice(0, 40));
        _allMaps = mergedList;
        renderFilterBar(mergedList);
        if (_activeFilter) applyFilter(); else renderCards(mergedList);
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
