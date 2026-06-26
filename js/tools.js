// ── tools.js ─ Drawing tools, ruler & geometry editing ──

let activeTool = null, drawHandler = null;

// Select tool state (declared early so stopAll can reference it)
var _selectMode = false;
var _selBox = null;
var _selStart = null;
var _selDragging = false;
var _SEL_DRAG_THRESHOLD = 5;

// ── P1.2: Edit mode state ──
let editMode = false;
let _routeStart = null;
let _routeEnd = null;
let _routePreviewLine = null;
let _routePreviewGlow = null;
let _routePreviewCoords = null;
let _routeAbortController = null;
let _routeRequestId = 0;
const _routeCache = new Map();
let _routePendingConfirm = false;

function stopAll() {
  if (drawHandler) { try { drawHandler.disable(); } catch (e) {} drawHandler = null; }
  _resetSelectedRouteFlow();
  stopRuler();
  if (_selectMode) stopSelect();
  document.getElementById('draw-hint').style.display = 'none';
  document.getElementById('map').classList.remove('draw-point-mode');
  document.querySelectorAll('.draw-btn').forEach(b => b.classList.remove('active'));
  var tbRuler = document.getElementById('tb-ruler');
  if (tbRuler) tbRuler.classList.remove('active');
  activeTool = null;
}

function setTool(tool) {
  if (window.manaSharedAccess && window.manaSharedAccess.canEdit === false) {
    if (typeof showToast === 'function') showToast((typeof LANG !== 'undefined' && LANG === 'en') ? 'This shared map is view only.' : 'Este mapa compartido es de solo lectura.');
    return;
  }
  // Exit edit mode if entering a draw tool
  if (editMode) stopEdit();
  // Exit select mode if entering another tool
  if (_selectMode && tool !== 'select') stopSelect();

  if (activeTool === tool) { stopAll(); return; }
  stopAll();
  activeTool = tool;
  var btn = document.getElementById('btn-' + tool);
  if (btn) btn.classList.add('active');
  // Also highlight toolbar ruler icon
  if (tool === 'ruler') { var tbR = document.getElementById('tb-ruler'); if (tbR) tbR.classList.add('active'); }
  const hint = document.getElementById('draw-hint');
  hint.style.display = 'block';
  const shapeOpts = { shapeOptions: { color: drawColor, weight: 2, fillOpacity: .18 } };

  if (tool === 'point') {
    // Ensure active group is compatible with points
    getOrCreateActiveGroup('point');
    hint.textContent = t('hint_point');
    document.getElementById('map').classList.add('draw-point-mode');
    map.once('click', async e => {
      stopAll();
      const name = await askName(t('name_point'), t('default_point_name'));
      if (name === null) return;
      if (typeof pushUndo === 'function') pushUndo();
      const icon = makeMarkerIcon(drawColor, markerType);
      const m = L.marker(e.latlng, { icon });
      m._manaName = name; m._manaColor = drawColor; m._manaMarkerType = markerType;
      m.bindPopup('<strong>' + name + '</strong>');
      addDrawnLayerToGroup(m);
    });
  } else if (tool === 'line') {
    // Ensure active group is compatible with lines
    getOrCreateActiveGroup('line');
    hint.textContent = t('hint_line');
    drawHandler = new L.Draw.Polyline(map, shapeOpts);
    drawHandler.enable();
  } else if (tool === 'polygon') {
    // Ensure active group is compatible with polygons
    getOrCreateActiveGroup('polygon');
    hint.textContent = t('hint_polygon');
    drawHandler = new L.Draw.Polygon(map, shapeOpts);
    drawHandler.enable();
  } else if (tool === 'ruler') {
    hint.textContent = t('hint_ruler');
    startRuler();
  } else if (tool === 'select') {
    hint.textContent = t('hint_select') || 'Clic en un elemento para seleccionarlo (Shift+clic para selección múltiple)';
    startSelect();
  }
}

function _resetSelectedRouteFlow() {
  if (_routeAbortController) _routeAbortController.abort();
  _routeAbortController = null;
  _routeStart = null;
  _routeEnd = null;
  _routePreviewCoords = null;
  _routePendingConfirm = false;
  if (_routePreviewLine) { map.removeLayer(_routePreviewLine); _routePreviewLine = null; }
  if (_routePreviewGlow) { map.removeLayer(_routePreviewGlow); _routePreviewGlow = null; }
}

