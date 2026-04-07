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

// Helper: distance from point to polyline segment (in pixels)
function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function isNearPolyline(latlng, layer, threshold) {
  threshold = threshold || 12;
  const ep = map.latLngToContainerPoint(latlng);
  const latlngs = layer.getLatLngs();
  // Handle nested arrays (polygons, multi-polylines)
  const rings = Array.isArray(latlngs[0]) && latlngs[0] instanceof L.LatLng
    ? [latlngs] : (Array.isArray(latlngs[0]) ? latlngs : [latlngs]);
  for (const ring of rings) {
    const flat = Array.isArray(ring[0]) ? ring[0] : ring;
    for (let i = 0; i < flat.length - 1; i++) {
      const a = map.latLngToContainerPoint(flat[i]);
      const b = map.latLngToContainerPoint(flat[i + 1]);
      if (distToSegment(ep, a, b) < threshold) return true;
    }
  }
  return false;
}

map.on('contextmenu', e => {
  L.DomEvent.preventDefault(e);
  ctxLatLng = e.latlng;
  ctxTargetLayer = null;

  // Detect layer under click with proper proximity checks
  let bestDist = Infinity;
  drawnItems.eachLayer(l => {
    if (l instanceof L.Marker) {
      const pt = map.latLngToContainerPoint(l.getLatLng());
      const ep = map.latLngToContainerPoint(e.latlng);
      const d = Math.hypot(pt.x - ep.x, pt.y - ep.y);
      if (d < 24 && d < bestDist) { bestDist = d; ctxTargetLayer = l; }
    } else if (l instanceof L.Polygon) {
      // For polygons: check fill area OR border proximity
      if (l.getBounds().contains(e.latlng)) {
        ctxTargetLayer = l; bestDist = 0;
      } else if (isNearPolyline(e.latlng, l, 12)) {
        ctxTargetLayer = l; bestDist = 5;
      }
    } else if (l instanceof L.Polyline) {
      if (isNearPolyline(e.latlng, l, 14)) {
        ctxTargetLayer = l; bestDist = 5;
      }
    } else if (l instanceof L.Circle) {
      const center = l.getLatLng();
      const dist = e.latlng.distanceTo(center);
      if (dist <= l.getRadius()) {
        ctxTargetLayer = l; bestDist = 0;
      }
    }
  });

  document.getElementById('ctx-coords').textContent =
    e.latlng.lat.toFixed(5) + ', ' + e.latlng.lng.toFixed(5);

  // Update style section visibility and controls
  try { updateCtxStyleSection(); } catch(err) { console.warn('ctx style error:', err); }

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

// Prevent clicks INSIDE the context menu from closing it
document.getElementById('ctx-menu').addEventListener('click', e => {
  e.stopPropagation();
});
document.getElementById('ctx-menu').addEventListener('mousedown', e => {
  e.stopPropagation();
});

// Close menu when clicking outside or pressing Escape
document.addEventListener('click', e => {
  const menu = document.getElementById('ctx-menu');
  if (!menu.contains(e.target)) closeCtx();
});
document.addEventListener('contextmenu', e => {
  // Don't close on right-click (the handler will reopen it)
});
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
  // Highlight selected swatch
  document.querySelectorAll('.ctx-swatch').forEach(s => {
    s.style.borderColor = (s.style.backgroundColor && s.onclick.toString().includes(color))
      ? 'white' : 'transparent';
  });
  stats(); showToast('Color aplicado');
}

function ctxSetWeight(w) {
  if (!ctxTargetLayer || ctxTargetLayer instanceof L.Marker) return;
  ctxTargetLayer.setStyle({ weight: w });
  // Highlight selected weight
  document.querySelectorAll('.ctx-weight-btn').forEach(b => {
    b.classList.toggle('active', b.textContent.trim() === String(w));
  });
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


// ═══════════════════════════════════════════════════════════════
// SIDEBAR LAYER CONTEXT MENU
// ═══════════════════════════════════════════════════════════════
let _lctxType = null;   // 'group' | 'layer'
let _lctxId = null;     // group id or layer index

function closeLayerCtx() {
  document.getElementById('layer-ctx-menu').classList.remove('open');
}

// Show from right-click
function showLayerCtx(e, type, id) {
  e.preventDefault();
  e.stopPropagation();
  _openLayerCtx(e.clientX, e.clientY, type, id);
}

// Show from palette button click
function showLayerCtxBtn(e, type, id) {
  e.stopPropagation();
  const rect = e.currentTarget.getBoundingClientRect();
  _openLayerCtx(rect.left, rect.bottom + 4, type, id);
}

function _openLayerCtx(x, y, type, id) {
  _lctxType = type;
  _lctxId = id;

  const menu = document.getElementById('layer-ctx-menu');
  const title = document.getElementById('lctx-title');
  const weightRow = document.getElementById('lctx-weight-row');
  const catSection = document.getElementById('lctx-categorize');
  const catList = document.getElementById('lctx-cat-list');
  const opSlider = document.getElementById('lctx-opacity');
  const opVal = document.getElementById('lctx-opacity-val');

  if (type === 'group') {
    const meta = _manaGroupMeta[id];
    if (!meta) return;
    title.textContent = meta.name;

    // Check if group has non-marker layers (for weight control)
    let hasLines = false;
    meta.allLayers.forEach(l => {
      if (!(l instanceof L.Marker)) hasLines = true;
    });
    weightRow.style.display = hasLines ? 'flex' : 'none';

    // Opacity: use first layer's opacity
    let curOp = 100;
    if (meta.allLayers.length) {
      const first = meta.allLayers[0];
      curOp = Math.round(((first instanceof L.Marker ? first.options.opacity : first.options.opacity) || 1) * 100);
    }
    opSlider.value = curOp;
    opVal.textContent = curOp + '%';

    // Build categorize options
    const attrs = Object.keys(meta.attrs);
    if (attrs.length) {
      catSection.style.display = 'block';
      catList.innerHTML = attrs.map(a => {
        const count = meta.attrs[a].values.size;
        return '<button class="ctx-item ctx-cat-item" onclick="lctxCategorize(\'' +
          a.replace(/'/g, "\\'") + '\')">' +
          '<span class="ctx-cat-field">' + a + '</span>' +
          '<span class="ctx-cat-count">' + count + ' val.</span></button>';
      }).join('');
    } else {
      catSection.style.display = 'none';
    }
  } else {
    // Individual layer
    const layers = [];
    drawnItems.eachLayer(l => layers.push(l));
    const layer = layers[id];
    if (!layer) return;
    title.textContent = layer._manaName || 'Elemento';
    weightRow.style.display = (layer instanceof L.Marker) ? 'none' : 'flex';

    let curOp = 100;
    if (layer instanceof L.Marker) {
      curOp = Math.round((layer.options.opacity || 1) * 100);
    } else {
      curOp = Math.round((layer.options.opacity || 1) * 100);
    }
    opSlider.value = curOp;
    opVal.textContent = curOp + '%';

    catSection.style.display = 'none';
  }

  // Position and show
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.classList.add('open');

  // Adjust if overflows
  requestAnimationFrame(() => {
    const r = menu.getBoundingClientRect();
    if (r.right > window.innerWidth) menu.style.left = (x - r.width) + 'px';
    if (r.bottom > window.innerHeight) menu.style.top = (y - r.height) + 'px';
  });
}

// ── Actions ──
function _getLctxLayers() {
  if (_lctxType === 'group') {
    const meta = _manaGroupMeta[_lctxId];
    return meta ? meta.allLayers : [];
  } else {
    const layers = [];
    drawnItems.eachLayer(l => layers.push(l));
    return layers[_lctxId] ? [layers[_lctxId]] : [];
  }
}

function lctxSetColor(color) {
  _getLctxLayers().forEach(l => {
    if (l instanceof L.Marker) {
      l._manaColor = color;
      l.setIcon(makeMarkerIcon(color, markerType));
    } else {
      l.setStyle({ color: color });
    }
  });
  if (_lctxType === 'group' && _manaGroupMeta[_lctxId]) {
    _manaGroupMeta[_lctxId].color = color;
  }
  stats(); showToast('Color aplicado');
}

function lctxSetWeight(w) {
  _getLctxLayers().forEach(l => {
    if (!(l instanceof L.Marker)) l.setStyle({ weight: w });
  });
  document.querySelectorAll('#layer-ctx-menu .ctx-weight-btn').forEach(b => {
    b.classList.toggle('active', b.textContent.trim() === String(w));
  });
  showToast('Grosor: ' + w + 'px');
}

function lctxSetOpacity(val) {
  const op = val / 100;
  document.getElementById('lctx-opacity-val').textContent = val + '%';
  _getLctxLayers().forEach(l => {
    if (l instanceof L.Marker) {
      l.setOpacity(op);
    } else {
      l.setStyle({ opacity: op, fillOpacity: op * 0.3 });
    }
  });
}

async function lctxRename() {
  closeLayerCtx();
  if (_lctxType === 'group') {
    const meta = _manaGroupMeta[_lctxId];
    if (!meta) return;
    const name = await askName('Renombrar capa', meta.name);
    if (name === null) return;
    meta.name = name;
  } else {
    const layers = [];
    drawnItems.eachLayer(l => layers.push(l));
    const layer = layers[_lctxId];
    if (!layer) return;
    const name = await askName('Renombrar elemento', layer._manaName || 'Elemento');
    if (name === null) return;
    layer._manaName = name;
    if (layer.getPopup && layer.getPopup()) {
      layer.setPopupContent('<strong>' + name + '</strong>');
    }
  }
  stats(); showToast('Renombrado');
}

function lctxZoom() {
  closeLayerCtx();
  if (_lctxType === 'group') {
    focusGroup(_lctxId);
  } else {
    focusLayer(_lctxId);
  }
}

function lctxCategorize(field) {
  if (_lctxType !== 'group') return;
  const meta = _manaGroupMeta[_lctxId];
  if (!meta) return;

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

  closeLayerCtx(); stats();
  showToast('Categorizado por ' + field + ' (' + uniqueVals.length + ' valores)');
}

async function lctxDelete() {
  closeLayerCtx();
  if (_lctxType === 'group') {
    deleteGroup(_lctxId);
  } else {
    const layers = [];
    drawnItems.eachLayer(l => layers.push(l));
    const layer = layers[_lctxId];
    if (!layer) return;
    drawnItems.removeLayer(layer);
    stats();
    showToast('Elemento eliminado');
  }
}

// ── Close & propagation ──
document.getElementById('layer-ctx-menu').addEventListener('click', e => e.stopPropagation());
document.getElementById('layer-ctx-menu').addEventListener('mousedown', e => e.stopPropagation());
document.addEventListener('click', e => {
  const lm = document.getElementById('layer-ctx-menu');
  if (lm && !lm.contains(e.target)) closeLayerCtx();
});
document.addEventListener('contextmenu', e => {
  // If right-clicking outside the layer-ctx-menu, close it
  const lm = document.getElementById('layer-ctx-menu');
  if (lm && !lm.contains(e.target)) closeLayerCtx();
});
