// ── context-menu.js ─ Right-click menu, toast, & in-app dialogs ──

// ═══════════════════════════════════════════════════════════════
// CENTRALIZED COLOR PALETTE
// Adding a new color: edit only this array.
// ═══════════════════════════════════════════════════════════════
const SWATCH_PALETTE = [
  { hex: '#0ea5e9', name: 'Azul' },
  { hex: '#6366f1', name: '\u00CDndigo' },
  { hex: '#10b981', name: 'Menta' },
  { hex: '#f59e0b', name: 'Dorado' },
  { hex: '#ef4444', name: 'Rojo' },
  { hex: '#ec4899', name: 'Rosa' },
  { hex: '#8b5cf6', name: 'P\u00FArpura' },
  { hex: '#64748b', name: 'Pizarra' },
];

const LAYER_CTX_PALETTE = [
  { hex: '#0ea5e9' }, { hex: '#6366f1' }, { hex: '#10b981' },
  { hex: '#f59e0b' }, { hex: '#ef4444' }, { hex: '#ec4899' },
  { hex: '#8b5cf6' }, { hex: '#f97316' }, { hex: '#64748b' },
  { hex: '#30363b' },
];

// Extended palette for categorization
const CTX_PALETTE = [
  '#0ea5e9','#6366f1','#10b981','#f59e0b','#ef4444','#ec4899',
  '#8b5cf6','#64748b','#f97316','#14b8a6','#a855f7','#84cc16',
  '#e11d48','#0284c7','#ca8a04','#7c3aed','#059669','#dc2626'
];

// Render swatches programmatically on load
document.addEventListener('DOMContentLoaded', () => {
  // P3.10: Accessibility - add aria-live to toast
  const toastEl = document.getElementById('toast');
  if (toastEl) toastEl.setAttribute('aria-live', 'polite');

  // ── Sidebar color row ──
  const sidebarRow = document.getElementById('color-row');
  if (sidebarRow) {
    sidebarRow.innerHTML = '';
    SWATCH_PALETTE.forEach((s, i) => {
      const div = document.createElement('div');
      div.className = 'color-swatch' + (i === 0 ? ' active' : '');
      div.dataset.color = s.hex;
      div.style.background = s.hex;
      div.title = s.name;
      div.onclick = function() { setDrawColor(s.hex, this); };
      sidebarRow.appendChild(div);
    });
  }

  // ── Context menu (#ctx-menu) color row ──
  const ctxRow = document.querySelector('#ctx-style-section .ctx-color-row');
  if (ctxRow) {
    ctxRow.innerHTML = '';
    SWATCH_PALETTE.forEach(s => {
      const div = document.createElement('div');
      div.className = 'ctx-swatch';
      div.style.background = s.hex;
      div.onclick = function() { ctxSetColor(s.hex); };
      ctxRow.appendChild(div);
    });
  }

  // ── Layer context menu (#layer-ctx-menu) color row ──
  const lctxRow = document.querySelector('#layer-ctx-menu .ctx-color-row');
  if (lctxRow) {
    lctxRow.innerHTML = '';
    LAYER_CTX_PALETTE.forEach(s => {
      const div = document.createElement('div');
      div.className = 'ctx-swatch';
      div.style.background = s.hex;
      div.onclick = function() { lctxSetColor(s.hex); };
      lctxRow.appendChild(div);
    });
  }
});


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
  if (e.key === 'Escape') { closeCtx(); closeAttributeDrawer(); }
});

function ctxCopyCoords() {
  const text = document.getElementById('ctx-coords').textContent;
  navigator.clipboard.writeText(text).then(() => {
    showToast(t('toast_coords_copied'));
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast(t('toast_coords_copied'));
  });
  closeCtx();
}

