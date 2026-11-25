// ── gallery-layers.js ─ Add published maps from the public gallery as layers ──
// Lists the gallery with a field-masked Firestore REST query (cheap) and pulls
// the full GeoJSON only for the map the user chooses to add.

(function () {
  'use strict';

  const MAPS_COLLECTION = 'maps';
  const LIST_FIELDS = ['slug', 'title', 'name', 'tags', 'featureCount', 'lang', 'updatedAtMs', 'unlisted'];
  const LIST_LIMIT = 100;
  const CACHE_TTL = 60 * 1000;

  let _items = null;
  let _itemsAt = 0;
  let _loading = null;
  let _added = Object.create(null);
  let _search = '';
  let _lastFocus = null;

  function el(id) { return document.getElementById(id); }

  function tr(key, params) {
    return typeof t === 'function' ? t(key, params) : key;
  }

  function esc(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(value) {
    return esc(value).replace(/`/g, '&#96;');
  }

  // ═══════════════════════════════════════════════════════════════
  // FIRESTORE HELPERS
  // ═══════════════════════════════════════════════════════════════

  function firebaseConfigForRest() {
    try {
      if (window.ManaFirebase && typeof window.ManaFirebase.getConfig === 'function') {
        return window.ManaFirebase.getConfig();
      }
    } catch (e) {
      console.warn('gallery layers config unavailable:', e);
    }
    if (typeof firebaseConfig !== 'undefined') return firebaseConfig;
    return null;
  }

  function decodeFirestoreValue(value) {
    if (Array.isArray(value)) return value.map(decodeFirestoreValue);
    if (value && typeof value === 'object') {
      const keys = Object.keys(value);
      if (keys.length === 1) {
        switch (keys[0]) {
          case 'nullValue': return null;
          case 'stringValue': return value.stringValue;
          case 'integerValue': return Number(value.integerValue);
          case 'doubleValue': return Number(value.doubleValue);
          case 'booleanValue': return !!value.booleanValue;
          case 'timestampValue': return value.timestampValue;
          case 'arrayValue':
            return (value.arrayValue && value.arrayValue.values ? value.arrayValue.values : []).map(decodeFirestoreValue);
          case 'mapValue': {
            const out = {};
            const fields = (value.mapValue && value.mapValue.fields) || {};
            Object.keys(fields).forEach(function (key) { out[key] = decodeFirestoreValue(fields[key]); });
            return out;
          }
        }
      }
      const obj = {};
      Object.keys(value).forEach(function (key) { obj[key] = decodeFirestoreValue(value[key]); });
      return obj;
    }
    return value;
  }

  function restConfig() {
    const cfg = firebaseConfigForRest();
    if (!cfg || !cfg.projectId || !cfg.apiKey) return null;
    return {
      key: cfg.apiKey,
      db: 'https://firestore.googleapis.com/v1/projects/' + cfg.projectId +
        '/databases/(default)/documents'
    };
  }

  async function fetchPublishedRest() {
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
          limit: LIST_LIMIT,
          select: { fields: LIST_FIELDS.map(function (field) { return { fieldPath: field }; }) }
        }
      })
    });
    if (!res.ok) throw new Error('firestore-runQuery ' + res.status);
    const rows = await res.json();
    const items = [];
    (rows || []).forEach(function (row) {
      const doc = row && row.document;
      if (!doc) return;
      const item = {};
      const fields = doc.fields || {};
      Object.keys(fields).forEach(function (key) { item[key] = decodeFirestoreValue(fields[key]); });
      item.id = (doc.name || '').split('/').pop();
      items.push(item);
    });
    return normalizeItems(items);
  }

  async function fetchPublishedSdk() {
    if (typeof firebase === 'undefined') throw new Error('firebase-unavailable');
    let db = null;
    try {
      if (window.ManaFirebase && typeof window.ManaFirebase.getDb === 'function') db = window.ManaFirebase.getDb();
      else {
        if (!firebase.apps || !firebase.apps.length) return [];
        db = firebase.firestore();
      }
    } catch (e) {
      console.warn('gallery layers db unavailable:', e);
    }
    if (!db) throw new Error('firestore-unavailable');
    const snap = await db.collection(MAPS_COLLECTION)
      .where('isPublished', '==', true)
      .limit(LIST_LIMIT)
      .get();
    if (!snap || !snap.docs) return [];
    return normalizeItems(snap.docs.map(function (doc) { return { id: doc.id, ...doc.data() }; }));
  }

  function normalizeItems(items) {
    const seen = Object.create(null);
    const out = [];
    (items || []).forEach(function (item) {
      if (!item || item.isPublished === false || item.unlisted === true) return;
      const id = item.slug || item.id;
      if (!id || seen[id]) return;
      seen[id] = true;
      item.id = id;
      item.slug = id;
      item.title = item.title || item.name || id;
      out.push(item);
    });
    const locale = typeof LANG !== 'undefined' && LANG === 'en' ? 'en' : 'es';
    out.sort(function (a, b) {
      return String(a.title).localeCompare(String(b.title), locale, { sensitivity: 'base' });
    });
    return out;
  }

  async function loadItems(force) {
    if (!force && _items && Date.now() - _itemsAt < CACHE_TTL) return _items;
    if (_loading) return _loading;
    _loading = (async function () {
      try {
        return await fetchPublishedRest();
      } catch (err) {
        console.warn('gallery layers REST failed, falling back to SDK:', err);
        return await fetchPublishedSdk();
      }
    })();
    try {
      _items = await _loading;
      _itemsAt = Date.now();
      return _items;
    } finally {
      _loading = null;
    }
  }

  function normalizeText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  // ═══════════════════════════════════════════════════════════════
  // MODAL UI
  // ═══════════════════════════════════════════════════════════════

  function setStatus(text) {
    const status = el('gallery-layers-status');
    if (status) status.textContent = text || '';
  }

  function renderError() {
    const list = el('gallery-layers-list');
    setStatus('');
    if (!list) return;
    list.innerHTML = '<div class="gallery-layers-empty">' + esc(tr('gallery_layers_error')) +
      '<br><button type="button" class="gallery-layers-retry" data-gallery-retry="1">' +
      esc(tr('gallery_layers_retry')) + '</button></div>';
  }

  function renderItems() {
    const list = el('gallery-layers-list');
    if (!list) return;
    setStatus('');
    const query = normalizeText(_search);
    const items = (_items || []).filter(function (item) {
      if (!query) return true;
      const haystack = [item.title, item.slug, item.name]
        .concat(Array.isArray(item.tags) ? item.tags : [])
        .map(normalizeText)
        .join(' ');
      return haystack.indexOf(query) !== -1;
    });
    if (!items.length) {
      const msg = _search ? tr('gallery_layers_no_results') : tr('gallery_layers_empty');
      list.innerHTML = '<div class="gallery-layers-empty">' + esc(msg) + '</div>';
      return;
    }
    list.innerHTML = items.map(renderRow).join('');
  }

  function renderRow(item) {
    const id = item.id;
    const added = !!_added[id];
    const count = Number(item.featureCount);
    const meta = [];
    if (isFinite(count) && count > 0) {
      const locale = typeof LANG !== 'undefined' && LANG === 'en' ? 'en-US' : 'es-ES';
      meta.push('<span>' + esc(tr('gallery_layers_feature_count', { n: count.toLocaleString(locale) })) + '</span>');
    }
    const tags = Array.isArray(item.tags) ? item.tags.slice(0, 3) : [];
    tags.forEach(function (tag) {
      if (tag) meta.push('<span class="gallery-layer-tag">' + esc(tag) + '</span>');
    });
    return '<div class="gallery-layer-row">' +
      '<div class="gallery-layer-copy">' +
        '<strong title="' + escapeAttr(item.title) + '">' + esc(item.title) + '</strong>' +
        '<span class="gallery-layer-meta">' + meta.join('') + '</span>' +
      '</div>' +
      '<button type="button" class="gallery-layer-add' + (added ? ' is-added' : '') + '"' +
        ' data-gallery-add="' + escapeAttr(id) + '"' +
        (added ? ' disabled' : '') + '>' +
        esc(added ? tr('gallery_layers_added') : tr('gallery_layers_add')) +
      '</button>' +
    '</div>';
  }

  async function openPicker() {
    const modal = el('gallery-layers-modal');
    if (!modal) return;
    if (window.manaSharedAccess && window.manaSharedAccess.canEdit === false) {
      if (typeof showToast === 'function') {
        showToast(typeof LANG !== 'undefined' && LANG === 'en'
          ? 'This shared map is view only.'
          : 'Este mapa compartido es de solo lectura.');
      }
      return;
    }
    _lastFocus = document.activeElement;
    _search = '';
    const input = el('gallery-layers-search');
    if (input) input.value = '';
    const list = el('gallery-layers-list');
    if (list) list.innerHTML = '';
    setStatus(tr('gallery_layers_loading'));
    modal.style.display = 'flex';
    document.body.classList.add('gallery-layers-open');
    setTimeout(function () { if (input) input.focus(); }, 40);
    try {
      await loadItems(false);
      renderItems();
    } catch (err) {
      console.warn('gallery layers load failed:', err);
      renderError();
    }
  }

  function closePicker() {
    const modal = el('gallery-layers-modal');
    if (!modal) return;
    modal.style.display = 'none';
    document.body.classList.remove('gallery-layers-open');
    if (_lastFocus && typeof _lastFocus.focus === 'function') _lastFocus.focus();
  }

  // ═══════════════════════════════════════════════════════════════
  // GEOJSON → EDITOR LAYERS
  // ═══════════════════════════════════════════════════════════════

  function parseGeoJSON(value) {
    if (!value) return null;
    if (typeof value === 'string') {
      try { return parseGeoJSON(JSON.parse(value)); } catch (e) { return null; }
    }
    if (value.type === 'Feature') value = { type: 'FeatureCollection', features: [value] };
    if (value && Array.isArray(value.features) && value.features.length) return value;
    return null;
  }

  async function fetchMapGeo(id) {
    let db = null;
    try {
      if (window.ManaFirebase && typeof window.ManaFirebase.getDb === 'function') db = window.ManaFirebase.getDb();
      else if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) db = firebase.firestore();
    } catch (e) {
      console.warn('gallery layers db unavailable:', e);
    }
    if (!db) throw new Error('firestore-unavailable');

    const ref = db.collection(MAPS_COLLECTION).doc(id);
    const snap = await ref.get();
    if (!snap || !snap.exists) throw new Error('map-not-found');
    const data = snap.data() || {};
    if (!data.isPublished) throw new Error('map-not-published');

    let geo = parseGeoJSON(data.geojson || data.mapData || data.geojsonText || data.mapDataText);

    if (!geo && data.geojsonChunked && data.geojsonChunked.chunkCount) {
      const chunkSnap = await ref
        .collection(data.geojsonChunked.collection || 'geoChunks')
        .orderBy('index', 'asc')
        .limit(data.geojsonChunked.chunkCount)
        .get();
      let raw = '';
      chunkSnap.forEach(function (doc) {
        const chunk = doc.data() || {};
        if (typeof chunk.text === 'string') raw += chunk.text;
      });
      geo = parseGeoJSON(raw);
    }

    return { geo: geo, title: data.title || data.name || id };
  }

  function uniqueGroupName(name, title) {
    for (const gid in _manaGroupMeta) {
      const meta = _manaGroupMeta[gid];
      if (meta && meta.name === name) return title + ' · ' + name;
    }
    return name;
  }

  function fitNewGroups(before) {
    if (typeof L === 'undefined' || typeof map === 'undefined' || !map) return;
    const bounds = L.latLngBounds();
    let any = false;
    Object.keys(_manaGroupMeta).forEach(function (gid) {
      if (before[gid]) return;
      const meta = _manaGroupMeta[gid];
      if (!meta) return;
      meta.allLayers.forEach(function (layer) {
        if (meta.hiddenLayers && meta.hiddenLayers.has(layer)) return;
        if (layer.getBounds) {
          const b = layer.getBounds();
          if (b && b.isValid && b.isValid()) { bounds.extend(b); any = true; }
        } else if (layer.getLatLng) {
          bounds.extend(layer.getLatLng());
          any = true;
        }
      });
    });
    if (any) {
      map.fitBounds(bounds, { padding: [24, 24], maxZoom: 14 });
      if (typeof activeBase !== 'undefined' && activeBase === 'globe' &&
          typeof globeMap !== 'undefined' && globeMap && typeof globeMap.fitBounds === 'function') {
        try {
          globeMap.fitBounds([
            [bounds.getWest(), bounds.getSouth()],
            [bounds.getEast(), bounds.getNorth()]
          ], { padding: 40, maxZoom: 2.4 });
        } catch (e) { /* globe may still be loading */ }
      }
    }
  }

  async function addGeoToEditor(geo, title) {
    const groups = Object.create(null);
    const order = [];
    const ungrouped = [];

    geo.features.forEach(function (feature) {
      const props = (feature && feature.properties) || {};
      const groupName = typeof props._manaGroupName === 'string' ? props._manaGroupName.trim() : '';
      if (groupName) {
        if (!groups[groupName]) { groups[groupName] = []; order.push(groupName); }
        groups[groupName].push(feature);
      } else {
        ungrouped.push(feature);
      }
    });

    const before = Object.create(null);
    Object.keys(_manaGroupMeta).forEach(function (gid) { before[gid] = true; });

    const imports = [];
    order.forEach(function (groupName) {
      imports.push(Promise.resolve(loadGeoJSON(
        { type: 'FeatureCollection', features: groups[groupName] },
        uniqueGroupName(groupName, title)
      )));
    });
    if (ungrouped.length) {
      imports.push(Promise.resolve(loadGeoJSON(
        { type: 'FeatureCollection', features: ungrouped },
        title
      )));
    }
    if (!imports.length) throw new Error('empty-geo');

    await Promise.all(imports);
    fitNewGroups(before);
  }

  async function addItem(item, button) {
    if (!item || _added[item.id]) return;
    const previousLabel = button ? button.textContent : '';
    if (button) {
      button.disabled = true;
      button.classList.add('is-loading');
      button.textContent = tr('gallery_layers_adding');
    }
    try {
      const fetched = await fetchMapGeo(item.id);
      if (!fetched.geo) throw new Error('empty-geo');
      if (typeof pushUndo === 'function') pushUndo();
      await addGeoToEditor(fetched.geo, fetched.title || item.title || item.id);
      _added[item.id] = true;
      renderItems();
      if (typeof showToast === 'function') {
        showToast(tr('gallery_layers_added_toast', { name: fetched.title || item.title || item.id }));
      }
    } catch (err) {
      console.warn('gallery layer add failed:', err);
      if (button) {
        button.disabled = false;
        button.classList.remove('is-loading');
        button.textContent = previousLabel;
      }
      if (typeof manaAlert === 'function') manaAlert(tr('gallery_layers_load_error'), 'error');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // EVENTS
  // ═══════════════════════════════════════════════════════════════

  function init() {
    const modal = el('gallery-layers-modal');
    if (!modal) return;

    modal.addEventListener('click', function (event) {
      if (event.target === modal) closePicker();
    });

    document.addEventListener('keydown', function (event) {
      if (modal.style.display === 'none') return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closePicker();
        return;
      }
      if (typeof _trapFocus === 'function') {
        try { _trapFocus(modal, event); } catch (e) { /* keep keyboard usable */ }
      }
    }, true);

    const search = el('gallery-layers-search');
    if (search) {
      search.addEventListener('input', function () {
        _search = search.value || '';
        renderItems();
      });
    }

    const list = el('gallery-layers-list');
    if (list) {
      list.addEventListener('click', function (event) {
        const retry = event.target.closest('[data-gallery-retry]');
        if (retry) {
          setStatus(tr('gallery_layers_loading'));
          list.innerHTML = '';
          loadItems(true).then(renderItems).catch(renderError);
          return;
        }
        const button = event.target.closest('[data-gallery-add]');
        if (!button) return;
        const id = button.getAttribute('data-gallery-add');
        if (!id) return;
        const item = (_items || []).find(function (entry) { return entry.id === id; });
        if (item) addItem(item, button);
      });
    }
  }

  window.openGalleryLayersPicker = openPicker;
  window.closeGalleryLayersPicker = closePicker;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
