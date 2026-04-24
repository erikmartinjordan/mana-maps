// ── categorize.js ─ "Style by Attribute" — instant palette-based styling ──

// ═══════════════════════════════════════════════════════════════
// PALETTES
// ═══════════════════════════════════════════════════════════════
const PALETTES_QUAL = {
  vivid:  ['#0ea5e9','#ef4444','#10b981','#f59e0b','#8b5cf6','#ec4899','#f97316','#6366f1','#14b8a6','#a855f7'],
  pastel: ['#93c5fd','#fca5a5','#86efac','#fde68a','#c4b5fd','#fbcfe8','#fdba74','#a5b4fc','#99f6e4','#d8b4fe'],
  earth:  ['#92400e','#065f46','#1e3a5f','#78350f','#3b0764','#831843','#7c2d12','#134e4a','#1e1b4b','#4a044e'],
  bold:   ['#dc2626','#2563eb','#16a34a','#d97706','#9333ea','#db2777','#ea580c','#4f46e5','#0d9488','#7c3aed'],
  muted:  ['#64748b','#6b7280','#71717a','#737373','#78716c','#57534e','#525252','#44403c','#3f3f46','#374151'],
};
const PALETTES_SEQ = {
  blues:   ['#eff6ff','#bfdbfe','#60a5fa','#2563eb','#1e40af'],
  greens:  ['#f0fdf4','#bbf7d0','#4ade80','#16a34a','#14532d'],
  reds:    ['#fef2f2','#fecaca','#f87171','#dc2626','#7f1d1d'],
  oranges: ['#fff7ed','#fed7aa','#fb923c','#ea580c','#7c2d12'],
  purples: ['#faf5ff','#e9d5ff','#a855f7','#7e22ce','#3b0764'],
};
const QUAL_NAMES = Object.keys(PALETTES_QUAL);
const SEQ_NAMES  = Object.keys(PALETTES_SEQ);
const FALLBACK_COLOR = '#94a3b8';

// ═══════════════════════════════════════════════════════════════
// STATE — tracks the active panel so palette/swatch clicks work
// ═══════════════════════════════════════════════════════════════
let _catState = null;
// { groupId, field, mode:'categorized'|'graduated', palette, container, source,
//   uniqueVals, colorMap, fallback, breaks, overrides:Set }

// ═══════════════════════════════════════════════════════════════
// ENTRY POINTS (signatures preserved for context-menu.js)
// ═══════════════════════════════════════════════════════════════
function lctxCategorize(field) {
  if (_lctxType !== 'group') return;
  _initCat(_lctxId, field, document.getElementById('lctx-cat-list'), 'lctx');
}

function ctxCategorizeBy(field) {
  if (!ctxTargetLayer || !ctxTargetLayer._manaGroupId) return;
  _initCat(ctxTargetLayer._manaGroupId, field, document.getElementById('ctx-categorize-list'), 'ctx');
}

// ═══════════════════════════════════════════════════════════════
// INIT — detect mode, build colorMap, render, apply instantly
// ═══════════════════════════════════════════════════════════════
function _initCat(groupId, field, container, source) {
  const meta = _manaGroupMeta[groupId];
  if (!meta) return;
  if (typeof pushUndo === 'function') pushUndo();

  // Collect unique values
  const valSet = new Set();
  meta.allLayers.forEach(l => {
    const v = (l._manaProperties || {})[field];
    if (v !== null && v !== undefined && String(v) !== '') valSet.add(String(v));
  });
  const uniqueVals = [...valSet].sort();

  // Detect mode
  const isNumeric = meta.attrs[field] && meta.attrs[field].type === 'number' && uniqueVals.length > 6;
  const mode = isNumeric ? 'graduated' : 'categorized';
  const paletteName = isNumeric ? SEQ_NAMES[0] : QUAL_NAMES[0];

  _catState = {
    groupId, field, mode, palette: paletteName,
    container, source, uniqueVals,
    colorMap: {}, fallback: FALLBACK_COLOR,
    breaks: [], overrides: new Set(),
  };

  _applyPalette(paletteName);   // builds colorMap/breaks + applies to map
  _renderPanel();               // renders panel UI
}

