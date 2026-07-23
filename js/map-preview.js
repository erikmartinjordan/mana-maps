// ── map-preview.js ─ shared map thumbnail previews (build + SVG render) ──
// Single source of truth used by: gallery page, public profiles, my-maps,
// and the publish flow (editor). Exposes window.ManaMapPreview.
//
// Preview data format (stored in Firestore `mapPreview`):
//   { bbox: [minLng, minLat, maxLng, maxLat],
//     kind: 'geometry' | 'density-grid',
//     gridSize: number | null,
//     cells: [{ x, y, n, c }] | null,
//     features: [{ geometry: { type, coordinatesText }, color }] }
//
// Rendering uses a Web Mercator projection and an aspect-correct viewBox so
// shapes keep their real-world proportions. Geometry simplification uses
// Douglas–Peucker (shape-preserving) instead of naive even sampling.

(function() {
  'use strict';

  var PREVIEW_MAX_FEATURES = 96;
  var PREVIEW_GRID_SIZE = 10;
  var PREVIEW_DENSITY_GRID_SIZE = 28;
  var PREVIEW_TOTAL_COORD_BUDGET = 2600;
  var PREVIEW_MIN_COORDS_PER_GEOMETRY = 48;
  var PREVIEW_MAX_COORDS_PER_GEOMETRY = 260;
  var DEFAULT_COLOR = '#0ea5e9';

  // ── numbers ──────────────────────────────────────────────────────────────

  function roundPreviewNumber(value) {
    var num = Number(value);
    if (!isFinite(num)) return null;
    return Number(num.toFixed(5));
  }

  function validColor(value) {
    return /^#[0-9a-f]{3,8}$/i.test(value || '') ? value : DEFAULT_COLOR;
  }

  function featureColor(feature) {
    var props = feature && feature.properties ? feature.properties : {};
    return validColor(props._manaColor || props.color);
  }

  // ── coordinate collection / bbox ────────────────────────────────────────

  function collectCoordPairs(coords, out) {
    if (!Array.isArray(coords)) return;
    if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      var x = roundPreviewNumber(coords[0]);
      var y = roundPreviewNumber(coords[1]);
      if (x !== null && y !== null) out.push([x, y]);
      return;
    }
    coords.forEach(function(child) { collectCoordPairs(child, out); });
  }

  function geoBBox(geo) {
    var points = [];
    geo.features.forEach(function(feature) {
      var geom = feature && feature.geometry;
      if (!geom || !Array.isArray(geom.coordinates)) return;
      collectCoordPairs(geom.coordinates, points);
    });
    if (!points.length) return null;
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    points.forEach(function(c) {
      minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0]);
      minY = Math.min(minY, c[1]); maxY = Math.max(maxY, c[1]);
    });
    return (isFinite(minX) && isFinite(maxX) && isFinite(minY) && isFinite(maxY))
      ? [minX, minY, maxX, maxY]
      : null;
  }

  function featureCenter(feature) {
    var geom = feature && feature.geometry;
    if (!geom || !Array.isArray(geom.coordinates)) return null;
    var coords = [];
    collectCoordPairs(geom.coordinates, coords);
    if (!coords.length) return null;
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    coords.forEach(function(c) {
      minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0]);
      minY = Math.min(minY, c[1]); maxY = Math.max(maxY, c[1]);
    });
    return isFinite(minX) && isFinite(maxX) && isFinite(minY) && isFinite(maxY)
      ? [(minX + maxX) / 2, (minY + maxY) / 2]
      : null;
  }

  // ── Douglas–Peucker simplification (iterative, shape-preserving) ────────

  function perpendicularDistanceSq(p, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1];
    var lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-18) {
      var ex = p[0] - a[0], ey = p[1] - a[1];
      return ex * ex + ey * ey;
    }
    var t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    var px = a[0] + t * dx - p[0], py = a[1] + t * dy - p[1];
    return px * px + py * py;
  }

  function douglasPeucker(points, toleranceSq) {
    var n = points.length;
    if (n <= 2) return points.slice();
    var keep = new Uint8Array(n);
    keep[0] = keep[n - 1] = 1;
    var stack = [[0, n - 1]];
    while (stack.length) {
      var seg = stack.pop();
      var first = seg[0], last = seg[1];
      var maxDist = 0, index = -1;
      for (var i = first + 1; i < last; i++) {
        var d = perpendicularDistanceSq(points[i], points[first], points[last]);
        if (d > maxDist) { maxDist = d; index = i; }
      }
      if (maxDist > toleranceSq && index > 0) {
        keep[index] = 1;
        stack.push([first, index], [index, last]);
      }
    }
    var out = [];
    for (var j = 0; j < n; j++) if (keep[j]) out.push(points[j]);
    return out;
  }

  function sampleArrayEvenly(items, maxItems) {
    if (!Array.isArray(items) || items.length <= maxItems) return items || [];
    if (maxItems <= 1) return [items[0]];
    var sampled = [];
    for (var i = 0; i < maxItems; i++) {
      sampled.push(items[Math.round(i * (items.length - 1) / (maxItems - 1))]);
    }
    return sampled;
  }

  function lineSpanSq(coords) {
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (var i = 0; i < coords.length; i++) {
      var c = coords[i];
      if (!Array.isArray(c) || c.length < 2) continue;
      minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0]);
      minY = Math.min(minY, c[1]); maxY = Math.max(maxY, c[1]);
    }
    if (!isFinite(minX)) return 0;
    var dx = maxX - minX, dy = maxY - minY;
    return dx * dx + dy * dy;
  }

  // Simplify a line/ring: Douglas–Peucker at ~0.35% of the geometry diagonal,
  // escalating tolerance if the result still exceeds the coordinate budget.
  function simplifyLine(coords, maxCoords, closed) {
    if (!Array.isArray(coords)) return [];
    var clean = [];
    for (var i = 0; i < coords.length; i++) {
      var p = Array.isArray(coords[i]) && coords[i].length >= 2
        ? [roundPreviewNumber(coords[i][0]), roundPreviewNumber(coords[i][1])]
        : null;
      if (p && p[0] !== null && p[1] !== null) clean.push(p);
    }
    if (clean.length <= maxCoords) return clean;
    var minLen = closed ? 4 : 2;
    var spanSq = lineSpanSq(clean);
    var factor = 0.0035;
    var out = clean;
    for (var attempt = 0; attempt < 6; attempt++) {
      var tolSq = spanSq * factor * factor;
      out = douglasPeucker(clean, tolSq);
      if (out.length <= maxCoords || out.length <= minLen) break;
      factor *= 2.2;
    }
    if (out.length > maxCoords) out = sampleArrayEvenly(out, maxCoords);
    if (closed && out.length >= 3) {
      var f = out[0], l = out[out.length - 1];
      if (f[0] !== l[0] || f[1] !== l[1]) out.push([f[0], f[1]]);
    }
    return out;
  }

  // ── geometry encoding ────────────────────────────────────────────────────

  function sanitizePreviewPoint(coord) {
    if (!Array.isArray(coord) || coord.length < 2) return null;
    var x = roundPreviewNumber(coord[0]);
    var y = roundPreviewNumber(coord[1]);
    return x === null || y === null ? null : [x, y];
  }

  function simplifyPreviewPolygon(poly, maxCoords) {
    if (!Array.isArray(poly)) return [];
    return poly.map(function(ring) {
      return simplifyLine(ring, maxCoords, true);
    }).filter(function(ring) { return ring.length >= 4; });
  }

  function simplifyPreviewGeometry(geometry, maxCoords) {
    if (!geometry || !geometry.type || !Array.isArray(geometry.coordinates)) return null;
    var coords = geometry.coordinates;
    if (geometry.type === 'Point') {
      coords = sanitizePreviewPoint(coords);
    } else if (geometry.type === 'MultiPoint' || geometry.type === 'LineString') {
      coords = geometry.type === 'MultiPoint'
        ? sampleArrayEvenly(coords.map(sanitizePreviewPoint).filter(Boolean), maxCoords)
        : simplifyLine(coords, maxCoords, false);
    } else if (geometry.type === 'MultiLineString' || geometry.type === 'Polygon') {
      if (geometry.type === 'MultiLineString') {
        coords = coords.map(function(line) { return simplifyLine(line, maxCoords, false); })
          .filter(function(line) { return line.length >= 2; });
      } else {
        coords = simplifyPreviewPolygon(coords, maxCoords);
      }
    } else if (geometry.type === 'MultiPolygon') {
      coords = coords.map(function(poly) {
        return simplifyPreviewPolygon(poly, maxCoords);
      }).filter(function(poly) { return poly.length; });
    } else {
      return null;
    }
    if (!coords || (Array.isArray(coords) && !coords.length)) return null;
    return { type: geometry.type, coordinatesText: JSON.stringify(coords) };
  }

  // ── feature selection (spatially balanced) ──────────────────────────────

  function previewFeatureIndexes(features, maxFeatures, bbox) {
    var count = Array.isArray(features) ? features.length : 0;
    if (!count) return [];
    var target = Math.min(count, maxFeatures);
    if (count <= target) return features.map(function(_, index) { return index; });

    var minX = Number(bbox && bbox[0]); var minY = Number(bbox && bbox[1]);
    var maxX = Number(bbox && bbox[2]); var maxY = Number(bbox && bbox[3]);
    if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
      return sampleArrayEvenly(features.map(function(_, index) { return index; }), target);
    }
    var spanX = Math.max(maxX - minX, 1e-9);
    var spanY = Math.max(maxY - minY, 1e-9);
    var buckets = {};

    features.forEach(function(feature, index) {
      var center = featureCenter(feature);
      if (!center) return;
      var gx = Math.max(0, Math.min(PREVIEW_GRID_SIZE - 1, Math.floor(((center[0] - minX) / spanX) * PREVIEW_GRID_SIZE)));
      var gy = Math.max(0, Math.min(PREVIEW_GRID_SIZE - 1, Math.floor(((center[1] - minY) / spanY) * PREVIEW_GRID_SIZE)));
      var key = gx + ':' + gy;
      var cellCenterX = minX + ((gx + 0.5) / PREVIEW_GRID_SIZE) * spanX;
      var cellCenterY = minY + ((gy + 0.5) / PREVIEW_GRID_SIZE) * spanY;
      var dist = Math.pow(center[0] - cellCenterX, 2) + Math.pow(center[1] - cellCenterY, 2);
      if (!buckets[key]) buckets[key] = [];
      buckets[key].push({ index: index, dist: dist });
    });

    var bucketList = Object.keys(buckets).sort().map(function(key) {
      return buckets[key].sort(function(a, b) { return a.dist - b.dist; });
    });
    if (!bucketList.length) return sampleArrayEvenly(features.map(function(_, index) { return index; }), target);

    var selected = [];
    var used = {};
    var cursor = 0;
    while (selected.length < target) {
      var added = false;
      bucketList.forEach(function(bucket) {
        if (selected.length >= target) return;
        var candidate = bucket[cursor];
        if (candidate && !used[candidate.index]) {
          used[candidate.index] = true;
          selected.push(candidate.index);
          added = true;
        }
      });
      if (!added) break;
      cursor++;
    }
    if (selected.length < target) {
      sampleArrayEvenly(features.map(function(_, index) { return index; }), target).forEach(function(index) {
        if (selected.length < target && !used[index]) {
          used[index] = true;
          selected.push(index);
        }
      });
    }
    return selected.sort(function(a, b) { return a - b; });
  }

  function buildDensityCells(features, bbox) {
    var minX = Number(bbox && bbox[0]); var minY = Number(bbox && bbox[1]);
    var maxX = Number(bbox && bbox[2]); var maxY = Number(bbox && bbox[3]);
    if (!Array.isArray(features) || !isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return [];
    var spanX = Math.max(maxX - minX, 1e-9);
    var spanY = Math.max(maxY - minY, 1e-9);
    var cells = {};
    features.forEach(function(feature) {
      var center = featureCenter(feature);
      if (!center) return;
      var x = Math.max(0, Math.min(PREVIEW_DENSITY_GRID_SIZE - 1, Math.floor(((center[0] - minX) / spanX) * PREVIEW_DENSITY_GRID_SIZE)));
      var y = Math.max(0, Math.min(PREVIEW_DENSITY_GRID_SIZE - 1, Math.floor(((maxY - center[1]) / spanY) * PREVIEW_DENSITY_GRID_SIZE)));
      var key = x + ':' + y;
      if (!cells[key]) cells[key] = { x: x, y: y, n: 0, c: featureColor(feature) };
      cells[key].n += 1;
    });
    return Object.keys(cells).map(function(key) { return cells[key]; });
  }

  // ── public: build ────────────────────────────────────────────────────────

  function buildMapPreview(geo) {
    if (!geo || !Array.isArray(geo.features) || !geo.features.length) return null;
    var bbox = geoBBox(geo);
    if (!bbox) return null;
    var isLargePreview = geo.features.length > PREVIEW_MAX_FEATURES;
    var cells = isLargePreview ? buildDensityCells(geo.features, bbox) : [];
    var coordBudget = Math.max(
      PREVIEW_MIN_COORDS_PER_GEOMETRY,
      Math.min(PREVIEW_MAX_COORDS_PER_GEOMETRY, Math.floor(PREVIEW_TOTAL_COORD_BUDGET / geo.features.length))
    );
    var entries = isLargePreview ? [] : previewFeatureIndexes(geo.features, PREVIEW_MAX_FEATURES, bbox).map(function(index) {
      var feature = geo.features[index];
      return {
        geometry: simplifyPreviewGeometry(feature ? feature.geometry : null, coordBudget),
        color: featureColor(feature)
      };
    }).filter(function(entry) { return !!entry.geometry; });
    return (cells.length || entries.length) ? {
      bbox: bbox,
      kind: cells.length ? 'density-grid' : 'geometry',
      gridSize: cells.length ? PREVIEW_DENSITY_GRID_SIZE : null,
      cells: cells.length ? cells : null,
      features: entries
    } : null;
  }

  // ── SVG rendering (Web Mercator, aspect-correct, styled) ─────────────────

  var MERCATOR_MAX_LAT = 85.051129;

  function mercatorY(lat) {
    var clamped = Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, lat));
    var rad = clamped * Math.PI / 180;
    return Math.log(Math.tan(Math.PI / 4 + rad / 2));
  }

  function renderMapPreviewSVG(preview) {
    if (!preview || !Array.isArray(preview.bbox)) return '';
    var bbox = preview.bbox;
    var minX = Number(bbox[0]); var minY = Number(bbox[1]); var maxX = Number(bbox[2]); var maxY = Number(bbox[3]);
    if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return '';

    // Project to Web Mercator so shapes keep real-world proportions.
    var pMinX = minX * Math.PI / 180, pMaxX = maxX * Math.PI / 180;
    var pMinY = mercatorY(minY), pMaxY = mercatorY(maxY);
    var spanX = Math.max(pMaxX - pMinX, 1e-9);
    var spanY = Math.max(pMaxY - pMinY, 1e-9);

    // Aspect-correct canvas (largest side = 100) + breathing room.
    var aspect = spanX / spanY;
    var w = aspect >= 1 ? 100 : 100 * aspect;
    var h = aspect >= 1 ? 100 / aspect : 100;
    var padX = w * 0.09 + 2.5, padY = h * 0.09 + 2.5;
    var viewW = w + 2 * padX, viewH = h + 2 * padY;

    function toX(x) { return ((x * Math.PI / 180 - pMinX) / spanX) * w + padX; }
    function toY(y) { return ((pMaxY - mercatorY(y)) / spanY) * h + padY; }

    // Stroke scale: relative to canvas so previews look consistent at any aspect.
    var unit = Math.min(viewW, viewH) / 100;

    function renderDensityCells() {
      if (!Array.isArray(preview.cells) || !preview.cells.length) return '';
      var grid = Math.max(1, Number(preview.gridSize) || PREVIEW_DENSITY_GRID_SIZE);
      var sizeX = w / grid, sizeY = h / grid;
      var maxCount = preview.cells.reduce(function(max, cell) {
        return Math.max(max, Number(cell && cell.n) || 1);
      }, 1);
      return preview.cells.map(function(cell) {
        var x = Number(cell && cell.x); var y = Number(cell && cell.y);
        if (!isFinite(x) || !isFinite(y)) return '';
        var count = Math.max(1, Number(cell.n) || 1);
        var opacity = Math.min(0.9, 0.3 + Math.sqrt(count / maxCount) * 0.55);
        var cellW = Math.max(sizeX - 0.35, 1.1);
        var cellH = Math.max(sizeY - 0.35, 1.1);
        return '<rect x="' + (padX + x * sizeX).toFixed(2) + '" y="' + (padY + y * sizeY).toFixed(2) +
          '" width="' + cellW.toFixed(2) + '" height="' + cellH.toFixed(2) +
          '" rx="' + (Math.min(cellW, cellH) * 0.32).toFixed(2) +
          '" fill="' + validColor(cell.c) + '" fill-opacity="' + opacity.toFixed(2) + '"/>';
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

    function lineToPath(line, close) {
      if (!Array.isArray(line)) return '';
      var d = '';
      for (var i = 0; i < line.length; i++) {
        var p = pointToString(line[i]);
        if (!p) continue;
        d += (d ? 'L' : 'M') + p.replace(',', ' ');
      }
      return d ? d + (close ? ' Z' : '') : '';
    }

    var body = renderDensityCells();

    if (Array.isArray(preview.features)) {
      // Two passes: fills first, then lines, then points (proper layering).
      var fills = '', lines = '', points = '';
      preview.features.forEach(function(entry) {
        var geom = decodePreviewGeometry(entry && entry.geometry);
        if (!geom) return;
        var stroke = validColor(entry.color);
        var i, p;
        if (geom.type === 'Polygon' && Array.isArray(geom.coordinates)) {
          var d = '';
          geom.coordinates.forEach(function(ring) { d += lineToPath(ring, true); });
          if (d) fills += '<path d="' + d + '" fill="' + stroke + '" fill-opacity="0.16" stroke="' + stroke +
            '" stroke-opacity="0.9" stroke-width="' + (1.5 * unit).toFixed(2) + '" stroke-linejoin="round"/>';
        } else if (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates)) {
          geom.coordinates.forEach(function(poly) {
            var d = '';
            poly.forEach(function(ring) { d += lineToPath(ring, true); });
            if (d) fills += '<path d="' + d + '" fill="' + stroke + '" fill-opacity="0.16" stroke="' + stroke +
              '" stroke-opacity="0.9" stroke-width="' + (1.5 * unit).toFixed(2) + '" stroke-linejoin="round"/>';
          });
        } else if (geom.type === 'LineString' && Array.isArray(geom.coordinates)) {
          var dl = lineToPath(geom.coordinates, false);
          if (dl) lines += '<path d="' + dl + '" fill="none" stroke="#ffffff" stroke-opacity="0.75" stroke-width="' + (3.6 * unit).toFixed(2) +
            '" stroke-linecap="round" stroke-linejoin="round"/>' +
            '<path d="' + dl + '" fill="none" stroke="' + stroke + '" stroke-width="' + (2 * unit).toFixed(2) +
            '" stroke-linecap="round" stroke-linejoin="round"/>';
        } else if (geom.type === 'MultiLineString' && Array.isArray(geom.coordinates)) {
          geom.coordinates.forEach(function(lineCoords) {
            var dl = lineToPath(lineCoords, false);
            if (dl) lines += '<path d="' + dl + '" fill="none" stroke="#ffffff" stroke-opacity="0.75" stroke-width="' + (3.6 * unit).toFixed(2) +
              '" stroke-linecap="round" stroke-linejoin="round"/>' +
              '<path d="' + dl + '" fill="none" stroke="' + stroke + '" stroke-width="' + (2 * unit).toFixed(2) +
              '" stroke-linecap="round" stroke-linejoin="round"/>';
          });
        } else if (geom.type === 'Point' && Array.isArray(geom.coordinates)) {
          p = pointToString(geom.coordinates).split(',');
          if (p.length === 2) points += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + (3.6 * unit).toFixed(2) +
            '" fill="#ffffff" fill-opacity="0.9"/>' +
            '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + (2.5 * unit).toFixed(2) + '" fill="' + stroke + '"/>';
        } else if (geom.type === 'MultiPoint' && Array.isArray(geom.coordinates)) {
          for (i = 0; i < geom.coordinates.length; i++) {
            p = pointToString(geom.coordinates[i]).split(',');
            if (p.length === 2) points += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + (3.2 * unit).toFixed(2) +
              '" fill="#ffffff" fill-opacity="0.9"/>' +
              '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + (2.2 * unit).toFixed(2) + '" fill="' + stroke + '"/>';
          }
        }
      });
      body += fills + lines + points;
    }

    if (!body) return '';
    return '<svg class="thumb-preview" viewBox="0 0 ' + viewW.toFixed(2) + ' ' + viewH.toFixed(2) +
      '" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' + body + '</svg>';
  }

  window.ManaMapPreview = {
    build: buildMapPreview,
    renderSVG: renderMapPreviewSVG
  };
})();
