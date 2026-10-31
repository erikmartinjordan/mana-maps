// ── share-card.js ─ Tarjeta cuadrada (1080×1080) lista para compartir.
// Compone una imagen "espectacular" a partir de un mapa (GeoJSON + metadatos):
// símbolo de Maña, título, subtítulo, el mapa en coroplético intenso y, si el
// mapa declara una variable numérica (valueKey/legendKey), guías en L que
// apuntan a los 5 valores más altos. Expone window.ManaShareCard.
(function () {
  'use strict';

  var SIZE = 1080;
  var INK = '#111214';       // --text
  var GRAY = '#5f6670';      // --muted
  var LIGHT = '#ffffff';     // --surface
  var FONT = "'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

  // Símbolo de la marca: blob + glifo «M̃» (sin wordmark).
  var ICON = 'M42.3,-74.7C55.1,-65.8,66.1,-55.2,74.7,-42.4C83.2,-29.7,89.3,-14.8,89.7,0.2C90,15.2,84.6,30.5,74.3,40.2C64,49.8,48.7,54,35.6,62.1C22.4,70.2,11.2,82.3,-0.8,83.6C-12.7,84.9,-25.4,75.4,-36.1,65.9C-46.9,56.4,-55.6,46.8,-61.3,35.8C-66.9,24.8,-69.5,12.4,-72,-1.4C-74.5,-15.3,-76.9,-30.5,-70.9,-41C-64.9,-51.4,-50.6,-57.1,-37.4,-65.8C-24.2,-74.5,-12.1,-86.1,1.3,-88.4C14.7,-90.7,29.5,-83.6,42.3,-74.7Z';
  var MG1 = 'M1675 0H1303V987L1032 350H777L506 987V0H154V1489H585L915 754L1244 1489H1675Z';
  var MG2 = 'M-186 2061Q-196 1894 -269.0 1816.5Q-342 1739 -472 1739Q-520 1739 -563.0 1758.5Q-606 1778 -637 1797Q-667 1816 -703.5 1835.5Q-740 1855 -765 1855Q-815 1855 -833.0 1823.5Q-851 1792 -855 1733H-1065Q-1059 1879 -983.0 1966.5Q-907 2054 -780 2054Q-732 2054 -691.0 2037.0Q-650 2020 -612 1998Q-582 1981 -546.0 1962.0Q-510 1943 -487 1943Q-439 1943 -418.5 1975.0Q-398 2007 -396 2061Z';

  var W_MAX = 85.051129, DEG = 180 / Math.PI;
  function mercY(lat) { return Math.log(Math.tan(Math.PI / 4 + Math.max(-W_MAX, Math.min(W_MAX, lat)) * Math.PI / 360)) * DEG; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function symbol(x, y, fg, bg, size) {
    var k = (size / 36).toFixed(4);
    return '<g transform="translate(' + x + ' ' + y + ') scale(' + k + ')">' +
      '<g transform="translate(2 2) scale(0.18)"><path fill="' + fg + '" transform="translate(100 100)" d="' + ICON + '"/></g>' +
      '<g transform="translate(13.302 24.5) scale(0.00732422 -0.00732422)">' +
        '<path fill="' + bg + '" d="' + MG1 + '"/>' +
        '<path fill="' + bg + '" transform="translate(1530 -40)" d="' + MG2 + '"/>' +
      '</g></g>';
  }
  function wrap(text, maxWidth, fontSize) {
    var perChar = fontSize * 0.55;
    var maxChars = Math.max(6, Math.floor(maxWidth / perChar));
    var words = String(text || '').split(/\s+/).filter(Boolean);
    var lines = [], cur = '';
    words.forEach(function (w) {
      var t = cur ? cur + ' ' + w : w;
      if (t.length > maxChars && cur) { lines.push(cur); cur = w; } else cur = t;
    });
    if (cur) lines.push(cur);
    return lines.slice(0, 4);
  }
  function fmt(v, format) {
    if (!isFinite(v)) return '';
    if (format === 'percent') return String(Math.round(v * 100) / 100).replace('.', ',') + '%';
    if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(1).replace('.', ',') + ' B';
    if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1).replace('.', ',') + ' M';
    if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(0) + ' k';
    return String(Math.round(v * 100) / 100).replace('.', ',');
  }

  // ── Geometría ──
  function rings(geom, cb) {
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
      if (typeof x !== 'number' || typeof y !== 'number') return;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      var m = mercY(y); if (m < minY) minY = m; if (m > maxY) maxY = m;
    }
    (geo.features || []).forEach(function (f) {
      var g = f.geometry; if (!g) return;
      if (g.type === 'Point') add(g.coordinates[0], g.coordinates[1]);
      else if (g.type === 'MultiPoint') g.coordinates.forEach(function (c) { add(c[0], c[1]); });
      else rings(g, function (r) { for (var i = 0; i < r.length; i++) add(r[i][0], r[i][1]); });
    });
    if (minX === Infinity) return null;
    return { minX: minX, maxX: maxX, minY: minY, maxY: maxY };
  }
  function fit(b, rect) {
    var spanX = b.maxX - b.minX, spanY = b.maxY - b.minY;
    var s = Math.min(rect.w / spanX, rect.h / spanY);
    var mw = spanX * s, mh = spanY * s;
    var ox = rect.x + (rect.w - mw) / 2, oy = rect.y + (rect.h - mh) / 2;
    return {
      s: s, ox: ox, oy: oy, minX: b.minX, maxY: b.maxY,
      tx: function (lon) { return ox + (lon - b.minX) * s; },
      ty: function (m) { return oy + (b.maxY - m) * s; }
    };
  }
  function ringPath(r, p) {
    var d = '';
    for (var i = 0; i < r.length; i++) {
      var c = r[i];
      d += (d ? 'L' : 'M') + p.tx(c[0]).toFixed(1) + ' ' + p.ty(mercY(c[1])).toFixed(1);
    }
    return d + 'Z';
  }
  function landTransform(p) {
    var A = p.s / 10000, C = -(DEG * p.s) / 10000, B = p.ox - p.minX * p.s, D = p.oy + p.maxY * p.s;
    return 'matrix(' + A.toFixed(8) + ' 0 0 ' + C.toFixed(8) + ' ' + B.toFixed(3) + ' ' + D.toFixed(3) + ')';
  }
  function featureColor(f) { var p = f.properties || {}; return p._manaColor || p.color || '#7a5a1e'; }

  function drawFeatures(p, geo, opts) {
    var land = '', polys = '', lines = '', points = '';
    var world = (p.maxX0 - p.minX0) > 300;
    if (!world) { /* región/ciudad: sin silueta de tierra */ }
    if (world && window.WORLD_LAND_PATH) land = '<path d="' + window.WORLD_LAND_PATH + '" fill="#efe9df" transform="' + landTransform(p) + '"/>';
    var border = opts.lightBorder === false ? 'none' : '#ffffff';
    (geo.features || []).forEach(function (f) {
      var g = f.geometry; if (!g) return;
      var col = featureColor(f);
      var op = (f.properties && typeof f.properties._manaFillOpacity === 'number') ? f.properties._manaFillOpacity : 0.9;
      op = Math.max(0.82, Math.min(1, op));
      var d = '';
      if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
        rings(g, function (r) { d += ringPath(r, p); });
        if (d) polys += '<path d="' + d + '" fill="' + col + '" fill-opacity="' + op.toFixed(2) + '" fill-rule="evenodd" stroke="' + border + '" stroke-width="0.8" stroke-linejoin="round"/>';
      } else if (g.type === 'LineString' || g.type === 'MultiLineString') {
        rings(g, function (l) {
          var dd = '';
          for (var i = 0; i < l.length; i++) dd += (dd ? 'L' : 'M') + p.tx(l[i][0]).toFixed(1) + ' ' + p.ty(mercY(l[i][1])).toFixed(1);
          if (dd) lines += '<path d="' + dd + '" fill="none" stroke="#ffffff" stroke-opacity="0.8" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>' +
            '<path d="' + dd + '" fill="none" stroke="' + col + '" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>';
        });
      } else if (g.type === 'Point' || g.type === 'MultiPoint') {
        var pts = g.type === 'Point' ? [g.coordinates] : g.coordinates;
        pts.forEach(function (c) {
          if (typeof c[0] !== 'number') return;
          var x = p.tx(c[0]).toFixed(1), y = p.ty(mercY(c[1])).toFixed(1);
          points += '<circle cx="' + x + '" cy="' + y + '" r="6.5" fill="#ffffff" fill-opacity="0.92" stroke="' + col + '" stroke-width="2"/>' +
            '<circle cx="' + x + '" cy="' + y + '" r="3.2" fill="' + col + '"/>';
        });
      }
    });
    return land + polys + lines + points;
  }

  // ── Detección de variable numérica + top N ──
  function detectValueKey(geo) {
    var feats = geo.features || [], counts = {}, sums = {};
    feats.forEach(function (f) {
      var props = f.properties || {};
      Object.keys(props).forEach(function (k) {
        if (k === '_manaColor' || k === '_manaFillOpacity' || k === '_manaWeight' || k === 'name' || k.charCodeAt(0) === 95) return;
        var v = props[k];
        if (typeof v === 'number' && isFinite(v)) { counts[k] = (counts[k] || 0) + 1; sums[k] = (sums[k] || 0) + Math.abs(v); }
      });
    });
    var best = null, bestN = 0;
    Object.keys(counts).forEach(function (k) {
      if (/anyo|año|year|code|id/i.test(k)) return;
      if (counts[k] > bestN) { best = k; bestN = counts[k]; }
    });
    return (bestN >= Math.max(3, feats.length * 0.5)) ? best : null;
  }
  function topFeatures(geo, key, n) {
    return (geo.features || [])
      .filter(function (f) { return f.properties && typeof f.properties[key] === 'number' && isFinite(f.properties[key]); })
      .sort(function (a, b) { return b.properties[key] - a.properties[key]; })
      .slice(0, n);
  }
  function featureLabel(f, key, format) {
    var p = f.properties || {};
    var name = p._manaName || p.name || p.Nombre || '';
    return name + ' · ' + fmt(p[key], format);
  }
  function featurePoint(p, f) {
    var g = f.geometry; if (!g) return null;
    var c = null;
    if (g.type === 'Point') c = g.coordinates;
    else {
      // centroid of the largest ring
      var best = null, bestLen = 0;
      rings(g, function (r) { if (r.length > bestLen) { bestLen = r.length; best = r; } });
      if (!best) return null;
      var sx = 0, sy = 0; for (var i = 0; i < best.length; i++) { sx += best[i][0]; sy += best[i][1]; }
      c = [sx / best.length, sy / best.length];
    }
    return { x: p.tx(c[0]), y: p.ty(mercY(c[1])) };
  }

  // ── Callouts (guías en L) ──
  function guide(p, f, text, tx, ty, anchor, size) {
    var pt = featurePoint(p, f); if (!pt) return '';
    var lx = anchor === 'end' ? tx - 12 : tx + 12;
    var d = 'M' + pt.x.toFixed(1) + ' ' + pt.y.toFixed(1) + 'L' + pt.x.toFixed(1) + ' ' + ty.toFixed(1) + 'L' + tx.toFixed(1) + ' ' + ty.toFixed(1);
    return '<path d="' + d + '" fill="none" stroke="rgba(17,18,20,0.32)" stroke-width="1.4"/>' +
      '<circle cx="' + pt.x.toFixed(1) + '" cy="' + pt.y.toFixed(1) + '" r="4.6" fill="' + INK + '" stroke="#fff" stroke-width="1.8"/>' +
      '<text x="' + lx.toFixed(1) + '" y="' + (ty + 7).toFixed(1) + '" text-anchor="' + anchor + '" font-family="' + FONT +
      '" font-weight="700" font-size="' + size + '" fill="' + INK + '">' + esc(text) + '</text>';
  }
  function drawCallouts(p, feats, rect, cardW, key, format) {
    if (!feats.length) return '';
    var pts = feats.map(function (f) { return featurePoint(p, f); });
    var xs = pts.filter(Boolean).map(function (q) { return q.x; });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var split = (maxX - minX) > rect.w * 0.30;
    var rightFeat = [], leftFeat = [];
    feats.forEach(function (f, i) {
      var q = pts[i]; if (!q) return;
      (split && q.x < minX + rect.w * 0.22 ? leftFeat : rightFeat).push({ f: f, x: q.x });
    });
    rightFeat.sort(function (a, b) { return a.x - b.x; });
    leftFeat.sort(function (a, b) { return a.x - b.x; });
    var out = '';
    var rlx = Math.min(rect.x + rect.w + 26, cardW - 40);
    var top = rect.y + 60, bot = rect.y + rect.h - 40;
    rightFeat.forEach(function (o, i) {
      var ty = rightFeat.length === 1 ? (top + bot) / 2 : top + (bot - top) * i / (rightFeat.length - 1);
      out += guide(p, o.f, featureLabel(o.f, key, format), rlx, ty, 'start', 22);
    });
    leftFeat.forEach(function (o, i) {
      var ty = rect.y + rect.h + 46 + i * 40;
      out += guide(p, o.f, featureLabel(o.f, key, format), 28, ty, 'start', 22);
    });
    return out;
  }

  // ── Composición ──
  function build(opts) {
    opts = opts || {};
    var geo = opts.geojson;
    var W = SIZE, H = SIZE, M = 56;
    var title = opts.title || 'Untitled map';
    var subtitle = opts.subtitle || '';
    var source = opts.source || '';
    var b = (geo && bounds(geo)) || null;

    var lines = wrap(title, W - M * 2, 62);
    var titleTop = 150, lead = 72;
    var subY = titleTop + (lines.length - 1) * lead + 44;
    var titleSvg = lines.map(function (ln, i) {
      return '<text x="' + M + '" y="' + (titleTop + i * lead) + '" font-family="' + FONT + '" font-weight="800" font-size="62" letter-spacing="-1.2" fill="' + INK + '">' + esc(ln) + '</text>';
    }).join('');
    var subSvg = subtitle ? '<text x="' + (M + 2) + '" y="' + subY + '" font-family="' + FONT + '" font-weight="500" font-size="19" fill="' + GRAY + '">' + esc(subtitle) + '</text>' : '';

    var key = opts.valueKey || (geo ? detectValueKey(geo) : null);
    var feats = (key && geo) ? topFeatures(geo, key, 5) : [];
    var ranked = feats.length >= 3;

    var mapTop = subY + 30, mapBottom = H - 96;
    var rect;
    if (ranked) rect = { x: M, y: mapTop, w: Math.round(W * 0.58), h: mapBottom - mapTop };
    else rect = { x: M, y: mapTop, w: W - M * 2, h: mapBottom - mapTop };

    var mapSvg = '';
    var proj = null;
    if (geo && b) {
      proj = fit(b, rect);
      proj.minX0 = b.minX; proj.maxX0 = b.maxX;
      mapSvg = drawFeatures(proj, geo, opts);
    } else {
      mapSvg = '<text x="' + (W / 2) + '" y="' + ((mapTop + mapBottom) / 2) + '" text-anchor="middle" font-family="' + FONT + '" font-size="22" fill="' + GRAY + '">Sin vista previa</text>';
    }
    var calls = (ranked && proj) ? drawCallouts(proj, feats, rect, W, key, opts.legendFormat) : '';
    var sourceSvg = source ? '<text x="' + (W - M) + '" y="' + (H - 40) + '" text-anchor="end" font-family="' + FONT + '" font-weight="400" font-size="16" fill="' + GRAY + '">' + esc(source) + '</text>' : '';

    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
      '<rect width="' + W + '" height="' + H + '" fill="' + LIGHT + '"/>' +
      symbol(M, 54, INK, LIGHT, 46) +
      titleSvg + subSvg +
      mapSvg + calls + sourceSvg +
    '</svg>';
  }

  // ── Rasterizado ──
  function rasterize(svg, size, scale) {
    scale = scale || 2;
    return new Promise(function (resolve, reject) {
      var url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas');
        c.width = size * scale; c.height = size * scale;
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c);
      };
      img.onerror = function () { reject(new Error('No se pudo rasterizar la tarjeta')); };
      img.src = url;
    });
  }
  function toBlob(opts) {
    return rasterize(build(opts), SIZE, opts && opts.scale).then(function (c) {
      return new Promise(function (res) { c.toBlob(function (bl) { res(bl); }, 'image/png'); });
    });
  }
  function slugify(s) { return String(s || 'mapa').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40); }
  function filenameFor(t) { return slugify(t) + '.png'; }
  function downloadBlob(blob, filename) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || 'mapa.png';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }
  function shareBlob(blob, title) {
    var name = filenameFor(title), file = null;
    try { file = new File([blob], name, { type: 'image/png' }); } catch (e) {}
    if (file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      return navigator.share({ files: [file], title: title || '' });
    }
    downloadBlob(blob, name);
    return Promise.resolve();
  }
  function download(opts) { return toBlob(opts).then(function (bl) { downloadBlob(bl, filenameFor(opts && opts.title)); }); }
  function share(opts) { return toBlob(opts).then(function (bl) { return shareBlob(bl, opts && opts.title); }); }

  window.ManaShareCard = {
    SIZE: SIZE, build: build, toBlob: toBlob, filename: filenameFor,
    downloadBlob: downloadBlob, shareBlob: shareBlob, download: download, share: share
  };
})();
