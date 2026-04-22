// ── upsell.js — Upsell modal + Pro indicator · Maña Maps ──

const LEMON_URL = 'https://mana-maps.lemonsqueezy.com/checkout/buy/5114e28a-eabb-4cdb-a750-0101c8e797c8';

// ═══════════════════════════════════════════════════════════════
// SHOW / CLOSE UPSELL MODAL
// ═══════════════════════════════════════════════════════════════
function showUpsell() {
  document.getElementById('upsell-modal').classList.add('open');
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

function upsellHaveKey() {
  closeUpsell();
  if (typeof openAISettings === 'function') openAISettings(true);
}

// ═══════════════════════════════════════════════════════════════
// PRO INDICATOR (in sidebar layers panel footer)
// ═══════════════════════════════════════════════════════════════
function updateProIndicator() {
  var el = document.getElementById('pro-indicator');
  if (!el) return;
  var hasKey = typeof hasAIKey === 'function' && hasAIKey();
  if (hasKey) {
    el.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> ' + t('ai_configured').replace('✓ ', '');
    el.className = 'pro-indicator configured';
    el.onclick = null;
    el.style.cursor = 'default';
  } else {
    el.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> ' + t('footer_pro');
    el.className = 'pro-indicator not-configured';
    el.onclick = showUpsell;
    el.style.cursor = 'pointer';
  }
}

// Init on load
document.addEventListener('DOMContentLoaded', updateProIndicator);
setTimeout(updateProIndicator, 200);