function _routeKey(a, b) {
  const p = n => Number(n).toFixed(5);
  return p(a.lat) + ',' + p(a.lng) + '|' + p(b.lat) + ',' + p(b.lng);
}

const fetchRouteOptimistic = _debounce(async function(commitWhenReady) {
  if (!_routeStart || !_routeEnd) return;
  drawRoutePreview([_routeStart, _routeEnd]);
  document.getElementById('draw-hint').textContent = t('hint_route_loading');
  const key = _routeKey(_routeStart, _routeEnd);
  if (_routeCache.has(key)) {
    const cached = _routeCache.get(key);
    _routePreviewCoords = cached.coords;
    drawRoutePreview(cached.coords);
    document.getElementById('draw-hint').textContent = commitWhenReady ? t('hint_route_loading') : t('hint_route_confirm');
    if (commitWhenReady) commitRouteLine(cached.coords);
    return;
  }
  if (_routeAbortController) _routeAbortController.abort();
  const reqId = ++_routeRequestId;
  _routeAbortController = new AbortController();
  try {
    const url = 'https://router.project-osrm.org/route/v1/driving/' +
      _routeStart.lng + ',' + _routeStart.lat + ';' + _routeEnd.lng + ',' + _routeEnd.lat + '?overview=full&geometries=geojson';
    const resp = await fetch(url, { signal: _routeAbortController.signal });
    if (!resp.ok) throw new Error('routing failed');
    const data = await resp.json();
    const route = data && data.routes && data.routes[0];
    if (!route || reqId !== _routeRequestId) return;
    const coords = route.geometry.coordinates.map(c => [c[1], c[0]]);
    _routeCache.set(key, { coords: coords });
    _routePreviewCoords = coords;
    drawRoutePreview(coords);
    if (commitWhenReady) commitRouteLine(coords);
    else document.getElementById('draw-hint').textContent = t('hint_route_confirm');
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    if (_routePreviewLine) _routePreviewLine.setStyle({ color: '#ef4444', dashArray: '4 8' });
    document.getElementById('draw-hint').textContent = t('hint_route_fallback');
    setTimeout(function() {
      if (activeTool === 'route') document.getElementById('draw-hint').textContent = t('hint_route_start');
    }, 1200);
  } finally {
    _routeAbortController = null;
    if (commitWhenReady) _routePendingConfirm = false;
  }
}, 120);

function drawRoutePreview(coords) {
  if (_routePreviewLine) map.removeLayer(_routePreviewLine);
  if (_routePreviewGlow) map.removeLayer(_routePreviewGlow);
  _routePreviewGlow = L.polyline(coords, {
    color: '#67e8f9', weight: 10, opacity: 0.2, className: 'route-preview-glow'
  }).addTo(map);
  _routePreviewLine = L.polyline(coords, {
    color: '#0ea5e9', weight: 5, opacity: 0.95, dashArray: '14 10', className: 'route-preview-shine'
  }).addTo(map);
}

function commitRouteLine(coords) {
  if (typeof pushUndo === 'function') pushUndo();
  if (_routePreviewLine) { map.removeLayer(_routePreviewLine); _routePreviewLine = null; }
  if (_routePreviewGlow) { map.removeLayer(_routePreviewGlow); _routePreviewGlow = null; }
  const line = L.polyline(coords, { color: drawColor, weight: 4, opacity: 0.9 });
  line._manaName = (typeof LANG !== 'undefined' && LANG === 'en') ? 'Route' : 'Ruta';
  addDrawnLayerToGroup(line);
  map.fitBounds(line.getBounds(), { padding: [40, 40] });
  document.getElementById('draw-hint').textContent = t('hint_route_ready');
  _routeStart = null;
  _routeEnd = null;
  _routePreviewCoords = null;
  setTimeout(function() {
    if (activeTool === 'select') document.getElementById('draw-hint').textContent = t('hint_select') || 'Clic en un elemento para seleccionarlo (Shift+clic para selección múltiple)';
  }, 1000);
}

