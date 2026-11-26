// ── pdf-export.js ─ Descarga del mapa como PDF con plantillas.
// Compone la página en SVG (mapa + leyenda + datos), la rasteriza y ensambla
// un PDF en el navegador, sin servidores ni dependencias externas.
(function () {
  'use strict';

  var INK = '#111214';
  var MUTED = '#5f6670';
  var FAINT = '#9aa0a8';
  var LINE = '#e7e3da';
  var PAPER = '#fcf9f2';
  var SOFT = '#f3ecdf';
  var MAPBG = '#f7f2e8';
  var ACC = '#e8b86d';
  var ACC2 = '#d97757';
  var FONT = "'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
  var MONO = "'DM Mono',ui-monospace,SFMono-Regular,Menlo,monospace";
  var DEG = 180 / Math.PI;
  var WORLD_MAX = 85.051129;

  var ICON = 'M42.3,-74.7C55.1,-65.8,66.1,-55.2,74.7,-42.4C83.2,-29.7,89.3,-14.8,89.7,0.2C90,15.2,84.6,30.5,74.3,40.2C64,49.8,48.7,54,35.6,62.1C22.4,70.2,11.2,82.3,-0.8,83.6C-12.7,84.9,-25.4,75.4,-36.1,65.9C-46.9,56.4,-55.6,46.8,-61.3,35.8C-66.9,24.8,-69.5,12.4,-72,-1.4C-74.5,-15.3,-76.9,-30.5,-70.9,-41C-64.9,-51.4,-50.6,-57.1,-37.4,-65.8C-24.2,-74.5,-12.1,-86.1,1.3,-88.4C14.7,-90.7,29.5,-83.6,42.3,-74.7Z';
  var MG1 = 'M1675 0H1303V987L1032 350H777L506 987V0H154V1489H585L915 754L1244 1489H1675Z';
  var MG2 = 'M-186 2061Q-196 1894 -269.0 1816.5Q-342 1739 -472 1739Q-520 1739 -563.0 1758.5Q-606 1778 -637 1797Q-667 1816 -703.5 1835.5Q-740 1855 -765 1855Q-815 1855 -833.0 1823.5Q-851 1792 -855 1733H-1065Q-1059 1879 -983.0 1966.5Q-907 2054 -780 2054Q-732 2054 -691.0 2037.0Q-650 2020 -612 1998Q-582 1981 -546.0 1962.0Q-510 1943 -487 1943Q-439 1943 -418.5 1975.0Q-398 2007 -396 2061Z';

  var TEMPLATES = [
    { id: 'dossier', w: 794, h: 1123, scale: 2, pw: 595.28, ph: 841.89, name: 'Dossier', nameEn: 'Dossier', size: 'A4 · vertical' },
    { id: 'atlas', w: 1123, h: 794, scale: 2, pw: 841.89, ph: 595.28, name: 'Atlas', nameEn: 'Atlas', size: 'A4 · horizontal' },
    { id: 'ficha', w: 794, h: 1123, scale: 2, pw: 595.28, ph: 841.89, name: 'Ficha ejecutiva', nameEn: 'Executive sheet', size: 'A4 · vertical' },
    { id: 'cartel', w: 1000, h: 1400, scale: 2.2, pw: 1417.32, ph: 1983.31, name: 'Cartel', nameEn: 'Poster', size: '50×70 cm' },
    { id: 'minimal', w: 794, h: 1123, scale: 2, pw: 595.28, ph: 841.89, name: 'Minimal', nameEn: 'Minimal', size: 'A4 · vertical' }
  ];

  var state = {
    ctx: null,
    template: 'dossier',
    includeLegend: true,
    includeLabels: false,
    includeTable: true,
    frame: 'fit',
    region: null,
    mapViewBounds: null,
    cache: {},
    previewUrl: null,
    thumbUrls: {},
    busy: false,
    shareArtifact: null,
    shareKey: null,
    shareTimer: null
  };
  function templateName(t) { return lang() === 'en' ? (t.nameEn || t.name) : t.name; }

  // ── Analítica anónima ──
  // Mide qué plantilla y qué encuadre se usan y dónde falla la exportación.
  // Nunca se envían el título del mapa, su slug, textos ni coordenadas: solo
  // identificadores de plantilla, modos, booleanos y el número de elementos
  // agrupado en tramos, para no identificar el contenido del usuario.
  function featureBucket(n) {
    n = Number(n) || 0;
    if (n <= 1) return '0-1';
    if (n <= 50) return '2-50';
    if (n <= 200) return '51-200';
    if (n <= 1000) return '201-1000';
    return '1001+';
  }
  function errorReason(e) {
    var reason = (e && (e.name || e.code)) || 'unknown';
    return String(reason).slice(0, 40);
  }
  function track(name, params) {
    try {
      if (typeof window.trackEvent === 'function') window.trackEvent(name, params || {});
    } catch (e) { /* la medición nunca puede bloquear la exportación */ }
  }

  // ── Utilidades de texto ──
  function lang() { return (typeof LANG === 'string') ? LANG : 'es'; }
  function tr(es, en) { return lang() === 'en' ? en : es; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function num(v, dec) {
    if (!isFinite(v)) return '';
    var d = (typeof dec === 'number') ? dec : 2;
    try {
      return Number(v).toLocaleString(lang() === 'en' ? 'en-US' : 'es-ES', {
        minimumFractionDigits: 0,
        maximumFractionDigits: d
      });
    } catch (e) {
      var parts = Number(v).toFixed(d).split('.');
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, lang() === 'en' ? ',' : '.');
      var decPart = (parts[1] || '').replace(/0+$/, '');
      return parts[0] + (decPart ? (lang() === 'en' ? '.' : ',') + decPart : '');
    }
  }
  function formatVal(v, fmt) {
    if (!isFinite(v)) return '—';
    if (fmt === 'usd') return num(v, Math.abs(v) >= 1000 ? 0 : 2) + ' $';
    if (fmt === 'meters') return num(v, 0) + ' m';
    if (fmt === 'year') return String(Math.round(v));
    if (fmt === 'percent') return num(v, 1) + ' %';
    return num(v, Math.abs(v) >= 1000 ? 0 : 2);
  }
  function truncate(s, max) {
    s = String(s == null ? '' : s);
    return s.length > max ? s.slice(0, max - 1).trim() + '…' : s;
  }
  function niceKey(k) {
    k = String(k || '').replace(/\s*\((num|n[uú]mero|number|valor)\)\s*$/i, '').replace(/_/g, ' ').trim();
    return k ? k.charAt(0).toUpperCase() + k.slice(1) : '';
  }
  function wrapLines(text, maxWidth, size, maxLines) {
    var perChar = size * 0.53;
    var maxChars = Math.max(6, Math.floor(maxWidth / perChar));
    var words = String(text || '').split(/\s+/).filter(Boolean);
    var lines = [], cur = '';
    words.forEach(function (w) {
      var t = cur ? cur + ' ' + w : w;
      if (t.length > maxChars && cur) { lines.push(cur); cur = w; }
      else cur = t;
    });
    if (cur) lines.push(cur);
    if (maxLines && lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      lines[maxLines - 1] = truncate(lines[maxLines - 1], Math.max(6, maxChars));
      if (lines[maxLines - 1].length >= maxChars) lines[maxLines - 1] = lines[maxLines - 1].slice(0, maxChars - 1) + '…';
    }
    return lines;
  }
  function slugify(s) {
    return String(s || 'mapa').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'mapa';
  }

  // ── Geometría / proyección ──
  function mercY(lat) {
    var l = Math.max(-WORLD_MAX, Math.min(WORLD_MAX, lat));
    return Math.log(Math.tan(Math.PI / 4 + l * Math.PI / 360)) * DEG;
  }
  function featureColor(f) {
    var p = f.properties || {};
    return p._manaColor || p.color || ACC;
  }
  function featureOpacity(f) {
    var p = f.properties || {};
    var v = p._manaFillOpacity;
    return (typeof v === 'number' && isFinite(v)) ? Math.max(0.55, Math.min(1, v)) : 0.9;
  }
  function forEachRing(geom, cb) {
    if (!geom) return;
    var t = geom.type, c = geom.coordinates;
    if (t === 'Polygon') c.forEach(function (r) { cb(r); });
    else if (t === 'MultiPolygon') c.forEach(function (p) { p.forEach(function (r) { cb(r); }); });
    else if (t === 'LineString') cb(c);
    else if (t === 'MultiLineString') c.forEach(function (l) { cb(l); });
  }
  function bounds(geo) {
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    function add(x, y) {
      if (typeof x !== 'number' || typeof y !== 'number' || !isFinite(x) || !isFinite(y)) return;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      var m = mercY(y); if (m < minY) minY = m; if (m > maxY) maxY = m;
    }
    (geo.features || []).forEach(function (f) {
      var g = f.geometry; if (!g) return;
      if (g.type === 'Point') add(g.coordinates[0], g.coordinates[1]);
      else if (g.type === 'MultiPoint') g.coordinates.forEach(function (c) { add(c[0], c[1]); });
      else forEachRing(g, function (r) { for (var i = 0; i < r.length; i++) add(r[i][0], r[i][1]); });
    });
    if (minX === Infinity) return null;
    return { minX: minX, maxX: maxX, minY: minY, maxY: maxY };
  }
  function validBounds(b) {
    return !!(b && isFinite(b.minX) && isFinite(b.maxX) && isFinite(b.minY) && isFinite(b.maxY) &&
      b.maxX > b.minX && b.maxY > b.minY);
  }
  function featureBounds(f) {
    var g = f && f.geometry;
    if (!g) return null;
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    function add(x, y) {
      if (typeof x !== 'number' || typeof y !== 'number' || !isFinite(x) || !isFinite(y)) return;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      var m = mercY(y); if (m < minY) minY = m; if (m > maxY) maxY = m;
    }
    if (g.type === 'Point') add(g.coordinates[0], g.coordinates[1]);
    else if (g.type === 'MultiPoint') g.coordinates.forEach(function (c) { add(c[0], c[1]); });
    else forEachRing(g, function (r) { for (var i = 0; i < r.length; i++) add(r[i][0], r[i][1]); });
    if (minX === Infinity) return null;
    return { minX: minX, maxX: maxX, minY: minY, maxY: maxY };
  }
  function intersects(a, b) {
    return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
  }
  function getMapViewBounds() {
    try {
      if (typeof map === 'undefined' || !map || typeof map.getBounds !== 'function') return null;
      var b = map.getBounds();
      if (!b) return null;
      var w = b.getWest(), e = b.getEast(), s = b.getSouth(), n = b.getNorth();
      if (![w, e, s, n].every(function (v) { return isFinite(v); })) return null;
      var out = { minX: w, maxX: e, minY: mercY(s), maxY: mercY(n) };
      return validBounds(out) ? out : null;
    } catch (e) { return null; }
  }
  function fit(b, rect, cover) {
    var spanX = b.maxX - b.minX, spanY = b.maxY - b.minY;
    if (!isFinite(spanX) || !isFinite(spanY) || spanX <= 0 || spanY <= 0) return null;
    var s = cover ? Math.max(rect.w / spanX, rect.h / spanY) : Math.min(rect.w / spanX, rect.h / spanY);
    var mw = spanX * s, mh = spanY * s;
    var ox = rect.x + (rect.w - mw) / 2, oy = rect.y + (rect.h - mh) / 2;
    return {
      s: s, ox: ox, oy: oy, minX: b.minX, maxY: b.maxY,
      tx: function (lon) { return ox + (lon - b.minX) * s; },
      ty: function (m) { return oy + (b.maxY - m) * s; }
    };
  }
  function landTransform(p) {
    var A = p.s / 10000, C = -(DEG * p.s) / 10000, B = p.ox - p.minX * p.s, D = p.oy + p.maxY * p.s;
    return 'matrix(' + A.toFixed(8) + ' 0 0 ' + C.toFixed(8) + ' ' + B.toFixed(3) + ' ' + D.toFixed(3) + ')';
  }

  function markerEmoji(props) {
    var id = props._manaMarkerType || props.markerType;
    if (!id) return '';
    try {
      if (typeof _mkFind === 'function') { var d = _mkFind(id); if (d && d.e) return d.e; }
      if (typeof MK !== 'undefined' && Array.isArray(MK)) {
        for (var i = 0; i < MK.length; i++) if (MK[i].id === id) return MK[i].e || '';
      }
    } catch (e) {}
    return '';
  }

  function renderMap(geo, rect, opts) {
    opts = opts || {};
    var b = validBounds(opts.viewBounds) ? opts.viewBounds : bounds(geo);
    var clipId = 'pdfx-clip-' + (opts.id || 'map');
    var out = '<defs><clipPath id="' + clipId + '"><rect x="' + rect.x + '" y="' + rect.y + '" width="' + rect.w + '" height="' + rect.h + '" rx="' + (opts.radius || 0) + '"/></clipPath></defs>';
    out += '<g clip-path="url(#' + clipId + ')">';
    out += '<rect x="' + rect.x + '" y="' + rect.y + '" width="' + rect.w + '" height="' + rect.h + '" fill="' + MAPBG + '"/>';
    if (!b) {
      out += '<text x="' + (rect.x + rect.w / 2) + '" y="' + (rect.y + rect.h / 2) + '" text-anchor="middle" font-family="' + FONT + '" font-size="14" fill="' + FAINT + '">' + esc(tr('Sin vista previa', 'No preview')) + '</text>';
      out += '</g>';
      return out;
    }
    var p = fit(b, rect, !!opts.cover);
    if (!p) { out += '</g>'; return out; }
    var world = (b.maxX - b.minX) > 300;

    if (opts.graticule !== false) {
      var grat = '';
      for (var lon = -180; lon <= 180; lon += 30) {
        var gx = p.tx(lon);
        if (gx >= rect.x && gx <= rect.x + rect.w) grat += '<line x1="' + gx.toFixed(1) + '" y1="' + rect.y + '" x2="' + gx.toFixed(1) + '" y2="' + (rect.y + rect.h) + '"/>';
      }
      for (var lat = -60; lat <= 80; lat += 30) {
        var gy = p.ty(mercY(lat));
        if (gy >= rect.y && gy <= rect.y + rect.h) grat += '<line x1="' + rect.x + '" y1="' + gy.toFixed(1) + '" x2="' + (rect.x + rect.w) + '" y2="' + gy.toFixed(1) + '"/>';
      }
      out += '<g stroke="rgba(17,18,20,0.045)" stroke-width="1">' + grat + '</g>';
    }

    if (world && window.WORLD_LAND_PATH) {
      out += '<path d="' + window.WORLD_LAND_PATH + '" fill="#efe9df" transform="' + landTransform(p) + '"/>';
    }

    var polys = '', lines = '', points = '';
    (geo.features || []).forEach(function (f) {
      var pr = f.properties || {};
      if (pr._manaGroupHidden) return;
      var g = f.geometry; if (!g) return;
      var col = featureColor(f);
      if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
        var d = '';
        forEachRing(g, function (r) {
          var ring = '';
          for (var i = 0; i < r.length; i++) {
            ring += (ring ? 'L' : 'M') + p.tx(r[i][0]).toFixed(1) + ' ' + p.ty(mercY(r[i][1])).toFixed(1);
          }
          if (ring) d += ring + 'Z';
        });
        if (d) polys += '<path d="' + d + '" fill="' + col + '" fill-opacity="' + featureOpacity(f).toFixed(2) + '" fill-rule="evenodd" stroke="#ffffff" stroke-width="0.8" stroke-linejoin="round"/>';
      } else if (g.type === 'LineString' || g.type === 'MultiLineString') {
        forEachRing(g, function (l) {
          var dd = '';
          for (var i = 0; i < l.length; i++) dd += (dd ? 'L' : 'M') + p.tx(l[i][0]).toFixed(1) + ' ' + p.ty(mercY(l[i][1])).toFixed(1);
          if (dd) {
            lines += '<path d="' + dd + '" fill="none" stroke="#ffffff" stroke-opacity="0.85" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>';
            lines += '<path d="' + dd + '" fill="none" stroke="' + col + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
          }
        });
      } else if (g.type === 'Point' || g.type === 'MultiPoint') {
        var pts = g.type === 'Point' ? [g.coordinates] : g.coordinates;
        pts.forEach(function (c) {
          if (typeof c[0] !== 'number') return;
          var x = p.tx(c[0]), y = p.ty(mercY(c[1]));
          var emoji = markerEmoji(pr);
          if (emoji) {
            var sz = Number(pr._manaEmojiSize) || 22;
            sz = Math.max(12, Math.min(34, sz * 0.42));
            points += '<text x="' + x.toFixed(1) + '" y="' + (y + sz * 0.35).toFixed(1) + '" text-anchor="middle" font-size="' + sz.toFixed(1) + '" font-family="Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji,' + FONT + '">' + emoji + '</text>';
          } else {
            points += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="4.6" fill="#fff" fill-opacity="0.92" stroke="' + col + '" stroke-width="1.6"/>';
            points += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="2.1" fill="' + col + '"/>';
          }
        });
      }
    });
    out += '<g>' + polys + lines + points + '</g>';
    if (opts.labels) out += renderLabels(geo, p, rect, opts);
    out += '</g>';
    if (opts.border) out += '<rect x="' + rect.x + '" y="' + rect.y + '" width="' + rect.w + '" height="' + rect.h + '" rx="' + (opts.radius || 0) + '" fill="none" stroke="' + LINE + '"/>';
    return out;
  }

  // ── Etiquetas sobre el mapa ──
  function ringArea2(r) {
    var a = 0;
    for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
      a += (r[j][0] * r[i][1] - r[i][0] * r[j][1]);
    }
    return Math.abs(a / 2);
  }
  function labelAnchor(g, p) {
    if (!g) return null;
    var t = g.type, c = g.coordinates;
    if (t === 'Point' && c) return { x: p.tx(c[0]), y: p.ty(mercY(c[1])), kind: 'point' };
    if (t === 'MultiPoint' && c && c.length) {
      var mx = 0, my = 0, mn = 0;
      c.forEach(function (pt) { if (typeof pt[0] === 'number') { mx += p.tx(pt[0]); my += p.ty(mercY(pt[1])); mn++; } });
      return mn ? { x: mx / mn, y: my / mn, kind: 'point' } : null;
    }
    if (t === 'LineString' || t === 'MultiLineString') {
      var lines = t === 'LineString' ? [c] : c;
      var best = null;
      lines.forEach(function (l) { if (!best || l.length > best.length) best = l; });
      if (!best || !best.length) return null;
      var mid = best[Math.floor(best.length / 2)];
      return { x: p.tx(mid[0]), y: p.ty(mercY(mid[1])), kind: 'line', area: best.length };
    }
    if (t === 'Polygon' || t === 'MultiPolygon') {
      var rings = [];
      if (t === 'Polygon') rings = c;
      else c.forEach(function (poly) { poly.forEach(function (r) { rings.push(r); }); });
      var ring = null, ringArea = -1;
      rings.forEach(function (r) { var a = ringArea2(r); if (a > ringArea) { ringArea = a; ring = r; } });
      if (!ring || !ring.length) return null;
      var sx = 0, sy = 0, n = 0;
      for (var i = 0; i < ring.length; i++) {
        var pt = ring[i];
        if (typeof pt[0] !== 'number') continue;
        sx += p.tx(pt[0]); sy += p.ty(mercY(pt[1])); n++;
      }
      return n ? { x: sx / n, y: sy / n, kind: 'area', area: ringArea } : null;
    }
    return null;
  }
  function renderLabels(geo, p, rect, opts) {
    var cands = [];
    (geo.features || []).forEach(function (f, idx) {
      var pr = f.properties || {};
      if (pr._manaGroupHidden) return;
      var g = f.geometry;
      var name = pr._manaName || pr.name;
      if (!name) return;
      var anchor = labelAnchor(g, p);
      if (!anchor) return;
      var st = pr._manaLabelStyle || {};
      cands.push({
        name: String(name), anchor: anchor, style: st, order: idx,
        priority: (st.enabled ? 1000000 : 0) + (anchor.area || 0)
      });
    });
    cands.sort(function (a, b) {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.order - b.order;
    });
    var placed = [], out = '', max = opts.maxLabels || 80, count = 0;
    var scale = Number(opts.labelScale) || 1;
    cands.forEach(function (c) {
      if (count >= max) return;
      var st = c.style;
      var size = Math.max(6.5, Math.min(14, (Number(st.fontSize) || 11) * 0.68 * scale));
      var weight = st.fontWeight || '600';
      var color = st.color || '#1e293b';
      var halo = st.haloColor || '#ffffff';
      var haloW = Math.max(2, Math.min(4, (Number(st.haloWidth) || 3) * 0.8));
      var w = c.name.length * size * 0.6;
      var h = size * 1.18;
      var x = c.anchor.x, y = c.anchor.y, anchorAttr = 'middle';
      var x0, y0;
      if (c.anchor.kind === 'point') {
        anchorAttr = 'start';
        x += 10;
        x0 = x;
        y0 = y - h / 2;
        y += size * 0.34;
      } else {
        x0 = x - w / 2;
        y0 = y - h / 2;
        y += size * 0.34;
      }
      if (x0 < rect.x + 4 || x0 + w > rect.x + rect.w - 4 || y0 < rect.y + 2 || y0 + h > rect.y + rect.h - 2) return;
      for (var i = 0; i < placed.length; i++) {
        var q = placed[i];
        if (x0 < q.x0 + q.w + 4 && x0 + w + 4 > q.x0 && y0 < q.y0 + q.h + 3 && y0 + h + 3 > q.y0) return;
      }
      placed.push({ x0: x0, y0: y0, w: w, h: h });
      count++;
      out += '<text x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" text-anchor="' + anchorAttr +
        '" font-family="' + FONT + '" font-size="' + size.toFixed(1) + '" font-weight="' + esc(weight) +
        '" fill="' + esc(color) + '" stroke="' + esc(halo) + '" stroke-width="' + haloW.toFixed(1) +
        '" paint-order="stroke" stroke-linejoin="round">' + esc(c.name) + '</text>';
    });
    return out;
  }

  // ── Datos: lectura, leyenda, tabla, KPIs ──
  function parseNum(raw) {
    if (typeof raw === 'number') return isFinite(raw) ? raw : NaN;
    if (typeof window._manaParsePropNumber === 'function') {
      try { var n = window._manaParsePropNumber(raw); if (isFinite(n)) return n; } catch (e) {}
    }
    var s = String(raw == null ? '' : raw).replace(/[^\d.,\-]/g, '');
    if (!s || s === '-' || s === '.' || s === ',') return NaN;
    if (s.indexOf(',') !== -1) return parseFloat(s.replace(/\./g, '').replace(',', '.'));
    if (/^\d{1,3}(\.\d{3})+$/.test(s) && !/\.\d{1,2}$/.test(s)) return parseFloat(s.replace(/\./g, ''));
    return parseFloat(s);
  }
  function isNumericProp(v) {
    if (typeof v === 'number') return isFinite(v);
    if (typeof v !== 'string') return false;
    var s = v.trim();
    if (!s || s.length >= 40 || s.charAt(0) === '#') return false;
    if (!/\d/.test(s)) return false;
    return /^[-+]?[\d.,\s%$€£m²³]+$/i.test(s);
  }
  function detectValueKey(geo, feats) {
    var skip = /^(_|name$|nombre$|description$|descripci|fuente$|source$|pa[ií]s|country|continente|continent|tipo$|type$|c[oó]digo|code$|iso|id$|color|colour|hex|marker|opacity|width|weight|font|size|a[nñ]o de datos|year$|fecha$|date$)/i;
    var counts = {};
    feats.forEach(function (f) {
      var p = f.properties || {};
      Object.keys(p).forEach(function (k) {
        if (skip.test(k)) return;
        if (isNumericProp(p[k])) counts[k] = (counts[k] || 0) + 1;
      });
    });
    var best = null, bestN = 0;
    Object.keys(counts).forEach(function (k) {
      if (counts[k] > bestN) { best = k; bestN = counts[k]; }
    });
    return (bestN >= Math.max(3, feats.length * 0.4)) ? best : null;
  }
  function inferFormat(key) {
    var k = String(key || '').toLowerCase();
    if (/usd|d[oó]lar|pib|gdp|renta|salario|ingreso|precio|coste|valor/.test(k)) return 'usd';
    if (/altitud|altura|elevaci|profundidad|distancia|km/.test(k)) return 'meters';
    if (/%|porcentaje|percent|tasa|ratio|[ií]ndice|idh/.test(k)) return 'percent';
    if (/a[nñ]o|year|anyo/.test(k)) return 'year';
    return 'number';
  }
  function prettyGroup(f) {
    var p = f.properties || {};
    return p._manaGroupName || p.group || '';
  }

  function buildLegend(geo, feats) {
    var li = window.MANA_LOADED_LEGEND;
    if (li && (li.format === 'category' || li.format === 'text') && li.legend && Array.isArray(li.legend.steps) && li.legend.steps.length) {
      return {
        kind: 'cat',
        title: li.legend.title || li.title || li.key || tr('Leyenda', 'Legend'),
        steps: li.legend.steps.map(function (s) {
          return { label: (s && (s.label || s.v)) || '', color: (s && (s.c || s.color)) || ACC };
        }).filter(function (s) { return !!s.label; })
      };
    }
    var key = (li && li.key) || detectValueKey(geo, feats);
    if (key) {
      var colors = {}, min = Infinity, max = -Infinity, has = 0;
      feats.forEach(function (f) {
        var v = parseNum((f.properties || {})[key]);
        if (!isFinite(v) || v === 0) return;
        var c = featureColor(f);
        if (!c) return;
        if (!colors[c]) colors[c] = { sum: 0, n: 0 };
        colors[c].sum += v; colors[c].n++;
        if (v < min) min = v;
        if (v > max) max = v;
        has++;
      });
      var steps = Object.keys(colors).map(function (c) {
        return { color: c, value: colors[c].sum / colors[c].n };
      }).sort(function (a, b) { return a.value - b.value; });
      if (steps.length >= 2 && has >= 3) {
        return {
          kind: 'ramp',
          key: key,
          title: (li && li.title) || niceKey(key),
          format: (li && li.format) || inferFormat(key),
          steps: steps,
          min: min,
          max: max
        };
      }
    }
    // Categórica: agrupa por capa/grupo y, si no hay, por color.
    var groups = {};
    feats.forEach(function (f) {
      var name = prettyGroup(f) || featureColor(f);
      if (!name) return;
      if (!groups[name]) groups[name] = { label: name, color: featureColor(f), n: 0 };
      groups[name].n++;
    });
    var gsteps = Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 8);
    if (gsteps.length) return { kind: 'cat', title: tr('Elementos del mapa', 'Map items'), steps: gsteps };
    return { kind: 'none', title: '', steps: [] };
  }

  function buildRows(geo, legend, feats) {
    var rows = [];
    if (legend.kind === 'ramp') {
      feats.forEach(function (f) {
        var p = f.properties || {};
        var v = parseNum(p[legend.key]);
        if (!isFinite(v)) return;
        rows.push({ name: p._manaName || p.name || tr('Elemento', 'Item'), value: v, color: featureColor(f) });
      });
      rows.sort(function (a, b) { return b.value - a.value; });
      return rows.slice(0, 6).map(function (r) {
        return { name: r.name, color: r.color, value: formatVal(r.value, legend.format) };
      });
    }
    var groups = {};
    feats.forEach(function (f) {
      var name = prettyGroup(f) || tr('Elementos', 'Items');
      if (!groups[name]) groups[name] = { name: name, color: featureColor(f), n: 0 };
      groups[name].n++;
    });
    return Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (a, b) { return b.n - a.n; })
      .slice(0, 6).map(function (g) { return { name: g.name, color: g.color, value: num(g.n, 0) }; });
  }

  function buildStats(geo, legend, feats) {
    var points = 0, lines = 0, polygons = 0, groups = {};
    feats.forEach(function (f) {
      var g = f.geometry;
      if (g && (g.type === 'Point' || g.type === 'MultiPoint')) points++;
      else if (g && (g.type === 'LineString' || g.type === 'MultiLineString')) lines++;
      else if (g && (g.type === 'Polygon' || g.type === 'MultiPolygon')) polygons++;
      var gn = prettyGroup(f);
      if (gn) groups[gn] = true;
    });
    var st = {
      count: feats.length,
      groups: Object.keys(groups).length,
      points: points, lines: lines, polygons: polygons,
      numeric: false
    };
    if (legend.kind === 'ramp') {
      var vals = [];
      feats.forEach(function (f) {
        var v = parseNum((f.properties || {})[legend.key]);
        if (isFinite(v) && v !== 0) vals.push({ v: v, name: (f.properties || {})._manaName || (f.properties || {}).name || '' });
      });
      if (vals.length) {
        vals.sort(function (a, b) { return b.v - a.v; });
        st.numeric = true;
        st.max = vals[0].v; st.maxName = vals[0].name;
        st.min = vals[vals.length - 1].v; st.minName = vals[vals.length - 1].name;
        var sum = 0;
        vals.forEach(function (o) { sum += o.v; });
        st.avg = sum / vals.length;
      }
    }
    return st;
  }

  function extractSource(feats) {
    var found = {};
    feats.forEach(function (f) {
      var p = f.properties || {};
      Object.keys(p).forEach(function (k) {
        if (!/^(fuente|source|datasource|data_source|data source)$/i.test(k)) return;
        var v = p[k];
        if (typeof v === 'string' && v.trim()) found[v.trim()] = true;
      });
    });
    var list = Object.keys(found);
    return list.slice(0, 2).join(' · ').slice(0, 180);
  }
  function extractDate(feats) {
    for (var i = 0; i < feats.length; i++) {
      var p = feats[i].properties || {};
      var keys = Object.keys(p);
      for (var j = 0; j < keys.length; j++) {
        if (!/^(a[nñ]o de datos|year|anyo|data date|datadate|fecha)$/i.test(keys[j])) continue;
        var v = p[keys[j]];
        if ((typeof v === 'string' && v.trim()) || typeof v === 'number') return String(v).trim();
      }
    }
    return String(new Date().getFullYear());
  }

  function buildContext(viewBounds) {
    var geo = (typeof getEnrichedGeoJSON === 'function') ? getEnrichedGeoJSON() : null;
    if (!geo || !Array.isArray(geo.features)) geo = { type: 'FeatureCollection', features: [] };
    var allFeats = geo.features.filter(function (f) { return f && !((f.properties || {})._manaGroupHidden); });
    var feats = allFeats;
    if (validBounds(viewBounds)) {
      feats = allFeats.filter(function (f) {
        var fb = featureBounds(f);
        return fb && intersects(fb, viewBounds);
      });
    }
    var contentForMeta = feats.length ? feats : allFeats;
    var legend = buildLegend(geo, feats);
    var title = (typeof getProjectName === 'function') ? getProjectName() : tr('Mapa sin título', 'Untitled map');
    if (!title || !String(title).trim()) title = tr('Mapa sin título', 'Untitled map');
    var stats = buildStats(geo, legend, feats);
    var rows = buildRows(geo, legend, feats);
    var source = extractSource(contentForMeta);
    var date = extractDate(contentForMeta);
    var subtitle = legend.kind === 'ramp'
      ? legend.title + ' · ' + stats.count + ' ' + tr('elementos', 'items')
      : stats.count + ' ' + tr('elementos', 'items') + ' · ' + date;
    var visibleGeo = { type: 'FeatureCollection', features: allFeats };
    var b = validBounds(viewBounds) ? viewBounds : bounds(visibleGeo);
    var world = !!(b && (b.maxX - b.minX) > 300);
    var labelsEnabled = feats.some(function (f) {
      var st = (f.properties || {})._manaLabelStyle;
      return !!(st && st.enabled);
    });
    return {
      geo: visibleGeo, feats: feats, allFeats: allFeats, title: title, subtitle: subtitle,
      legend: legend, stats: stats, rows: rows,
      source: source, date: date, world: world, labelsEnabled: labelsEnabled,
      viewBounds: validBounds(viewBounds) ? viewBounds : null
    };
  }

  // ── Primitivas SVG ──
  function svgPage(w, h, body, bg) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
      '<rect width="' + w + '" height="' + h + '" fill="' + (bg || PAPER) + '"/>' + body + '</svg>';
  }
  function txt(x, y, s, size, weight, fill, anchor, extra, family) {
    return '<text x="' + x + '" y="' + y + '" font-family="' + (family || FONT) + '" font-size="' + size +
      '" font-weight="' + (weight || 400) + '" fill="' + (fill || INK) + '"' +
      (anchor ? ' text-anchor="' + anchor + '"' : '') + (extra || '') + '>' + esc(s) + '</text>';
  }
  function brand(x, y, height, opts) {
    opts = opts || {};
    var scale = height / 40;
    return '<g transform="translate(' + x + ' ' + y + ') scale(' + scale.toFixed(5) + ')">' +
      '<g transform="translate(2 2) scale(0.18)">' +
        '<path fill="#30363B" stroke="rgba(1,1,1,0.5)" stroke-width="1" transform="translate(100 100)" d="' + ICON + '"/>' +
      '</g>' +
      '<g transform="translate(13.302 24.5) scale(0.00732422 -0.00732422)">' +
        '<path fill="#fff" d="' + MG1 + '"/>' +
        '<path fill="#fff" transform="translate(1530 -40)" d="' + MG2 + '"/>' +
      '</g>' +
      '<text x="48" y="26" font-family="Tahoma,Verdana,sans-serif" font-weight="800" font-size="18" fill="' +
        (opts.text || '#111214') + '" letter-spacing="-0.36">Maña<tspan font-size="11" font-weight="600" fill="' +
        (opts.subtext || '#5f6670') + '" dx="3" dy="-7.4">Maps</tspan></text>' +
      '</g>';
  }
  function drawLegend(x, y, w, legend, opts) {
    opts = opts || {};
    var s = '', cy = y;
    if (!legend || legend.kind === 'none') return { svg: '', height: 0 };
    s += txt(x, cy + 9, String(legend.title || '').toUpperCase(), 9.5, 700, '#6b7280', null, ' letter-spacing="1.2"');
    cy += 21;
    if (legend.kind === 'ramp') {
      var gid = 'pdfx-grad-' + (opts.id || 'x');
      s += '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="1" y2="0">';
      legend.steps.forEach(function (st, i) {
        var off = legend.steps.length > 1 ? (i / (legend.steps.length - 1)) : 0;
        s += '<stop offset="' + off.toFixed(3) + '" stop-color="' + st.color + '"/>';
      });
      s += '</linearGradient></defs>';
      s += '<rect x="' + x + '" y="' + cy + '" width="' + w + '" height="8" rx="2" fill="url(#' + gid + ')"/>';
      cy += 15;
      s += txt(x, cy + 8, formatVal(legend.min, legend.format), 8.5, 600, FAINT, null, null, MONO);
      s += txt(x + w, cy + 8, formatVal(legend.max, legend.format), 8.5, 600, FAINT, 'end', null, MONO);
      cy += 18;
    } else {
      legend.steps.slice(0, opts.max || 6).forEach(function (st) {
        s += '<rect x="' + x + '" y="' + (cy - 8) + '" width="9" height="9" rx="2" fill="' + st.color + '"/>';
        s += txt(x + 15, cy, truncate(st.label, opts.maxChars || 28), 9.5, 600, MUTED);
        cy += 16;
      });
      if (legend.steps.length > (opts.max || 6)) {
        s += txt(x + 15, cy, '+' + (legend.steps.length - (opts.max || 6)) + ' ' + tr('más', 'more'), 9, 600, FAINT);
        cy += 14;
      }
    }
    return { svg: s, height: cy - y };
  }
  function drawLegendSwatches(x, y, w, legend, cols) {
    if (!legend || legend.kind === 'none') return { svg: '', height: 0 };
    var s = '', cy = y;
    s += txt(x, cy + 9, String(legend.title || '').toUpperCase(), 10, 700, '#6b7280', null, ' letter-spacing="1.2"');
    cy += 24;
    if (legend.kind === 'ramp') {
      var gid = 'pdfx-sw-' + Math.random().toString(36).slice(2, 8);
      s += '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="1" y2="0">';
      legend.steps.forEach(function (st, i) {
        s += '<stop offset="' + (i / Math.max(1, legend.steps.length - 1)).toFixed(3) + '" stop-color="' + st.color + '"/>';
      });
      s += '</linearGradient></defs>';
      s += '<rect x="' + x + '" y="' + cy + '" width="' + w + '" height="10" rx="2" fill="url(#' + gid + ')"/>';
      cy += 22;
      s += txt(x, cy + 8, formatVal(legend.min, legend.format), 9, 600, FAINT, null, null, MONO);
      s += txt(x + w, cy + 8, formatVal(legend.max, legend.format), 9, 600, FAINT, 'end', null, MONO);
      cy += 18;
      return { svg: s, height: cy - y };
    }
    var cw = w / (cols || 3);
    legend.steps.slice(0, cols * 2).forEach(function (st, i) {
      var cx = x + (i % cols) * cw;
      var yy = cy + Math.floor(i / cols) * 18;
      s += '<rect x="' + cx + '" y="' + (yy - 8) + '" width="9" height="9" rx="2" fill="' + st.color + '"/>';
      s += txt(cx + 15, yy, truncate(st.label, 18), 9.5, 600, MUTED);
    });
    cy += Math.ceil(Math.min(legend.steps.length, cols * 2) / cols) * 18;
    return { svg: s, height: cy - y };
  }
  function drawTable(x, y, w, rows, opts) {
    opts = opts || {};
    if (!rows || !rows.length) return { svg: '', height: 0 };
    var s = '', rowH = opts.rowH || 21, fs = opts.fs || 10.5;
    s += txt(x, y, (opts.nameLabel || tr('Elemento', 'Item')).toUpperCase(), 8.5, 700, FAINT, null, ' letter-spacing="0.8"');
    s += txt(x + w, y, (opts.valueLabel || tr('Valor', 'Value')).toUpperCase(), 8.5, 700, FAINT, 'end', ' letter-spacing="0.8"');
    var cy = y + 10;
    rows.forEach(function (r) {
      cy += rowH;
      s += '<line x1="' + x + '" y1="' + (cy - rowH + 7) + '" x2="' + (x + w) + '" y2="' + (cy - rowH + 7) + '" stroke="' + LINE + '" stroke-width="0.7"/>';
      if (r.color) s += '<circle cx="' + (x + 4) + '" cy="' + (cy - 3) + '" r="3.1" fill="' + r.color + '"/>';
      s += txt(x + (r.color ? 13 : 0), cy - 1, truncate(r.name, opts.maxChars || 26), fs, 600, '#26282d');
      s += txt(x + w, cy - 1, r.value, fs, 600, '#26282d', 'end', null, MONO);
    });
    return { svg: s, height: cy - y };
  }
  function drawKpis(x, y, w, items) {
    if (!items || !items.length) return '';
    var s = '', cw = w / items.length;
    s += '<line x1="' + x + '" y1="' + y + '" x2="' + (x + w) + '" y2="' + y + '" stroke="' + INK + '" stroke-width="1.2"/>';
    s += '<line x1="' + x + '" y1="' + (y + 78) + '" x2="' + (x + w) + '" y2="' + (y + 78) + '" stroke="' + LINE + '" stroke-width="1"/>';
    items.forEach(function (it, i) {
      var cx = x + i * cw;
      if (i) s += '<line x1="' + cx + '" y1="' + y + '" x2="' + cx + '" y2="' + (y + 78) + '" stroke="' + LINE + '" stroke-width="1"/>';
      s += txt(cx + 12, y + 20, String(it.k || '').toUpperCase(), 8, 700, FAINT, null, ' letter-spacing="0.9"');
      s += txt(cx + 12, y + 50, it.v, 22, 800, INK, null, ' letter-spacing="-0.8"');
      s += txt(cx + 12, y + 67, truncate(it.d || '', 22), 8.5, 600, MUTED);
    });
    return s;
  }

  function kpiItems(ctx) {
    var st = ctx.stats;
    if (st.numeric) {
      return [
        { k: tr('Elementos', 'Items'), v: num(st.count, 0), d: st.groups ? st.groups + ' ' + tr('capas', 'layers') : '' },
        { k: tr('Máximo', 'Max'), v: formatVal(st.max, ctx.legend.format), d: truncate(st.maxName, 20) },
        { k: tr('Media', 'Average'), v: formatVal(st.avg, ctx.legend.format), d: ctx.date },
        { k: tr('Mínimo', 'Min'), v: formatVal(st.min, ctx.legend.format), d: truncate(st.minName, 20) }
      ];
    }
    return [
      { k: tr('Elementos', 'Items'), v: num(st.count, 0), d: st.groups ? st.groups + ' ' + tr('capas', 'layers') : '' },
      { k: tr('Puntos', 'Points'), v: num(st.points, 0), d: tr('marcadores', 'markers') },
      { k: tr('Líneas', 'Lines'), v: num(st.lines, 0), d: tr('trazados', 'paths') },
      { k: tr('Polígonos', 'Polygons'), v: num(st.polygons, 0), d: tr('áreas', 'areas') }
    ];
  }

  function footer(ctx, W, H, P, pageLabel) {
    var s = txt(P, H - 34, truncate(ctx.source || 'maña.com', 78), 8.5, 500, FAINT);
    s += txt(W - P, H - 34, pageLabel || '01', 8.5, 500, FAINT, 'end', null, MONO);
    return s;
  }
  function cardFrame(x, y, w, h, radius) {
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + (radius || 14) + '" fill="#ffffff" fill-opacity="0.95" stroke="' + LINE + '"/>';
  }

  // ── Plantillas ──
  function tplDossier(ctx, o) {
    var W = 794, H = 1123, P = 44, s = '';
    s += brand(P, P, 38);
    s += txt(W - P, P + 20, ctx.date, 9.5, 600, FAINT, 'end');
    s += txt(P, 126, (ctx.legend.kind === 'ramp' ? tr('Atlas de datos', 'Data atlas') : tr('Mapa', 'Map')).toUpperCase(), 11, 700, '#a37b32', null, ' letter-spacing="2"');
    var titleLines = wrapLines(ctx.title, W - 2 * P, 42, 2);
    var ty = 174;
    titleLines.forEach(function (ln, i) { s += txt(P, ty + i * 46, ln, 42, 800, INK, null, ' letter-spacing="-1.3"'); });
    var titleBottom = ty + (titleLines.length - 1) * 46;
    var subLines = wrapLines(ctx.subtitle, W - 2 * P, 14, 2);
    var subY = titleBottom + 27;
    subLines.forEach(function (ln, i) { s += txt(P, subY + i * 19, ln, 14, 500, MUTED); });
    var mapY = subY + subLines.length * 19 + 18;
    var footerY = H - 34;
    var lowerH = o.includeTable ? 158 : 74;
    var mapH = Math.max(260, footerY - 24 - lowerH - 22 - mapY);
    s += renderMap(ctx.geo, { x: P, y: mapY, w: W - 2 * P, h: mapH }, { id: 'dossier', border: true, radius: 10, labels: !!o.includeLabels, viewBounds: o.viewBounds });
    var lowerY = mapY + mapH + 24;
    var available = W - 2 * P;
    var legendW = o.includeTable ? available * 0.42 : available;
    if (o.includeLegend) s += drawLegend(P, lowerY, legendW, ctx.legend, { id: 'dossier', max: 5 }).svg;
    if (o.includeTable) {
      var tx = o.includeLegend ? P + legendW + 34 : P;
      var tw = W - P - tx;
      s += drawTable(tx, lowerY - 4, tw, ctx.rows, { nameLabel: tr('Lugar', 'Place'), valueLabel: tr('Valor', 'Value'), maxChars: 22 }).svg;
    }
    s += footer(ctx, W, H, P, '01');
    return svgPage(W, H, s);
  }

  function tplAtlas(ctx, o) {
    var W = 1123, H = 794, s = '';
    s += renderMap(ctx.geo, { x: 0, y: 0, w: W, h: H }, { id: 'atlas', cover: !o.viewBounds, labels: !!o.includeLabels, maxLabels: 60, labelScale: 1.08, viewBounds: o.viewBounds });
    s += '<defs><linearGradient id="pdfx-atlas-veil" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#ffffff" stop-opacity="0.94"/>' +
      '<stop offset="0.20" stop-color="#ffffff" stop-opacity="0.55"/>' +
      '<stop offset="0.36" stop-color="#ffffff" stop-opacity="0"/>' +
      '<stop offset="0.72" stop-color="#ffffff" stop-opacity="0"/>' +
      '<stop offset="1" stop-color="#ffffff" stop-opacity="0.88"/>' +
      '</linearGradient></defs>';
    s += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="url(#pdfx-atlas-veil)"/>';
    s += brand(60, 48, 38);
    s += txt(W - 60, 66, ctx.date, 9.5, 600, FAINT, 'end');
    var kicker = ctx.legend.kind === 'ramp' ? ctx.legend.title : tr('Mapa', 'Map');
    var titleLines = wrapLines(ctx.title, W * 0.56, 54, 2);
    var ty = 196;
    var titleBottom = ty + (titleLines.length - 1) * 58;
    var subLines = wrapLines(ctx.subtitle, W * 0.50, 14, 2);
    var subTop = titleBottom + 30;
    var panelBottom = subTop + (subLines.length - 1) * 19 + 28;
    s += '<rect x="40" y="110" width="' + Math.round(W * 0.56 + 40) + '" height="' + Math.round(panelBottom - 110) + '" rx="18" fill="#ffffff" fill-opacity="0.84" stroke="#ffffff" stroke-opacity="0.6"/>';
    s += txt(60, 150, kicker.toUpperCase(), 11, 700, '#a37b32', null, ' letter-spacing="2"');
    titleLines.forEach(function (ln, i) { s += txt(60, ty + i * 58, ln, 54, 800, INK, null, ' letter-spacing="-1.8"'); });
    subLines.forEach(function (ln, i) { s += txt(60, subTop + i * 19, ln, 14, 500, '#4a5058'); });

    var cardW = 268, cardX = W - 60 - cardW, cardY = 206;
    var lg = drawLegend(cardX + 22, cardY + 24, cardW - 44, ctx.legend, { id: 'atlas', max: 4 });
    var cardH = Math.max(158, lg.height + 116);
    s += cardFrame(cardX, cardY, cardW, cardH);
    s += lg.svg;
    var sy = cardY + 24 + lg.height + 18;
    s += '<line x1="' + (cardX + 22) + '" y1="' + sy + '" x2="' + (cardX + cardW - 22) + '" y2="' + sy + '" stroke="' + LINE + '"/>';
    if (ctx.stats.numeric) {
      s += txt(cardX + 22, sy + 19, num(ctx.stats.count, 0) + ' ' + tr('elementos', 'items'), 9.5, 700, INK);
      s += txt(cardX + 22, sy + 37, tr('Media', 'Average') + ': ' + formatVal(ctx.stats.avg, ctx.legend.format), 9, 600, MUTED);
      s += txt(cardX + 22, sy + 53, truncate(statsMaxLine(ctx), 34), 9, 600, MUTED);
    } else {
      s += txt(cardX + 22, sy + 19, num(ctx.stats.count, 0) + ' ' + tr('elementos', 'items'), 9.5, 700, INK);
      s += txt(cardX + 22, sy + 37, ctx.stats.groups + ' ' + tr('capas', 'layers'), 9, 600, MUTED);
    }

    var quote = ctx.stats.numeric
      ? tr(statsMaxLine(ctx) + '; la media es ' + formatVal(ctx.stats.avg, ctx.legend.format) + '.',
           statsMaxLine(ctx) + '; the average is ' + formatVal(ctx.stats.avg, ctx.legend.format) + '.')
      : tr('Un mapa de ' + ctx.stats.count + ' elementos repartidos en ' + (ctx.stats.groups || 1) + ' capas.',
           'A map of ' + ctx.stats.count + ' items across ' + (ctx.stats.groups || 1) + ' layers.');
    s += txt(60, H - 58, truncate(quote, 86), 12.5, 500, '#3f444b');
    s += txt(W - 60, H - 58, truncate(ctx.source || 'maña.com', 52), 8.5, 500, FAINT, 'end');
    return svgPage(W, H, s);
  }

  function statsMaxLine(ctx) {
    if (!ctx.stats.numeric) return '';
    return ctx.stats.maxName + ' ' + formatVal(ctx.stats.max, ctx.legend.format);
  }

  function tplFicha(ctx, o) {
    var W = 794, H = 1123, P = 44, s = '';
    s += brand(P, P, 38);
    s += txt(W - P, P + 20, ctx.date, 9.5, 600, FAINT, 'end');
    s += txt(P, 116, tr('Informe de una hoja', 'One-page report').toUpperCase(), 10.5, 700, '#a37b32', null, ' letter-spacing="1.8"');
    var titleLines = wrapLines(ctx.title, W - 2 * P, 34, 2);
    var ty = 158;
    titleLines.forEach(function (ln, i) { s += txt(P, ty + i * 38, ln, 34, 800, INK, null, ' letter-spacing="-1"'); });
    var titleBottom = ty + (titleLines.length - 1) * 38;
    var kpisY = titleBottom + 26;
    s += drawKpis(P, kpisY, W - 2 * P, kpiItems(ctx));
    var mapY = kpisY + 94;
    var mapH = 500;
    s += renderMap(ctx.geo, { x: P, y: mapY, w: W - 2 * P, h: mapH }, { id: 'ficha', border: true, radius: 10, labels: !!o.includeLabels, viewBounds: o.viewBounds });
    var lowerY = mapY + mapH + 24;
    var available = W - 2 * P;
    var colLegend = o.includeLegend ? available * 0.26 : 0;
    var colTable = o.includeTable ? available * 0.40 : 0;
    var gap = 24;
    var colNote = available - colLegend - colTable - (o.includeLegend ? gap : 0) - (o.includeTable ? gap : 0);
    var cx = P;
    if (o.includeLegend) {
      s += drawLegend(cx, lowerY, colLegend, ctx.legend, { id: 'ficha', max: 4 }).svg;
      cx += colLegend + gap;
    }
    if (o.includeTable) {
      s += drawTable(cx, lowerY - 4, colTable, ctx.rows, { nameLabel: tr('Top', 'Top'), valueLabel: tr('Valor', 'Value'), maxChars: 18, rowH: 20 }).svg;
      cx += colTable + gap;
    }
    if (colNote > 80) {
      s += '<rect x="' + cx + '" y="' + (lowerY - 4) + '" width="' + colNote + '" height="118" rx="10" fill="' + SOFT + '" stroke="#ebe4d7"/>';
      s += txt(cx + 14, lowerY + 18, tr('Metodología', 'Methodology').toUpperCase(), 8.5, 700, '#a37b32', null, ' letter-spacing="0.9"');
      var note = tr('Datos del mapa actual. La escala es secuencial y está ordenada por el valor.',
        'Current map data. The scale is sequential and sorted by value.');
      var nl = wrapLines(note, colNote - 28, 9.5, 5);
      nl.forEach(function (ln, i) { s += txt(cx + 14, lowerY + 38 + i * 15, ln, 9.5, 500, '#5b5145'); });
      var srcLines = wrapLines(ctx.source || 'maña.com', colNote - 28, 8, 3);
      srcLines.forEach(function (ln, i) { s += txt(cx + 14, lowerY + 78 + i * 13, ln, 8, 500, FAINT); });
    }
    s += footer(ctx, W, H, P, '01');
    return svgPage(W, H, s);
  }

  function tplCartel(ctx, o) {
    var W = 1000, H = 1400, s = '';
    var titleLines = wrapLines(ctx.title, W - 108, 92, 2);
    var ty = 170;
    var subLines = wrapLines(ctx.subtitle, W - 108, 16, 2);
    var sy = ty + (titleLines.length - 1) * 92 + 34;
    var bandH = Math.max(326, sy + subLines.length * 22 + 20);
    s += '<rect x="0" y="0" width="' + W + '" height="' + bandH + '" fill="' + ACC + '"/>';
    s += '<circle cx="870" cy="40" r="190" fill="#ffffff" fill-opacity="0.20"/>';
    s += brand(54, 34, 38);
    s += txt(W - 54, 58, tr('Cartel', 'Poster').toUpperCase(), 11, 700, '#5b431a', 'end', ' letter-spacing="2"');
    titleLines.forEach(function (ln, i) { s += txt(54, ty + i * 92, ln, 92, 800, INK, null, ' letter-spacing="-3.4"'); });
    subLines.forEach(function (ln, i) { s += txt(54, sy + i * 22, ln, 16, 500, '#4a3714'); });

    var mapY = bandH, mapH = 760;
    if (o.includeLegend) mapH -= 80;
    s += renderMap(ctx.geo, { x: 0, y: mapY, w: W, h: mapH }, { id: 'cartel', labels: !!o.includeLabels, maxLabels: 60, labelScale: 1.4, viewBounds: o.viewBounds });
    var by = mapY + mapH + 24;
    if (o.includeLegend) {
      var lg = drawLegendSwatches(54, by, W - 108, ctx.legend, 3);
      s += lg.svg;
      by += lg.height + 18;
    }
    if (o.includeTable) {
      s += drawTable(54, by + 8, W - 108, ctx.rows.slice(0, 5), { nameLabel: tr('Destacados', 'Highlights'), valueLabel: tr('Valor', 'Value'), maxChars: 34, rowH: 24, fs: 10.5 }).svg;
    }
    s += '<line x1="54" y1="' + (H - 66) + '" x2="' + (W - 54) + '" y2="' + (H - 66) + '" stroke="#e3dccd"/>';
    s += txt(54, H - 42, truncate(ctx.source || 'maña.com', 64), 10, 500, FAINT);
    s += txt(W - 54, H - 42, 'maña.com', 10, 600, FAINT, 'end');
    return svgPage(W, H, s, '#fbf7ee');
  }

  function tplMinimal(ctx, o) {
    var W = 794, H = 1123, P = 44, s = '';
    s += txt(P, 58, truncate(ctx.title, 58), 19, 700, INK, null, ' letter-spacing="-0.5"');
    s += txt(P, 76, truncate(ctx.subtitle, 66), 10, 500, MUTED);
    s += brand(W - P - 114, 36, 30);
    s += '<line x1="0" y1="100" x2="' + W + '" y2="100" stroke="' + LINE + '"/>';
    s += '<line x1="0" y1="100" x2="' + W + '" y2="100" stroke="' + ACC + '" stroke-width="2.4"/>';
    s += renderMap(ctx.geo, { x: 0, y: 262, w: W, h: 560 }, { id: 'minimal', labels: !!o.includeLabels, viewBounds: o.viewBounds });
    if (o.includeLegend) {
      var lg = ctx.legend;
      if (lg && lg.kind !== 'none') {
        var cardW = 268;
        var cardH = lg.kind === 'ramp' ? 90 : Math.min(150, 36 + lg.steps.length * 16);
        var cardY = H - 58 - cardH;
        s += cardFrame(P, cardY, cardW, cardH, 10);
        s += drawLegend(P + 16, cardY + 14, cardW - 32, lg, { id: 'minimal', max: 5 }).svg;
      }
    }
    s += txt(W - P, H - 52, truncate(ctx.source || 'maña.com', 64), 8.5, 500, FAINT, 'end');
    s += txt(W - P, H - 36, ctx.date + ' · maña.com', 8.5, 500, FAINT, 'end');
    return svgPage(W, H, s);
  }

  function buildSvg(ctx, tpl, opts) {
    opts = opts || {};
    if (tpl.id === 'dossier') return tplDossier(ctx, opts);
    if (tpl.id === 'atlas') return tplAtlas(ctx, opts);
    if (tpl.id === 'ficha') return tplFicha(ctx, opts);
    if (tpl.id === 'cartel') return tplCartel(ctx, opts);
    if (tpl.id === 'minimal') return tplMinimal(ctx, opts);
    return tplDossier(ctx, opts);
  }
  function templateById(id) {
    for (var i = 0; i < TEMPLATES.length; i++) if (TEMPLATES[i].id === id) return TEMPLATES[i];
    return TEMPLATES[0];
  }

  // ── Rasterizado y PDF ──
  function svgUrl(svg) {
    return URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  }
  function svgToJpeg(svg, pixelW, pixelH) {
    return new Promise(function (resolve, reject) {
      var url = svgUrl(svg);
      var img = new Image();
      function done() { URL.revokeObjectURL(url); }
      img.onload = function () {
        try {
          var c = document.createElement('canvas');
          c.width = pixelW; c.height = pixelH;
          var g = c.getContext('2d');
          g.fillStyle = '#ffffff'; g.fillRect(0, 0, pixelW, pixelH);
          g.drawImage(img, 0, 0, pixelW, pixelH);
          var out = c.toDataURL('image/jpeg', 0.92);
          done();
          resolve({ dataUrl: out, width: pixelW, height: pixelH });
        } catch (e) { done(); reject(e); }
      };
      img.onerror = function () { done(); reject(new Error('No se pudo rasterizar la plantilla')); };
      img.src = url;
    });
  }
  function dataUrlBytes(dataUrl) {
    var b64 = dataUrl.split(',')[1] || '';
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function buildPdf(pages) {
    var enc = new TextEncoder();
    var N = pages.length;
    var total = 2 + N * 3;
    var objects = new Array(total);
    var kids = [];
    for (var i = 0; i < N; i++) kids.push((3 + i * 3) + ' 0 R');
    objects[0] = enc.encode('<< /Type /Catalog /Pages 2 0 R >>');
    objects[1] = enc.encode('<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + N + ' >>');
    pages.forEach(function (pg, i) {
      var pageNum = 3 + i * 3;
      var imgNum = pageNum + 1;
      var contNum = pageNum + 2;
      var media = '[0 0 ' + pg.pw.toFixed(2) + ' ' + pg.ph.toFixed(2) + ']';
      objects[pageNum - 1] = enc.encode('<< /Type /Page /Parent 2 0 R /MediaBox ' + media +
        ' /Resources << /XObject << /Im0 ' + imgNum + ' 0 R >> >> /Contents ' + contNum + ' 0 R >>');

      var imgHead = enc.encode('<< /Type /XObject /Subtype /Image /Width ' + pg.width + ' /Height ' + pg.height +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + pg.bytes.length + ' >>\nstream\n');
      var imgTail = enc.encode('\nendstream');
      var imgBody = new Uint8Array(imgHead.length + pg.bytes.length + imgTail.length);
      imgBody.set(imgHead, 0); imgBody.set(pg.bytes, imgHead.length); imgBody.set(imgTail, imgHead.length + pg.bytes.length);
      objects[imgNum - 1] = imgBody;

      var content = 'q\n' + pg.pw.toFixed(2) + ' 0 0 ' + pg.ph.toFixed(2) + ' 0 0 cm\n/Im0 Do\nQ\n';
      var contBytes = enc.encode(content);
      var contHead = enc.encode('<< /Length ' + contBytes.length + ' >>\nstream\n');
      var contTail = enc.encode('\nendstream');
      var contBody = new Uint8Array(contHead.length + contBytes.length + contTail.length);
      contBody.set(contHead, 0); contBody.set(contBytes, contHead.length); contBody.set(contTail, contHead.length + contBytes.length);
      objects[contNum - 1] = contBody;
    });

    var parts = [], offsets = [], pos = 0;
    function push(part) {
      var bytes = (typeof part === 'string') ? enc.encode(part) : part;
      parts.push(bytes);
      pos += bytes.length;
    }
    push('%PDF-1.4\n');
    for (var k = 0; k < total; k++) {
      offsets[k] = pos;
      push((k + 1) + ' 0 obj\n');
      push(objects[k]);
      push('\nendobj\n');
    }
    var xrefStart = pos;
    var xref = 'xref\n0 ' + (total + 1) + '\n0000000000 65535 f \n';
    for (var m = 0; m < total; m++) xref += String(offsets[m]).padStart(10, '0') + ' 00000 n \n';
    push(xref);
    push('trailer\n<< /Size ' + (total + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefStart + '\n%%EOF');
    return new Blob(parts, { type: 'application/pdf' });
  }
  function downloadBlob(blob, filename) {
    if (window.ManaShareCard && typeof window.ManaShareCard.downloadBlob === 'function') {
      window.ManaShareCard.downloadBlob(blob, filename);
      return;
    }
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || 'mapa.pdf';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 6000);
  }

  // Web Share con archivos (iOS/Android y navegadores compatibles). Se prueba
  // con un PDF diminuto para decidir si se ofrece «Compartir PDF» sin tener
  // que construir el documento; si no hay soporte queda la descarga normal.
  function canSharePdfFile(file) {
    try {
      if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' ||
          typeof navigator.canShare !== 'function' || typeof File !== 'function') return false;
      var probe = file || new File([new Uint8Array(1)], 'mapa.pdf', { type: 'application/pdf' });
      return !!navigator.canShare({ files: [probe] });
    } catch (e) { return false; }
  }

  async function buildPdfArtifact(tpl, opts, onStatus) {
    var svg = buildSvg(state.ctx, tpl, opts);
    if (onStatus) onStatus(tr('Preparando la página…', 'Preparing page…'));
    var pixelW = Math.round(tpl.w * tpl.scale);
    var pixelH = Math.round(tpl.h * tpl.scale);
    var jpg = await svgToJpeg(svg, pixelW, pixelH);
    if (onStatus) onStatus(tr('Construyendo el PDF…', 'Building PDF…'));
    var blob = buildPdf([{
      pw: tpl.pw, ph: tpl.ph,
      width: jpg.width, height: jpg.height,
      bytes: dataUrlBytes(jpg.dataUrl)
    }]);
    var filename = slugify(state.ctx.title) + '-mana-maps.pdf';
    var file = null;
    try { file = new File([blob], filename, { type: 'application/pdf' }); } catch (e) { file = null; }
    return { blob: blob, file: file, filename: filename };
  }

  async function generatePdf(tpl, opts, onStatus) {
    var artifact = await buildPdfArtifact(tpl, opts, onStatus);
    downloadBlob(artifact.blob, artifact.filename);
    return artifact;
  }

  // ── Modal ──
  function ensureModal() {
    if (document.getElementById('pdfx-modal')) return document.getElementById('pdfx-modal');
    var wrap = document.createElement('div');
    wrap.id = 'pdfx-modal';
    wrap.className = 'pdfx-overlay';
    wrap.hidden = true;
    wrap.innerHTML =
      '<div class="pdfx-dialog" role="dialog" aria-modal="true" aria-labelledby="pdfx-title">' +
        '<div class="pdfx-head">' +
          '<div class="pdfx-head-main">' +
            '<img class="pdfx-logo" src="/assets/brand/mana-logo.svg" alt="Maña Maps">' +
            '<div class="pdfx-head-copy"><h2 id="pdfx-title">' + esc(tr('Descargar PDF', 'Download PDF')) + '</h2>' +
            '<p>' + esc(tr('Elige plantilla y encuadre. Se genera desde el mapa actual.', 'Choose a template and frame. It uses the current map.')) + '</p></div>' +
          '</div>' +
          '<button type="button" class="pdfx-close" aria-label="' + esc(tr('Cerrar', 'Close')) + '">×</button>' +
        '</div>' +
        '<div class="pdfx-main">' +
          '<div class="pdfx-preview-wrap">' +
            '<div class="pdfx-preview" id="pdfx-preview"><div class="pdfx-spinner"></div></div>' +
            '<div class="pdfx-caption" id="pdfx-caption"></div>' +
            '<div class="pdfx-picker" id="pdfx-picker" hidden>' +
              '<div class="pdfx-picker-head">' +
                '<div><b>' + esc(tr('Selecciona la zona', 'Select the area')) + '</b><span>' +
                  esc(tr('Arrastra sobre el mapa para encuadrar el PDF.', 'Drag over the map to frame the PDF.')) + '</span></div>' +
                '<div class="pdfx-picker-actions">' +
                  '<button type="button" class="pdfx-btn ghost" data-picker-cancel>' + esc(tr('Cancelar', 'Cancel')) + '</button>' +
                  '<button type="button" class="pdfx-btn primary" data-picker-apply disabled>' + esc(tr('Aplicar', 'Apply')) + '</button>' +
                '</div>' +
              '</div>' +
              '<div class="pdfx-picker-map" id="pdfx-picker-map">' +
                '<div class="pdfx-picker-canvas" id="pdfx-picker-canvas"></div>' +
                '<div class="pdfx-picker-sel" id="pdfx-picker-sel" hidden></div>' +
              '</div>' +
              '<div class="pdfx-picker-foot"><span id="pdfx-picker-note">' +
                esc(tr('Ninguna zona seleccionada', 'No area selected')) + '</span>' +
                '<button type="button" class="pdfx-link" data-picker-reset>' + esc(tr('Reiniciar', 'Reset')) + '</button></div>' +
            '</div>' +
          '</div>' +
          '<div class="pdfx-side">' +
            '<div class="pdfx-templates" role="radiogroup" aria-label="' + esc(tr('Plantillas', 'Templates')) + '"></div>' +
            '<div class="pdfx-frame">' +
              '<span class="pdfx-label">' + esc(tr('Encuadre', 'Frame')) + '</span>' +
              '<div class="pdfx-seg" role="group" aria-label="' + esc(tr('Encuadre', 'Frame')) + '">' +
                '<button type="button" class="pdfx-seg-btn on" data-frame="fit">' + esc(tr('Todo', 'All')) + '</button>' +
                '<button type="button" class="pdfx-seg-btn" data-frame="view">' + esc(tr('Vista actual', 'Current view')) + '</button>' +
                '<button type="button" class="pdfx-seg-btn" data-frame="region">' + esc(tr('Región', 'Area')) + '</button>' +
              '</div>' +
              '<p class="pdfx-hint" id="pdfx-frame-hint">' + esc(tr('Se usará todo el mapa.', 'The whole map will be used.')) + '</p>' +
            '</div>' +
            '<div class="pdfx-options">' +
              '<label class="pdfx-check"><input type="checkbox" id="pdfx-opt-legend" checked> ' + esc(tr('Leyenda', 'Legend')) + '</label>' +
              '<label class="pdfx-check"><input type="checkbox" id="pdfx-opt-labels"> ' + esc(tr('Etiquetas', 'Labels')) + '</label>' +
              '<label class="pdfx-check"><input type="checkbox" id="pdfx-opt-table" checked> ' + esc(tr('Tabla de datos', 'Data table')) + '</label>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="pdfx-foot">' +
          '<span class="pdfx-status" id="pdfx-status" role="status" aria-live="polite"></span>' +
          '<div class="pdfx-actions">' +
            '<button type="button" class="pdfx-btn ghost" data-close>' + esc(tr('Cancelar', 'Cancel')) + '</button>' +
            '<button type="button" class="pdfx-btn ghost" id="pdfx-share" hidden>' + esc(tr('Compartir PDF', 'Share PDF')) + '</button>' +
            '<button type="button" class="pdfx-btn primary" id="pdfx-download">' + esc(tr('Descargar PDF', 'Download PDF')) + '</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);

    var list = wrap.querySelector('.pdfx-templates');
    list.innerHTML = TEMPLATES.map(function (t, i) {
      var kind = (t.w > t.h) ? 'land' : 'port';
      return '<button type="button" class="pdfx-card' + (i === 0 ? ' on' : '') + '" data-id="' + t.id + '" role="radio" aria-checked="' + (i === 0) + '">' +
        '<span class="pdfx-thumb ' + kind + '"><span class="pdfx-thumb-title"></span><span class="pdfx-thumb-map"></span><span class="pdfx-thumb-legend"></span></span>' +
        '<b>' + esc(templateName(t)) + '</b><small>' + esc(t.size) + '</small></button>';
    }).join('');

    function close() {
      releaseUrls();
      clearShareArtifact();
      state.picker = null;
      var pickerEl = document.getElementById('pdfx-picker');
      if (pickerEl) pickerEl.hidden = true;
      var previewEl = document.getElementById('pdfx-preview');
      if (previewEl && previewEl.parentNode && previewEl.parentNode.classList) {
        previewEl.parentNode.classList.remove('is-picking');
      }
      if (previewEl) previewEl.removeAttribute('data-tag');
      wrap.hidden = true;
      document.documentElement.classList.remove('pdfx-open');
      refreshEditorMaps();
    }
    state.close = close;
    wrap.querySelector('.pdfx-close').addEventListener('click', close);
    wrap.querySelector('[data-close]').addEventListener('click', close);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !wrap.hidden) close();
    });
    list.querySelectorAll('.pdfx-card').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (state.busy) return;
        state.template = btn.getAttribute('data-id');
        list.querySelectorAll('.pdfx-card').forEach(function (b) {
          var on = b === btn;
          b.classList.toggle('on', on);
          b.setAttribute('aria-checked', on ? 'true' : 'false');
        });
        track('pdf_template', { template: state.template });
        renderPreview();
      });
    });
    wrap.querySelector('#pdfx-opt-legend').addEventListener('change', function (e) {
      state.includeLegend = !!e.target.checked;
      state.cache = {};
      renderPreview();
      renderThumbs();
    });
    wrap.querySelector('#pdfx-opt-labels').addEventListener('change', function (e) {
      state.includeLabels = !!e.target.checked;
      state.cache = {};
      renderPreview();
      renderThumbs();
    });
    wrap.querySelector('#pdfx-opt-table').addEventListener('change', function (e) {
      state.includeTable = !!e.target.checked;
      state.cache = {};
      renderPreview();
      renderThumbs();
    });
    wrap.querySelectorAll('[data-frame]').forEach(function (btn) {
      btn.addEventListener('click', function () { chooseFrame(btn.getAttribute('data-frame')); });
    });
    var pickerMap = document.getElementById('pdfx-picker-map');
    if (pickerMap) {
      pickerMap.addEventListener('pointerdown', function (e) {
        if (!state.picker || state.picker.dragStart) return;
        e.preventDefault();
        var pt = pickerPoint(e);
        if (!pt) return;
        try { pickerMap.setPointerCapture(e.pointerId); } catch (_) {}
        state.picker.dragStart = { x: pt.x, y: pt.y };
        state.picker.sel = null;
        var selEl = document.getElementById('pdfx-picker-sel');
        if (selEl) selEl.hidden = true;
        var apply = document.querySelector('[data-picker-apply]');
        if (apply) apply.disabled = true;
        var note = document.getElementById('pdfx-picker-note');
        if (note) note.textContent = tr('Arrastra para definir la zona', 'Drag to define the area');
        renderPreview();
      });
      pickerMap.addEventListener('pointermove', function (e) {
        if (!state.picker || !state.picker.dragStart) return;
        e.preventDefault();
        var pt = pickerPoint(e);
        if (!pt) return;
        var s = state.picker.dragStart;
        var sel = { x1: s.x, y1: s.y, x2: pt.x, y2: pt.y };
        state.picker.sel = sel;
        drawPickerSel(sel);
        var apply = document.querySelector('[data-picker-apply]');
        if (apply) apply.disabled = !(Math.abs(sel.x2 - sel.x1) > 16 && Math.abs(sel.y2 - sel.y1) > 16);
      });
      pickerMap.addEventListener('pointerup', function (e) {
        if (!state.picker || !state.picker.dragStart) return;
        var pt = pickerPoint(e);
        var s = state.picker.dragStart;
        state.picker.dragStart = null;
        if (!pt) return;
        var sel = { x1: s.x, y1: s.y, x2: pt.x, y2: pt.y };
        if (Math.abs(sel.x2 - sel.x1) < 16 || Math.abs(sel.y2 - sel.y1) < 16) {
          resetRegionPicker();
          return;
        }
        state.picker.sel = sel;
        drawPickerSel(sel);
        var apply = document.querySelector('[data-picker-apply]');
        if (apply) apply.disabled = false;
        var note = document.getElementById('pdfx-picker-note');
        if (note) note.textContent = tr('Zona seleccionada', 'Selected area');
        updateCropPreview();
      });
      pickerMap.addEventListener('pointercancel', function () {
        if (state.picker) state.picker.dragStart = null;
      });
    }
    wrap.querySelector('[data-picker-apply]').addEventListener('click', applyRegionPicker);
    wrap.querySelector('[data-picker-cancel]').addEventListener('click', function () {
      closeRegionPicker(true);
      renderPreview();
    });
    wrap.querySelector('[data-picker-reset]').addEventListener('click', resetRegionPicker);
    window.addEventListener('resize', function () {
      if (state.picker && state.picker.sel) drawPickerSel(state.picker.sel);
    });
    wrap.querySelector('#pdfx-download').addEventListener('click', onDownload);
    wrap.querySelector('#pdfx-share').addEventListener('click', onShare);
    return wrap;
  }

  function frameBounds() {
    if (state.frame === 'region') return validBounds(state.region) ? state.region : null;
    if (state.frame === 'view') return validBounds(state.mapViewBounds) ? state.mapViewBounds : null;
    return null;
  }
  function boundsKey(b) {
    if (!validBounds(b)) return 'fit';
    return [b.minX, b.maxX, b.minY, b.maxY].map(function (v) { return v.toFixed(5); }).join(',');
  }
  function frameKey() {
    var b = frameBounds();
    if (!b) return 'fit';
    return state.frame + ':' + boundsKey(b);
  }
  function currentOptions() {
    return {
      includeLegend: state.includeLegend,
      includeLabels: state.includeLabels,
      includeTable: state.includeTable,
      viewBounds: frameBounds()
    };
  }
  function flagsKey(tpl) {
    return tpl.id + ':' + (state.includeLegend ? 1 : 0) + (state.includeLabels ? 1 : 0) + (state.includeTable ? 1 : 0);
  }
  function optionsKey(tpl) {
    return flagsKey(tpl) + ':' + frameKey();
  }
  function releaseUrls() {
    if (state.previewUrl) { URL.revokeObjectURL(state.previewUrl); state.previewUrl = null; }
    Object.keys(state.thumbUrls).forEach(function (k) { URL.revokeObjectURL(state.thumbUrls[k]); });
    state.thumbUrls = {};
  }
  function rebuildContextForFrame() {
    state.ctx = buildContext(frameBounds());
    state.cache = {};
  }
  function updateFrameUI() {
    var wrap = document.getElementById('pdfx-modal');
    if (!wrap) return;
    wrap.querySelectorAll('[data-frame]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-frame') === state.frame);
    });
    var hint = document.getElementById('pdfx-frame-hint');
    if (!hint) return;
    if (state.frame === 'view') hint.textContent = tr('Se usará la zona visible en el editor.', 'The visible editor area will be used.');
    else if (state.frame === 'region') {
      hint.textContent = validBounds(state.region)
        ? tr('Se usará la zona seleccionada.', 'The selected area will be used.')
        : tr('Selecciona una zona en el mapa.', 'Select an area on the map.');
    } else hint.textContent = tr('Se usará todo el mapa.', 'The whole map will be used.');
  }
  function chooseFrame(frame) {
    if (state.busy) return;
    if (frame === 'region') { openRegionPicker(); return; }
    if (frame === 'view') {
      var vb = getMapViewBounds();
      if (!vb) {
        state.frame = 'fit';
        setStatus(tr('No se pudo leer la vista actual; se usará todo el mapa.', 'Could not read the current view; using the whole map.'));
      } else {
        state.frame = 'view';
        state.mapViewBounds = vb;
      }
    } else {
      state.frame = 'fit';
    }
    rebuildContextForFrame();
    updateFrameUI();
    track('pdf_frame', { frame: state.frame, requested: frame });
    renderPreview();
    renderThumbs();
  }

  // ── Selector de región ──
  var PICKER_W = 1000, PICKER_H = 625;
  function pickerGeom() {
    var el = document.getElementById('pdfx-picker-map');
    if (!el) return null;
    var box = el.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    var scale = Math.min(box.width / PICKER_W, box.height / PICKER_H);
    return { scale: scale, dx: (box.width - PICKER_W * scale) / 2, dy: (box.height - PICKER_H * scale) / 2, box: box };
  }
  function pickerPoint(e) {
    var g = pickerGeom();
    if (!g) return null;
    var x = (e.clientX - g.box.left - g.dx) / g.scale;
    var y = (e.clientY - g.box.top - g.dy) / g.scale;
    return {
      x: Math.max(0, Math.min(PICKER_W, x)),
      y: Math.max(0, Math.min(PICKER_H, y)),
      g: g
    };
  }
  function drawPickerSel(sel) {
    var el = document.getElementById('pdfx-picker-sel');
    var g = pickerGeom();
    if (!el || !g || !sel) return;
    var x1 = Math.min(sel.x1, sel.x2), x2 = Math.max(sel.x1, sel.x2);
    var y1 = Math.min(sel.y1, sel.y2), y2 = Math.max(sel.y1, sel.y2);
    el.style.left = (g.dx + x1 * g.scale) + 'px';
    el.style.top = (g.dy + y1 * g.scale) + 'px';
    el.style.width = Math.max(0, (x2 - x1) * g.scale) + 'px';
    el.style.height = Math.max(0, (y2 - y1) * g.scale) + 'px';
    el.hidden = false;
  }
  function renderPicker() {
    var canvas = document.getElementById('pdfx-picker-canvas');
    var note = document.getElementById('pdfx-picker-note');
    var apply = document.querySelector('[data-picker-apply]');
    var selEl = document.getElementById('pdfx-picker-sel');
    if (!canvas) return;
    var b = bounds(state.ctx.geo);
    if (!b) {
      canvas.innerHTML = '<div class="pdfx-picker-empty">' + esc(tr('No hay mapa que mostrar.', 'No map to display.')) + '</div>';
      return;
    }
    var rect = { x: 0, y: 0, w: PICKER_W, h: PICKER_H };
    var p = fit(b, rect, false);
    if (!p) return;
    var inner = renderMap(state.ctx.geo, rect, { id: 'picker', graticule: true });
    canvas.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + PICKER_W + ' ' + PICKER_H +
      '" preserveAspectRatio="xMidYMid meet">' + inner + '</svg>';
    state.picker = { b: b, p: p, dragStart: null, sel: null, prevFrame: state.frame };
    if (selEl) selEl.hidden = true;
    if (apply) apply.disabled = true;
    if (note) note.textContent = tr('Ninguna zona seleccionada', 'No area selected');
    if (validBounds(state.region)) {
      var r = state.region;
      var x1 = p.tx(r.minX), x2 = p.tx(r.maxX);
      var y1 = p.ty(r.maxY), y2 = p.ty(r.minY);
      var sel = {
        x1: Math.max(0, Math.min(PICKER_W, x1)), x2: Math.max(0, Math.min(PICKER_W, x2)),
        y1: Math.max(0, Math.min(PICKER_H, y1)), y2: Math.max(0, Math.min(PICKER_H, y2))
      };
      state.picker.sel = sel;
      drawPickerSel(sel);
      if (apply) apply.disabled = false;
      if (note) note.textContent = tr('Zona seleccionada', 'Selected area');
    }
  }
  function selectionBounds() {
    if (!state.picker || !state.picker.sel) return null;
    var s = state.picker.sel, p = state.picker.p, b = state.picker.b;
    if (!p || !b) return null;
    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
    var out = {
      minX: clamp(p.minX + (Math.min(s.x1, s.x2) - p.ox) / p.s, b.minX, b.maxX),
      maxX: clamp(p.minX + (Math.max(s.x1, s.x2) - p.ox) / p.s, b.minX, b.maxX),
      minY: clamp(p.maxY - (Math.max(s.y1, s.y2) - p.oy) / p.s, b.minY, b.maxY),
      maxY: clamp(p.maxY - (Math.min(s.y1, s.y2) - p.oy) / p.s, b.minY, b.maxY)
    };
    return validBounds(out) ? out : null;
  }
  // Mientras se elige la región el preview sigue visible como miniatura y se
  // refresca con la zona marcada, para no perder la referencia del encuadre.
  function updateCropPreview() {
    var b = selectionBounds();
    if (!b) { renderPreview(); return; }
    try { renderPreview(b); } catch (e) { renderPreview(); }
  }
  function openRegionPicker() {
    var wrap = document.getElementById('pdfx-modal');
    if (!wrap) return;
    var preview = document.getElementById('pdfx-preview');
    var picker = document.getElementById('pdfx-picker');
    if (!picker) return;
    var holder = preview ? preview.parentNode : null;
    if (holder && holder.classList) holder.classList.add('is-picking');
    if (preview) preview.setAttribute('data-tag', tr('Vista previa', 'Preview'));
    picker.hidden = false;
    renderPicker();
    updateFrameUI();
    document.querySelectorAll('[data-frame]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-frame') === 'region');
    });
    var hint = document.getElementById('pdfx-frame-hint');
    if (hint) hint.textContent = validBounds(state.region)
      ? tr('Se usará la zona seleccionada.', 'The selected area will be used.')
      : tr('Arrastra sobre el mapa para elegir la zona.', 'Drag over the map to choose the area.');
  }
  function closeRegionPicker(restore) {
    var picker = document.getElementById('pdfx-picker');
    var preview = document.getElementById('pdfx-preview');
    if (picker) picker.hidden = true;
    if (preview && preview.parentNode && preview.parentNode.classList) {
      preview.parentNode.classList.remove('is-picking');
    }
    if (preview) preview.removeAttribute('data-tag');
    if (restore) {
      state.frame = state.picker && state.picker.prevFrame ? state.picker.prevFrame : 'fit';
      if (state.frame === 'region' && !validBounds(state.region)) state.frame = 'fit';
      state.picker = null;
    }
    updateFrameUI();
  }
  function applyRegionPicker() {
    var b = selectionBounds();
    if (!b) return;
    state.region = b;
    state.frame = 'region';
    state.picker = null;
    closeRegionPicker(false);
    rebuildContextForFrame();
    updateFrameUI();
    track('pdf_frame', { frame: 'region', requested: 'region' });
    renderPreview();
    renderThumbs();
  }
  function resetRegionPicker() {
    if (state.picker) state.picker.sel = null;
    var selEl = document.getElementById('pdfx-picker-sel');
    if (selEl) selEl.hidden = true;
    var apply = document.querySelector('[data-picker-apply]');
    if (apply) apply.disabled = true;
    var note = document.getElementById('pdfx-picker-note');
    if (note) note.textContent = tr('Ninguna zona seleccionada', 'No area selected');
    renderPreview();
  }
  function renderPreview(cropBounds) {
    var box = document.getElementById('pdfx-preview');
    if (!box) return;
    var tpl = templateById(state.template);
    var crop = validBounds(cropBounds) ? cropBounds : null;
    var key = crop ? ('crop:' + flagsKey(tpl) + ':' + boundsKey(crop)) : optionsKey(tpl);
    if (crop) {
      // Solo se conserva el último recorte: evita acumular SVG en memoria
      // mientras el usuario redibuja el rectángulo.
      Object.keys(state.cache).forEach(function (k) {
        if (k.indexOf('crop:') === 0 && k !== key) delete state.cache[k];
      });
    }
    var svg = state.cache[key];
    if (!svg) {
      // La miniatura del recorte se compone con su propio contexto para que
      // leyenda y tabla describan solo la zona elegida.
      var ctx = crop ? buildContext(crop) : state.ctx;
      svg = buildSvg(ctx, tpl, {
        includeLegend: state.includeLegend,
        includeLabels: state.includeLabels,
        includeTable: state.includeTable,
        viewBounds: crop || frameBounds()
      });
      state.cache[key] = svg;
    }
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = svgUrl(svg);
    box.innerHTML = '<img alt="' + esc(templateName(tpl)) + '" src="' + state.previewUrl + '">';
    var cap = document.getElementById('pdfx-caption');
    if (cap) cap.textContent = (crop ? tr('Recorte', 'Crop') + ' · ' : '') + templateName(tpl) + ' · ' + tpl.size;
    if (!crop) scheduleShareArtifact();
  }

  function renderThumbs() {
    var cards = document.querySelectorAll('.pdfx-card');
    cards.forEach(function (btn, i) {
      setTimeout(function () {
        var wrap = document.getElementById('pdfx-modal');
        if (!wrap || wrap.hidden) return;
        try {
          var tpl = templateById(btn.getAttribute('data-id'));
          var key = optionsKey(tpl);
          var svg = state.cache[key];
          if (!svg) { svg = buildSvg(state.ctx, tpl, currentOptions()); state.cache[key] = svg; }
          var thumb = btn.querySelector('.pdfx-thumb');
          if (!thumb) return;
          var id = btn.getAttribute('data-id');
          if (state.thumbUrls[id]) URL.revokeObjectURL(state.thumbUrls[id]);
          var url = svgUrl(svg);
          state.thumbUrls[id] = url;
          thumb.style.backgroundImage = 'url("' + url + '")';
          thumb.classList.add('has-img');
        } catch (e) { /* mantiene el mock CSS si falla */ }
      }, 80 + i * 110);
    });
  }

  function setStatus(msg) {
    var el = document.getElementById('pdfx-status');
    if (el) el.textContent = msg || '';
  }
  // Parámetros anónimos de la exportación: identifican plantilla, encuadre y
  // opciones, nunca el contenido del mapa. `via` distingue descarga y share.
  function exportParams(tpl, started, via) {
    return {
      format: 'pdf',
      via: via,
      template: tpl.id,
      frame: state.frame,
      legend: state.includeLegend,
      labels: state.includeLabels,
      table: state.includeTable,
      featureCount: featureBucket(state.ctx && state.ctx.feats ? state.ctx.feats.length : 0),
      durationMs: Date.now() - started
    };
  }
  async function onDownload() {
    if (state.busy) return;
    var btn = document.getElementById('pdfx-download');
    var tpl = templateById(state.template);
    var started = Date.now();
    state.busy = true;
    if (btn) { btn.disabled = true; btn.classList.add('is-busy'); }
    try {
      await new Promise(function (r) { setTimeout(r, 30); });
      await generatePdf(tpl, currentOptions(), setStatus);
      track('export', exportParams(tpl, started, 'download'));
      setStatus(tr('PDF descargado ✓', 'PDF downloaded ✓'));
      setTimeout(function () { if (state.close) state.close(); }, 700);
    } catch (e) {
      console.error('[pdf-export]', e);
      track('pdf_error', { stage: 'download', template: tpl.id, frame: state.frame, reason: errorReason(e) });
      setStatus(tr('No se pudo generar el PDF. Inténtalo de nuevo.', 'Could not generate the PDF. Please try again.'));
    } finally {
      state.busy = false;
      if (btn) { btn.disabled = false; btn.classList.remove('is-busy'); }
    }
  }

  // ── Compartir en móvil ──
  // El PDF se prepara en segundo plano (solo en pantallas táctiles) para que
  // al tocar «Compartir PDF» la hoja nativa del sistema se abra dentro del
  // gesto del usuario: iOS descarta `navigator.share` si se llama tarde. Si no
  // hay artefacto listo se genera en el momento y, si el navegador lo rechaza,
  // la exportación cae en la descarga normal.
  function isCoarsePointer() {
    try { return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); } catch (e) { return false; }
  }
  function shareArtifactKey() {
    return optionsKey(templateById(state.template));
  }
  function clearShareArtifact() {
    if (state.shareTimer) { clearTimeout(state.shareTimer); state.shareTimer = null; }
    state.shareArtifact = null;
    state.shareKey = null;
  }
  function prefetchShareArtifact() {
    if (!canSharePdfFile() || state.busy || !state.ctx || !state.ctx.feats || !state.ctx.feats.length) return;
    // En mapas muy densos la rasterización en segundo plano competiría con la
    // vista previa y la descarga: se genera al tocar el botón.
    if (state.ctx.feats.length > 200) return;
    var key = shareArtifactKey();
    if (state.shareKey === key) return;
    state.shareKey = key;
    state.shareArtifact = null;
    var tpl = templateById(state.template);
    buildPdfArtifact(tpl, currentOptions()).then(function (artifact) {
      if (state.shareKey === key) state.shareArtifact = artifact;
    }).catch(function () {
      if (state.shareKey === key) state.shareArtifact = null;
    });
  }
  function scheduleShareArtifact() {
    if (!isCoarsePointer() || !canSharePdfFile()) return;
    if (state.shareTimer) clearTimeout(state.shareTimer);
    state.shareTimer = setTimeout(function () {
      state.shareTimer = null;
      prefetchShareArtifact();
    }, 700);
  }

  function finishShare(artifact, tpl, started) {
    track('export', exportParams(tpl, started, 'download'));
    downloadBlob(artifact.blob, artifact.filename);
    setStatus(tr('No se pudo compartir; PDF descargado ✓', 'Could not share; PDF downloaded ✓'));
    setTimeout(function () { if (state.close) state.close(); }, 800);
  }

  async function onShare() {
    if (state.busy) return;
    if (!canSharePdfFile()) {
      // El navegador dejó de soportarlo (o cambió): la descarga es el fallback.
      onDownload();
      return;
    }
    var shareBtn = document.getElementById('pdfx-share');
    var dlBtn = document.getElementById('pdfx-download');
    var tpl = templateById(state.template);
    var started = Date.now();
    var key = shareArtifactKey();
    var cached = (state.shareArtifact && state.shareKey === key) ? state.shareArtifact : null;
    if (cached && cached.file) {
      // Sin awaits antes del share: conserva la activación del gesto en iOS.
      return shareNow(cached, tpl, started, shareBtn, dlBtn);
    }
    state.busy = true;
    if (shareBtn) { shareBtn.disabled = true; shareBtn.classList.add('is-busy'); }
    if (dlBtn) dlBtn.disabled = true;
    var artifact = null;
    try {
      artifact = await buildPdfArtifact(tpl, currentOptions(), setStatus);
      if (!artifact.file || !canSharePdfFile(artifact.file)) {
        downloadBlob(artifact.blob, artifact.filename);
        track('export', exportParams(tpl, started, 'download'));
        setStatus(tr('Compartir no está disponible; PDF descargado ✓', 'Sharing is not available; PDF downloaded ✓'));
        setTimeout(function () { if (state.close) state.close(); }, 800);
        return;
      }
      await navigator.share({
        files: [artifact.file],
        title: (state.ctx && state.ctx.title) || 'Maña Maps',
        text: tr('Mapa creado con Maña Maps', 'Map made with Maña Maps')
      });
      track('export', exportParams(tpl, started, 'share'));
      setStatus(tr('PDF compartido ✓', 'PDF shared ✓'));
      setTimeout(function () { if (state.close) state.close(); }, 700);
    } catch (e) {
      if (e && e.name === 'AbortError') {
        setStatus(tr('Compartir cancelado.', 'Sharing cancelled.'));
      } else if (artifact) {
        // El PDF existe: la descarga es el fallback cuando el share falla.
        console.error('[pdf-export]', e);
        track('pdf_error', { stage: 'share', template: tpl.id, frame: state.frame, reason: errorReason(e) });
        finishShare(artifact, tpl, started);
      } else {
        console.error('[pdf-export]', e);
        track('pdf_error', { stage: 'share', template: tpl.id, frame: state.frame, reason: errorReason(e) });
        setStatus(tr('No se pudo generar el PDF. Inténtalo de nuevo.', 'Could not generate the PDF. Please try again.'));
      }
    } finally {
      state.busy = false;
      if (shareBtn) { shareBtn.disabled = false; shareBtn.classList.remove('is-busy'); }
      if (dlBtn) dlBtn.disabled = false;
    }
  }

  function shareNow(artifact, tpl, started, shareBtn, dlBtn) {
    state.busy = true;
    if (shareBtn) { shareBtn.disabled = true; shareBtn.classList.add('is-busy'); }
    if (dlBtn) dlBtn.disabled = true;
    var done = function () {
      state.busy = false;
      if (shareBtn) { shareBtn.disabled = false; shareBtn.classList.remove('is-busy'); }
      if (dlBtn) dlBtn.disabled = false;
    };
    var sharePromise;
    try {
      sharePromise = navigator.share({
        files: [artifact.file],
        title: (state.ctx && state.ctx.title) || 'Maña Maps',
        text: tr('Mapa creado con Maña Maps', 'Map made with Maña Maps')
      });
    } catch (e) {
      sharePromise = Promise.reject(e);
    }
    return Promise.resolve(sharePromise).then(function () {
      track('export', exportParams(tpl, started, 'share'));
      setStatus(tr('PDF compartido ✓', 'PDF shared ✓'));
      setTimeout(function () { if (state.close) state.close(); }, 700);
      done();
    }).catch(function (e) {
      done();
      if (e && e.name === 'AbortError') {
        setStatus(tr('Compartir cancelado.', 'Sharing cancelled.'));
        return;
      }
      track('pdf_error', { stage: 'share', template: tpl.id, frame: state.frame, reason: errorReason(e) });
      finishShare(artifact, tpl, started);
    });
  }

  // ── Repintado del mapa del editor ──
  // El modal oculta el mapa y bloquea el scroll (html.pdfx-open). Al cerrarlo
  // el contenedor recupera su ancho real un frame después, así que Leaflet, el
  // puente MapLibre de la capa activa y el globo 3D deben recalcular tamaño o
  // se quedan con zonas grises/recortadas hasta el siguiente gesto.
  function refreshEditorMaps() {
    var seen = [];
    function resizeGl(gl, syncToLeaflet) {
      if (!gl || typeof gl.resize !== 'function' || seen.indexOf(gl) !== -1) return;
      seen.push(gl);
      try { gl.resize(); } catch (e) { /* sin WebGL disponible */ }
      if (syncToLeaflet) {
        try {
          if (typeof map !== 'undefined' && map && typeof map.getCenter === 'function' && typeof gl.jumpTo === 'function') {
            var c = map.getCenter();
            gl.jumpTo({ center: [c.lng, c.lat], zoom: map.getZoom() });
          }
        } catch (e) { /* el globo conserva su propia cámara */ }
      }
      try { if (typeof gl.triggerRepaint === 'function') gl.triggerRepaint(); } catch (e) {}
    }
    setTimeout(function () {
      try {
        if (typeof map !== 'undefined' && map && typeof map.invalidateSize === 'function') {
          map.invalidateSize();
        }
      } catch (e) { /* páginas sin mapa Leaflet */ }
      var gl = null;
      try {
        gl = typeof _getActiveGLMap === 'function' ? _getActiveGLMap() : null;
      } catch (e) { gl = null; }
      resizeGl(gl, true);
      try {
        if (typeof globeMap !== 'undefined') resizeGl(globeMap, false);
      } catch (e) { /* el globo aún no se ha creado */ }
    }, 50);
  }

  function openPdfExport() {
    if (document.querySelectorAll('#export-menu.open, .drop-menu.open').length) {
      document.querySelectorAll('.drop-menu.open').forEach(function (x) { x.classList.remove('open'); });
    }
    state.frame = 'fit';
    state.region = null;
    state.picker = null;
    state.mapViewBounds = getMapViewBounds();
    state.ctx = buildContext(null);
    if (!state.ctx.feats.length) {
      track('pdf_error', { stage: 'empty', template: 'none', frame: 'fit', reason: 'no-features' });
      if (typeof showToast === 'function') showToast(tr('No hay elementos para exportar.', 'No elements to export.'), 'warning');
      else if (typeof manaAlert === 'function') manaAlert(tr('No hay elementos para exportar.', 'No elements to export.'), 'warning');
      return;
    }
    state.cache = {};
    state.template = 'dossier';
    state.includeLegend = true;
    state.includeLabels = !!state.ctx.labelsEnabled && state.ctx.feats.length <= 120;
    state.includeTable = true;
    var wrap = ensureModal();
    // «Compartir PDF» solo aparece donde el navegador puede compartir archivos.
    clearShareArtifact();
    var shareBtn = wrap.querySelector('#pdfx-share');
    if (shareBtn) {
      shareBtn.hidden = !canSharePdfFile();
      shareBtn.disabled = false;
      shareBtn.classList.remove('is-busy');
    }
    // Re-sincroniza el estado de las tarjetas y casillas cada vez que se abre.
    wrap.querySelectorAll('.pdfx-card').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-id') === 'dossier'); });
    var lg = wrap.querySelector('#pdfx-opt-legend'); if (lg) lg.checked = true;
    var lb = wrap.querySelector('#pdfx-opt-labels'); if (lb) lb.checked = state.includeLabels;
    var tb = wrap.querySelector('#pdfx-opt-table'); if (tb) tb.checked = true;
    var picker = document.getElementById('pdfx-picker'); if (picker) picker.hidden = true;
    var previewWrap = document.querySelector('#pdfx-modal .pdfx-preview-wrap');
    if (previewWrap) previewWrap.classList.remove('is-picking');
    var previewBefore = document.getElementById('pdfx-preview');
    if (previewBefore) previewBefore.removeAttribute('data-tag');
    state.picker = null;
    updateFrameUI();
    setStatus('');
    track('pdf_open', {
      featureCount: featureBucket(state.ctx.feats.length),
      templates: TEMPLATES.length,
      labels: state.includeLabels
    });
    wrap.hidden = false;
    document.documentElement.classList.add('pdfx-open');
    var prev = document.getElementById('pdfx-preview');
    if (prev) prev.innerHTML = '<div class="pdfx-spinner"></div>';
    // Deja que el modal se pinte antes de componer el SVG (mapas grandes).
    setTimeout(function () {
      try { renderPreview(); } catch (e) {
        console.error(e);
        track('pdf_error', { stage: 'preview', template: state.template, frame: state.frame, reason: errorReason(e) });
        setStatus(tr('No se pudo componer la vista previa.', 'Could not build the preview.'));
      }
      renderThumbs();
    }, 20);
  }

  window.openPdfExport = openPdfExport;
  window.ManaPdfExport = { open: openPdfExport, buildContext: buildContext, _templates: TEMPLATES };
})();
