// ── plans.js — Plan utilities · Maña Maps ──

(function () {

  /* Share map is 100% free — no gating */

  window.closeUpgradeModal = function () {
    var el = document.getElementById('upgrade-modal');
    if (el) el.classList.remove('open');
  };

  /* API for testing */
  window.manaPlan = {
    get: function () { return 'free'; },
    set: function () {}
  };

})();