async function ctxAddPoint() {
  if (!ctxLatLng) return;
  closeCtx();
  const name = await askName(t('name_point'), t('default_point_name'));
  if (name === null) return;
  const icon = makeMarkerIcon(drawColor, markerType);
  const m = L.marker(ctxLatLng, { icon }).addTo(drawnItems);
  m._manaName = name;
  m._manaColor = drawColor;
  m.bindPopup('<strong>' + name + '</strong>');
  stats();
  if (typeof saveState === 'function') saveState();
}

function ctxCenterHere() {
  if (!ctxLatLng) return;
  closeCtx();
  map.setView(ctxLatLng, map.getZoom());
}

function ctxDeleteLayer() {
  if (!ctxTargetLayer) return;
  closeCtx();
  if (typeof pushUndo === 'function') pushUndo();
  drawnItems.removeLayer(ctxTargetLayer);
  ctxTargetLayer = null;
  stats();
  if (typeof saveState === 'function') saveState();
}


// ═══════════════════════════════════════════════════════════════
// LAYER STYLING (from context menu)
// ═══════════════════════════════════════════════════════════════

function ctxSetColor(color) {
  if (!ctxTargetLayer) return;
  if (typeof pushUndo === 'function') pushUndo();
  if (ctxTargetLayer instanceof L.Marker) {
    ctxTargetLayer._manaColor = color;
    ctxTargetLayer.setIcon(makeMarkerIcon(color, markerType));
  } else {
    ctxTargetLayer.setStyle({ color: color });
  }
  stats(); showToast(t('toast_color_applied'));
  if (typeof saveState === 'function') saveState();
}

function ctxSetWeight(w) {
  if (!ctxTargetLayer || ctxTargetLayer instanceof L.Marker) return;
  ctxTargetLayer.setStyle({ weight: w });
  // Highlight selected weight
  document.querySelectorAll('#ctx-menu .ctx-weight-btn').forEach(b => {
    b.classList.toggle('active', b.textContent.trim() === String(w));
  });
  showToast(t('ctx_weight') + ': ' + w + 'px');
  if (typeof saveState === 'function') saveState();
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
  if (typeof saveState === 'function') saveState();
}

async function ctxRename() {
  if (!ctxTargetLayer) return;
  closeCtx();
  if (typeof pushUndo === 'function') pushUndo();
  const oldName = ctxTargetLayer._manaName || t('geom_element');
  const name = await askName(t('rename_element'), oldName);
  if (name === null) return;
  ctxTargetLayer._manaName = name;
  if (ctxTargetLayer.getPopup()) {
    ctxTargetLayer.setPopupContent('<strong>' + name + '</strong>');
  }
  stats(); showToast(t('toast_renamed'));
  if (typeof saveState === 'function') saveState();
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
  showToast(t('toast_style_applied'));
  if (typeof saveState === 'function') saveState();
}

// ═══════════════════════════════════════════════════════════════
// CATEGORIZE BY ATTRIBUTE
// ═══════════════════════════════════════════════════════════════
function ctxCategorizeBy(field) {
  if (!ctxTargetLayer || !ctxTargetLayer._manaGroupId) return;
  if (typeof pushUndo === 'function') pushUndo();
  const gid = ctxTargetLayer._manaGroupId;
  const meta = _manaGroupMeta[gid];
  if (!meta) return;

  // Collect unique values for this field
  const valSet = new Set();
  meta.allLayers.forEach(l => {
    const v = (l._manaProperties || {})[field];
    if (v !== null && v !== undefined && String(v) !== '') valSet.add(String(v));
  });

  const uniqueVals = [...valSet].sort();
  const colorMap = {};
  uniqueVals.forEach((v, i) => {
    colorMap[v] = CTX_PALETTE[i % CTX_PALETTE.length];
  });

  // Apply colors
  meta.allLayers.forEach(l => {
    const raw = (l._manaProperties || {})[field];
    const v = (raw !== null && raw !== undefined) ? String(raw) : '';
    const c = colorMap[v] || '#64748b';
    if (l instanceof L.Marker) {
      l._manaColor = c;
      l.setIcon(makeMarkerIcon(c, markerType));
    } else {
      l.setStyle({ color: c, weight: l.options.weight || 2 });
    }
  });

  closeCtx(); stats();
  showToast(t('toast_categorized') + ' ' + field + ' (' + uniqueVals.length + ' ' + t('toast_categorized_values') + ')');
  if (typeof saveState === 'function') saveState();
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
  if (typeof pushUndo === 'function') pushUndo();
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
  if (typeof saveState === 'function') saveState();
}

