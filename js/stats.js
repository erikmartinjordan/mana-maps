// ═══════════════════════════════════════════════════════
// js/stats.js — Panel de estadísticas del mapa
// Módulo nuevo para Maña Maps
// ═══════════════════════════════════════════════════════

let _statsPanelOpen = false;

// ═══ ABRIR / CERRAR ═══
function openStatsPanel() {
  const panel = document.getElementById('stats-panel');
  if (!panel) return;
  _statsPanelOpen = true;
  panel.classList.add('open');
  refreshStatsPanel();
}

function closeStatsPanel() {
  const panel = document.getElementById('stats-panel');
  if (!panel) return;
  _statsPanelOpen = false;
  panel.classList.remove('open');
}

function toggleStatsPanel() {
  _statsPanelOpen ? closeStatsPanel() : openStatsPanel();
}

// ═══ CÁLCULO DE ESTADÍSTICAS ═══
function computeMapStats() {
  var result = {
    total: 0, points: 0, lines: 0, polygons: 0,
    totalLengthM: 0, totalAreaM2: 0,
    bounds: null, groupCount: 0, wmsCount: 0, attributes: {}
  };

  // Contar WMS activos
  if (typeof _wmsOverlays !== 'undefined' && Array.isArray(_wmsOverlays)) {
    result.wmsCount = _wmsOverlays.filter(function(w) { return w.visible; }).length;
  }

  // Iterar features
  if (typeof drawnItems !== 'undefined') {
    try {
      var b = drawnItems.getBounds();
      if (b.isValid()) result.bounds = b;
    } catch (e) {}

    drawnItems.eachLayer(function(layer) {
      if (layer instanceof L.LayerGroup || layer instanceof L.GeoJSON) {
        layer.eachLayer(function(sub) { _analyzeLayer(sub, result); });
      } else {
        _analyzeLayer(layer, result);
      }
    });
  }

  // Contar grupos
  if (typeof _manaGroupMeta !== 'undefined') {
    result.groupCount = Object.keys(_manaGroupMeta).length;
  }

  return result;
}

function _analyzeLayer(layer, s) {
  s.total++;

  if (layer instanceof L.CircleMarker || layer instanceof L.Marker) {
    s.points++;
  } else if (layer instanceof L.Polygon) {
    s.polygons++;
    var latlngs = layer.getLatLngs();
    s.totalAreaM2 += _calcPolygonArea(latlngs);
    s.totalLengthM += _calcPolylineLength(latlngs[0] || latlngs);
  } else if (layer instanceof L.Polyline) {
    s.lines++;
    s.totalLengthM += _calcPolylineLength(layer.getLatLngs());
  }

  // Recoger atributos de features GeoJSON
  var props = (layer.feature && layer.feature.properties) || layer._manaProperties;
  if (props) {
    Object.keys(props).forEach(function(key) {
      if (key.startsWith('_') || key === 'bbox') return;
      var val = props[key];
      if (val === null || val === undefined) return;
      if (!s.attributes[key]) s.attributes[key] = { values: [], numeric: true };
      if (s.attributes[key].values.length < 500) s.attributes[key].values.push(val);
      if (isNaN(Number(val))) s.attributes[key].numeric = false;
    });
  }
}

// --- Cálculo de longitud de polilínea (metros) ---
function _calcPolylineLength(latlngs) {
  if (!latlngs || latlngs.length === 0) return 0;
  if (Array.isArray(latlngs[0]) && !latlngs[0].lat) {
    return latlngs.reduce(function(sum, part) { return sum + _calcPolylineLength(part); }, 0);
  }
  var total = 0;
  for (var i = 1; i < latlngs.length; i++) {
    total += latlngs[i - 1].distanceTo(latlngs[i]);
  }
  return total;
}

// --- Cálculo de área de polígono (m², fórmula esférica) ---
function _calcPolygonArea(latlngs) {
  if (typeof L.GeometryUtil !== 'undefined' && L.GeometryUtil.geodesicArea) {
    var ring = Array.isArray(latlngs[0]) ? latlngs[0] : latlngs;
    return Math.abs(L.GeometryUtil.geodesicArea(ring));
  }
  var ring = Array.isArray(latlngs[0]) ? latlngs[0] : latlngs;
  if (!ring || ring.length < 3) return 0;
  var area = 0, R = 6371000;
  for (var i = 0; i < ring.length; i++) {
    var j = (i + 1) % ring.length;
    var xi = ring[i].lng * Math.PI / 180;
    var yi = ring[i].lat * Math.PI / 180;
    var xj = ring[j].lng * Math.PI / 180;
    var yj = ring[j].lat * Math.PI / 180;
    area += (xj - xi) * (2 + Math.sin(yi) + Math.sin(yj));
  }
  return Math.abs(area * R * R / 2);
}

