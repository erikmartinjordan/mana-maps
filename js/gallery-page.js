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
      var tags = Array.isArray(item.tags) ? item.tags : [];
      var tagsHtml = tags.length
        ? '<div class="card-tags">' + tags.map(function(t) { return '<span class="card-tag">' + escHtml(t) + '</span>'; }).join('') + '</div>'
        : '';
      var descHtml = item.description
        ? '<div class="card-desc">' + escHtml(item.description) + '</div>'
        : '';
      var sourceHtml = item.dataSource
        ? '<div class="meta-source">' + escHtml(item.dataSource) + (item.dataDate ? ' (' + escHtml(item.dataDate) + ')' : '') + '</div>'
        : '';
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
          descHtml +
          sourceHtml +
          tagsHtml +
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

  function updateFilterScrollButtons() {
    var bar = document.getElementById('filter-bar');
    var leftBtn = document.getElementById('filter-scroll-left');
    var rightBtn = document.getElementById('filter-scroll-right');
    if (!bar || !leftBtn || !rightBtn) return;
    var canScroll = bar.scrollWidth > bar.clientWidth + 4;
    if (!canScroll) {
      leftBtn.classList.remove('visible');
      rightBtn.classList.remove('visible');
      return;
    }
    leftBtn.classList.toggle('visible', bar.scrollLeft > 4);
    rightBtn.classList.toggle('visible', bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 4);
  }

  function initFilterScroll() {
    var bar = document.getElementById('filter-bar');
    var leftBtn = document.getElementById('filter-scroll-left');
    var rightBtn = document.getElementById('filter-scroll-right');
    if (!bar || !leftBtn || !rightBtn) return;
    leftBtn.addEventListener('click', function() { bar.scrollBy({ left: -200, behavior: 'smooth' }); });
    rightBtn.addEventListener('click', function() { bar.scrollBy({ left: 200, behavior: 'smooth' }); });
    bar.addEventListener('scroll', updateFilterScrollButtons, { passive: true });
    window.addEventListener('resize', updateFilterScrollButtons);
    // drag-to-scroll
    var isDown = false, startX, scrollLeft;
    bar.addEventListener('mousedown', function(e) { isDown = true; bar.style.cursor = 'grabbing'; startX = e.pageX - bar.offsetLeft; scrollLeft = bar.scrollLeft; });
    bar.addEventListener('mouseleave', function() { isDown = false; bar.style.cursor = ''; });
    bar.addEventListener('mouseup', function() { isDown = false; bar.style.cursor = ''; });
    bar.addEventListener('mousemove', function(e) {
      if (!isDown) return;
      e.preventDefault();
      var x = e.pageX - bar.offsetLeft;
      bar.scrollLeft = scrollLeft - (x - startX);
    });
  }
  // init once on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFilterScroll);
  } else {
    initFilterScroll();
  }

  function renderFilterBar(maps) {
    var bar = document.getElementById('filter-bar');
    var wrap = document.getElementById('filter-bar-wrap');
    if (!bar || !wrap) return;
    var tags = collectTags(maps);
    if (!tags.length) {
      wrap.hidden = true;
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
    wrap.hidden = false;
    // refresh scroll buttons after render
    requestAnimationFrame(function() { updateFilterScrollButtons(); setTimeout(updateFilterScrollButtons, 100); });

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