function lctxSetWeight(w) {
  _getLctxLayers().forEach(l => {
    if (!(l instanceof L.Marker)) l.setStyle({ weight: w });
  });
  document.querySelectorAll('#layer-ctx-menu .ctx-weight-btn').forEach(b => {
    b.classList.toggle('active', b.textContent.trim() === String(w));
  });
  showToast('Grosor: ' + w + 'px');
  if (typeof saveState === 'function') saveState();
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
  if (typeof saveState === 'function') saveState();
}

async function lctxRename() {
  closeLayerCtx();
  if (typeof pushUndo === 'function') pushUndo();
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
  if (typeof saveState === 'function') saveState();
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
  if (typeof pushUndo === 'function') pushUndo();
  const meta = _manaGroupMeta[_lctxId];
  if (!meta) return;

  const valSet = new Set();
  meta.allLayers.forEach(l => {
    const v = (l._manaProperties || {})[field];
    if (v !== null && v !== undefined && String(v) !== '') valSet.add(String(v));
  });

  const uniqueVals = [...valSet].sort();
  const colorMap = {};
  uniqueVals.forEach((v, i) => {
    colorMap[v] = CTX_PALETTE[i % CTX_PALETTE.length];
  });

  meta.allLayers.forEach(l => {
    const raw = (l._manaProperties || {})[field];
    const v = (raw !== null && raw !== undefined) ? String(raw) : '';
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
  if (typeof saveState === 'function') saveState();
}

async function lctxDelete() {
  closeLayerCtx();
  if (typeof pushUndo === 'function') pushUndo();
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
    if (typeof saveState === 'function') saveState();
  }
}


// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
// PROPERTY EDITOR \u2014 Notion-style key-value modal
// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
var _propLayer = null;
var _propGroupLayers = [];
var _propHighlight = null;

function lctxShowAttrTable() {
  closeLayerCtx();
  var layers = _getLctxLayers();
  if (!layers.length) return;
  _propGroupLayers = layers.length > 1 ? layers : [];
  _propLayer = layers[0];
  _openPropModal();
}

function ctxShowAttrTable() {
  if (!ctxTargetLayer) return;
  closeCtx();
  var gid = ctxTargetLayer._manaGroupId;
  if (gid && _manaGroupMeta[gid]) {
    _propGroupLayers = _manaGroupMeta[gid].allLayers.slice();
  } else {
    _propGroupLayers = [];
  }
  _propLayer = ctxTargetLayer;
  _openPropModal();
}

function _openPropModal() {
  _buildPropEditor();
  document.getElementById("attr-modal").classList.add("open");
}

function closeAttrModal() {
  document.getElementById("attr-modal").classList.remove("open");
  _propLayer = null;
  _propGroupLayers = [];
  if (_propHighlight) {
    try { map.removeLayer(_propHighlight); } catch(e) {}
    _propHighlight = null;
  }
}
function closeAttributeDrawer() { closeAttrModal(); }

document.addEventListener("DOMContentLoaded", function() {
  var modal = document.getElementById("attr-modal");
  if (modal) modal.addEventListener("mousedown", function(e) {
    if (e.target === modal) closeAttrModal();
  });
});

// \u2550\u2550\u2550 BUILD \u2550\u2550\u2550
function _buildPropEditor() {
  if (!_propLayer) return;
  var title = document.getElementById("attr-modal-title");
  var body = document.getElementById("attr-modal-body");
  var selector = document.getElementById("attr-elem-selector");

  title.textContent = _propLayer._manaName || "Propiedades";

  // Element selector for groups
  if (_propGroupLayers.length > 1) {
    selector.style.display = "flex";
    selector.innerHTML = "";
    _propGroupLayers.forEach(function(l, i) {
      var btn = document.createElement("button");
      btn.className = "attr-elem-btn" + (l === _propLayer ? " active" : "");
      var nm = l._manaName || ("Elemento " + (i + 1));
      btn.textContent = nm.length > 20 ? nm.substring(0, 18) + "\u2026" : nm;
      btn.setAttribute("data-idx", i);
      btn.onclick = function() { _propSelectElem(+this.dataset.idx); };
      selector.appendChild(btn);
    });
  } else {
    selector.style.display = "none";
  }

  // Collect properties
  var props = _propLayer._manaProperties || {};
  var entries = [{ key: "name", val: _propLayer._manaName || "" }];
  Object.keys(props).forEach(function(k) {
    if (k.charAt(0) === "_" || k === "bbox" || k === "name") return;
    var v = props[k];
    entries.push({ key: k, val: (v !== null && v !== undefined) ? String(v) : "" });
  });

  // Build rows using DOM (avoids all quoting issues)
  body.innerHTML = "";
  entries.forEach(function(entry, i) {
    var isName = (entry.key === "name");
    var row = document.createElement("div");
    row.className = "prop-row";
    row.setAttribute("data-idx", i);

    // \u2500 Key column \u2500
    var keyDiv = document.createElement("div");
    keyDiv.className = "prop-key";

    var icon = document.createElement("span");
    icon.className = "prop-icon";
    icon.textContent = isName ? "Aa" : "\u2261";
    keyDiv.appendChild(icon);

    var keyText = document.createElement("span");
    keyText.className = "prop-key-text" + (isName ? " is-fixed" : "");
    keyText.textContent = isName ? "nombre" : entry.key;
    if (!isName) {
      keyText.contentEditable = "true";
      keyText.spellcheck = false;
      keyText.setAttribute("data-oldkey", entry.key);
      keyText.addEventListener("blur", function() { _propRenameKey(this); });
      keyText.addEventListener("keydown", function(e) {
        if (e.key === "Enter") { e.preventDefault(); this.blur(); }
      });
    }
    keyDiv.appendChild(keyText);
    row.appendChild(keyDiv);

    // \u2500 Value column \u2500
    var valDiv = document.createElement("div");
    valDiv.className = "prop-val";

    var valText = document.createElement("span");
    valText.className = "prop-val-text";
    valText.contentEditable = "true";
    valText.spellcheck = false;
    valText.textContent = entry.val;
    valText.setAttribute("data-idx", i);
    valText.setAttribute("data-key", entry.key);
    valText.addEventListener("blur", function() { _propSaveVal(this); });
    valText.addEventListener("keydown", function(e) { _propValKey(e, this); });
    valDiv.appendChild(valText);
    row.appendChild(valDiv);

    // \u2500 Delete button \u2500
    if (!isName) {
      var del = document.createElement("button");
      del.className = "prop-del";
      del.title = "Eliminar";
      del.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      del.setAttribute("data-key", entry.key);
      del.onclick = function() { _propDeleteAttr(this.dataset.key); };
      row.appendChild(del);
    } else {
      var ph = document.createElement("div");
      ph.className = "prop-del-ph";
      row.appendChild(ph);
    }

    body.appendChild(row);
  });

  if (entries.length <= 1) {
    var empty = document.createElement("div");
    empty.className = "prop-empty";
    empty.textContent = "Sin atributos adicionales";
    body.appendChild(empty);
  }
}

// \u2550\u2550\u2550 ELEMENT SELECTOR \u2550\u2550\u2550
function _propSelectElem(idx) {
  _propLayer = _propGroupLayers[idx];
  _buildPropEditor();
  if (_propLayer.getBounds) map.fitBounds(_propLayer.getBounds(), { maxZoom: 15, padding: [24,24] });
  else if (_propLayer.getLatLng) map.setView(_propLayer.getLatLng(), 15);
  if (_propHighlight) { try { map.removeLayer(_propHighlight); } catch(e) {} }
  if (_propLayer instanceof L.Marker) {
    _propHighlight = L.circleMarker(_propLayer.getLatLng(), {
      radius: 18, color: "#0ea5e9", weight: 3, fillOpacity: 0.15, dashArray: "4 4"
    }).addTo(map);
  } else if (_propLayer.getLatLngs) {
    var C = (_propLayer instanceof L.Polygon) ? L.polygon : L.polyline;
    _propHighlight = C(_propLayer.getLatLngs(), {
      color: "#0ea5e9", weight: 5, fillOpacity: 0.12, dashArray: "6 4"
    }).addTo(map);
  }
  setTimeout(function() {
    if (_propHighlight) { try { map.removeLayer(_propHighlight); } catch(e) {} _propHighlight = null; }
  }, 2500);
}

// \u2550\u2550\u2550 EDITING \u2550\u2550\u2550
function _propSaveVal(el) {
  if (!_propLayer) return;
  var key = el.dataset.key;
  var newVal = el.textContent.trim();
  if (key === "name") {
    _propLayer._manaName = newVal;
    if (_propLayer.getPopup && _propLayer.getPopup()) _propLayer.setPopupContent("<strong>" + newVal + "</strong>");
    document.getElementById("attr-modal-title").textContent = newVal || "Propiedades";
    if (_propGroupLayers.length > 1) {
      var idx = _propGroupLayers.indexOf(_propLayer);
      var btns = document.querySelectorAll(".attr-elem-btn");
      if (btns[idx]) btns[idx].textContent = newVal.length > 20 ? newVal.substring(0,18) + "\u2026" : newVal;
    }
  } else {
    if (!_propLayer._manaProperties) _propLayer._manaProperties = {};
    var num = parseFloat(newVal);
    _propLayer._manaProperties[key] = (newVal !== "" && !isNaN(num) && String(num) === newVal) ? num : newVal;
  }
  if (typeof saveState === "function") saveState();
}

function _propRenameKey(el) {
  if (!_propLayer) return;
  var oldKey = el.dataset.oldkey;
  var newKey = el.textContent.trim();
  if (!newKey || newKey === oldKey) { el.textContent = oldKey; return; }
  if (!_propLayer._manaProperties) return;
  if (_propLayer._manaProperties.hasOwnProperty(oldKey)) {
    _propLayer._manaProperties[newKey] = _propLayer._manaProperties[oldKey];
    delete _propLayer._manaProperties[oldKey];
  }
  var gid = _propLayer._manaGroupId;
  if (gid && _manaGroupMeta[gid]) {
    if (_manaGroupMeta[gid].attrs[oldKey]) {
      _manaGroupMeta[gid].attrs[newKey] = _manaGroupMeta[gid].attrs[oldKey];
      delete _manaGroupMeta[gid].attrs[oldKey];
    }
    // Rename in ALL features of the group (QGIS-style schema)
    _manaGroupMeta[gid].allLayers.forEach(function(l) {
      if (l._manaProperties && l._manaProperties.hasOwnProperty(oldKey)) {
        l._manaProperties[newKey] = l._manaProperties[oldKey];
        delete l._manaProperties[oldKey];
      }
    });
  }
  _buildPropEditor();
  showToast("Renombrado: " + newKey);
  if (typeof saveState === "function") saveState();
}

function _propValKey(e, el) {
  if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
    e.preventDefault();
    el.blur();
    var idx = +el.dataset.idx;
    var next = e.shiftKey ? idx - 1 : idx + 1;
    var nextEl = document.querySelector('.prop-val-text[data-idx="' + next + '"]');
    if (nextEl) {
      nextEl.focus();
      var r = document.createRange(); r.selectNodeContents(nextEl);
      var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    }
  } else if (e.key === "Escape") { el.blur(); }
}

