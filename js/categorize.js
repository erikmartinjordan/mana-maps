// ── categorize.js ─ QGIS-style categorization panel ──

const CATEGORY_PALETTE = [
  '#0ea5e9','#ef4444','#10b981','#f59e0b',
  '#8b5cf6','#ec4899','#f97316','#6366f1',
  '#64748b','#30363b'
];

// ═══════════════════════════════════════════════════════════════
// ENTRY POINTS — replace direct auto-apply with panel builder
// ═══════════════════════════════════════════════════════════════

// Called from sidebar layer context menu (replaces old lctxCategorize)
function lctxCategorize(field) {
  if (_lctxType !== 'group') return;
  const container = document.getElementById('lctx-cat-list');
  buildCategorizationPanel(_lctxId, field, container, 'lctx');
}

// Called from map right-click context menu (replaces old ctxCategorizeBy)
function ctxCategorizeBy(field) {
  if (!ctxTargetLayer || !ctxTargetLayer._manaGroupId) return;
  const gid = ctxTargetLayer._manaGroupId;
  const container = document.getElementById('ctx-categorize-list');
  buildCategorizationPanel(gid, field, container, 'ctx');
}

// ═══════════════════════════════════════════════════════════════
// BUILD CATEGORIZATION PANEL
// ═══════════════════════════════════════════════════════════════
function buildCategorizationPanel(groupId, field, container, source) {
  const meta = _manaGroupMeta[groupId];
  if (!meta) return;

  // Collect unique values
  const valSet = new Set();
  meta.allLayers.forEach(l => {
    const v = (l._manaProperties || {})[field];
    if (v !== null && v !== undefined && String(v) !== '') valSet.add(String(v));
  });
  const uniqueVals = [...valSet].sort();

  // Assign initial colors from palette
  const colorMap = {};
  uniqueVals.forEach((v, i) => {
    colorMap[v] = CATEGORY_PALETTE[i % CATEGORY_PALETTE.length];
  });
  let fallbackColor = '#94a3b8';

  // ── Render ──
  _renderCatPanel(container, groupId, field, uniqueVals, colorMap, fallbackColor, source);
}

function _renderCatPanel(container, groupId, field, uniqueVals, colorMap, fallbackColor, source) {
  // Header
  let html = '<div style="display:flex;align-items:center;gap:6px;padding:6px 4px 8px;">';
  html += '<button class="cat-back-btn" onclick="_catGoBack(\'' + source + '\',\'' + groupId + '\')" style="background:none;border:none;cursor:pointer;color:var(--text-3,#9ca3af);font-size:16px;padding:2px 4px;" title="Volver">←</button>';
  html += '<span style="font-size:11px;font-weight:600;color:var(--text-2,#374151);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Campo: ' + _escHtml(field) + '</span>';
  html += '<button onclick="_catRandomize(\'' + _escAttr(groupId) + '\',\'' + _escAttr(field) + '\')" style="font-size:10px;padding:3px 8px;border-radius:4px;border:0.5px solid var(--border,#e5e7eb);background:var(--surface-2,#f3f4f6);cursor:pointer;color:var(--text-2,#374151);font-family:inherit;font-weight:600;">Aleatorio</button>';
  html += '</div>';

  // Empty state
  if (!uniqueVals.length) {
    html += '<div style="padding:12px 8px;font-size:12px;color:var(--text-3,#9ca3af);font-style:italic;">Ninguna feature contiene el campo \'' + _escHtml(field) + '\'.</div>';
    html += '<div style="display:flex;gap:6px;justify-content:flex-end;padding:8px 4px;">';
    html += '<button onclick="_catGoBack(\'' + source + '\',\'' + _escAttr(groupId) + '\')" style="font-size:11px;padding:5px 14px;border-radius:50px;border:0.5px solid var(--border);background:var(--surface);cursor:pointer;color:var(--text-2);font-family:inherit;font-weight:600;">Cancelar</button>';
    html += '<button disabled style="font-size:11px;padding:5px 14px;border-radius:50px;border:none;background:#ccc;color:#fff;font-family:inherit;font-weight:600;cursor:not-allowed;">Aplicar</button>';
    html += '</div>';
    container.innerHTML = html;
    return;
  }

  // Rows zone
  html += '<div id="_cat-rows" style="max-height:300px;overflow-y:auto;">';
  uniqueVals.forEach(v => {
    html += _catRowHtml(v, colorMap[v], groupId, field);
  });
  // Separator
  html += '<div style="height:1px;background:var(--border,#e5e7eb);margin:4px 8px;"></div>';
  // Fallback row
  html += _catRowHtml('__fallback__', fallbackColor, groupId, field, true);
  html += '</div>';

  // Actions
  html += '<div style="display:flex;gap:6px;justify-content:flex-end;padding:8px 4px;border-top:0.5px solid var(--border,#e5e7eb);margin-top:4px;">';
  html += '<button onclick="_catGoBack(\'' + source + '\',\'' + _escAttr(groupId) + '\')" style="font-size:11px;padding:5px 14px;border-radius:50px;border:0.5px solid var(--border);background:var(--surface,#fff);cursor:pointer;color:var(--text-2,#374151);font-family:inherit;font-weight:600;">Cancelar</button>';
  html += '<button onclick="_catApply(\'' + _escAttr(groupId) + '\',\'' + _escAttr(field) + '\',\'' + source + '\')" style="font-size:11px;padding:5px 14px;border-radius:50px;border:none;background:#1a1a1a;color:#fff;cursor:pointer;font-family:inherit;font-weight:600;">Aplicar</button>';
  html += '</div>';

  container.innerHTML = html;
}

