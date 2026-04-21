// ── modal.js ─ Name input modal dialog ──

let _modalResolve = null;

function askName(title, defaultVal) {
  return new Promise(resolve => {
    _modalResolve = resolve;
    document.getElementById('name-modal-title').textContent = title;
    const inp = document.getElementById('name-modal-input');
    inp.value = defaultVal || '';
    const modal = document.getElementById('name-modal');
    // P3.10: Accessibility
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', title);
    modal.classList.add('open');
    setTimeout(() => { inp.focus(); inp.select(); }, 50);
  });
}

function modalOk() {
  const val = document.getElementById('name-modal-input').value.trim() || 'Sin nombre';
  document.getElementById('name-modal').classList.remove('open');
  if (_modalResolve) { _modalResolve(val); _modalResolve = null; }
}

function modalCancel() {
  document.getElementById('name-modal').classList.remove('open');
  if (_modalResolve) { _modalResolve(null); _modalResolve = null; }
}

document.getElementById('name-modal-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') modalOk();
  if (e.key === 'Escape') modalCancel();
});

// ═══════════════════════════════════════════════════════════════
// MODAL KEYBOARD ACCESSIBILITY & FOCUS TRAPPING
// ═══════════════════════════════════════════════════════════════

function _trapFocus(container, e) {
  const focusable = container.querySelectorAll(
    'input, button, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.key === 'Tab') {
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
}

// ── Name modal: Escape / Enter / focus trap ──
document.getElementById('name-modal').addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.stopPropagation(); modalCancel(); }
  _trapFocus(document.getElementById('name-modal'), e);
});

// ── AI Settings modal: Escape / Enter / focus trap ──
document.getElementById('ai-settings-modal').addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    e.stopPropagation();
    closeAISettings();
  }
  if (e.key === 'Enter' && e.target.tagName !== 'SELECT') {
    e.preventDefault();
    saveAISettings();
  }
  _trapFocus(document.getElementById('ai-settings-modal').querySelector('.ai-modal-content'), e);
});

// ── Confirm modal: Escape / Enter / focus trap ──
document.getElementById('confirm-modal').addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.stopPropagation(); confirmCancel(); }
  if (e.key === 'Enter') { e.preventDefault(); confirmOk(); }
  _trapFocus(document.getElementById('confirm-modal').querySelector('.confirm-modal-box'), e);
});
