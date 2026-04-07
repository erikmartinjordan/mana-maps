// ── modal.js ─ Name input modal dialog ──

let _modalResolve = null;

function askName(title, defaultVal) {
  return new Promise(resolve => {
    _modalResolve = resolve;
    document.getElementById('name-modal-title').textContent = title;
    const inp = document.getElementById('name-modal-input');
    inp.value = defaultVal || '';
    document.getElementById('name-modal').classList.add('open');
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