function attrAddProperty() {
  if (!_propLayer) return;
  if (!_propLayer._manaProperties) _propLayer._manaProperties = {};

  var body = document.getElementById("attr-modal-body");

  // Remove "sin atributos" message if present
  var empty = body.querySelector(".prop-empty");
  if (empty) empty.remove();

  // Build new row using DOM
  var idx = body.querySelectorAll(".prop-row").length;
  var row = document.createElement("div");
  row.className = "prop-row prop-row-new";
  row.setAttribute("data-idx", idx);

  // Key column
  var keyDiv = document.createElement("div");
  keyDiv.className = "prop-key";
  var icon = document.createElement("span");
  icon.className = "prop-icon";
  icon.textContent = "\u2261";
  keyDiv.appendChild(icon);
  var keyText = document.createElement("span");
  keyText.className = "prop-key-text";
  keyText.contentEditable = "true";
  keyText.spellcheck = false;
  keyText.setAttribute("data-newrow", "true");
  keyText.addEventListener("blur", function() {
    var name = this.textContent.trim();
    if (!name) { row.remove(); return; }
    // Commit: save to ALL features in the group (QGIS-style schema)
    _propLayer._manaProperties[name] = "";
    var gid = _propLayer._manaGroupId;
    if (gid && _manaGroupMeta[gid]) {
      if (!_manaGroupMeta[gid].attrs[name]) {
        _manaGroupMeta[gid].attrs[name] = { type: "string", values: new Set() };
      }
      // Propagate to all features in the group
      _manaGroupMeta[gid].allLayers.forEach(function(l) {
        if (!l._manaProperties) l._manaProperties = {};
        if (!(name in l._manaProperties)) l._manaProperties[name] = "";
      });
    }
    if (typeof saveState === "function") saveState();
    // Rebuild so it gets proper event handlers
    _buildPropEditor();
    // Focus the value of the newly added row
    requestAnimationFrame(function() {
      var allVals = document.querySelectorAll(".prop-val-text");
      if (allVals.length) allVals[allVals.length - 1].focus();
    });
  });
  keyText.addEventListener("keydown", function(e) {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      this.blur();
    } else if (e.key === "Escape") {
      this.textContent = "";
      this.blur();
    }
  });
  keyDiv.appendChild(keyText);
  row.appendChild(keyDiv);

  // Value column (placeholder until key is committed)
  var valDiv = document.createElement("div");
  valDiv.className = "prop-val";
  var valText = document.createElement("span");
  valText.className = "prop-val-text prop-val-placeholder";
  valText.textContent = "";
  valDiv.appendChild(valText);
  row.appendChild(valDiv);

  // Delete placeholder
  var ph = document.createElement("div");
  ph.className = "prop-del-ph";
  row.appendChild(ph);

  body.appendChild(row);

  // Scroll to bottom and focus the key field
  body.scrollTop = body.scrollHeight;
  requestAnimationFrame(function() { keyText.focus(); });
}


function _propDeleteAttr(key) {
  if (!_propLayer || key === "name") return;
  if (_propLayer._manaProperties) delete _propLayer._manaProperties[key];
  var gid = _propLayer._manaGroupId;
  if (gid && _manaGroupMeta[gid]) {
    delete _manaGroupMeta[gid].attrs[key];
    // Remove from ALL features in the group (QGIS-style schema)
    _manaGroupMeta[gid].allLayers.forEach(function(l) {
      if (l._manaProperties) delete l._manaProperties[key];
    });
  }
  _buildPropEditor();
  showToast("Atributo eliminado");
  if (typeof saveState === "function") saveState();
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
