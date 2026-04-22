// ── tools.js ─ Drawing tools, ruler & geometry editing ──

let activeTool = null, drawHandler = null;

// ── P1.2: Edit mode state ──
let editMode = false;

function stopAll() {
  if (drawHandler) { try { drawHandler.disable(); } catch (e) {} drawHandler = null; }
  stopRuler();
  document.getElementById('draw-hint').style.display = 'none';
  document.querySelectorAll('.draw-btn').forEach(b => b.classList.remove('active'));
  var tbRuler = document.getElementById('tb-ruler');
  if (tbRuler) tbRuler.classList.remove('active');
  activeTool = null;
}

function setTool(tool) {
  // Exit edit mode if entering a draw tool
  if (editMode) stopEdit();

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
    hint.textContent = t('hint_point');
    map.once('click', async e => {
      stopAll();
      const name = await askName(t('name_point'), t('default_point_name'));
      if (name === null) return;
      if (typeof pushUndo === 'function') pushUndo();
      const icon = makeMarkerIcon(drawColor, markerType);
      const m = L.marker(e.latlng, { icon });
      m._manaName = name; m._manaColor = drawColor;
      m.bindPopup('<strong>' + name + '</strong>');
      addDrawnLayerToGroup(m);
    });
  } else if (tool === 'line') {
    hint.textContent = t('hint_line');
    drawHandler = new L.Draw.Polyline(map, shapeOpts);
    drawHandler.enable();
  } else if (tool === 'polygon') {
    hint.textContent = t('hint_polygon');
    drawHandler = new L.Draw.Polygon(map, shapeOpts);
    drawHandler.enable();
  } else if (tool === 'ruler') {
    hint.textContent = t('hint_ruler');
    startRuler();
  }
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
  closeCtx();
  const ok = await manaConfirm(t('modal_clear_confirm'));
  if (ok) {
    if (typeof pushUndo === 'function') pushUndo();
    drawnItems.clearLayers();
    // Also clear group meta registry
    for (const gid in _manaGroupMeta) delete _manaGroupMeta[gid];
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

  // Disable editing on all layers
  drawnItems.eachLayer(l => {
    if (l.editing) l.editing.disable();
  });

  stats();
  if (typeof saveState === 'function') saveState();
}

// ── RULER ──
let rulerPoints = [], rulerLine = null, rulerMarkers = [];

function startRuler() {
  rulerPoints = []; rulerMarkers = []; rulerLine = null;
  map.on('click', rulerClick);
  map.on('dblclick', rulerFinish);
  map.on('mousemove', rulerMove);
}

function stopRuler() {
  map.off('click', rulerClick);
  map.off('dblclick', rulerFinish);
  map.off('mousemove', rulerMove);
  rulerMarkers.forEach(m => map.removeLayer(m));
  if (rulerLine) map.removeLayer(rulerLine);
  rulerPoints = []; rulerMarkers = []; rulerLine = null;
  document.getElementById('ruler-tooltip').style.display = 'none';
}

function rulerClick(e) {
  if (rulerPoints.length > 0 && e.latlng.distanceTo(rulerPoints[rulerPoints.length - 1]) < 5) return;
  rulerPoints.push(e.latlng);
  const dot = L.circleMarker(e.latlng, {
    radius: 5, color: '#30363b', fillColor: 'white', fillOpacity: 1, weight: 2
  }).addTo(map);
  rulerMarkers.push(dot);
  if (rulerPoints.length >= 2) {
    if (rulerLine) map.removeLayer(rulerLine);
    rulerLine = L.polyline(rulerPoints, { color: '#0ea5e9', weight: 2, dashArray: '6 4' }).addTo(map);
  }
}

function rulerMove(e) {
  if (!rulerPoints.length) return;
  const tip = document.getElementById('ruler-tooltip');
  tip.textContent = formatDist(getTotalDist([...rulerPoints, e.latlng]));
  const pt = map.latLngToContainerPoint(e.latlng);
  tip.style.left = pt.x + 'px';
  tip.style.top = pt.y + 'px';
  tip.style.display = 'block';
}

function rulerFinish(e) {
  e.originalEvent.preventDefault();
  if (rulerPoints.length < 2) { stopRuler(); stopAll(); return; }
  L.popup({ closeButton: true })
    .setLatLng(rulerPoints[Math.floor(rulerPoints.length / 2)])
    .setContent('<strong>' + t('ruler_total') + '</strong><br>' + formatDist(getTotalDist(rulerPoints)))
    .openOn(map);
  stopRuler();
  stopAll();
}

function getTotalDist(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += pts[i].distanceTo(pts[i - 1]);
  return d;
}

function formatDist(m) {
  return m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m';
}