// ═══ RENDERIZADO DEL PANEL ═══
function refreshStatsPanel() {
  if (!_statsPanelOpen) return;
  var panel = document.getElementById('stats-panel');
  if (!panel) return;

  var s = computeMapStats();

  var lengthKm = (s.totalLengthM / 1000).toFixed(2);
  var areaKm2  = (s.totalAreaM2 / 1000000).toFixed(4);
  var areaHa   = (s.totalAreaM2 / 10000).toFixed(2);

  var boundsStr = '\u2014';
  if (s.bounds) {
    var sw = s.bounds.getSouthWest();
    var ne = s.bounds.getNorthEast();
    boundsStr = sw.lat.toFixed(4) + '\u00b0, ' + sw.lng.toFixed(4) + '\u00b0 \u2192 ' + ne.lat.toFixed(4) + '\u00b0, ' + ne.lng.toFixed(4) + '\u00b0';
  }

  var html =
    '<div class="stats-panel-header">' +
    '  <span class="stats-panel-title">' +
    '    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '      <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>' +
    '    </svg>' +
    '    Estad\u00edsticas' +
    '  </span>' +
    '  <button class="stats-panel-close" onclick="closeStatsPanel()">' +
    '    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">' +
    '      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>' +
    '    </svg>' +
    '  </button>' +
    '</div>' +

    // Resumen
    '<div class="stats-section">' +
    '  <div class="stats-section-label">' + (LANG==='en'?'Summary':'Resumen') + '</div>' +
    '  <div class="stats-grid">' +
    '    <div class="stats-card">' +
    '      <span class="stats-card-val">' + s.total + '</span>' +
    '      <span class="stats-card-label">Total</span>' +
    '    </div>' +
    '    <div class="stats-card" style="--accent: var(--blue);">' +
    '      <span class="stats-card-val">' + s.points + '</span>' +
    '      <span class="stats-card-label">' + t('stat_points') + '</span>' +
    '    </div>' +
    '    <div class="stats-card" style="--accent: var(--green);">' +
    '      <span class="stats-card-val">' + s.lines + '</span>' +
    '      <span class="stats-card-label">' + t('stat_lines') + '</span>' +
    '    </div>' +
    '    <div class="stats-card" style="--accent: #f97316;">' +
    '      <span class="stats-card-val">' + s.polygons + '</span>' +
    '      <span class="stats-card-label">' + t('stat_polygons') + '</span>' +
    '    </div>' +
    '  </div>' +
    '</div>' +

    // Geometría
    '<div class="stats-section">' +
    '  <div class="stats-section-label">' + t('stats_geometry') + '</div>' +
    '  <div class="stats-row"><span>' + t('stats_total_length') + '</span><strong>' + lengthKm + ' km</strong></div>' +
    '  <div class="stats-row"><span>' + t('stats_total_area') + '</span><strong>' + areaKm2 + ' km\u00b2 (' + areaHa + ' ha)</strong></div>' +
    '  <div class="stats-row"><span>Extensi\u00f3n</span><span class="stats-mono">' + boundsStr + '</span></div>' +
    '</div>' +

    // Capas y WMS
    '<div class="stats-section">' +
    '  <div class="stats-section-label">' + t('panel_layers_title') + '</div>' +
    '  <div class="stats-row"><span>Grupos de datos</span><strong>' + s.groupCount + '</strong></div>' +
    '  <div class="stats-row"><span>' + t('stats_wms_layers') + '</span><strong>' + s.wmsCount + '</strong></div>' +
    '</div>';

  // Atributos (top 5 campos)
  var attrKeys = Object.keys(s.attributes);
  if (attrKeys.length > 0) {
    html += '<div class="stats-section">' +
      '<div class="stats-section-label">Atributos (top campos)</div>';

    attrKeys.slice(0, 5).forEach(function(key) {
      var attr = s.attributes[key];
      html += '<div class="stats-attr-field">' + key;

      if (attr.numeric) {
        var nums = attr.values.filter(function(v) { return v !== null && v !== undefined; }).map(Number);
        if (nums.length > 0) {
          var min = Math.min.apply(null, nums).toFixed(2);
          var max = Math.max.apply(null, nums).toFixed(2);
          var avg = (nums.reduce(function(a, b) { return a + b; }, 0) / nums.length).toFixed(2);
          html += ' <span class="stats-attr-meta">min: ' + min + ' \u00b7 max: ' + max + ' \u00b7 avg: ' + avg + '</span>';
        }
      } else {
        var freq = {};
        attr.values.forEach(function(v) { var k = String(v); freq[k] = (freq[k] || 0) + 1; });
        var sorted = Object.keys(freq).map(function(k) { return [k, freq[k]]; });
        sorted.sort(function(a, b) { return b[1] - a[1]; });
        var top3 = sorted.slice(0, 3).map(function(x) { return x[0] + ' (' + x[1] + ')'; }).join(', ');
        html += ' <span class="stats-attr-meta">' + top3 + '</span>';
      }

      html += '</div>';
    });
    html += '</div>';
  }

  panel.innerHTML = html;
}

// ═══ HACER STAT-PILLS CLICABLES ═══
document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('.stat-pill:not(.shortcuts-pill)').forEach(function(pill) {
    pill.style.cursor = 'pointer';
    pill.style.pointerEvents = 'auto';
    pill.addEventListener('click', toggleStatsPanel);
  });
});

// Refrescar panel automáticamente si está abierto (cada 2s)
setInterval(function() {
  if (_statsPanelOpen) refreshStatsPanel();
}, 2000);
