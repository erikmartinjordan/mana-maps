// ── context-menu.js ─ Right-click menu, toast, & in-app dialogs ──

// ═══════════════════════════════════════════════════════════════
// IN-APP CONFIRM DIALOG (replaces browser confirm())
// ═══════════════════════════════════════════════════════════════
let _confirmResolve = null;

function manaConfirm(msg) {
  return new Promise(resolve => {
    _confirmResolve = resolve;
    const modal = document.getElementById('confirm-modal');
    document.getElementById('confirm-modal-msg').innerHTML = msg;
    modal.classList.add('open');
  });
}

function confirmOk() {
  document.getElementById('confirm-modal').classList.remove('open');
  if (_confirmResolve) { _confirmResolve(true); _confirmResolve = null; }
}

function confirmCancel() {
  document.getElementById('confirm-modal').classList.remove('open');
  if (_confirmResolve) { _confirmResolve(false); _confirmResolve = null; }
}

// ═══════════════════════════════════════════════════════════════
// IN-APP ALERT / NOTIFICATION (replaces browser alert())
// ═══════════════════════════════════════════════════════════════
let _alertTimer = null;

function manaAlert(msg, type) {
  type = type || 'info';
  const el = document.getElementById('mana-alert');
  const icon = type === 'error' ? '\u26A0\uFE0F'
             : type === 'warning' ? '\u26A0\uFE0F'
             : '\u2139\uFE0F';
  el.innerHTML = '<span class="mana-alert-icon">' + icon + '</span><span class="mana-alert-text">' + msg + '</span>';
  el.className = 'mana-alert show ' + type;
  if (_alertTimer) clearTimeout(_alertTimer);
  _alertTimer = setTimeout(() => el.classList.remove('show'), type === 'error' ? 5000 : 3500);
}



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
  // Update style section visibility and controls
  updateCtxStyleSection();

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


// ═══════════════════════════════════════════════════════════════
// LAYER STYLING (from context menu)
// ═══════════════════════════════════════════════════════════════
const CTX_PALETTE = [
  '#0ea5e9','#6366f1','#10b981','#f59e0b','#ef4444','#ec4899',
  '#8b5cf6','#64748b','#f97316','#14b8a6','#a855f7','#84cc16',
  '#e11d48','#0284c7','#ca8a04','#7c3aed','#059669','#dc2626'
];

function ctxSetColor(color) {
  if (!ctxTargetLayer) return;
  if (ctxTargetLayer instanceof L.Marker) {
    ctxTargetLayer._manaColor = color;
    ctxTargetLayer.setIcon(makeMarkerIcon(color, markerType));
  } else {
    ctxTargetLayer.setStyle({ color: color });
  }
  stats(); showToast('Color aplicado');
}

function ctxSetWeight(w) {
  if (!ctxTargetLayer || ctxTargetLayer instanceof L.Marker) return;
  ctxTargetLayer.setStyle({ weight: w });
  showToast('Grosor: ' + w + 'px');
}

function ctxSetOpacity(val) {
  if (!ctxTargetLayer) return;
  const op = val / 100;
  document.getElementById('ctx-opacity-val').textContent = val + '%';
  if (ctxTargetLayer instanceof L.Marker) {
    ctxTargetLayer.setOpacity(op);
  } else {
    ctxTargetLayer.setStyle({ opacity: op, fillOpacity: op * 0.3 });
  }
}

async function ctxRename() {
  if (!ctxTargetLayer) return;
  closeCtx();
  const oldName = ctxTargetLayer._manaName || 'Elemento';
  const name = await askName('Renombrar elemento', oldName);
  if (name === null) return;
  ctxTargetLayer._manaName = name;
  if (ctxTargetLayer.getPopup()) {
    ctxTargetLayer.setPopupContent('<strong>' + name + '</strong>');
  }
  stats(); showToast('Renombrado');
}

