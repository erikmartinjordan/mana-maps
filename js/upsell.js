// ── upsell.js — Upsell modal + Pro indicator · Maña Maps ──

const LEMON_URL = 'https://mana-maps.lemonsqueezy.com/checkout/buy/5114e28a-eabb-4cdb-a750-0101c8e797c8';

// ═══════════════════════════════════════════════════════════════
// SHOW / CLOSE UPSELL MODAL
// ═══════════════════════════════════════════════════════════════
function showUpsell(mode) {
  var modal = document.getElementById('upsell-modal');
  if (!modal) return;
  var title = modal.querySelector('.upsell-title');
  var price = modal.querySelector('.upsell-price');
  var note = modal.querySelector('.upsell-note');
  var period = (typeof LANG !== 'undefined' && LANG === 'en') ? '/ month' : '/ mes';
  var defaultNote = (typeof LANG !== 'undefined' && LANG === 'en')
    ? 'Free includes up to 3 saved maps · Pro adds unlimited maps and advanced sharing options'
    : 'El plan gratis incluye hasta 3 mapas guardados · Pro añade mapas ilimitados y opciones avanzadas de compartir';

  if (title) title.textContent = 'Maña Maps Pro';
  if (price) price.innerHTML = '4,99 € <span class="upsell-period">' + period + '</span>';
  if (note) note.textContent = defaultNote;

  if (mode === 'map-limit' && note) {
    note.textContent = (typeof LANG !== 'undefined' && LANG === 'en')
      ? 'Free plan includes up to 3 saved maps. Upgrade for unlimited cloud maps and sharing options.'
      : 'El plan gratis incluye hasta 3 mapas guardados. Mejora para tener mapas ilimitados en la nube y opciones de compartir.';
  }
  modal.classList.add('open');
}

function closeUpsell() {
  document.getElementById('upsell-modal').classList.remove('open');
}

// Close on backdrop click
document.addEventListener('click', function (e) {
  if (e.target.id === 'upsell-modal') closeUpsell();
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') closeUpsell();
});

// ═══════════════════════════════════════════════════════════════
// CTA ACTIONS
// ═══════════════════════════════════════════════════════════════
function upsellBuy() {
  window.open(LEMON_URL, '_blank');
}

// Backward-compatible hook for any cached markup that still calls this action.
function upsellHaveKey() {
  closeUpsell();
}

// ═══════════════════════════════════════════════════════════════
// PRO INDICATOR (in sidebar layers panel footer)
// ═══════════════════════════════════════════════════════════════
function updateProIndicator() {
  var el = document.getElementById('pro-indicator');
  if (!el) return;
  el.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 17.6A4.4 4.4 0 0016.2 11 6 6 0 104.6 13.2 3.5 3.5 0 005 20h14a3 3 0 001-2.4z"/></svg> ' + t('footer_pro');
  el.className = 'pro-indicator not-configured';
  el.onclick = showUpsell;
  el.style.cursor = 'pointer';
}

// Init on load
document.addEventListener('DOMContentLoaded', updateProIndicator);
setTimeout(updateProIndicator, 200);
