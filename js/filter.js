// ── filter.js ─ QGIS-style attribute filtering for imported layers ──

// ═══════════════════════════════════════════════════════════════
// MASTER REGISTRY — source of truth for all imported layers
// ═══════════════════════════════════════════════════════════════
const _manaGroupRegistry = {};  // gid -> [layer, layer, ...]
const _manaGroupFilters  = {};  // gid -> [{ field, op, value }, ...]
const _filterOpenGroups  = {};  // gid -> bool (is filter panel open)

// Register layers for a group (called from import-export.js)
function registerGroupLayers(gid, layers) {
  _manaGroupRegistry[gid] = layers.slice();
}

// ═══════════════════════════════════════════════════════════════
// ATTRIBUTE DISCOVERY
// ═══════════════════════════════════════════════════════════════
function getGroupAttributes(gid) {
  const layers = _manaGroupRegistry[gid];
  if (!layers || !layers.length) return [];
  const keys = new Set();
  layers.forEach(l => {
    const props = l._manaProperties || {};
    Object.keys(props).forEach(k => {
      if (!k.startsWith('_') && k !== 'bbox') keys.add(k);
    });
  });
  return Array.from(keys).sort();
}

function getUniqueValues(gid, field) {
  const layers = _manaGroupRegistry[gid];
  if (!layers || !layers.length) return [];
  const vals = new Set();
  layers.forEach(l => {
    const v = (l._manaProperties || {})[field];
    if (v !== null && v !== undefined && v !== '') vals.add(String(v));
  });
  return Array.from(vals).sort((a, b) => {
    const na = Number(a), nb = Number(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  });
}

function detectFieldType(gid, field) {
  const layers = _manaGroupRegistry[gid];
  if (!layers) return 'text';
  for (const l of layers) {
    const v = (l._manaProperties || {})[field];
    if (v !== null && v !== undefined && v !== '') {
      if (typeof v === 'number') return 'number';
      if (!isNaN(Number(v))) return 'number';
      return 'text';
    }
  }
  return 'text';
}

// ═══════════════════════════════════════════════════════════════
// FILTER EVALUATION
// ═══════════════════════════════════════════════════════════════
const FILTER_OPS = {
  '=':       { label: '=',            fn: (a, b) => String(a) === String(b) },
  '!=':      { label: '≠',            fn: (a, b) => String(a) !== String(b) },
  '>':       { label: '>',            fn: (a, b) => Number(a) > Number(b) },
  '<':       { label: '<',            fn: (a, b) => Number(a) < Number(b) },
  '>=':      { label: '≥',            fn: (a, b) => Number(a) >= Number(b) },
  '<=':      { label: '≤',            fn: (a, b) => Number(a) <= Number(b) },
  'contains':{ label: 'contiene',     fn: (a, b) => String(a).toLowerCase().includes(String(b).toLowerCase()) },
  'starts':  { label: 'empieza por',  fn: (a, b) => String(a).toLowerCase().startsWith(String(b).toLowerCase()) },
  'ends':    { label: 'termina en',   fn: (a, b) => String(a).toLowerCase().endsWith(String(b).toLowerCase()) },
  'empty':   { label: t('filter_is_empty'),   fn: (a)    => a === null || a === undefined || a === '' },
  'notempty':{ label: t('filter_is_not_empty'),fn: (a)    => a !== null && a !== undefined && a !== '' },
};

function evaluateRules(properties, rules) {
  if (!rules || !rules.length) return true;
  return rules.every(rule => {
    const val = properties[rule.field];
    const opDef = FILTER_OPS[rule.op];
    if (!opDef) return true;
    return opDef.fn(val, rule.value);
  });
}

// ═══════════════════════════════════════════════════════════════
// APPLY / CLEAR FILTER
// ═══════════════════════════════════════════════════════════════
function applyFilter(gid) {
  const rules = _manaGroupFilters[gid] || [];
  const allLayers = _manaGroupRegistry[gid] || [];

  allLayers.forEach(l => {
    const match = evaluateRules(l._manaProperties || {}, rules);
    if (match) {
      if (!drawnItems.hasLayer(l)) drawnItems.addLayer(l);
      l._manaFilterHidden = false;
    } else {
      if (drawnItems.hasLayer(l)) drawnItems.removeLayer(l);
      l._manaFilterHidden = true;
    }
  });

  stats();
}

function clearFilter(gid) {
  _manaGroupFilters[gid] = [];
  const allLayers = _manaGroupRegistry[gid] || [];
  allLayers.forEach(l => {
    if (!drawnItems.hasLayer(l)) drawnItems.addLayer(l);
    l._manaFilterHidden = false;
  });
  stats();
}

function getFilterMatchCount(gid) {
  const rules = _manaGroupFilters[gid] || [];
  const allLayers = _manaGroupRegistry[gid] || [];
  if (!rules.length) return { visible: allLayers.length, total: allLayers.length };
  let visible = 0;
  allLayers.forEach(l => {
    if (evaluateRules(l._manaProperties || {}, rules)) visible++;
  });
  return { visible, total: allLayers.length };
}

// ═══════════════════════════════════════════════════════════════
// FILTER PANEL UI (rendered inline in sidebar)
// ═══════════════════════════════════════════════════════════════
function toggleFilterPanel(gid) {
  _filterOpenGroups[gid] = !_filterOpenGroups[gid];
  renderLayers();
}

function renderFilterPanel(gid) {
  const rules = _manaGroupFilters[gid] || [];
  const attrs = getGroupAttributes(gid);
  const counts = getFilterMatchCount(gid);

  if (!attrs.length) {
    return '<div class="filter-panel"><p class="filter-empty">' + t('filter_no_attrs') + '</p></div>';
  }

  let html = '<div class="filter-panel">';

  // Active rules as chips
  if (rules.length) {
    html += '<div class="filter-chips">';
    rules.forEach((r, i) => {
      const opLabel = FILTER_OPS[r.op] ? FILTER_OPS[r.op].label : r.op;
      const valDisplay = (r.op === 'empty' || r.op === 'notempty') ? '' : ' «' + r.value + '»';
      html += '<div class="filter-chip">';
      html += '  <span class="filter-chip-text">' + r.field + ' ' + opLabel + valDisplay + '</span>';
      html += '  <button class="filter-chip-remove" onclick="removeFilterRule(' + gid + ',' + i + ')" title="Eliminar">&times;</button>';
      html += '</div>';
    });
    html += '</div>';
    html += '<div class="filter-match-count">' + counts.visible + ' de ' + counts.total + ' elementos</div>';
  }

  // New rule builder
  html += '<div class="filter-rule-builder">';

  // Field selector
  html += '<select class="filter-select" id="filter-field-' + gid + '" onchange="onFilterFieldChange(' + gid + ')">';
  html += '<option value="">Campo...</option>';
  attrs.forEach(a => {
    html += '<option value="' + a + '">' + a + '</option>';
  });
  html += '</select>';

  // Operator selector
  html += '<select class="filter-select filter-op" id="filter-op-' + gid + '">';
  html += '<option value="=">=</option>';
  html += '<option value="!=">≠</option>';
  html += '<option value="contains">contiene</option>';
  html += '<option value="starts">empieza por</option>';
  html += '<option value="ends">termina en</option>';
  html += '<option value=">">></option>';
  html += '<option value="<"><</option>';
  html += '<option value=">=">≥</option>';
  html += '<option value="<=">≤</option>';
  html += '<option value="empty">' + t('filter_is_empty') + '</option>';
  html += '<option value="notempty">' + t('filter_is_not_empty') + '</option>';
  html += '</select>';

  // Value input with datalist
  html += '<div class="filter-value-wrap">';
  html += '<input class="filter-input" id="filter-val-' + gid + '" list="filter-vals-' + gid + '" placeholder="Valor..." autocomplete="off"/>';
  html += '<datalist id="filter-vals-' + gid + '"></datalist>';
  html += '</div>';

  // Add rule button
  html += '<button class="filter-add-btn" onclick="addFilterRule(' + gid + ')" title="Añadir regla">';
  html += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
  html += '</button>';

  html += '</div>';

  // Action buttons
  html += '<div class="filter-actions">';
  if (rules.length) {
    html += '<button class="filter-clear-btn" onclick="clearFilter(' + gid + ')">Limpiar filtro</button>';
  }
  html += '</div>';

  html += '</div>';
  return html;
}

// ═══════════════════════════════════════════════════════════════
// FILTER RULE MANAGEMENT
// ═══════════════════════════════════════════════════════════════
function addFilterRule(gid) {
  const fieldEl = document.getElementById('filter-field-' + gid);
  const opEl = document.getElementById('filter-op-' + gid);
  const valEl = document.getElementById('filter-val-' + gid);
  if (!fieldEl || !opEl) return;

  const field = fieldEl.value;
  const op = opEl.value;
  const value = valEl ? valEl.value.trim() : '';

  if (!field) { fieldEl.focus(); return; }
  if (!value && op !== 'empty' && op !== 'notempty') { valEl.focus(); return; }

  if (!_manaGroupFilters[gid]) _manaGroupFilters[gid] = [];
  _manaGroupFilters[gid].push({ field, op, value });
  applyFilter(gid);
}

function removeFilterRule(gid, idx) {
  if (!_manaGroupFilters[gid]) return;
  _manaGroupFilters[gid].splice(idx, 1);
  if (_manaGroupFilters[gid].length === 0) {
    clearFilter(gid);
  } else {
    applyFilter(gid);
  }
}

function onFilterFieldChange(gid) {
  const fieldEl = document.getElementById('filter-field-' + gid);
  const datalistEl = document.getElementById('filter-vals-' + gid);
  const opEl = document.getElementById('filter-op-' + gid);
  if (!fieldEl || !datalistEl) return;

  const field = fieldEl.value;
  if (!field) { datalistEl.innerHTML = ''; return; }

  // Populate unique values datalist
  const vals = getUniqueValues(gid, field);
  datalistEl.innerHTML = vals.slice(0, 100).map(v => '<option value="' + v.replace(/"/g, '&quot;') + '">').join('');

  // Auto-select better operator based on field type
  const ftype = detectFieldType(gid, field);
  if (ftype === 'number') {
    opEl.value = '=';
  } else {
    opEl.value = 'contains';
  }
}

// ═══════════════════════════════════════════════════════════════
// CLEANUP
// ═══════════════════════════════════════════════════════════════
function cleanupGroupFilter(gid) {
  delete _manaGroupRegistry[gid];
  delete _manaGroupFilters[gid];
  delete _filterOpenGroups[gid];
}
