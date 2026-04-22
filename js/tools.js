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
    hint.textContent = 'Haz clic en el mapa para a\u00F1adir un punto';
    map.once('click', async e => {
      stopAll();
      const name = await askName('Nombre del punto', 'Nuevo punto');
      if (name === null) return;
      if (typeof pushUndo === 'function') pushUndo();
      const icon = makeMarkerIcon(drawColor, markerType);
      const m = L.marker(e.latlng, { icon }).addTo(drawnItems);
      m._manaName = name; m._manaColor = drawColor;
      m.bindPopup('<strong>' + name + '</strong>');
      stats();
      if (typeof saveState === 'function') saveState();
    });
  } else if (tool === 'line') {
    hint.textContent = 'Clic para a\u00F1adir v\u00E9rtices \u2014 doble clic para terminar';
    drawHandler = new L.Draw.Polyline(map, shapeOpts);
    drawHandler.enable();
  } else if (tool === 'polygon') {
    hint.textContent = 'Clic para a\u00F1adir v\u00E9rtices \u2014 cierra haciendo clic en el primer punto';
    drawHandler = new L.Draw.Polygon(map, shapeOpts);
    drawHandler.enable();
  } else if (tool === 'ruler') {
    hint.textContent = 'Clic para fijar puntos \u2014 doble clic para terminar y ver resultado';
    startRuler();
  }
}

// Handle draw:created event
map.on(L.Draw.Event.CREATED, async e => {
  const layer = e.layer;
  const isLine = layer instanceof L.Polyline && !(layer instanceof L.Polygon);
  stopAll();
  const label = isLine ? 'L\u00EDnea' : 'Pol\u00EDgono';
  const name = await askName('Nombre de la ' + (isLine ? 'l\u00EDnea' : 'forma'), label + ' 1');
  if (typeof pushUndo === 'function') pushUndo();
  layer._manaName = name || label;
  drawnItems.addLayer(layer);
  stats();
  if (typeof saveState === 'function') saveState();
});

async function clearAll() {
  closeCtx();
  const ok = await manaConfirm('\u00BFSeguro que quieres borrar todo?');
  if (ok) {
    if (typeof pushUndo === 'function') pushUndo();
    drawnItems.clearLayers();
    // Also clear group meta registry
    for (const gid in _manaGroupMeta) delete _manaGroupMeta[gid];
    // Clear WMS overlay layers
    if (typeof _wmsOverlays !== 'undefined') {
      _wmsOverlays.forEach(item => { if (map.hasLayer(item.layer)) map.removeLayer(item.layer); });
      _wmsOverlays.length = 0;
    }
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
  hint.textContent = 'Arrastra los v\u00E9rtices para editar. Clic en "Editar" de nuevo para terminar.';
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
    .setContent('<strong>Distancia total</strong><br>' + formatDist(getTotalDist(rulerPoints)))
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

