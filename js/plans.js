// ── plans.js — Gate de compartir mapa · Maña Maps ──

(function () {

  function isPro() {
    return localStorage.getItem('mana-plan') === 'pro';
  }

  /* Gate: compartir mapa */
  if (typeof shareMapURL === 'function') {
    var _share = shareMapURL;
    window.shareMapURL = function () {
      if (isPro()) return _share.apply(this, arguments);
      document.getElementById('upgrade-modal').classList.add('open');
    };
  }

  window.closeUpgradeModal = function () {
    document.getElementById('upgrade-modal').classList.remove('open');
  };

  /* API para testing / Stripe callback */
  window.manaPlan = {
    get: function () { return isPro() ? 'pro' : 'free'; },
    set: function (p) { localStorage.setItem('mana-plan', p); location.reload(); }
  };

})();