function _maybePrepareRouteFromSelection() {
  if (!_selectMode || typeof _selectedLayers === 'undefined') return;
  const selectedPoints = [];
  _selectedLayers.forEach(function(layer) {
    if (layer && typeof layer.getLatLng === 'function') selectedPoints.push(layer);
  });
  if (selectedPoints.length !== 2) {
    _resetSelectedRouteFlow();
    return;
  }
  const a = selectedPoints[0].getLatLng();
  const b = selectedPoints[1].getLatLng();
  _routeStart = a;
  _routeEnd = b;
  _routePreviewCoords = null;
  _routePendingConfirm = true;
  fetchRouteOptimistic(false);
}

function _confirmSelectedRouteOnClick() {
  if (!_routePendingConfirm || !_routeStart || !_routeEnd) return;
  if (_routePreviewCoords && _routePreviewCoords.length > 1) {
    commitRouteLine(_routePreviewCoords);
    return;
  }
  fetchRouteOptimistic(true);
}

function _debounce(fn, wait) {
  let timer = null;
  return function() {
    const args = arguments;
    clearTimeout(timer);
    timer = setTimeout(function() { fn.apply(null, args); }, wait);
  };
}

// Handle draw:created event
map.on(L.Draw.Event.CREATED, async e => {
  const layer = e.layer;
  const isLine = layer instanceof L.Polyline && !(layer instanceof L.Polygon);
  stopAll();
  const label = isLine ? t('draw_line_label') : t('draw_polygon_label');
  const name = await askName(isLine ? t('draw_name_line') : t('draw_name_polygon'), label + ' 1');
  if (typeof pushUndo === 'function') pushUndo();
  layer._manaName = name || label;
  addDrawnLayerToGroup(layer);
});

async function clearAll() {
  if (window.manaSharedAccess && window.manaSharedAccess.canEdit === false) {
    if (typeof showToast === 'function') showToast((typeof LANG !== 'undefined' && LANG === 'en') ? 'This shared map is view only.' : 'Este mapa compartido es de solo lectura.');
    return;
  }
  closeCtx();
  const ok = await manaConfirm(t('modal_clear_confirm'));
  if (ok) {
    if (typeof pushUndo === 'function') pushUndo();
    drawnItems.clearLayers();
    // Also clear group meta registry and label overlays
    for (const gid in _manaGroupMeta) { removeLabelsFromLayer(_manaGroupMeta[gid]); delete _manaGroupMeta[gid]; }
    _activeGroupId = null;
    _manaGroupCounter = 0;
    _manaLayerNameCounter = 0;
    // Clear WMS overlay layers
    if (typeof _wmsOverlays !== 'undefined') {
      _wmsOverlays.forEach(item => { if (map.hasLayer(item.layer)) map.removeLayer(item.layer); });
      _wmsOverlays.length = 0;
    }
    // Reset project name
    var projInput = document.getElementById('project-name-input');
    if (projInput) projInput.value = '';
    if (typeof setProjectName === 'function') setProjectName('');
    stats();
    if (typeof saveState === 'function') saveState();
  }
}

// ═══════════════════════════════════════════════════════════════
// P1.2: GEOMETRY EDIT MODE
// ═══════════════════════════════════════════════════════════════

function toggleEdit() {
  if (window.manaSharedAccess && window.manaSharedAccess.canEdit === false) {
    if (typeof showToast === 'function') showToast((typeof LANG !== 'undefined' && LANG === 'en') ? 'This shared map is view only.' : 'Este mapa compartido es de solo lectura.');
    return;
  }
  if (editMode) stopEdit();
  else startEdit();
}

function startEdit() {
  stopAll(); // stop drawing tools
  editMode = true;
  var btn = document.getElementById('btn-edit');
  if (btn) btn.classList.add('active');

  // Show hint
  const hint = document.getElementById('draw-hint');
  hint.textContent = t('hint_edit');
  hint.style.display = 'block';

  // Save state before editing
  if (typeof pushUndo === 'function') pushUndo();

  // Enable editing on all layers
  drawnItems.eachLayer(l => {
    if (l.editing) l.editing.enable();
  });
}

function stopEdit() {
  editMode = false;
  const btn = document.getElementById('btn-edit');
  if (btn) btn.classList.remove('active');
  document.getElementById('draw-hint').style.display = 'none';
  document.getElementById('map').classList.remove('draw-point-mode');

  // Disable editing on all layers
  drawnItems.eachLayer(l => {
    if (l.editing) l.editing.disable();
  });

  if (typeof refreshAllLabels === 'function') refreshAllLabels();
  stats();
  if (typeof saveState === 'function') saveState();
}