function _catRowHtml(value, color, groupId, field, isFallback) {
  const label = isFallback ? 'Todos los demás' : value;
  const displayLabel = label.length > 28 ? label.substring(0, 28) + '…' : label;
  const id = '_cat-' + (isFallback ? 'fallback' : _hashStr(value));

  let html = '<div class="cat-row" data-value="' + _escAttr(value) + '" style="display:flex;align-items:center;gap:6px;padding:3px 8px;height:30px;font-size:12px;">';

  // Hidden native color picker
  html += '<input type="color" id="' + id + '-picker" value="' + color + '" style="position:absolute;width:0;height:0;opacity:0;pointer-events:none;" onchange="_catSyncFromPicker(this)">';

  // Swatch
  html += '<div class="cat-swatch" onclick="document.getElementById(\'' + id + '-picker\').click()" style="width:14px;height:14px;border-radius:3px;background:' + color + ';cursor:pointer;flex-shrink:0;border:0.5px solid rgba(0,0,0,0.1);" data-id="' + id + '"></div>';

  // Value label
  html += '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-2,#374151);" title="' + _escAttr(label) + '">' + _escHtml(displayLabel) + '</span>';

  // Hex input
  html += '<input type="text" maxlength="7" value="' + color + '" class="cat-hex" data-id="' + id + '" onchange="_catSyncFromHex(this)" style="width:62px;font-size:10px;font-family:monospace;padding:2px 4px;border:0.5px solid var(--border,#e5e7eb);border-radius:3px;background:var(--surface-3,#f9fafb);color:var(--text,#1a1a1a);text-align:center;">';

  // Remove button (not for fallback)
  if (!isFallback) {
    html += '<button onclick="_catRemoveRow(this)" style="background:none;border:none;cursor:pointer;color:var(--text-3,#9ca3af);font-size:14px;padding:0 2px;line-height:1;" title="Eliminar">×</button>';
  }

  html += '</div>';
  return html;
}

// ═══════════════════════════════════════════════════════════════
// PANEL INTERACTIONS
// ═══════════════════════════════════════════════════════════════

function _catSyncFromPicker(picker) {
  const id = picker.id.replace('-picker', '');
  const swatch = document.querySelector('.cat-swatch[data-id="' + id + '"]');
  const hex = document.querySelector('.cat-hex[data-id="' + id + '"]');
  if (swatch) swatch.style.background = picker.value;
  if (hex) hex.value = picker.value;
}

function _catSyncFromHex(input) {
  const val = input.value.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(val)) return;
  const id = input.dataset.id;
  const swatch = document.querySelector('.cat-swatch[data-id="' + id + '"]');
  const picker = document.getElementById(id + '-picker');
  if (swatch) swatch.style.background = val;
  if (picker) picker.value = val;
}

function _catRemoveRow(btn) {
  const row = btn.closest('.cat-row');
  if (row) row.remove();
}

function _catRandomize(groupId, field) {
  const rows = document.querySelectorAll('#_cat-rows .cat-row');
  rows.forEach(row => {
    if (row.dataset.value === '__fallback__') return;
    const h = Math.floor(Math.random() * 360);
    const s = 60 + Math.floor(Math.random() * 15);
    const l = 48 + Math.floor(Math.random() * 10);
    const hex = _hslToHex(h, s, l);
    const id = row.querySelector('.cat-swatch')?.dataset.id;
    if (!id) return;
    const swatch = row.querySelector('.cat-swatch');
    const hexInput = row.querySelector('.cat-hex');
    const picker = document.getElementById(id + '-picker');
    if (swatch) swatch.style.background = hex;
    if (hexInput) hexInput.value = hex;
    if (picker) picker.value = hex;
  });
}

function _catGoBack(source, groupId) {
  // Re-render the original attribute list
  if (source === 'lctx') {
    _rebuildAttrList(document.getElementById('lctx-cat-list'), groupId, 'lctxCategorize');
  } else {
    _rebuildAttrList(document.getElementById('ctx-categorize-list'), groupId, 'ctxCategorizeBy');
  }
}