// ═══════════════════════════════════════════════════════════════
// APPLY PALETTE — builds colorMap from palette, colors the map
// ═══════════════════════════════════════════════════════════════
function _applyPalette(paletteName) {
  const s = _catState;
  if (!s) return;
  s.palette = paletteName;
  const meta = _manaGroupMeta[s.groupId];
  if (!meta) return;

  if (s.mode === 'graduated') {
    const ramp = PALETTES_SEQ[paletteName] || PALETTES_SEQ[SEQ_NAMES[0]];
    const nums = [];
    meta.allLayers.forEach(l => {
      const v = Number((l._manaProperties || {})[s.field]);
      if (!isNaN(v)) nums.push(v);
    });
    const min = Math.min.apply(null, nums);
    const max = Math.max.apply(null, nums);
    const step = (max - min) / ramp.length || 1;
    s.breaks = [];
    for (let i = 0; i <= ramp.length; i++) s.breaks.push(+(min + step * i).toPrecision(6));
    s.breaks[s.breaks.length - 1] = max; // ensure exact max

    // Build colorMap by class index
    s.colorMap = {};
    for (let i = 0; i < ramp.length; i++) s.colorMap['__class_' + i] = ramp[i];
    s.fallback = FALLBACK_COLOR;

    // Apply to layers
    meta.allLayers.forEach(l => {
      const v = Number((l._manaProperties || {})[s.field]);
      const c = isNaN(v) ? s.fallback : _classColor(v, s.breaks, ramp);
      _setLayerColor(l, c);
    });

  } else {
    const pal = PALETTES_QUAL[paletteName] || PALETTES_QUAL[QUAL_NAMES[0]];
    s.colorMap = {};
    s.uniqueVals.forEach((v, i) => {
      // Keep overridden colors
      if (s.overrides.has(v) && s.colorMap[v]) return;
      s.colorMap[v] = pal[i % pal.length];
    });

    // Apply to layers
    meta.allLayers.forEach(l => {
      const raw = (l._manaProperties || {})[s.field];
      const v = (raw !== null && raw !== undefined) ? String(raw) : '';
      const c = s.colorMap[v] || s.fallback;
      _setLayerColor(l, c);
    });
  }

  // Store on meta
  meta.categorization = {
    field: s.field, mode: s.mode, palette: s.palette,
    colorMap: Object.assign({}, s.colorMap), fallback: s.fallback,
    breaks: s.breaks.slice(),
  };
  _renderCatLegend(s.groupId, s);
  if (typeof stats === 'function') stats();
  if (typeof saveState === 'function') saveState();
}

function _classColor(value, breaks, ramp) {
  for (let i = 0; i < breaks.length - 1; i++) {
    if (value <= breaks[i + 1]) return ramp[Math.min(i, ramp.length - 1)];
  }
  return ramp[ramp.length - 1];
}

function _setLayerColor(layer, color) {
  if (layer instanceof L.Marker) {
    layer._manaColor = color;
    layer.setIcon(makeMarkerIcon(color, layer._manaMarkerType || markerType));
  } else if (layer.setStyle) {
    layer.setStyle({ color: color, fillColor: color });
  }
}

// ═══════════════════════════════════════════════════════════════
// RENDER PANEL
// ═══════════════════════════════════════════════════════════════
function _renderPanel() {
  const s = _catState;
  if (!s || !s.container) return;
  const names = s.mode === 'graduated' ? SEQ_NAMES : QUAL_NAMES;
  const pals  = s.mode === 'graduated' ? PALETTES_SEQ : PALETTES_QUAL;

  // Header
  let h = '<div class="cat-header">';
  h += '<button class="cat-back" onclick="_catGoBack()" title="' + t('ctx_back') + '">←</button>';
  h += '<span class="cat-field-label">' + _esc(s.field) + '</span>';
  h += '<button class="cat-reset-btn" onclick="_catReset()">' + t('cat_reset') + '</button>';
  h += '</div>';

  // Palette dots
  h += '<div class="cat-palette-row">';
  names.forEach(function(name) {
    var colors = pals[name];
    var active = name === s.palette ? ' cat-dot-active' : '';
    // Show a mini gradient for sequential, first color for qualitative
    var bg = s.mode === 'graduated'
      ? 'background:linear-gradient(135deg,' + colors[0] + ',' + colors[2] + ',' + colors[4] + ')'
      : 'background:' + colors[0];
    h += '<button class="cat-dot' + active + '" style="' + bg + '" onclick="_catSwitchPalette(\'' + name + '\')" title="' + name + '"></button>';
  });
  h += '</div>';

  // Legend rows
  h += '<div class="cat-rows">';
  if (s.mode === 'graduated') {
    var ramp = pals[s.palette];
    for (var i = 0; i < s.breaks.length - 1; i++) {
      var lo = _fmtNum(s.breaks[i]);
      var hi = _fmtNum(s.breaks[i + 1]);
      h += _legendRow('__class_' + i, ramp[i], lo + ' ' + t('cat_range') + ' ' + hi, false);
    }
  } else {
    if (!s.uniqueVals.length) {
      h += '<div class="cat-empty">' + t('cat_no_values') + '</div>';
    } else {
      var pal = pals[s.palette];
      s.uniqueVals.forEach(function(v, i) {
        var c = s.overrides.has(v) ? s.colorMap[v] : pal[i % pal.length];
        s.colorMap[v] = c;
        h += _legendRow(v, c, v, s.overrides.has(v));
      });
    }
    // Fallback
    h += '<div class="cat-sep"></div>';
    h += _legendRow('__fallback__', s.fallback, t('cat_others'), false, true);
  }
  h += '</div>';

  s.container.innerHTML = h;

  // Toast
  var count = s.mode === 'graduated' ? (s.breaks.length - 1) : s.uniqueVals.length;
  showToast(t('cat_toast') + ' ' + s.field + ' (' + count + ' ' + t('cat_values') + ')');
}