// ── RULER ──
let rulerPoints = [], rulerLine = null, rulerMarkers = [], rulerPreview = null;
let rulerCompleted = [];

function startRuler() {
  rulerPoints = []; rulerMarkers = []; rulerLine = null; rulerPreview = null;
  map.doubleClickZoom && map.doubleClickZoom.disable();
  map.on('click', rulerClick);
  map.on('dblclick', rulerFinish);
  map.on('mousemove', rulerMove);
}

function stopRuler() {
  map.off('click', rulerClick);
  map.off('dblclick', rulerFinish);
  map.off('mousemove', rulerMove);
  map.doubleClickZoom && map.doubleClickZoom.enable();
  rulerMarkers.forEach(m => map.removeLayer(m));
  if (rulerLine) map.removeLayer(rulerLine);
  if (rulerPreview) map.removeLayer(rulerPreview);
  rulerCompleted.forEach(function(g) {
    g.markers.forEach(function(m) { map.removeLayer(m); });
    if (g.line) map.removeLayer(g.line);
  });
  rulerPoints = []; rulerMarkers = []; rulerLine = null; rulerPreview = null;
  rulerCompleted = [];
}

let _rulerIgnoreClick = 0;
function rulerClick(e) {
  if (Date.now() < _rulerIgnoreClick) return;
  if (rulerPoints.length > 0 && e.latlng.distanceTo(rulerPoints[rulerPoints.length - 1]) < 2) return;
  rulerPoints.push(e.latlng);
  const dot = L.circleMarker(e.latlng, {
    radius: 5, color: '#30363b', fillColor: 'white', fillOpacity: 1, weight: 2
  }).addTo(map);
  rulerMarkers.push(dot);
  if (rulerPreview) { map.removeLayer(rulerPreview); rulerPreview = null; }
  if (rulerPoints.length >= 2) {
    if (rulerLine) map.removeLayer(rulerLine);
    rulerLine = L.polyline(rulerPoints, { color: '#0ea5e9', weight: 2.5 }).addTo(map);
    var d = Math.round(getTotalDist(rulerPoints));
    rulerLine.bindTooltip(d + ' m', {
      permanent: true, direction: 'center', className: 'ruler-label'
    });
  }
}

function rulerMove(e) {
  if (rulerPreview) { map.removeLayer(rulerPreview); rulerPreview = null; }
  if (!rulerPoints.length) return;
  var last = rulerPoints[rulerPoints.length - 1];
  var previewPts = [last, e.latlng];
  rulerPreview = L.polyline(previewPts, {
    color: '#0ea5e9', weight: 2.5, dashArray: '6 5', opacity: 0.65
  }).addTo(map);
  var segDist = Math.round(e.latlng.distanceTo(last));
  rulerPreview.bindTooltip(segDist + ' m', {
    permanent: true, direction: 'center', className: 'ruler-label'
  });
}

function rulerFinish(e) {
  e.originalEvent.preventDefault();
  if (rulerPoints.length < 2) return;
  if (rulerPreview) { map.removeLayer(rulerPreview); rulerPreview = null; }
  if (rulerLine) rulerLine.setLatLngs(rulerPoints);
  var totalDist = Math.round(getTotalDist(rulerPoints));
  if (rulerLine) {
    rulerLine.unbindTooltip();
    rulerLine.bindTooltip(totalDist + ' m', {
      permanent: true, direction: 'center', className: 'ruler-label total'
    });
  }
  rulerCompleted.push({ markers: rulerMarkers.slice(), line: rulerLine });
  rulerPoints = []; rulerMarkers = []; rulerLine = null;
  _rulerIgnoreClick = Date.now() + 400;
  document.getElementById('draw-hint').textContent = t('hint_ruler');
}

function getTotalDist(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += pts[i].distanceTo(pts[i - 1]);
  return d;
}

function formatDist(m) {
  return Math.round(m) + ' m';
}

// ═══════════════════════════════════════════════════════════════
// SELECT TOOL — click + box/marquee selection (QGIS-style)
// ═══════════════════════════════════════════════════════════════