function ctxStyleGroup() {
  if (!ctxTargetLayer || !ctxTargetLayer._manaGroupId) return;
  const gid = ctxTargetLayer._manaGroupId;
  const meta = _manaGroupMeta[gid];
  if (!meta) return;

  // Get current style from target layer
  let color, weight, opacity;
  if (ctxTargetLayer instanceof L.Marker) {
    color = ctxTargetLayer._manaColor || '#0ea5e9';
    opacity = ctxTargetLayer.options.opacity || 1;
  } else {
    color = ctxTargetLayer.options.color || '#0ea5e9';
    weight = ctxTargetLayer.options.weight || 2;
    opacity = ctxTargetLayer.options.opacity || 1;
  }

  // Apply to all layers in group
  meta.allLayers.forEach(l => {
    if (l instanceof L.Marker) {
      l._manaColor = color;
      l.setIcon(makeMarkerIcon(color, markerType));
      l.setOpacity(opacity);
    } else {
      l.setStyle({ color: color, weight: weight || 2, opacity: opacity, fillOpacity: opacity * 0.3 });
    }
  });
  meta.color = color;
  closeCtx(); stats();
  showToast('Estilo aplicado a toda la capa');
}

// ═══════════════════════════════════════════════════════════════
// CATEGORIZE BY ATTRIBUTE
// ═══════════════════════════════════════════════════════════════
function ctxCategorizeBy(field) {
  if (!ctxTargetLayer || !ctxTargetLayer._manaGroupId) return;
  const gid = ctxTargetLayer._manaGroupId;
  const meta = _manaGroupMeta[gid];
  if (!meta) return;

  // Collect unique values for this field
  const valSet = new Set();
  meta.allLayers.forEach(l => {
    const v = (l._manaProperties || {})[field];
    if (v !== null && v !== undefined && v !== '') valSet.add(String(v));
  });

  const uniqueVals = [...valSet].sort();
  const colorMap = {};
  uniqueVals.forEach((v, i) => {
    colorMap[v] = CTX_PALETTE[i % CTX_PALETTE.length];
  });

  // Apply colors
  meta.allLayers.forEach(l => {
    const v = String((l._manaProperties || {})[field] || '');
    const c = colorMap[v] || '#64748b';
    if (l instanceof L.Marker) {
      l._manaColor = c;
      l.setIcon(makeMarkerIcon(c, markerType));
    } else {
      l.setStyle({ color: c, weight: l.options.weight || 2 });
    }
  });

  closeCtx(); stats();
  showToast('Categorizado por ' + field + ' (' + uniqueVals.length + ' valores)');
}

// ═══════════════════════════════════════════════════════════════
// CONTEXT MENU — show/hide style section dynamically
// ═══════════════════════════════════════════════════════════════
function updateCtxStyleSection() {
  const section = document.getElementById('ctx-style-section');
  const deleteBtn = document.getElementById('ctx-delete-layer');
  const weightRow = document.getElementById('ctx-weight-row');
  const styleGroupBtn = document.getElementById('ctx-style-group');
  const catSection = document.getElementById('ctx-categorize-section');
  const catList = document.getElementById('ctx-categorize-list');
  const opacitySlider = document.getElementById('ctx-opacity');
  const opacityVal = document.getElementById('ctx-opacity-val');

  if (!ctxTargetLayer) {
    section.style.display = 'none';
    deleteBtn.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  deleteBtn.style.display = 'flex';

  // Show weight row only for non-markers
  weightRow.style.display = (ctxTargetLayer instanceof L.Marker) ? 'none' : 'flex';

  // Set opacity slider to current value
  let curOpacity = 100;
  if (ctxTargetLayer instanceof L.Marker) {
    curOpacity = Math.round((ctxTargetLayer.options.opacity || 1) * 100);
  } else {
    curOpacity = Math.round((ctxTargetLayer.options.opacity || 1) * 100);
  }
  opacitySlider.value = curOpacity;
  opacityVal.textContent = curOpacity + '%';

  // Show "apply to group" button if layer belongs to a group
  const gid = ctxTargetLayer._manaGroupId;
  if (gid && _manaGroupMeta[gid]) {
    styleGroupBtn.style.display = 'flex';

    // Build categorize options from group attributes
    const meta = _manaGroupMeta[gid];
    const attrs = Object.keys(meta.attrs);
    if (attrs.length) {
      catSection.style.display = 'block';
      catList.innerHTML = attrs.map(a => {
        const count = meta.attrs[a].values.size;
        return '<button class="ctx-item ctx-cat-item" onclick="ctxCategorizeBy(\'' +
          a.replace(/'/g, "\\'") + '\')">' +
          '<span class="ctx-cat-field">' + a + '</span>' +
          '<span class="ctx-cat-count">' + count + ' val.</span></button>';
      }).join('');
    } else {
      catSection.style.display = 'none';
    }
  } else {
    styleGroupBtn.style.display = 'none';
    catSection.style.display = 'none';
  }
}