function _legendRow(dataVal, color, label, isOverridden, isFallback) {
  var displayLabel = label.length > 30 ? label.substring(0, 30) + '…' : label;
  var cls = isFallback ? ' cat-row-fallback' : '';
  var dot = isOverridden ? '<span class="cat-override-dot"></span>' : '';
  var h = '<div class="cat-row' + cls + '" data-val="' + _escAttr(dataVal) + '">';
  h += '<span class="cat-swatch" style="background:' + color + '" data-color="' + color + '" onclick="_cpOpenForSwatch(this)">' + dot + '</span>';
  h += '<span class="cat-label" title="' + _escAttr(label) + '">' + _esc(displayLabel) + '</span>';
  h += '</div>';
  return h;
}

// ═══════════════════════════════════════════════════════════════
// INTERACTIONS
// ═══════════════════════════════════════════════════════════════
function _catSwitchPalette(name) {
  if (!_catState) return;
  // Preserve overrides: re-apply only non-overridden values
  _applyPalette(name);
  _renderPanel();
}

function _catSwatchChange(swatch, newColor) {
  var s = _catState;
  if (!s) return;
  var row = swatch.closest('.cat-row');
  if (!row) return;
  var val = row.dataset.val;
  var color = newColor;

  // Update state
  if (val === '__fallback__') {
    s.fallback = color;
  } else {
    s.colorMap[val] = color;
    if (!val.startsWith('__class_')) s.overrides.add(val);
  }

  // Update swatch visual
  if (swatch) {
    swatch.style.background = color;
    swatch.dataset.color = color;
    if (!val.startsWith('__class_') && val !== '__fallback__' && !swatch.querySelector('.cat-override-dot')) {
      swatch.innerHTML = '<span class="cat-override-dot"></span>';
    }
  }

  // Re-apply colors to map
  var meta = _manaGroupMeta[s.groupId];
  if (!meta) return;
  meta.allLayers.forEach(function(l) {
    var raw = (l._manaProperties || {})[s.field];
    if (s.mode === 'graduated') {
      var v = Number(raw);
      var c = isNaN(v) ? s.fallback : _classColor(v, s.breaks, _seqRampFromState());
      _setLayerColor(l, c);
    } else {
      var sv = (raw !== null && raw !== undefined) ? String(raw) : '';
      _setLayerColor(l, s.colorMap[sv] || s.fallback);
    }
  });

  meta.categorization = {
    field: s.field, mode: s.mode, palette: s.palette,
    colorMap: Object.assign({}, s.colorMap), fallback: s.fallback,
    breaks: s.breaks.slice(),
  };
  _renderCatLegend(s.groupId, s);
  if (typeof saveState === 'function') saveState();
}

function _seqRampFromState() {
  var s = _catState;
  if (!s) return [];
  var base = PALETTES_SEQ[s.palette] || PALETTES_SEQ[SEQ_NAMES[0]];
  return base.map(function(c, i) { return s.colorMap['__class_' + i] || c; });
}