function startSelect() {
  _selectMode = true;

  // Cursor: crosshair on the map
  map.getContainer().classList.add('select-mode');

  // Disable map dragging so mousedown+drag draws a box, not pans
  map.dragging.disable();

  // Create rubber-band div (reused across drags)
  if (!_selBox) {
    _selBox = document.createElement('div');
    _selBox.className = 'select-rubber-band';
    map.getContainer().appendChild(_selBox);
  }
  _selBox.style.display = 'none';

  // Bind events on the map container (not Leaflet events) so we get raw coords
  var container = map.getContainer();
  container.addEventListener('mousedown', _selOnDown);
  container.addEventListener('touchstart', _selOnTouchStart, { passive: false });
}

function stopSelect() {
  _selectMode = false;
  _selDragging = false;
  _selStart = null;

  map.getContainer().classList.remove('select-mode');
  map.dragging.enable();

  if (_selBox) _selBox.style.display = 'none';

  var container = map.getContainer();
  container.removeEventListener('mousedown', _selOnDown);
  container.removeEventListener('touchstart', _selOnTouchStart);
  document.removeEventListener('mousemove', _selOnMove);
  document.removeEventListener('mouseup', _selOnUp);
  document.removeEventListener('touchmove', _selOnTouchMove);
  document.removeEventListener('touchend', _selOnTouchEnd);

  var btn = document.getElementById('btn-select');
  if (btn) btn.classList.remove('active');
}

// ── Mouse events ──

function _selOnDown(e) {
  // Ignore right-click
  if (e.button && e.button !== 0) return;
  // Ignore if clicking on UI elements inside the map container (zoom controls, etc.)
  if (e.target.closest('.leaflet-control-container')) return;

  e.preventDefault();
  e.stopPropagation();

  var rect = map.getContainer().getBoundingClientRect();
  _selStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  _selDragging = false;

  document.addEventListener('mousemove', _selOnMove);
  document.addEventListener('mouseup', _selOnUp);
}

function _selOnMove(e) {
  if (!_selStart) return;
  var rect = map.getContainer().getBoundingClientRect();
  var cx = e.clientX - rect.left;
  var cy = e.clientY - rect.top;
  var dx = cx - _selStart.x;
  var dy = cy - _selStart.y;

  if (!_selDragging && Math.hypot(dx, dy) < _SEL_DRAG_THRESHOLD) return;
  _selDragging = true;

  // Draw rubber band
  var x = Math.min(_selStart.x, cx);
  var y = Math.min(_selStart.y, cy);
  var w = Math.abs(dx);
  var h = Math.abs(dy);
  _selBox.style.left = x + 'px';
  _selBox.style.top = y + 'px';
  _selBox.style.width = w + 'px';
  _selBox.style.height = h + 'px';
  _selBox.style.display = 'block';
}

function _selOnUp(e) {
  document.removeEventListener('mousemove', _selOnMove);
  document.removeEventListener('mouseup', _selOnUp);

  if (!_selStart) return;

  var rect = map.getContainer().getBoundingClientRect();
  var endX = e.clientX - rect.left;
  var endY = e.clientY - rect.top;
  var additive = e.shiftKey;

  if (_selDragging) {
    // ── Box selection ──
    _selBox.style.display = 'none';
    var x1 = Math.min(_selStart.x, endX);
    var y1 = Math.min(_selStart.y, endY);
    var x2 = Math.max(_selStart.x, endX);
    var y2 = Math.max(_selStart.y, endY);
    _selectByBox(x1, y1, x2, y2, additive);
  } else {
    // ── Click selection (no drag) ──
    _selectByClick(_selStart.x, _selStart.y, additive);
  }

  _selStart = null;
  _selDragging = false;
}

// ── Touch events (same logic, adapted) ──

function _selOnTouchStart(e) {
  if (e.touches.length !== 1) return;
  if (e.target.closest('.leaflet-control-container')) return;
  e.preventDefault();

  var rect = map.getContainer().getBoundingClientRect();
  var t = e.touches[0];
  _selStart = { x: t.clientX - rect.left, y: t.clientY - rect.top };
  _selDragging = false;

  document.addEventListener('touchmove', _selOnTouchMove, { passive: false });
  document.addEventListener('touchend', _selOnTouchEnd);
}

