// ── shortcuts.js ─ Keyboard shortcuts for Maña Maps ──

(function() {
  'use strict';

  // ── Shortcut legend modal (injected once) ──
  var modal = document.createElement('div');
  modal.id = 'shortcuts-modal';
  modal.className = 'shortcuts-modal';
  modal.innerHTML =
    '<div class="shortcuts-box">' +
    '<h4><span data-i18n="shortcut_title">' + t('shortcut_title') + '</span><button onclick="closeShortcuts()">&times;</button></h4>' +
    '<div class="shortcuts-sep">' + t('shortcut_tools') + '</div>' +
    _row('P', 'shortcut_point') +
    _row('L', 'shortcut_line') +
    _row('G', 'shortcut_polygon') +
    _row('R', 'shortcut_ruler') +
    '<div class="shortcuts-sep">' + t('shortcut_map') + '</div>' +
    _row('F', 'shortcut_fit') +
    _row('+', 'shortcut_zoom_in') +
    _row('−', 'shortcut_zoom_out') +
    '<div class="shortcuts-sep">' + t('shortcut_general') + '</div>' +
    _row('Ctrl+Z', 'shortcut_undo') +
    _row('Ctrl+E', 'shortcut_export') +
    _row('Ctrl+A', 'shortcut_select_all') +
    _row('Del', 'shortcut_delete') +
    _row('Esc', 'shortcut_escape') +
    _row('?', 'shortcut_show') +
    '</div>';
  document.body.appendChild(modal);

  // Close on backdrop click
  modal.addEventListener('click', function(e) {
    if (e.target === modal) closeShortcuts();
  });

  function _row(key, i18nKey) {
    return '<div class="shortcuts-row"><span>' + t(i18nKey) + '</span><span class="shortcuts-key">' + key + '</span></div>';
  }

  window.openShortcuts = function() {
    modal.classList.add('open');
  };
  window.closeShortcuts = function() {
    modal.classList.remove('open');
  };

  // ── Keydown handler ──
  document.addEventListener('keydown', function(e) {
    var tag = (e.target.tagName || '').toLowerCase();
    var inInput = (tag === 'input' || tag === 'textarea' || e.target.isContentEditable);
    var ctrl = e.ctrlKey || e.metaKey;

    // ── Escape — always works ──
    if (e.key === 'Escape') {
      // Close shortcuts modal
      if (modal.classList.contains('open')) { closeShortcuts(); return; }
      // Close dropdowns
      document.querySelectorAll('.drop-menu.open').forEach(function(m) { m.classList.remove('open'); });
      // Close modals
      var aiModal = document.getElementById('ai-settings-modal');
      if (aiModal && aiModal.classList.contains('open')) { if (typeof closeAISettings === 'function') closeAISettings(); return; }
      var confirmM = document.getElementById('confirm-modal');
      if (confirmM && confirmM.classList.contains('open')) { if (typeof confirmCancel === 'function') confirmCancel(); return; }
      var nameM = document.getElementById('name-modal');
      if (nameM && nameM.classList.contains('open')) { if (typeof modalCancel === 'function') modalCancel(); return; }
      // Cancel active tool
      if (typeof setTool === 'function') setTool(null);
      return;
    }

    // ── Ctrl/Cmd combos — work even in inputs ──
    if (ctrl) {
      if (e.key === 'z' || e.key === 'Z') {
        if (!inInput && typeof undo === 'function') { e.preventDefault(); undo(); }
        return;
      }
      if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        if (typeof toggleMenu === 'function') toggleMenu('export-menu', e);
        return;
      }
      if ((e.key === 'a' || e.key === 'A') && !inInput) {
        e.preventDefault();
        // Select all layers
        if (typeof drawnItems !== 'undefined' && typeof selectLayerOnMap === 'function') {
          var first = true;
          drawnItems.eachLayer(function(l) {
            selectLayerOnMap(l, !first);
            first = false;
          });
        }
        return;
      }
      return; // Don't process other ctrl combos
    }

    // ── Single keys — only when NOT in input ──
    if (inInput) return;

    // Block single-key shortcuts when any modal/overlay is open
    if (modal.classList.contains('open')
      || document.querySelector('.confirm-modal.open, .ai-modal.open, #name-modal.open, .attr-modal.open'))
      return;

    switch (e.key) {
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        if (typeof _selectedLayers !== 'undefined' && _selectedLayers.size > 0) {
          var count = _selectedLayers.size;
          var toDelete = [];
          _selectedLayers.forEach(function(l) { toDelete.push(l); });
          toDelete.forEach(function(l) {
            if (typeof drawnItems !== 'undefined' && drawnItems.hasLayer(l)) drawnItems.removeLayer(l);
          });
          if (typeof clearSelection === 'function') clearSelection();
          if (typeof stats === 'function') stats();
          if (typeof saveState === 'function') saveState();
          if (typeof showToast === 'function') showToast(count + ' ' + t('shortcut_deleted'));
        }
        break;
      case 'p': if (typeof setTool === 'function') setTool('point'); break;
      case 'l': if (typeof setTool === 'function') setTool('line'); break;
      case 'g': if (typeof setTool === 'function') setTool('polygon'); break;
      case 'r': if (typeof setTool === 'function') setTool('ruler'); break;
      case 'f':
        if (typeof drawnItems !== 'undefined' && typeof map !== 'undefined') {
          var bounds = drawnItems.getBounds();
          if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24] });
        }
        break;
      case '+': case '=':
        if (typeof map !== 'undefined') map.zoomIn();
        break;
      case '-':
        if (typeof map !== 'undefined') map.zoomOut();
        break;
      case '?':
        openShortcuts();
        break;
    }
  });
})();
