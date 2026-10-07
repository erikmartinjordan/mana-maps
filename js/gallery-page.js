// ── gallery-page.js ─ renders /gallery ─

(function() {
  const MAPS_COLLECTION = 'maps';
  const LIKES_STORAGE_KEY = 'mana-gallery-likes';
  const firebaseConfig = window.ManaFirebase && window.ManaFirebase.getConfig();

  // The grid only needs lightweight card data; `mapPreview` is fetched lazily
  // per visible card (see schedulePreviews) and the featured ?slug= map fetches
  // its own full document on demand. `geojsonText` is never listed.
  const GALLERY_LIST_FIELDS = [
    'title', 'name', 'slug', 'description', 'tags', 'likes', 'views',
    'authorHandle', 'shareMode', 'featureCount', 'createdAt', 'createdAtMs',
    'updatedAtMs', 'legendKey', 'legendTitle', 'legendFormat',
    'dataSource', 'dataYear', 'dataDate', 'isPublished'
  ];

  function withListFields(query) {
    if (!query || typeof query.select !== 'function') return query;
    try { return query.select(GALLERY_LIST_FIELDS); } catch (e) { return query; }
  }


  function escHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function escAttr(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function safeDate(tsMs) {
    if (!tsMs) return 'Sin fecha';
    try {
      return new Date(tsMs).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (_) {
      return 'Sin fecha';
    }
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
      style.textContent = '.gallery-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%) translateY(12px);z-index:10001;padding:7px 18px;border-radius:50px;background:#1a1a1a;color:#fff;font-family:\'DM Sans\',-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:12px;font-weight:600;box-shadow:0 4px 12px rgba(0,0,0,.08);opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;max-width:min(420px,calc(100vw - 32px));text-align:center}.gallery-toast.open{opacity:1;transform:translateX(-50%) translateY(0)}.gallery-toast a{color:inherit;font-weight:700;text-decoration:underline;margin-left:6px}@media (prefers-color-scheme: dark){.gallery-toast{background:#0ea5e9;color:#111}}';
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

  function dedupeSortMaps(items) {
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
  }

  async function remoteMaps() {
    if (typeof firebase === 'undefined') return [];
    try {
      if (!firebase.apps || !firebase.apps.length) { if (!firebaseConfig) return []; firebase.initializeApp(firebaseConfig); }
      const db = firebase.firestore();
      // Firestore read: published maps list for the gallery bootstrap. No
      // orderBy so the query works with the single-field index only (the
      // composite indexes were never provisioned); we sort client-side.
      const snap = await withListFields(
        db.collection(MAPS_COLLECTION).where('isPublished', '==', true).limit(100)
      ).get();
      if (!snap || !snap.docs) return [];
      return dedupeSortMaps(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.warn('gallery remoteMaps error:', e);
      return [];
    }
  }

  // The Firebase web SDK cannot project fields, so listing the collection
  // downloads every full document including geojsonText. The public Firestore
  // REST API does support field masks, so the gallery bootstraps from a
  // projected runQuery (~9 KB gzip for the whole gallery instead of ~2.7 MB gzip)
  // and pulls each card's mapPreview lazily.
  function restConfig() {
    if (!firebaseConfig || !firebaseConfig.projectId || !firebaseConfig.apiKey) return null;
    return {
      key: firebaseConfig.apiKey,
      db: 'https://firestore.googleapis.com/v1/projects/' + firebaseConfig.projectId +
        '/databases/(default)/documents'
    };
  }

  function canUseRest() {
    return !!(restConfig() && typeof fetch === 'function');
  }

  async function fetchPublishedListRest() {
    const cfg = restConfig();
    if (!cfg) throw new Error('rest-unavailable');
    const res = await fetch(cfg.db + ':runQuery?key=' + encodeURIComponent(cfg.key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: MAPS_COLLECTION }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'isPublished' },
              op: 'EQUAL',
              value: { booleanValue: true }
            }
          },
          limit: 100,
          select: { fields: GALLERY_LIST_FIELDS.map(function(f) { return { fieldPath: f }; }) }
        }
      })
    });
    if (!res.ok) throw new Error('firestore-runQuery ' + res.status);
    const rows = await res.json();
    const items = [];
    (rows || []).forEach(function(row) {
      var doc = row && row.document;
      if (!doc) return;
      var item = {};
      var fields = doc.fields || {};
      Object.keys(fields).forEach(function(k) { item[k] = decodeFirestoreValue(fields[k]); });
      item.id = (doc.name || '').split('/').pop();
      items.push(item);
    });
    return dedupeSortMaps(items);
  }

  async function fetchMapPreviewRest(id) {
    const cfg = restConfig();
    if (!cfg || !id) return null;
    const res = await fetch(cfg.db + '/maps/' + encodeURIComponent(id) +
      '?key=' + encodeURIComponent(cfg.key) + '&mask.fieldPaths=mapPreview');
    if (!res.ok) return null;
    const doc = await res.json();
    var raw = doc && doc.fields && doc.fields.mapPreview;
    if (!raw) return null;
    return normalizePreview(decodeFirestoreValue(raw));
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
  // PREVIEW NORMALIZATION
  // ═══════════════════════════════════════════════════════════════
  // Some published docs stored `mapPreview` using the Firestore REST value
  // wrappers ({ stringValue }, { arrayValue }, { mapValue }…) instead of a
  // plain object, and at inconsistent nesting depths. decodeFirestoreValue
  // unwraps any such wrappers; normalizePreview runs it a couple of passes and
  // returns a clean preview (or null) so it is safe to feed renderSVG directly.

  var FIRESTORE_VALUE_KEYS = {
    nullValue: 1, stringValue: 1, integerValue: 1, doubleValue: 1,
    booleanValue: 1, arrayValue: 1, mapValue: 1, timestampValue: 1
  };

  function decodeFirestoreValue(value) {
    if (Array.isArray(value)) return value.map(decodeFirestoreValue);
    if (value && typeof value === 'object') {
      var keys = Object.keys(value);
      if (keys.length === 1 && FIRESTORE_VALUE_KEYS[keys[0]]) {
        var type = keys[0];
        var raw = value[type];
        if (type === 'nullValue') return null;
        if (type === 'stringValue') return raw;
        if (type === 'timestampValue') return raw;
        if (type === 'integerValue') return parseInt(raw, 10);
        if (type === 'doubleValue') return Number(raw);
        if (type === 'booleanValue') return raw;
        if (type === 'arrayValue') return ((raw && raw.values) || []).map(decodeFirestoreValue);
        if (type === 'mapValue') {
          var fields = (raw && raw.fields) || {};
          var out = {};
          Object.keys(fields).forEach(function(k) { out[k] = decodeFirestoreValue(fields[k]); });
          return out;
        }
      }
      var plain = {};
      keys.forEach(function(k) { plain[k] = decodeFirestoreValue(value[k]); });
      return plain;
    }
    return value;
  }

  function normalizePreview(preview) {
    if (!preview || typeof preview !== 'object') return null;
    var clean = decodeFirestoreValue(decodeFirestoreValue(preview));
    return (clean && Array.isArray(clean.bbox)) ? clean : null;
  }

  // Returns the renderable preview for an item, cached on the item so the SVG
  // is never rebuilt twice per card (renderThumb + thumbAspectStyle both call
  // this). Prefers the stored mapPreview; only falls back to parsing the full
  // GeoJSON when the item happens to carry it (e.g. the ?slug= featured map).
  function previewOf(item) {
    if (!item) return null;
    if (item._manaPreview) return item._manaPreview;
    if (item.mapPreview) {
      var normalized = normalizePreview(item.mapPreview);
      if (normalized) { item._manaPreview = normalized; return normalized; }
    }
    var geo = getPublishedGeo(item);
    if (geo && window.ManaMapPreview) {
      var built = window.ManaMapPreview.build(geo);
      if (built) { item._manaPreview = built; return built; }
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
    var svg = window.ManaMapPreview.renderSVG(previewOf(item));
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
    var preview = previewOf(item);
    if (!preview) return '';
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

  // Keep JSON-LD numberOfItems in sync with the actual map count so search
  // engines always see the correct collection size.
  function syncJsonLdCount(count) {
    var el = document.getElementById('ld-collection');
    if (!el) return;
    try {
      var ld = JSON.parse(el.textContent);
      if (ld.mainEntity && ld.mainEntity.numberOfItems !== count) {
        ld.mainEntity.numberOfItems = count;
        el.textContent = JSON.stringify(ld);
      }
    } catch (_) {}
  }

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
      return '' +
        '<div class="card">' +
          '<a class="card-link" href="/map/index.html?gallery=' + encodeURIComponent(mapSlug) + '&map=' + encodeURIComponent(mapSlug) + '&room=' + encodeURIComponent(mapSlug) + '&mode=' + encodeURIComponent(mode) + '">' +
            '<div class="thumb" data-map-id="' + escAttr(mapSlug) + '"' + thumbAspectStyle(item) + '>' + thumb + '</div>' +
            '<h3 class="title">' + escHtml(item.title || item.name || 'Mapa sin título') + '</h3>' +
          '</a>' +
          '<div class="meta">' +
            (authorHandle ? '<a class="meta-author" href="/@' + encodeURIComponent(authorHandle) + '">@' + escHtml(authorHandle) + '</a><span>·</span>' : '') +
            '<span>' + (item.featureCount || 0) + ' elementos</span>' +
            '<span>·</span>' +
            '<span>' + safeDate(created) + '</span>' +
          '</div>' +
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
            '<button class="card-action-btn card-share-btn" data-map-id="' + escAttr(mapSlug) + '" data-title="' + escAttr(item.title || item.name || 'Mapa de Maña Maps') + '" onclick="galleryShareCard(this)" aria-label="Compartir">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/></svg>' +
            '</button>' +
          '</div>' +
        '</div>';
    }).join('');

    schedulePreviews(items);
  }

  // Lazily fill in thumbnails. The list query is deliberately lightweight (no
  // mapPreview, ~9 KB for the whole gallery), so previews are fetched per card
  // only when it is about to scroll into view.
  var _previewObserver = null;

  function ensurePreviewObserver() {
    if (_previewObserver || typeof IntersectionObserver === 'undefined') return _previewObserver;
    _previewObserver = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (!entry.isIntersecting) return;
        _previewObserver.unobserve(entry.target);
        var item = findMapByKey(entry.target.getAttribute('data-map-id'));
        if (item) loadPreviewForItem(item);
      });
    }, { rootMargin: '400px 0px' });
    return _previewObserver;
  }

  function findMapByKey(key) {
    if (!key) return null;
    for (var i = 0; i < _allMaps.length; i++) {
      var m = _allMaps[i];
      if (m && (m.slug || m.id) === key) return m;
    }
    return null;
  }

  function schedulePreviews(items) {
    if (!window.ManaMapPreview || typeof document === 'undefined') return;
    var observer = ensurePreviewObserver();
    var thumbs = document.querySelectorAll('#gallery-list .thumb[data-map-id]');
    Array.prototype.forEach.call(thumbs, function(thumb) {
      if (thumb.getAttribute('data-preview-observed')) return;
      var item = findMapByKey(thumb.getAttribute('data-map-id'));
      if (!item || previewOf(item)) return;
      thumb.setAttribute('data-preview-observed', '1');
      if (observer) observer.observe(thumb);
      else loadPreviewForItem(item);
    });
  }

  function loadPreviewForItem(item) {
    if (!item || !window.ManaMapPreview) return;
    if (previewOf(item)) { patchCardPreview(item); return; }
    if (item._previewLoading) return;
    item._previewLoading = true;
    var restore = function() { item._previewLoading = false; };
    var apply = function(preview) {
      restore();
      if (!preview) return;
      item._manaPreview = preview;
      patchCardPreview(item);
    };

    // SDK path (or items that already carry the preview): stored preview.
    if (item.mapPreview) {
      var normalized = normalizePreview(item.mapPreview);
      if (normalized) { apply(normalized); return; }
    }

    // REST: fetch just the mapPreview field for this document (~tens of KB),
    // far cheaper than the whole document.
    if (canUseRest()) {
      fetchMapPreviewRest(item.slug || item.id).then(function(preview) {
        if (preview) { apply(preview); return; }
        hydratePreviewFromFullDoc(item).then(apply).catch(restore);
      }).catch(function() { restore(); });
      return;
    }

    hydratePreviewFromFullDoc(item).then(apply).catch(restore);
  }

  function hydratePreviewFromFullDoc(item) {
    return getPublishedGeoAsync(item).then(function(geo) {
      return geo ? window.ManaMapPreview.build(geo) : null;
    });
  }

  function patchCardPreview(item) {
    if (!window.ManaMapPreview) return;
    var key = item && (item.slug || item.id);
    if (!key) return;
    var thumbs = document.querySelectorAll('#gallery-list .thumb[data-map-id]');
    var thumb = null;
    Array.prototype.forEach.call(thumbs, function(el) {
      if (!thumb && el.getAttribute('data-map-id') === key) thumb = el;
    });
    if (!thumb) return;
    thumb.innerHTML = renderThumb(item);
    var preview = previewOf(item);
    var aspect = preview ? window.ManaMapPreview.aspectOf(preview) : NaN;
    if (isFinite(aspect) && aspect > 0) {
      thumb.style.aspectRatio = aspect;
      thumb.style.height = 'auto';
      thumb.style.boxSizing = 'content-box';
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // CATEGORÍAS — botón desplegable multi-selección
  // ═══════════════════════════════════════════════════════════════

  var _allMaps = [];
  var _activeTags = [];
  var _allTags = [];
  var _tagCounts = {};

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

  function updateCatButton() {
    var count = document.getElementById('cat-dd-count');
    if (count) {
      if (_activeTags.length) { count.textContent = _activeTags.length; count.hidden = false; }
      else { count.hidden = true; }
    }
    var clear = document.getElementById('cat-clear');
    if (clear) clear.disabled = !_activeTags.length;
  }

  function closeCatDropdown() {
    var dd = document.getElementById('cat-dd');
    var btn = document.getElementById('cat-dd-btn');
    if (!dd) return;
    dd.classList.remove('open');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  function filterCatOptions(q) {
    q = (q || '').toLowerCase();
    document.querySelectorAll('#cat-opts .cat-opt').forEach(function(el) {
      el.style.display = el.textContent.toLowerCase().indexOf(q) >= 0 ? '' : 'none';
    });
  }

  function renderCatOptions() {
    var opts = document.getElementById('cat-opts');
    if (!opts) return;
    if (!_allTags.length) {
      opts.innerHTML = '<div class="cat-opt-empty">Sin categorías</div>';
      return;
    }
    opts.innerHTML = _allTags.map(function(tag) {
      var on = _activeTags.indexOf(tag) >= 0;
      return '<label class="cat-opt"><input type="checkbox" data-tag="' + escHtml(tag) + '"' + (on ? ' checked' : '') + '>' +
        '<span>' + escHtml(getTagLabel(tag)) + '</span>' +
        '<span class="cat-opt-n">' + (_tagCounts[tag] || 0) + '</span></label>';
    }).join('');
    opts.querySelectorAll('input[type=checkbox]').forEach(function(cb) {
      cb.addEventListener('change', function() {
        var tag = cb.getAttribute('data-tag');
        if (cb.checked) { if (_activeTags.indexOf(tag) < 0) _activeTags.push(tag); }
        else { _activeTags = _activeTags.filter(function(t) { return t !== tag; }); }
        renderCatActive();
        updateCatButton();
        applyFilter();
      });
    });
  }

  function renderCatActive() {
    var el = document.getElementById('cat-active');
    if (!el) return;
    if (!_activeTags.length) { el.innerHTML = ''; return; }
    el.innerHTML = _activeTags.map(function(tag) {
      var label = escHtml(getTagLabel(tag));
      return '<span class="cat-chip">' + label +
        '<button type="button" data-tag="' + escHtml(tag) + '" aria-label="Quitar ' + label + '">&times;</button></span>';
    }).join('') +
      (_activeTags.length > 1 ? '<button class="cat-clear-inline" type="button" id="cat-clear-inline">Limpiar todo</button>' : '');
    el.querySelectorAll('.cat-chip button').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var tag = btn.getAttribute('data-tag');
        _activeTags = _activeTags.filter(function(t) { return t !== tag; });
        renderCatOptions();
        renderCatActive();
        updateCatButton();
        applyFilter();
      });
    });
    var inline = el.querySelector('#cat-clear-inline');
    if (inline) inline.addEventListener('click', clearCatSelection);
  }

  function clearCatSelection() {
    _activeTags = [];
    renderCatOptions();
    renderCatActive();
    updateCatButton();
    applyFilter();
  }

  function initCatDropdown() {
    var dd = document.getElementById('cat-dd');
    var btn = document.getElementById('cat-dd-btn');
    var search = document.getElementById('cat-search');
    var apply = document.getElementById('cat-apply');
    var clear = document.getElementById('cat-clear');
    if (!dd || !btn) return;
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var open = dd.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open && search) {
        search.value = '';
        filterCatOptions('');
        setTimeout(function() { search.focus(); }, 40);
      }
    });
    if (search) search.addEventListener('input', function() { filterCatOptions(search.value); });
    if (apply) apply.addEventListener('click', closeCatDropdown);
    if (clear) clear.addEventListener('click', clearCatSelection);
    document.addEventListener('click', function(e) { if (!dd.contains(e.target)) closeCatDropdown(); });
    document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeCatDropdown(); });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCatDropdown);
  } else {
    initCatDropdown();
  }

  function renderCatBar(maps) {
    var bar = document.getElementById('cat-bar');
    if (!bar) return;
    _allTags = collectTags(maps);
    if (!_allTags.length) { bar.hidden = true; return; }
    bar.hidden = false;

    _tagCounts = {};
    _allTags.forEach(function(t) { _tagCounts[t] = 0; });
    maps.forEach(function(m) {
      var mt = Array.isArray(m.tags) ? m.tags : [];
      mt.forEach(function(t) { if (_tagCounts[t] !== undefined) _tagCounts[t]++; });
    });

    // Categorías activas desde la URL: ?tags=slug1,slug2 (o ?tag=slug legado)
    var params = new URLSearchParams(window.location.search);
    var initTags = params.get('tags');
    if (initTags) {
      _activeTags = initTags.split(',').map(function(slug) {
        return _allTags.find(function(t) { return getTagSlug(t) === slug; });
      }).filter(Boolean);
    } else {
      var legacyTag = params.get('tag');
      if (legacyTag) {
        var matched = _allTags.find(function(t) { return getTagSlug(t) === legacyTag; });
        if (matched) _activeTags = [matched];
      }
    }

    renderCatOptions();
    renderCatActive();
    updateCatButton();
    if (_activeTags.length) applyFilter();
  }

  function applyFilter() {
    var statusEl = document.getElementById('filter-status');

    // URL: ?tags=a,b (limpia el ?tag= legado)
    var url = new URL(window.location.href);
    url.searchParams.delete('tag');
    if (_activeTags.length) {
      url.searchParams.set('tags', _activeTags.map(getTagSlug).join(','));
    } else {
      url.searchParams.delete('tags');
    }
    window.history.replaceState(null, '', url);

    // Multi-selección con lógica OR: el mapa aparece si tiene alguna categoría elegida
    var filtered = _activeTags.length
      ? _allMaps.filter(function(m) {
          var tags = Array.isArray(m.tags) ? m.tags : [];
          return _activeTags.some(function(t) { return tags.indexOf(t) >= 0; });
        })
      : _allMaps;

    renderCards(filtered);

    if (statusEl) {
      if (_activeTags.length) {
        var names = _activeTags.map(function(t) { return '«' + getTagLabel(t) + '»'; }).join(', ');
        statusEl.textContent = 'Mostrando ' + filtered.length + ' mapa' + (filtered.length !== 1 ? 's' : '') + ' en ' + names + '.';
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
  // SHARE + VIEW COUNTER
  // ═══════════════════════════════════════════════════════════════

  function track(name, params) {
    if (typeof window.trackEvent === 'function') {
      try { window.trackEvent(name, params); } catch (e) {}
    }
  }

  function shareUrlFor(slug) {
    return 'https://maña.com/gallery/?slug=' + encodeURIComponent(slug);
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function(resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        resolve();
      } catch (e) { reject(e); }
    });
  }

  function doShare(url, title, source) {
    track('share', { source: source });
    if (navigator.share) {
      navigator.share({ title: title, url: url }).catch(function() {});
      return;
    }
    copyToClipboard(url).then(function() {
      galleryToast('Enlace copiado al portapapeles');
    }).catch(function() {
      galleryToast('No se pudo copiar el enlace.');
    });
  }

  // Share a published map from the gallery grid.
  window.galleryShareCard = function(btn) {
    var slug = btn.getAttribute('data-map-id');
    if (!slug) return;
    var title = btn.getAttribute('data-title') || 'Mapa de Maña Maps';
    doShare(shareUrlFor(slug), title, 'gallery_card');
  };

  // Share the featured ?slug= map.
  window.galleryShareSlug = function(btn) {
    var url = (btn && btn.getAttribute('data-url')) || window.location.href;
    var title = (btn && btn.getAttribute('data-title')) || document.title;
    doShare(url, title, 'gallery_slug');
  };

  // Count a public landing view. The editor flow already increments views
  // (js/persistence.js); here we cover direct visits to /gallery/?slug=.
  function countSlugView(slug, authorHandle) {
    if (!slug) return;
    try {
      var key = 'mana-slug-viewed:' + slug;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch (e) {}
    if (window.manaMaps && typeof window.manaMaps.incrementMapView === 'function') {
      try {
        Promise.resolve(window.manaMaps.incrementMapView(slug, authorHandle)).catch(function() {});
      } catch (e) {}
    }
    track('mapview', { slug: slug, source: 'gallery_slug' });
  }

  function slugCtaHtml(item) {
    var slug = item.slug || item.id;
    var title = item.title || item.name || 'Mapa de Maña Maps';
    var url = shareUrlFor(slug);
    var xHref = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(title + ' — vía Maña Maps') + '&url=' + encodeURIComponent(url);
    var author = item.authorHandle
      ? '<a class="slug-author" href="/@' + encodeURIComponent(item.authorHandle) + '">@' + escHtml(item.authorHandle) + '</a> · '
      : '';
    var created = item.createdAtMs || (item.createdAt && item.createdAt.toMillis ? item.createdAt.toMillis() : 0);
    return '<div class="slug-meta-line">' + author +
        (item.featureCount || 0) + ' elementos · ' + safeDate(created) + '</div>' +
      '<div class="slug-cta">' +
        '<a class="slug-cta-btn" href="/map/" onclick="galleryTrackCta()">Crea tu mapa gratis</a>' +
        '<button type="button" class="slug-share-btn" data-url="' + escAttr(url) + '" data-title="' + escAttr(title) + '" onclick="galleryShareSlug(this)">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/></svg>' +
          'Compartir</button>' +
        '<a class="slug-share-btn" href="' + escAttr(xHref) + '" target="_blank" rel="noopener" onclick="galleryTrackShare(\'x\')" aria-label="Compartir en X">' +
          '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.657l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z"/></svg>' +
          'X</a>' +
      '</div>' +
      '<div class="slug-watermark">Hecho con <strong>Maña Maps</strong> · <a href="/map/" onclick="galleryTrackCta()">Crea el tuyo gratis</a></div>';
  }

  window.galleryTrackCta = function() {
    track('cta_click', { target: 'create_map', source: 'gallery_slug' });
  };

  window.galleryTrackShare = function(network) {
    track('share', { network: network, source: 'gallery_slug' });
  };

  function ensureSlugStyles() {
    if (document.getElementById('slug-cta-styles')) return;
    var style = document.createElement('style');
    style.id = 'slug-cta-styles';
    style.textContent =
      '.slug-meta-line{font-size:13px;color:#6b7280;margin:10px 0 0}' +
      '.slug-author{color:#0ea5e9;text-decoration:none;font-weight:600}' +
      '.slug-cta{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}' +
      '.slug-cta-btn,.slug-share-btn{display:inline-flex;align-items:center;gap:7px;padding:9px 16px;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;text-decoration:none;border:1px solid transparent;font-family:inherit}' +
      '.slug-cta-btn{background:#0ea5e9;color:#fff}' +
      '.slug-cta-btn:hover{background:#0284c7}' +
      '.slug-share-btn{background:transparent;color:#374151;border-color:#d1d5db}' +
      '.slug-share-btn:hover{background:#f3f4f6}' +
      '.slug-watermark{margin-top:10px;font-size:12px;color:#9ca3af}' +
      '.slug-watermark a{color:#0ea5e9;text-decoration:none;font-weight:600}' +
      '@media (prefers-color-scheme: dark){.slug-share-btn{color:#e5e7eb;border-color:#374151}.slug-share-btn:hover{background:#1f2937}.slug-meta-line{color:#9ca3af}}';
    document.head.appendChild(style);
  }

  // ═══════════════════════════════════════════════════════════════
  // JSON-LD Dataset for individual map landing pages (?slug=<slug>)
  // ═══════════════════════════════════════════════════════════════

  function computeBBoxFromGeo(geo) {
    if (!geo || !geo.features || !geo.features.length) return null;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    geo.features.forEach(function(f) {
      var geom = f && f.geometry;
      if (!geom) return;
      _collectAllCoords(geom.coordinates, function(x, y) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      });
    });
    return (isFinite(minX) && isFinite(maxX) && isFinite(minY) && isFinite(maxY))
      ? [minX, minY, maxX, maxY]
      : null;
  }

  function _collectAllCoords(coords, cb) {
    if (!coords) return;
    if (typeof coords[0] === 'number') { cb(coords[0], coords[1]); return; }
    coords.forEach(function(c) { _collectAllCoords(c, cb); });
  }

  function injectDatasetJsonLd(item) {
    if (!item) return;
    var slug = item.slug || item.id;
    var title = item.title || item.name || 'Mapa sin título';
    var description = item.description || title;
    var canonicalUrl = 'https://maña.com/gallery/' + encodeURIComponent(slug) + '/';
    var ogImage = 'https://maña.com/og-cards/' + encodeURIComponent(slug) + '.png';

    // spatialCoverage: derive bounding box from mapPreview or GeoJSON
    var bbox = null;
    if (item.mapPreview && item.mapPreview.bbox) {
      bbox = item.mapPreview.bbox;
    } else {
      var geo = getPublishedGeo(item);
      if (geo) bbox = computeBBoxFromGeo(geo);
    }
    var spatialCoverage;
    if (bbox && bbox.length === 4) {
      spatialCoverage = {
        "@type": "Place",
        "geo": {
          "@type": "GeoShape",
          "box": bbox[1] + " " + bbox[0] + " " + bbox[3] + " " + bbox[2]
        }
      };
    } else {
      spatialCoverage = { "@type": "Place", "name": "Mundo" };
    }

    // dateModified: prefer updatedAtMs, fallback to createdAtMs
    var modMs = item.updatedAtMs || (item.updatedAt && item.updatedAt.toMillis ? item.updatedAt.toMillis() : 0)
      || item.createdAtMs || (item.createdAt && item.createdAt.toMillis ? item.createdAt.toMillis() : 0)
      || Date.now();
    var dateModified = new Date(modMs).toISOString().split('T')[0];

    var dataset = {
      "@context": "https://schema.org",
      "@type": "Dataset",
      "name": title,
      "description": description,
      "url": canonicalUrl,
      "spatialCoverage": spatialCoverage,
      "creator": {
        "@type": "Organization",
        "name": "Maña Maps",
        "url": "https://maña.com"
      },
      "dateModified": dateModified
    };

    if (item.dataSource) dataset.source = item.dataSource;
    if (item.dataYear) dataset.temporalCoverage = String(item.dataYear);
    if (Array.isArray(item.tags) && item.tags.length) dataset.keywords = item.tags;

    // Inject <script type="application/ld+json"> with id="ld-dataset"
    var existing = document.getElementById('ld-dataset');
    if (existing) existing.remove();
    var script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = 'ld-dataset';
    script.textContent = JSON.stringify(dataset);
    document.head.appendChild(script);

    // Update <title>, canonical and meta tags for SEO
    document.title = title + ' — Maña Maps';

    var metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.setAttribute('content', description.length > 160 ? description.slice(0, 157) + '…' : description);

    var canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) canonical.setAttribute('href', canonicalUrl);

    var ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute('content', title);

    var ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) ogDesc.setAttribute('content', description.length > 200 ? description.slice(0, 197) + '…' : description);

    var ogUrl = document.querySelector('meta[property="og:url"]');
    if (ogUrl) ogUrl.setAttribute('content', canonicalUrl);

    var twitterTitle = document.querySelector('meta[name="twitter:title"]');
    if (twitterTitle) twitterTitle.setAttribute('content', title);

    var twitterDesc = document.querySelector('meta[name="twitter:description"]');
    if (twitterDesc) twitterDesc.setAttribute('content', description.length > 200 ? description.slice(0, 197) + '…' : description);

    var ogImageEl = document.querySelector('meta[property="og:image"]');
    if (ogImageEl) ogImageEl.setAttribute('content', ogImage);
    var twImageEl = document.querySelector('meta[name="twitter:image"]');
    if (twImageEl) twImageEl.setAttribute('content', ogImage);
  }

  function handleSlugLanding(maps) {
    var params = new URLSearchParams(window.location.search);
    var slug = params.get('slug');
    if (!slug) return;
    var item = maps.find(function(m) { return (m.slug || m.id) === slug; });
    if (item) injectDatasetJsonLd(item);
  }

  // ═══════════════════════════════════════════════════════════════
  // LANDING /gallery/?slug=<id> — mapa MapLibre + leyenda legendKey
  // ═══════════════════════════════════════════════════════════════
  // Solo se renderiza cuando la URL trae ?slug=. Sin slug no hay mapa
  // destacado en la galería (decisión de producto: grid sin destacado).

  var _slugMap = null;

  function parseLegendNumber(raw) {
    if (raw == null) return NaN;
    // Números ya tipados en GeoJSON (3.781 felicidad, 0.972 IDH…): usarlos
    // tal cual. Pasarlos por string los trataría como miles («3.781»→3781).
    if (typeof raw === 'number') return isFinite(raw) ? raw : NaN;
    var s = String(raw);
    var m = s.replace(/[^\d.,\-]/g, '');
    if (m === '') return NaN;
    var num;
    if (m.indexOf(',') !== -1) {
      num = parseFloat(m.replace(/\./g, '').replace(',', '.'));
    } else if (/^\d{1,3}(\.\d{3})+$/.test(m) && !/\.\d{1,2}$/.test(m)) {
      // Miles con punto («4.280 m», «55.000»); 1–2 decimales = decimal.
      num = parseFloat(m.replace(/\./g, ''));
    } else {
      num = parseFloat(m);
    }
    return isFinite(num) ? num : NaN;
  }

  function formatLegendValue(v, fmt) {
    if (fmt === 'year') return String(Math.round(v));
    if (fmt === 'meters') return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' m';
    if (fmt === 'usd') return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' $';
    if (fmt === 'percent') {
      var p = Math.round(v * 10) / 10;
      var parts = String(p).split('.');
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      return parts.join(',') + '%';
    }
    var rounded = Math.round(v * 100) / 100;
    var parts2 = String(rounded).split('.');
    parts2[0] = parts2[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return parts2.join(',');
  }

  // Leyenda numérica declarada en el documento Firestore (legendKey).
  // Agrupa por _manaGroupName y pinta rampa claro→oscuro ordenada por el dato.
  function buildLegendForKey(geo, item) {
    var key = item && item.legendKey;
    if (!key) return '';
    var title = (item && item.legendTitle) || key;
    var fmt = (item && item.legendFormat) || 'number';
    var groups = {};
    (geo.features || []).forEach(function(f) {
      var p = f && f.properties;
      if (!p) return;
      var gname = p._manaGroupName || 'Datos';
      if (!p._manaColor) return;
      var v = parseLegendNumber(p[key]);
      if (!isFinite(v)) return;
      if (!groups[gname]) groups[gname] = { colors: {}, vals: [] };
      var b = groups[gname];
      if (!b.colors[p._manaColor]) {
        b.colors[p._manaColor] = true;
        b.vals.push({ v: v, c: p._manaColor });
      }
    });
    var ramp = null;
    Object.keys(groups).forEach(function(gname) {
      var u = {};
      groups[gname].vals.forEach(function(d) { u[d.c] = d; });
      var steps = Object.keys(u).map(function(k) { return u[k]; }).sort(function(a, b) { return a.v - b.v; });
      if (steps.length >= 3 && !ramp) ramp = { name: gname, steps: steps };
    });
    if (!ramp) return '';
    var html = '<div class="featured-legend" role="img" aria-label="Leyenda: ' + escHtml(title) + '">' +
      '<div class="featured-legend-title">' + escHtml(title) + '</div>' +
      '<div class="featured-legend-steps">';
    ramp.steps.forEach(function(s) { html += '<span style="background:' + s.c + '"></span>'; });
    html += '</div>' +
      '<div class="featured-legend-scale"><span>' + escHtml(formatLegendValue(ramp.steps[0].v, fmt)) + '</span>' +
      '<span>' + escHtml(formatLegendValue(ramp.steps[ramp.steps.length - 1].v, fmt)) + '</span></div>' +
      '</div>';
    return html;
  }

  async function remoteMapById(id) {
    if (!id || typeof firebase === 'undefined') return null;
    try {
      if (!firebase.apps || !firebase.apps.length) { if (!firebaseConfig) return null; firebase.initializeApp(firebaseConfig); }
      const db = firebase.firestore();
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

  async function getPublishedGeoAsync(item) {
    if (!item) return null;
    var immediate = getPublishedGeo(item);
    if (immediate) return immediate;
    if (item._geojsonLoaded && item._geojsonLoaded.features) return item._geojsonLoaded;
    if (typeof firebase === 'undefined') return null;
    try {
      if (!firebase.apps || !firebase.apps.length) { if (!firebaseConfig) return null; firebase.initializeApp(firebaseConfig); }
      var db = firebase.firestore();
      // Gallery list items come from a field-masked query without the heavy geo
      // payloads, so fetch the full document on demand (only the featured
      // ?slug= map and the handful of items missing a stored preview need it).
      var fullItem = item;
      if (!fullItem.geojsonChunked || !getPublishedGeo(fullItem)) {
        var fetched = await remoteMapById(item.slug || item.id);
        if (fetched) fullItem = fetched;
      }
      if (fullItem.geojsonChunked && fullItem.geojsonChunked.chunkCount) {
        var chunked = await readChunkedPublishedGeo(db, fullItem);
        if (chunked && chunked.features) {
          item._geojsonLoaded = chunked;
          return chunked;
        }
      }
      var geo = getPublishedGeo(fullItem);
      if (geo) {
        item._geojsonLoaded = geo;
        return geo;
      }
    } catch (e) {
      console.warn('gallery getPublishedGeoAsync failed:', e);
    }
    return null;
  }

  function collectGeoBounds(geo) {
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    function walk(coords) {
      if (!Array.isArray(coords)) return;
      if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
        var x = coords[0], y = coords[1];
        if (!isFinite(x) || !isFinite(y)) return;
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

  function addSlugMapLayers(map, geo) {
    if (!map.getSource('slug-data')) {
      map.addSource('slug-data', { type: 'geojson', data: geo });
    } else {
      map.getSource('slug-data').setData(geo);
    }
    var colorExpr = ['coalesce', ['get', '_manaColor'], ['get', 'color'], '#0ea5e9'];
    var isPolygon = ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']];
    var isLine = ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'MultiLineString']];
    var isPoint = ['any', ['==', ['geometry-type'], 'Point'], ['==', ['geometry-type'], 'MultiPoint']];

    if (!map.getLayer('slug-fills')) {
      map.addLayer({
        id: 'slug-fills', type: 'fill', source: 'slug-data', filter: isPolygon,
        paint: { 'fill-color': colorExpr, 'fill-opacity': ['coalesce', ['get', '_manaFillOpacity'], 0.16] }
      });
    }
    if (!map.getLayer('slug-fill-outlines')) {
      map.addLayer({
        id: 'slug-fill-outlines', type: 'line', source: 'slug-data', filter: isPolygon,
        layout: { 'line-join': 'round' },
        paint: {
          'line-color': ['coalesce', ['get', '_manaBorderColor'], colorExpr],
          'line-width': ['coalesce', ['get', '_manaWeight'], 1],
          'line-opacity': 0.9
        }
      });
    }
    if (!map.getLayer('slug-lines')) {
      map.addLayer({
        id: 'slug-lines', type: 'line', source: 'slug-data', filter: isLine,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': colorExpr,
          'line-width': ['coalesce', ['get', '_manaWeight'], 1.6],
          'line-opacity': ['coalesce', ['get', '_manaOpacity'], 0.92]
        }
      });
    }
    if (!map.getLayer('slug-points')) {
      map.addLayer({
        id: 'slug-points', type: 'circle', source: 'slug-data', filter: isPoint,
        paint: {
          'circle-radius': 6,
          'circle-color': colorExpr,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': ['coalesce', ['get', '_manaOpacity'], 0.95]
        }
      });
    }
  }

  async function showSlugMap(item) {
    if (!item) return;
    var wrap = document.getElementById('slug-map-wrap');
    var meta = document.getElementById('slug-map-meta');
    var target = document.getElementById('slug-map');
    var titleEl = document.getElementById('slug-map-title');
    if (!wrap || !target) return;

    ensureSlugStyles();
    countSlugView(item.slug || item.id, item.authorHandle);

    // Bloque «Mapas relacionados»: enlaces HTML rastreables al inicio de la
    // landing para interconectar el SEO de la galería.
    renderRelatedMaps(item, _allMaps);

    var geo = await getPublishedGeoAsync(item);
    if (titleEl) titleEl.textContent = item.title || item.name || 'Mapa';
    wrap.hidden = false;

    if (_slugMap) {
      try { _slugMap.remove(); } catch (e) {}
      _slugMap = null;
    }
    target.innerHTML = '';

    if (!geo || !geo.features || !geo.features.length || !window.maplibregl) {
      var fallbackSvg = (window.ManaMapPreview && renderThumb) ? renderThumb(item) : '';
      target.innerHTML = '<div class="featured-static">' + fallbackSvg + '</div>';
      if (meta) meta.innerHTML = '<div class="slug-meta-line">Vista previa estática del mapa.</div>' + slugCtaHtml(item);
      return;
    }

    var legendHtml = buildLegendForKey(geo, item);
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
    _slugMap = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    var bounds = collectGeoBounds(geo);
    if (bounds) {
      map.fitBounds(bounds, { padding: { top: 40, bottom: 40, left: 48, right: 48 }, duration: 0, maxZoom: 11 });
    }

    map.on('load', function() { addSlugMapLayers(map, geo); });
    map.on('error', function(e) {
      if (e && e.error && e.error.status === 404) return;
      console.warn('slug map error:', e && e.error ? e.error.message : e);
    });

    if (meta) meta.innerHTML = slugCtaHtml(item);
  }

  // ═══════════════════════════════════════════════════════════════
  // MAPAS RELACIONADOS — bloque SEO en landings /gallery/?slug=
  // ═══════════════════════════════════════════════════════════════
  // Enlaces HTML rastreables a 3-4 mapas temáticamente afines.
  // Afinidad: tags compartidos con peso IDF + clústeres temáticos
  // + tokens de título/slug. Fallback: mapas más recientes.

  var RELATED_LIMIT = 4;

  // Clústeres temáticos (tokens en minúscula, sin acentos) para emparejar
  // mapas aunque sus tags sean distintos (p. ej. «Océanos» ↔ «Arrecifes»).
  var RELATED_THEME_CLUSTERS = [
    ['volcan', 'geolog', 'pico', 'peak', 'montan', 'desiert', 'desert', 'rio', 'river', 'isla', 'island', 'ocean', 'mare', 'sea', 'arrecife', 'coral', 'incendi', 'wildfire', 'forest', 'hidrograf', 'glaciar', 'volcano'],
    ['co2', 'emision', 'nuclear', 'energia', 'energy', 'electric', 'clima', 'climate', 'forest', 'incendi', 'wildfire', 'medio', 'ambiente', 'environment', 'contamina', 'solar', 'eolica', 'eolico'],
    ['poblacion', 'population', 'fertil', 'esperanza', 'life', 'alfabetiz', 'literacy', 'educacion', 'education', 'felicidad', 'happiness', 'bienestar', 'internet', 'conectiv', 'desarrollo', 'development', 'idh', 'humano', 'salario', 'wage', 'econom', 'salud', 'health', 'empleo', 'pobreza'],
    ['patrimonio', 'unesco', 'biblioteca', 'library', 'cultura', 'culture', 'ciudad', 'city', 'perdid', 'lost', 'ruina', 'ruin', 'arqueolog', 'historia', 'history', 'civiliz', 'museo', 'monumento', 'heritage'],
    ['fibra', 'fiber', 'internet', 'tecnolog', 'technology', 'conectiv', 'infrastructure', 'infraestructura', 'nuclear', 'electric', 'dato', 'data', 'banda', 'red'],
  ];

  var RELATED_GENERIC_TOKENS = /^(mundo|mundial|paises|pais|por|del|de|la|el|los|las|y|en|con|world|country|countries|the|of|and|in|mapa|maps|indice|index|total|principales|mayores|largos|largas|largest|biggest|famosos|activos|peores|worst|publicas|public|per|capita|mundial)$/;

  function normalizeRelToken(str) {
    return String(str || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function normRelTag(tag) {
    return normalizeRelToken(tag);
  }

  function relatedTokensOf(map) {
    var raw = ((map && (map.title || map.name)) || '') + ' ' +
      ((map && (map.slug || map.id)) || '') + ' ' +
      (map && Array.isArray(map.tags) ? map.tags.join(' ') : '');
    return normalizeRelToken(raw).split(/\s+/).filter(function(w) {
      return w.length >= 3 && !RELATED_GENERIC_TOKENS.test(w);
    });
  }

  function mapThemeIndexes(map) {
    var tokens = relatedTokensOf(map);
    var themes = [];
    RELATED_THEME_CLUSTERS.forEach(function(cluster, idx) {
      for (var i = 0; i < cluster.length; i++) {
        var needle = cluster[i];
        for (var j = 0; j < tokens.length; j++) {
          if (tokens[j].indexOf(needle) >= 0) { themes.push(idx); return; }
        }
      }
    });
    return themes;
  }

  function buildRelTagStats(maps) {
    var freq = {};
    var total = (maps || []).length;
    (maps || []).forEach(function(m) {
      (Array.isArray(m.tags) ? m.tags : []).forEach(function(t) {
        var nt = normRelTag(t);
        if (!nt) return;
        freq[nt] = (freq[nt] || 0) + 1;
      });
    });
    return { freq: freq, total: total || 1 };
  }

  function relTagWeight(stats, tag) {
    var f = stats.freq[tag] || 0;
    if (!f) return 0;
    // IDF: una tag compartida y rara aporta más afinidad que una genérica.
    return Math.log(1 + stats.total / f);
  }

  function mapCreatedMs(m) {
    return (m && m.createdAtMs) || (m && m.createdAt && m.createdAt.toMillis ? m.createdAt.toMillis() : 0);
  }

  // Devuelve 3-4 mapas afines al actual (excluido él mismo).
  function pickRelatedMaps(current, allMaps, limit) {
    limit = limit || RELATED_LIMIT;
    var currentSlug = current && (current.slug || current.id);
    var others = (allMaps || []).filter(function(m) {
      var s = m && (m.slug || m.id);
      return s && s !== currentSlug;
    });
    if (!others.length) return [];

    var stats = buildRelTagStats((allMaps || []).concat(current ? [current] : []));
    var currentTags = (current && Array.isArray(current.tags) ? current.tags : [])
      .map(normRelTag).filter(Boolean);
    var currentThemes = mapThemeIndexes(current || {});
    var currentTokenSet = {};
    relatedTokensOf(current || {}).forEach(function(t) { currentTokenSet[t] = true; });

    var scored = others.map(function(m) {
      var score = 0;
      (Array.isArray(m.tags) ? m.tags : []).forEach(function(t) {
        var nt = normRelTag(t);
        if (nt && currentTags.indexOf(nt) >= 0) score += relTagWeight(stats, nt);
      });
      mapThemeIndexes(m).forEach(function(th) {
        if (currentThemes.indexOf(th) >= 0) score += 1.5;
      });
      relatedTokensOf(m).forEach(function(t) {
        if (currentTokenSet[t]) score += 0.3;
      });
      return { map: m, score: score, created: mapCreatedMs(m) };
    }).filter(function(x) { return x.score > 0; });

    scored.sort(function(a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return b.created - a.created;
    });

    var picked = scored.slice(0, limit).map(function(x) { return x.map; });

    // Fallback: completar con los mapas más recientes aún no elegidos.
    if (picked.length < limit) {
      var seen = {};
      picked.forEach(function(m) { seen[m.slug || m.id] = true; });
      var byRecency = others.slice().sort(function(a, b) { return mapCreatedMs(b) - mapCreatedMs(a); });
      for (var i = 0; i < byRecency.length && picked.length < limit; i++) {
        var key = byRecency[i].slug || byRecency[i].id;
        if (!seen[key]) {
          picked.push(byRecency[i]);
          seen[key] = true;
        }
      }
    }
    return picked;
  }

  // Renderiza el bloque «Mapas relacionados» con enlaces HTML rastreables.
  function renderRelatedMaps(current, allMaps) {
    var section = document.getElementById('related-maps');
    var list = document.getElementById('related-maps-list');
    if (!section || !list) return;
    if (!current) {
      section.hidden = true;
      list.innerHTML = '';
      return;
    }
    var related = pickRelatedMaps(current, allMaps || _allMaps, RELATED_LIMIT);
    if (!related.length) {
      section.hidden = true;
      list.innerHTML = '';
      return;
    }
    list.innerHTML = related.map(function(m) {
      var slug = m.slug || m.id;
      var title = m.title || m.name || 'Mapa sin título';
      var href = '/gallery/?slug=' + encodeURIComponent(slug);
      return '<li class="related-map-item">' +
        '<a class="related-map-link" href="' + href + '">' + escHtml(title) + '</a>' +
        '</li>';
    }).join('');
    section.hidden = false;
  }

  // Hook de test/auditoría (no usado por la UI).
  window.ManaGalleryRelated = {
    pickRelatedMaps: pickRelatedMaps,
    renderRelatedMaps: renderRelatedMaps,
    RELATED_LIMIT: RELATED_LIMIT
  };

  // ═══════════════════════════════════════════════════════════════
  // INIT + REALTIME
  // ═══════════════════════════════════════════════════════════════

  function applyMaps(items) {
    _allMaps = items || [];
    renderCatBar(_allMaps);
    if (!_activeTags.length) renderCards(_allMaps);
    syncJsonLdCount(_allMaps.length);
    handleSlugLanding(_allMaps);
    renderSlugLandingMap(_allMaps);
  }

  async function init() {
    if (canUseRest()) {
      try {
        applyMaps(await fetchPublishedListRest());
        return;
      } catch (e) {
        console.warn('gallery REST list failed, falling back to Firebase SDK:', e);
      }
    }
    if (typeof firebase === 'undefined') { applyMaps([]); return; }
    subscribeToPublishedMaps();
  }

  async function renderSlugLandingMap(maps) {
    var params = new URLSearchParams(window.location.search);
    var slug = params.get('slug');
    if (!slug) return;
    var item = (maps || _allMaps || []).find(function(m) { return (m.slug || m.id) === slug; });
    if (!item) {
      item = await remoteMapById(slug);
      if (item) {
        var list = maps || _allMaps;
        if (list) {
          list.unshift(item);
          renderCatBar(list);
          if (!_activeTags.length) renderCards(list);
        }
      }
    }
    if (item) await showSlugMap(item);
    else renderRelatedMaps(null, maps || _allMaps);
  }

  init();

  function subscribeToPublishedMaps() {
    if (typeof firebase === 'undefined') { return; }
    try {
      if (!firebase.apps || !firebase.apps.length) {
        if (!firebaseConfig) { applyMaps([]); return; }
        firebase.initializeApp(firebaseConfig);
      }
      const db = firebase.firestore();
      // Single realtime source for the grid: the initial snapshot paints the
      // cards (no separate .get() download) and later snapshots keep it live.
      var query = withListFields(
        db.collection(MAPS_COLLECTION).where('isPublished', '==', true).limit(100)
      );
      query.onSnapshot(function(snap) {
        applyMaps(dedupeSortMaps(snap.docs.map(function(d) { return { id: d.id, ...d.data() }; })));
      }, function(err) {
        console.warn('gallery realtime subscribe failed, falling back to one-shot read:', err);
        remoteMaps().then(applyMaps).catch(function() { applyMaps([]); });
      });
    } catch (e) {
      console.warn('gallery realtime unavailable:', e);
      remoteMaps().then(applyMaps).catch(function() { applyMaps([]); });
    }
  }
})();