function _catReset() {
  var s = _catState;
  if (!s) return;
  var meta = _manaGroupMeta[s.groupId];
  if (!meta) return;
  var original = meta.color || '#0ea5e9';

  meta.allLayers.forEach(function(l) { _setLayerColor(l, original); });
  meta.categorization = null;

  // Remove legend
  var groupEl = document.querySelector('.layer-group[data-group-id="' + s.groupId + '"]');
  if (groupEl) { var lg = groupEl.querySelector('.cat-legend'); if (lg) lg.remove(); }

  _catGoBack();
  if (typeof stats === 'function') stats();
  if (typeof saveState === 'function') saveState();
}

function _catGoBack() {
  var s = _catState;
  if (!s) return;
  var fnName = s.source === 'lctx' ? 'lctxCategorize' : 'ctxCategorizeBy';
  _rebuildAttrList(s.container, s.groupId, fnName);
  _catState = null;
}

// ═══════════════════════════════════════════════════════════════
// ATTRIBUTE LIST BUILDER (used by context-menu.js)
// ═══════════════════════════════════════════════════════════════
function _rebuildAttrList(container, groupId, fnName) {
  var meta = _manaGroupMeta[groupId];
  if (!meta) return;
  var attrs = Object.keys(meta.attrs);
  container.innerHTML = attrs.map(function(a) {
    var count = meta.attrs[a].values.size;
    var typeIcon = meta.attrs[a].type === 'number' ? '#' : 'Aa';
    return '<button class="ctx-item ctx-cat-item" onclick="' + fnName + '(\'' +
      a.replace(/'/g, "\\'") + '\')">' +
      '<span class="ctx-cat-field">' + '<span class="cat-type-badge">' + typeIcon + '</span> ' + a + '</span>' +
      '<span class="ctx-cat-count">' + count + ' val.</span></button>';
  }).join('');
}

// ═══════════════════════════════════════════════════════════════
// SIDEBAR LEGEND
// ═══════════════════════════════════════════════════════════════
function _renderCatLegend(groupId, s) {
  var groupEl = document.querySelector('.layer-group[data-group-id="' + groupId + '"]');
  if (!groupEl) return;
  var old = groupEl.querySelector('.cat-legend');
  if (old) old.remove();

  var legend = document.createElement('div');
  legend.className = 'cat-legend';

  var items = '';
  if (s.mode === 'graduated') {
    var ramp = _seqRampFromState();
    for (var i = 0; i < s.breaks.length - 1; i++) {
      items += '<div class="cat-legend-row">' +
        '<span class="cat-legend-swatch" style="background:' + ramp[i] + '"></span>' +
        '<span>' + _fmtNum(s.breaks[i]) + ' – ' + _fmtNum(s.breaks[i + 1]) + '</span></div>';
    }
  } else {
    for (var val in s.colorMap) {
      if (val.startsWith('__')) continue;
      items += '<div class="cat-legend-row">' +
        '<span class="cat-legend-swatch" style="background:' + s.colorMap[val] + '"></span>' +
        '<span>' + _esc(val.length > 20 ? val.substring(0, 20) + '…' : val) + '</span></div>';
    }
    items += '<div class="cat-legend-row">' +
      '<span class="cat-legend-swatch" style="background:' + s.fallback + '"></span>' +
      '<span class="cat-legend-fallback">' + t('cat_others') + '</span></div>';
  }
  legend.innerHTML = items;
  groupEl.appendChild(legend);
}

// ═══════════════════════════════════════════════════════════════
// RESTORE (called by import-export.js on reload)
// ═══════════════════════════════════════════════════════════════
function applyCategorizationToGroup(groupId, field, colorMap, fallbackColor) {
  var meta = _manaGroupMeta[groupId];
  if (!meta) return;
  meta.allLayers.forEach(function(l) {
    var raw = (l._manaProperties || {})[field];
    var v = (raw !== null && raw !== undefined) ? String(raw) : '';
    var c = colorMap[v] || fallbackColor;
    _setLayerColor(l, c);
  });
  meta.categorization = { field: field, mode: 'categorized', palette: 'vivid', colorMap: colorMap, fallback: fallbackColor, breaks: [] };
  _renderCatLegend(groupId, meta.categorization);
  if (typeof stats === 'function') stats();
}

// ═══════════════════════════════════════════════════════════════
// EXPORT HOOK
// ═══════════════════════════════════════════════════════════════
(function() {
  var _orig = typeof getCurrentGeoJSON === 'function' ? getCurrentGeoJSON : null;
  if (!_orig) return;
  window.getCurrentGeoJSON = function() {
    var gj = _orig();
    var cats = {};
    for (var gid in _manaGroupMeta) {
      var m = _manaGroupMeta[gid];
      if (m.categorization) cats[m.name || gid] = m.categorization;
    }
    if (Object.keys(cats).length) gj.categorization = cats;
    return gj;
  };
})();

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════
function _esc(s)     { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function _escAttr(s) { return String(s).replace(/'/g,"\\'").replace(/"/g,'&quot;'); }
function _hash(s)    { var h=0; for(var i=0;i<s.length;i++){h=((h<<5)-h)+s.charCodeAt(i);h|=0;} return Math.abs(h).toString(36); }
function _fmtNum(n)  { return Number(n) === Math.floor(n) ? String(n) : Number(n).toFixed(1); }


// ═══════════════════════════════════════════════════════════════
// CUSTOM COLOR PICKER (replaces native <input type="color">)
// Matches Maña Maps design: white surface, DM Sans/Mono, radius, shadow.
// ═══════════════════════════════════════════════════════════════
var _cpEl = null;
var _cpSwatch = null;
var _cpHue = 0, _cpSat = 1, _cpVal = 1;
var _cpDragging = null;

function _cpOpenForSwatch(swatchEl) {
  var currentColor = swatchEl.dataset.color || '#0ea5e9';
  // Normalize rgb(...) to hex
  if (!currentColor.startsWith('#')) {
    var d = document.createElement('div');
    d.style.color = currentColor;
    document.body.appendChild(d);
    var rgb = getComputedStyle(d).color;
    document.body.removeChild(d);
    var m = rgb.match(/\d+/g);
    if (m) currentColor = '#' + ((1<<24)+(+m[0]<<16)+(+m[1]<<8)+(+m[2])).toString(16).slice(1);
  }
  _cpOpen(swatchEl, currentColor, function(hex) {
    _catSwatchChange(swatchEl, hex);
  });
}

function _cpOpen(anchorEl, hex, onChange) {
  _cpClose();
  _cpSwatch = anchorEl;

  var rgb = _cpHexToRgb(hex);
  var hsv = _cpRgbToHsv(rgb.r, rgb.g, rgb.b);
  _cpHue = hsv.h; _cpSat = hsv.s; _cpVal = hsv.v;

  var el = document.createElement('div');
  el.className = 'mana-cp';
  el.onclick = function(e) { e.stopPropagation(); };
  el.onmousedown = function(e) { e.stopPropagation(); };
  el.innerHTML =
    '<div class="mana-cp-gradient">' +
      '<canvas width="208" height="140"></canvas>' +
      '<div class="mana-cp-cursor"></div>' +
    '</div>' +
    '<div class="mana-cp-hue-wrap">' +
      '<div class="mana-cp-preview"></div>' +
      '<div class="mana-cp-hue"><div class="mana-cp-hue-thumb"></div></div>' +
    '</div>' +
    '<div class="mana-cp-inputs">' +
      '<div class="mana-cp-field mana-cp-hex"><input type="text" maxlength="7" spellcheck="false"><label>HEX</label></div>' +
      '<div class="mana-cp-field"><input type="number" min="0" max="255"><label>R</label></div>' +
      '<div class="mana-cp-field"><input type="number" min="0" max="255"><label>G</label></div>' +
      '<div class="mana-cp-field"><input type="number" min="0" max="255"><label>B</label></div>' +
    '</div>';

  document.body.appendChild(el);
  _cpEl = el;
  _cpEl._onChange = onChange;

  // Position near anchor
  var rect = anchorEl.getBoundingClientRect();
  var cpW = 232, cpH = 250;
  var left = rect.right + 8;
  var top = rect.top - 20;
  if (left + cpW > window.innerWidth) left = rect.left - cpW - 8;
  if (top + cpH > window.innerHeight) top = window.innerHeight - cpH - 8;
  if (top < 8) top = 8;
  el.style.left = left + 'px';
  el.style.top = top + 'px';

  _cpDrawGradient();
  _cpUpdateUI();

  // Gradient events
  var canvas = el.querySelector('canvas');
  var hueBar = el.querySelector('.mana-cp-hue');
  canvas.addEventListener('mousedown', _cpGradientDown);
  canvas.addEventListener('touchstart', _cpGradientDown, {passive: false});
  hueBar.addEventListener('mousedown', _cpHueDown);
  hueBar.addEventListener('touchstart', _cpHueDown, {passive: false});

  // Input events
  var inputs = el.querySelectorAll('.mana-cp-field input');
  inputs[0].addEventListener('change', _cpHexInput);
  inputs[1].addEventListener('input', _cpRgbInput);
  inputs[2].addEventListener('input', _cpRgbInput);
  inputs[3].addEventListener('input', _cpRgbInput);

  setTimeout(function() {
    document.addEventListener('mousedown', _cpOutsideClick);
    document.addEventListener('touchstart', _cpOutsideClick, {passive: true});
  }, 50);
}

function _cpClose() {
  if (_cpEl) { _cpEl.remove(); _cpEl = null; }
  _cpSwatch = null; _cpDragging = null;
  document.removeEventListener('mousedown', _cpOutsideClick);
  document.removeEventListener('touchstart', _cpOutsideClick);
  document.removeEventListener('mousemove', _cpDragMove);
  document.removeEventListener('mouseup', _cpDragEnd);
  document.removeEventListener('touchmove', _cpDragMove);
  document.removeEventListener('touchend', _cpDragEnd);
}

function _cpOutsideClick(e) {
  if (_cpEl && !_cpEl.contains(e.target) && (!_cpSwatch || !_cpSwatch.contains(e.target))) _cpClose();
}

// ── Gradient (SV) ──
function _cpDrawGradient() {
  if (!_cpEl) return;
  var canvas = _cpEl.querySelector('canvas');
  var ctx = canvas.getContext('2d');
  var w = canvas.width, h = canvas.height;
  var hueRgb = _cpHsvToRgb(_cpHue, 1, 1);
  ctx.fillStyle = 'rgb(' + hueRgb.r + ',' + hueRgb.g + ',' + hueRgb.b + ')';
  ctx.fillRect(0, 0, w, h);
  var gW = ctx.createLinearGradient(0, 0, w, 0);
  gW.addColorStop(0, 'rgba(255,255,255,1)');
  gW.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gW; ctx.fillRect(0, 0, w, h);
  var gB = ctx.createLinearGradient(0, 0, 0, h);
  gB.addColorStop(0, 'rgba(0,0,0,0)');
  gB.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = gB; ctx.fillRect(0, 0, w, h);
}

function _cpGradientDown(e) {
  e.preventDefault(); _cpDragging = 'gradient'; _cpGradientMove(e);
  document.addEventListener('mousemove', _cpDragMove);
  document.addEventListener('mouseup', _cpDragEnd);
  document.addEventListener('touchmove', _cpDragMove, {passive: false});
  document.addEventListener('touchend', _cpDragEnd);
}

function _cpGradientMove(e) {
  if (!_cpEl) return;
  var canvas = _cpEl.querySelector('canvas');
  var rect = canvas.getBoundingClientRect();
  var cx = e.touches ? e.touches[0].clientX : e.clientX;
  var cy = e.touches ? e.touches[0].clientY : e.clientY;
  _cpSat = Math.max(0, Math.min(1, (cx - rect.left) / rect.width));
  _cpVal = 1 - Math.max(0, Math.min(1, (cy - rect.top) / rect.height));
  _cpUpdateUI(); _cpEmit();
}

// ── Hue bar ──
function _cpHueDown(e) {
  e.preventDefault(); _cpDragging = 'hue'; _cpHueMove(e);
  document.addEventListener('mousemove', _cpDragMove);
  document.addEventListener('mouseup', _cpDragEnd);
  document.addEventListener('touchmove', _cpDragMove, {passive: false});
  document.addEventListener('touchend', _cpDragEnd);
}

function _cpHueMove(e) {
  if (!_cpEl) return;
  var bar = _cpEl.querySelector('.mana-cp-hue');
  var rect = bar.getBoundingClientRect();
  var cx = e.touches ? e.touches[0].clientX : e.clientX;
  _cpHue = Math.max(0, Math.min(1, (cx - rect.left) / rect.width)) * 360;
  _cpDrawGradient(); _cpUpdateUI(); _cpEmit();
}

// ── Drag ──
function _cpDragMove(e) {
  e.preventDefault();
  if (_cpDragging === 'gradient') _cpGradientMove(e);
  else if (_cpDragging === 'hue') _cpHueMove(e);
}
function _cpDragEnd() {
  _cpDragging = null;
  document.removeEventListener('mousemove', _cpDragMove);
  document.removeEventListener('mouseup', _cpDragEnd);
  document.removeEventListener('touchmove', _cpDragMove);
  document.removeEventListener('touchend', _cpDragEnd);
}

// ── Inputs ──
function _cpHexInput(e) {
  var val = e.target.value.trim();
  if (!val.startsWith('#')) val = '#' + val;
  if (/^#[0-9a-fA-F]{6}$/.test(val)) {
    var rgb = _cpHexToRgb(val);
    var hsv = _cpRgbToHsv(rgb.r, rgb.g, rgb.b);
    _cpHue = hsv.h; _cpSat = hsv.s; _cpVal = hsv.v;
    _cpDrawGradient(); _cpUpdateUI(); _cpEmit();
  }
}
function _cpRgbInput() {
  if (!_cpEl) return;
  var inputs = _cpEl.querySelectorAll('.mana-cp-field input');
  var r = Math.max(0, Math.min(255, parseInt(inputs[1].value) || 0));
  var g = Math.max(0, Math.min(255, parseInt(inputs[2].value) || 0));
  var b = Math.max(0, Math.min(255, parseInt(inputs[3].value) || 0));
  var hsv = _cpRgbToHsv(r, g, b);
  _cpHue = hsv.h; _cpSat = hsv.s; _cpVal = hsv.v;
  _cpDrawGradient(); _cpUpdateUI(true); _cpEmit();
}

// ── UI update ──
function _cpUpdateUI(skipRgb) {
  if (!_cpEl) return;
  var rgb = _cpHsvToRgb(_cpHue, _cpSat, _cpVal);
  var hex = _cpRgbToHex(rgb.r, rgb.g, rgb.b);
  var cursor = _cpEl.querySelector('.mana-cp-cursor');
  cursor.style.left = (_cpSat * 100) + '%';
  cursor.style.top = ((1 - _cpVal) * 100) + '%';
  cursor.style.background = hex;
  var thumb = _cpEl.querySelector('.mana-cp-hue-thumb');
  thumb.style.left = (_cpHue / 360 * 100) + '%';
  var hRgb = _cpHsvToRgb(_cpHue, 1, 1);
  thumb.style.background = _cpRgbToHex(hRgb.r, hRgb.g, hRgb.b);
  _cpEl.querySelector('.mana-cp-preview').style.background = hex;
  var inputs = _cpEl.querySelectorAll('.mana-cp-field input');
  inputs[0].value = hex;
  if (!skipRgb) { inputs[1].value = rgb.r; inputs[2].value = rgb.g; inputs[3].value = rgb.b; }
}

function _cpEmit() {
  if (!_cpEl || !_cpEl._onChange) return;
  var rgb = _cpHsvToRgb(_cpHue, _cpSat, _cpVal);
  _cpEl._onChange(_cpRgbToHex(rgb.r, rgb.g, rgb.b));
}

// ── Color math ──
function _cpHexToRgb(hex) {
  hex = hex.replace('#', '');
  return { r: parseInt(hex.substring(0,2),16), g: parseInt(hex.substring(2,4),16), b: parseInt(hex.substring(4,6),16) };
}
function _cpRgbToHex(r, g, b) {
  return '#' + ((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1);
}
function _cpRgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  var max = Math.max(r,g,b), min = Math.min(r,g,b), d = max - min;
  var h = 0, s = max === 0 ? 0 : d / max, v = max;
  if (max !== min) {
    if (max === r)      h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else                h = (r - g) / d + 4;
    h *= 60;
  }
  return { h: h, s: s, v: v };
}
function _cpHsvToRgb(h, s, v) {
  var i = Math.floor(h / 60) % 6, f = h / 60 - Math.floor(h / 60);
  var p = v*(1-s), q = v*(1-f*s), t = v*(1-(1-f)*s);
  var r, g, b;
  switch(i) {
    case 0: r=v;g=t;b=p; break; case 1: r=q;g=v;b=p; break;
    case 2: r=p;g=v;b=t; break; case 3: r=p;g=q;b=v; break;
    case 4: r=t;g=p;b=v; break; case 5: r=v;g=p;b=q; break;
  }
  return { r: Math.round(r*255), g: Math.round(g*255), b: Math.round(b*255) };
}
