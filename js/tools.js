// ── tools.js ─ Drawing tools & ruler ──

let activeTool = null, drawHandler = null;

function stopAll() {
  if (drawHandler) { try { drawHandler.disable(); } catch (e) {} drawHandler = null; }
  stopRuler();
  document.getElementById('draw-hint').style.display = 'none';
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  activeTool = null;
}

function setTool(tool) {
  if (activeTool === tool) { stopAll(); return; }
  stopAll();
  activeTool = tool;
  document.getElementById('btn-' + tool).classList.add('active');
  const hint = document.getElementById('draw-hint');
  hint.style.display = 'block';
  const shapeOpts = { shapeOptions: { color: drawColor, weight: 2, fillOpacity: .18 } };

  if (tool === 'point') {
    hint.textContent = 'Haz clic en el mapa para a\u00F1adir un punto';
    map.once('click', async e => {
      stopAll();
      const name = await askName('Nombre del punto', 'Nuevo punto');
      if (name === null) return;
      const icon = makeMarkerIcon(drawColor, markerType);
      const m = L.marker(e.latlng, { icon }).addTo(drawnItems);
      m._manaName = name; m._manaColor = drawColor;
      m.bindPopup('<strong>' + name + '</strong>');
      stats();
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
  layer._manaName = name || label;
  drawnItems.addLayer(layer);
  stats();
});

function clearAll() {
  closeCtx();
  if (confirm('\u00BFBorrar todos los elementos del mapa?')) {
    drawnItems.clearLayers();
    stats();
  }
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
