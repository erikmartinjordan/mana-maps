// ── context-menu.js ─ Right-click menu & toast notifications ──

// ── TOAST ──
let toastTimer = null;

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ── MENUS ──
function toggleMenu(id, e) {
  e.stopPropagation();
  const m = document.getElementById(id);
  const wasOpen = m.classList.contains('open');
  document.querySelectorAll('.drop-menu').forEach(x => x.classList.remove('open'));
  if (!wasOpen) m.classList.add('open');
}

document.addEventListener('click', () =>
  document.querySelectorAll('.drop-menu').forEach(x => x.classList.remove('open'))
);

// ── CONTEXT MENU ──
let ctxLatLng = null, ctxTargetLayer = null;

map.on('contextmenu', e => {
  L.DomEvent.preventDefault(e);
  ctxLatLng = e.latlng;
  ctxTargetLayer = null;

  drawnItems.eachLayer(l => {
    if (l instanceof L.Marker) {
      const pt = map.latLngToContainerPoint(l.getLatLng());
      const ep = map.latLngToContainerPoint(e.latlng);
      if (Math.hypot(pt.x - ep.x, pt.y - ep.y) < 20) ctxTargetLayer = l;
    } else if (l.getBounds && l.getBounds().contains(e.latlng)) {
      ctxTargetLayer = l;
    }
  });

  document.getElementById('ctx-coords').textContent =
    e.latlng.lat.toFixed(5) + ', ' + e.latlng.lng.toFixed(5);
  document.getElementById('ctx-delete-layer').style.display =
    ctxTargetLayer ? 'flex' : 'none';

  const menu = document.getElementById('ctx-menu');
  menu.style.left = e.originalEvent.clientX + 'px';
  menu.style.top = e.originalEvent.clientY + 'px';
  menu.classList.add('open');

  requestAnimationFrame(() => {
    const r = menu.getBoundingClientRect();
    if (r.right > window.innerWidth)
      menu.style.left = (e.originalEvent.clientX - r.width) + 'px';
    if (r.bottom > window.innerHeight)
      menu.style.top = (e.originalEvent.clientY - r.height) + 'px';
  });
});

function closeCtx() {
  document.getElementById('ctx-menu').classList.remove('open');
}

document.addEventListener('click', closeCtx);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeCtx(); modalCancel(); }
});

function ctxCopyCoords() {
  const text = document.getElementById('ctx-coords').textContent;
  navigator.clipboard.writeText(text).then(() => {
    showToast('\uD83D\uDCCB Coordenadas copiadas');
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('\uD83D\uDCCB Coordenadas copiadas');
  });
  closeCtx();
}

async function ctxAddPoint() {
  if (!ctxLatLng) return;
  closeCtx();
  const name = await askName('Nombre del punto', 'Nuevo punto');
  if (name === null) return;
  const icon = makeMarkerIcon(drawColor, markerType);
  const m = L.marker(ctxLatLng, { icon }).addTo(drawnItems);
  m._manaName = name;
  m._manaColor = drawColor;
  m.bindPopup('<strong>' + name + '</strong>');
  stats();
}

function ctxCenterHere() {
  if (!ctxLatLng) return;
  closeCtx();
  map.setView(ctxLatLng, map.getZoom());
}

function ctxDeleteLayer() {
  if (!ctxTargetLayer) return;
  closeCtx();
  drawnItems.removeLayer(ctxTargetLayer);
  ctxTargetLayer = null;
  stats();
}
