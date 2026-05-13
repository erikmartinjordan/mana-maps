// ── public-profile.js ─ renders public @handle profiles ─

(function() {
  'use strict';

  const MAPS_COLLECTION = 'maps';
  const USERS_COLLECTION = 'users';
  const firebaseConfig = window.ManaFirebase && window.ManaFirebase.getConfig();

  function escHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function normalizeHandle(value) {
    return (value || '').toLowerCase().replace(/^@+/, '').replace(/[^a-z0-9._-]/g, '').slice(0, 24);
  }

  function getProfileHandleFromURL() {
    var path = window.location.pathname || '';
    var atMatch = path.match(/^\/@([a-z0-9._-]{3,24})\/?$/i);
    if (atMatch) return normalizeHandle(atMatch[1]);
    var params = new URLSearchParams(window.location.search || '');
    return normalizeHandle(params.get('u') || params.get('handle') || '');
  }

  function getDb() {
    if (typeof firebase === 'undefined') return null;
    if (!firebase.apps || !firebase.apps.length) { if (!firebaseConfig) return null; firebase.initializeApp(firebaseConfig); }
    return firebase.firestore();
  }

  function safeDate(tsMs) {
    if (!tsMs) return 'Sin fecha';
    try {
      return new Date(tsMs).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (e) {
      return 'Sin fecha';
    }
  }

  function timestampMs(item) {
    return item.createdAtMs || (item.createdAt && item.createdAt.toMillis ? item.createdAt.toMillis() : 0);
  }

  function color(value) { return /^#[0-9a-f]{3,8}$/i.test(value || '') ? value : '#0ea5e9'; }

  function numericStat(value) {
    var number = Number(value);
    return isFinite(number) && number > 0 ? Math.floor(number) : 0;
  }

  function mapViews(item) {
    return numericStat(item && (item.views != null ? item.views : item.viewCount));
  }

  function mapLikes(item) {
    return numericStat(item && (item.likes != null ? item.likes : item.likeCount));
  }

  function formatNumber(value) {
    try { return numericStat(value).toLocaleString('es-ES'); }
    catch (e) { return String(numericStat(value)); }
  }

  function mapCountLabel(count) {
    return count === 1 ? 'mapa público' : 'mapas públicos';
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
    function color(value) { return /^#[0-9a-f]{3,8}$/i.test(value || '') ? value : '#0ea5e9'; }
    function renderDensityCells() {
      if (!Array.isArray(preview.cells) || !preview.cells.length) return '';
      var grid = Math.max(1, Number(preview.gridSize) || 28);
      var size = 100 / grid;
      var maxCount = preview.cells.reduce(function(max, cell) {
        var count = Number(cell && cell.n) || 1;
        return Math.max(max, count);
      }, 1);
      return preview.cells.map(function(cell) {
        var x = Number(cell && cell.x); var y = Number(cell && cell.y);
        if (!isFinite(x) || !isFinite(y)) return '';
        var count = Math.max(1, Number(cell.n) || 1);
        var opacity = Math.min(0.88, 0.28 + (count / maxCount) * 0.48);
        return '<rect x="' + (x * size).toFixed(2) + '" y="' + (y * size).toFixed(2) + '" width="' + Math.max(size, 1.2).toFixed(2) + '" height="' + Math.max(size, 1.2).toFixed(2) + '" rx="0.9" fill="' + color(cell.c) + '" fill-opacity="' + opacity.toFixed(2) + '"/>';
      }).join('');
    }
    function decodePreviewGeometry(geom) {
      if (!geom) return null;
      if (Array.isArray(geom.coordinates)) return geom;
      if (typeof geom.coordinatesText === 'string' && geom.coordinatesText) {
        try { return { type: geom.type, coordinates: JSON.parse(geom.coordinatesText) }; }
        catch (e) { return null; }
      }
      return null;
    }
    function pointToString(coord) {
      if (!Array.isArray(coord) || coord.length < 2) return '';
      var x = Number(coord[0]); var y = Number(coord[1]);
      if (!isFinite(x) || !isFinite(y)) return '';
      return toX(x).toFixed(2) + ',' + toY(y).toFixed(2);
    }
    function lineToPoints(line) {
      if (!Array.isArray(line)) return '';
      return line.map(pointToString).filter(Boolean).join(' ');
    }
    function ringToPath(ring) {
      if (!Array.isArray(ring) || !ring.length) return '';
      var parts = ring.map(function(c, idx) {
        var point = pointToString(c);
        if (!point) return '';
        return (idx ? 'L' : 'M') + point.replace(',', ' ');
      }).filter(Boolean);
      return parts.length ? parts.join(' ') + ' Z' : '';
    }
    function renderPolygon(poly, stroke) {
      if (!Array.isArray(poly) || !poly.length) return '';
      var path = ringToPath(poly[0]);
      return path ? '<path d="' + path + '" fill="' + stroke + '" fill-opacity="0.2" stroke="' + stroke + '" stroke-width="1.3"/>' : '';
    }
    var body = renderDensityCells();
    preview.features.forEach(function(entry) {
      var geom = decodePreviewGeometry(entry && entry.geometry);
      if (!geom) return;
      var stroke = color(entry.color);
      if (geom.type === 'Point' && Array.isArray(geom.coordinates)) {
        var p = pointToString(geom.coordinates).split(',');
        if (p.length === 2) body += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="2.7" fill="' + stroke + '" fill-opacity="0.9"/>';
      } else if (geom.type === 'MultiPoint' && Array.isArray(geom.coordinates)) {
        geom.coordinates.forEach(function(coord) {
          var p = pointToString(coord).split(',');
          if (p.length === 2) body += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="2.3" fill="' + stroke + '" fill-opacity="0.9"/>';
        });
      } else if (geom.type === 'LineString' && Array.isArray(geom.coordinates)) {
        var pts = lineToPoints(geom.coordinates);
        if (pts) body += '<polyline points="' + pts + '" fill="none" stroke="' + stroke + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
      } else if (geom.type === 'MultiLineString' && Array.isArray(geom.coordinates)) {
        geom.coordinates.forEach(function(line) {
          var pts = lineToPoints(line);
          if (pts) body += '<polyline points="' + pts + '" fill="none" stroke="' + stroke + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
        });
      } else if (geom.type === 'Polygon' && Array.isArray(geom.coordinates)) {
        body += renderPolygon(geom.coordinates, stroke);
      } else if (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates)) {
        geom.coordinates.forEach(function(poly) { body += renderPolygon(poly, stroke); });
      }
    });
    if (!body) return '';
    return '<svg class="thumb-preview" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' + body + '</svg>';
  }

  function renderAvatar(profile, handle) {
    var url = (profile && profile.avatarUrl) || '';
    var name = (profile && profile.displayName) || handle || 'M';
    if (url) return '<img src="' + escHtml(url) + '" alt="Foto de ' + escHtml(name) + '" loading="lazy">';
    return '<span>' + escHtml(name.trim().charAt(0).toUpperCase() || '@') + '</span>';
  }

  function renderViewsSummary(maps) {
    var summary = document.getElementById('public-profile-views-summary');
    if (!summary) return;
    var visibleMaps = maps.filter(function(item) { return mapViews(item) > 0; }).slice(0, 12);
    if (!visibleMaps.length) {
      summary.innerHTML = '<span class="public-profile-views-empty">Sin visualizaciones todavía</span>';
      return;
    }
    var maxViews = visibleMaps.reduce(function(max, item) { return Math.max(max, mapViews(item)); }, 1);
    summary.innerHTML = '<div class="public-profile-view-bars">' + visibleMaps.map(function(item) {
      var views = mapViews(item);
      var height = Math.max(18, Math.round((views / maxViews) * 100));
      var title = (item.title || item.name || 'Mapa sin título') + ': ' + formatNumber(views) + ' visualizaciones';
      return '<span class="public-profile-view-bar" style="--bar-height:' + height + '%" title="' + escHtml(title) + '" aria-label="' + escHtml(title) + '"></span>';
    }).join('') + '</div>';
  }

  function renderMaps(maps, handle) {
    var list = document.getElementById('public-profile-maps');
    if (!list) return;
    if (!maps.length) {
      list.innerHTML = '<div class="public-profile-empty">@' + escHtml(handle) + ' todavía no tiene mapas públicos.</div>';
      return;
    }
    list.innerHTML = maps.map(function(item) {
      var mapSlug = item.slug || item.id;
      var created = timestampMs(item);
      var thumb = renderMapPreviewSVG(item.mapPreview);
      var views = mapViews(item);
      var likes = mapLikes(item);
      return '' +
        '<article class="public-map-card">' +
          '<a class="public-map-link" href="/map/index.html?gallery=' + encodeURIComponent(mapSlug) + '&map=' + encodeURIComponent(mapSlug) + '&room=' + encodeURIComponent(mapSlug) + '&mode=' + encodeURIComponent(item.shareMode || 'view') + '">' +
            '<div class="thumb">' + (thumb || '<span class="public-map-empty-thumb">Vista previa no disponible</span>') + '</div>' +
            '<h3>' + escHtml(item.title || item.name || 'Mapa sin título') + '</h3>' +
          '</a>' +
          '<p>' + escHtml(item.description || '') + '</p>' +
          '<div class="public-map-meta"><span>' + (item.featureCount || 0) + ' elementos</span><span>·</span><span>' + safeDate(created) + '</span></div>' +
          '<div class="public-map-engagement" aria-label="Actividad del mapa">' +
            '<span class="public-map-stat" title="Visualizaciones">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M1.5 12s3.8-7 10.5-7 10.5 7 10.5 7-3.8 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg>' +
              '<span>' + formatNumber(views) + '</span>' +
            '</span>' +
            '<span class="public-map-stat public-map-like-stat" title="Me gustas">' +
              '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.08C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>' +
              '<span>' + formatNumber(likes) + '</span>' +
            '</span>' +
          '</div>' +
        '</article>';
    }).join('');
  }

  async function fetchMaps(db, handle) {
    var snap = null;
    try {
      snap = await db.collection(MAPS_COLLECTION)
        .where('authorHandle', '==', handle)
        .orderBy('createdAt', 'desc')
        .limit(48)
        .get();
    } catch (e) {
      console.warn('public profile ordered maps query failed, retrying without orderBy:', e);
      snap = await db.collection(MAPS_COLLECTION)
        .where('authorHandle', '==', handle)
        .limit(100)
        .get();
    }
    var maps = snap.docs.map(function(doc) { return Object.assign({ id: doc.id }, doc.data() || {}); })
      .filter(function(item) { return item.isPublished === true || item.public === true; });
    maps.sort(function(a, b) { return timestampMs(b) - timestampMs(a); });
    return maps.slice(0, 48);
  }

  async function initPublicProfile() {
    var handle = getProfileHandleFromURL();
    if (!handle) {
      if (document.body.classList.contains('public-profile-page')) {
        var empty = document.getElementById('public-profile-maps');
        var bio = document.getElementById('public-profile-bio');
        if (bio) bio.textContent = 'Esta página no existe todavía.';
        if (empty) empty.innerHTML = '<div class="public-profile-empty">Perfil no encontrado. Visita la galería para descubrir mapas públicos.</div>';
      }
      return;
    }
    document.body.classList.add('public-profile-page');
    var editor = document.getElementById('private-profile-card');
    if (editor) editor.style.display = 'none';
    var publicView = document.getElementById('public-profile-view');
    if (publicView) publicView.style.display = 'block';

    var db = getDb();
    if (!db) return;
    try {
      var profileDoc = await db.collection(USERS_COLLECTION).doc(handle).get();
      var profile = profileDoc.exists ? (profileDoc.data() || {}) : null;
      var maps = await fetchMaps(db, handle);
      var displayName = (profile && profile.displayName) || '@' + handle;
      document.title = displayName + ' (@' + handle + ') — Maña Maps';
      var nameEl = document.getElementById('public-profile-name');
      var handleEl = document.getElementById('public-profile-handle');
      var bioEl = document.getElementById('public-profile-bio');
      var avatarEl = document.getElementById('public-profile-avatar');
      var countEl = document.getElementById('public-profile-map-count');
      var labelEl = document.getElementById('public-profile-map-label');
      var viewsEl = document.getElementById('public-profile-view-count');
      if (nameEl) nameEl.textContent = displayName;
      if (handleEl) handleEl.textContent = '@' + handle;
      if (bioEl) bioEl.textContent = (profile && profile.bio) || 'Mapas públicos creados con Maña Maps.';
      if (avatarEl) avatarEl.innerHTML = renderAvatar(profile, handle);
      var totalViews = maps.reduce(function(total, item) { return total + mapViews(item); }, 0);
      if (countEl) countEl.textContent = formatNumber(maps.length);
      if (labelEl) labelEl.textContent = mapCountLabel(maps.length);
      if (viewsEl) viewsEl.textContent = formatNumber(totalViews);
      renderViewsSummary(maps);
      renderMaps(maps, handle);
    } catch (e) {
      console.warn('public profile failed:', e);
      var list = document.getElementById('public-profile-maps');
      if (list) list.innerHTML = '<div class="public-profile-empty">No se pudo cargar este perfil.</div>';
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPublicProfile);
  else initPublicProfile();
})();