function _selOnTouchMove(e) {
  if (!_selStart || e.touches.length !== 1) return;
  e.preventDefault();
  var rect = map.getContainer().getBoundingClientRect();
  var t = e.touches[0];
  // Re-use mouse move logic via a fake event
  _selOnMove({ clientX: t.clientX, clientY: t.clientY });
}

function _selOnTouchEnd(e) {
  document.removeEventListener('touchmove', _selOnTouchMove);
  document.removeEventListener('touchend', _selOnTouchEnd);

  if (!_selStart) return;

  var rect = map.getContainer().getBoundingClientRect();
  // changedTouches gives the position of the ended touch
  var t = e.changedTouches[0];
  var endX = t.clientX - rect.left;
  var endY = t.clientY - rect.top;
  var additive = false; // no shift on touch

  if (_selDragging) {
    _selBox.style.display = 'none';
    var x1 = Math.min(_selStart.x, endX);
    var y1 = Math.min(_selStart.y, endY);
    var x2 = Math.max(_selStart.x, endX);
    var y2 = Math.max(_selStart.y, endY);
    _selectByBox(x1, y1, x2, y2, additive);
  } else {
    _selectByClick(_selStart.x, _selStart.y, additive);
  }

  _selStart = null;
  _selDragging = false;
}

// ═══════════════════════════════════════════════════════════════
// SELECTION LOGIC
// ═══════════════════════════════════════════════════════════════

/** Select all features whose representative point falls inside the box (container px). */
function _selectByBox(x1, y1, x2, y2, additive) {
  if (_routePendingConfirm) _routePendingConfirm = false;
  if (!additive && typeof clearSelection === 'function') clearSelection();

  var selBounds = L.latLngBounds(
    map.containerPointToLatLng([x1, y1]),
    map.containerPointToLatLng([x2, y2])
  );

  drawnItems.eachLayer(function (l) {
    var dominated = false;
    if (l instanceof L.Marker) {
      dominated = selBounds.contains(l.getLatLng());
    } else if (l.getBounds) {
      // Select if the box intersects the layer bounds
      dominated = selBounds.intersects(l.getBounds());
    }
    if (dominated && typeof selectLayerOnMap === 'function') {
      selectLayerOnMap(l, true); // always additive inside one box op
    }
  });

  // Count for toast
  if (typeof _selectedLayers !== 'undefined' && typeof showToast === 'function') {
    var n = _selectedLayers.size;
    if (n > 0) showToast(n + ' elemento' + (n > 1 ? 's' : '') + ' seleccionado' + (n > 1 ? 's' : ''));
  }
  _maybePrepareRouteFromSelection();
}

/** Single-click selection: find the closest feature near px coords. */
function _selectByClick(px, py, additive) {
  if (_routePendingConfirm) {
    _confirmSelectedRouteOnClick();
    return;
  }
  var latlng = map.containerPointToLatLng([px, py]);
  var bestLayer = null;
  var bestDist = Infinity;

  drawnItems.eachLayer(function (l) {
    if (l instanceof L.Marker) {
      var pt = map.latLngToContainerPoint(l.getLatLng());
      var d = Math.hypot(pt.x - px, pt.y - py);
      if (d < 24 && d < bestDist) { bestDist = d; bestLayer = l; }
    } else if (l instanceof L.Polygon) {
      if (l.getBounds().contains(latlng)) {
        bestLayer = l; bestDist = 0;
      } else if (typeof isNearPolyline === 'function' && isNearPolyline(latlng, l, 12)) {
        if (5 < bestDist) { bestLayer = l; bestDist = 5; }
      }
    } else if (l instanceof L.Polyline) {
      if (typeof isNearPolyline === 'function' && isNearPolyline(latlng, l, 14)) {
        if (5 < bestDist) { bestLayer = l; bestDist = 5; }
      }
    }
  });

  if (bestLayer) {
    if (typeof selectLayerOnMap === 'function') selectLayerOnMap(bestLayer, additive);
    if (typeof showToast === 'function') showToast((bestLayer._manaName || t('generic_element')) + ' seleccionado');
  } else if (!additive) {
    if (typeof clearSelection === 'function') clearSelection();
  }
  _maybePrepareRouteFromSelection();
}