function _rebuildAttrList(container, groupId, fnName) {
  const meta = _manaGroupMeta[groupId];
  if (!meta) return;
  const attrs = Object.keys(meta.attrs);
  container.innerHTML = attrs.map(a => {
    const count = meta.attrs[a].values.size;
    return '<button class="ctx-item ctx-cat-item" onclick="' + fnName + '(\'' +
      a.replace(/'/g, "\\'") + '\')">' +
      '<span class="ctx-cat-field">' + a + '</span>' +
      '<span class="ctx-cat-count">' + count + ' val.</span></button>';
  }).join('');
}

// ═══════════════════════════════════════════════════════════════
// APPLY CATEGORIZATION
// ═══════════════════════════════════════════════════════════════
function _catApply(groupId, field, source) {
  if (typeof pushUndo === 'function') pushUndo();

  const meta = _manaGroupMeta[groupId];
  if (!meta) return;

  // Read colors from DOM rows
  const colorMap = {};
  let fallbackColor = '#94a3b8';
  const rows = document.querySelectorAll('#_cat-rows .cat-row');
  rows.forEach(row => {
    const val = row.dataset.value;
    const hex = row.querySelector('.cat-hex')?.value || '#94a3b8';
    if (val === '__fallback__') {
      fallbackColor = hex;
    } else {
      colorMap[val] = hex;
    }
  });

  applyCategorizationToGroup(groupId, field, colorMap, fallbackColor);

  // Close menu
  if (source === 'lctx') { if (typeof closeLayerCtx === 'function') closeLayerCtx(); }
  else { if (typeof closeCtx === 'function') closeCtx(); }

  showToast('Categorizado por ' + field + ' (' + Object.keys(colorMap).length + ' valores)');
  if (typeof saveState === 'function') saveState();
}

function applyCategorizationToGroup(groupId, field, colorMap, fallbackColor) {
  const meta = _manaGroupMeta[groupId];
  if (!meta) return;

  // Apply colors to each layer
  meta.allLayers.forEach(l => {
    const raw = (l._manaProperties || {})[field];
    const v = (raw !== null && raw !== undefined) ? String(raw) : '';
    const c = colorMap[v] ?? fallbackColor;
    if (l instanceof L.Marker) {
      l._manaColor = c;
      l.setIcon(makeMarkerIcon(c, l._manaMarkerType || markerType));
    } else if (l.setStyle) {
      l.setStyle({ color: c, fillColor: c });
    }
  });

  // Store categorization metadata on group
  meta.categorization = { field: field, colorMap: colorMap, fallback: fallbackColor };

  // Update sidebar legend
  _renderCatLegend(groupId, field, colorMap, fallbackColor);
  stats();
}

// ═══════════════════════════════════════════════════════════════
// SIDEBAR LEGEND
// ═══════════════════════════════════════════════════════════════
function _renderCatLegend(groupId, field, colorMap, fallbackColor) {
  // Find the group header element in the sidebar
  const groupEl = document.querySelector('.layer-group[data-group-id="' + groupId + '"]');
  if (!groupEl) return;

  // Remove existing legend
  const old = groupEl.querySelector('.cat-legend');
  if (old) old.remove();

  const legend = document.createElement('div');
  legend.className = 'cat-legend';
  legend.style.cssText = 'padding:4px 10px 6px 28px;font-size:10px;border-top:0.5px solid var(--border,#e5e7eb);';

  let items = '';
  for (const [val, hex] of Object.entries(colorMap)) {
    items += '<div style="display:flex;align-items:center;gap:5px;padding:1px 0;">' +
      '<div style="width:10px;height:10px;border-radius:2px;background:' + hex + ';flex-shrink:0;"></div>' +
      '<span style="color:var(--text-2,#374151);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _escHtml(val) + '</span></div>';
  }
  items += '<div style="display:flex;align-items:center;gap:5px;padding:1px 0;">' +
    '<div style="width:10px;height:10px;border-radius:2px;background:' + fallbackColor + ';flex-shrink:0;"></div>' +
    '<span style="color:var(--text-3,#9ca3af);font-style:italic;">Otros</span></div>';

  legend.innerHTML = items;
  groupEl.appendChild(legend);
}

// ═══════════════════════════════════════════════════════════════
// EXPORT HOOK — include categorization in GeoJSON
// ═══════════════════════════════════════════════════════════════
(function() {
  const _origGetCurrentGeoJSON = typeof getCurrentGeoJSON === 'function' ? getCurrentGeoJSON : null;
  if (!_origGetCurrentGeoJSON) return;

  // Monkey-patch getCurrentGeoJSON to add categorization metadata
  window.getCurrentGeoJSON = function() {
    const gj = _origGetCurrentGeoJSON();
    // Add categorization info per group
    const cats = {};
    for (const gid in _manaGroupMeta) {
      const meta = _manaGroupMeta[gid];
      if (meta.categorization) {
        cats[meta.name || gid] = meta.categorization;
      }
    }
    if (Object.keys(cats).length) {
      gj.categorization = cats;
    }
    return gj;
  };
})();

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════
function _escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function _escAttr(s) { return String(s).replace(/'/g, "\\'").replace(/"/g, '&quot;'); }
function _hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; } return Math.abs(h).toString(36); }
function _hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const f = n => { const k = (n + h / 30) % 12; const a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return '#' + [f(0), f(8), f(4)].map(x => x.toString(16).padStart(2, '0')).join('');
}
