// ── plans.js — Plan utilities · Maña Maps ──

(function () {
  'use strict';

  var FREE_PLAN = 'free';
  var PRO_PLAN = 'pro';
  var ACTIVE_STATUSES = ['active', 'trialing'];

  function nowMs() {
    return Date.now();
  }

  function readProfile() {
    if (window.manaAuth && typeof window.manaAuth.getProfile === 'function') {
      return window.manaAuth.getProfile() || null;
    }
    return null;
  }

  function readDateMs(value) {
    if (!value) return null;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      var parsed = Date.parse(value);
      return Number.isNaN(parsed) ? null : parsed;
    }
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.toDate === 'function') return value.toDate().getTime();
    return null;
  }

  function isTruthyPlanFlag(value) {
    if (value === true) return true;
    if (typeof value !== 'string') return false;
    var normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === 'pro' || normalized === 'active';
  }

  function normalizePlan(profile) {
    var data = profile || readProfile() || {};
    var rawPlan = String(data.plan || data.tier || '').toLowerCase();
    var rawRole = String(data.role || '').toLowerCase();
    var rawStatus = String(data.planStatus || data.subscriptionStatus || '').toLowerCase();
    var proUntil = readDateMs(data.proUntil || data.planExpiresAt || data.subscriptionEndsAt);

    if (rawPlan === PRO_PLAN || rawRole === PRO_PLAN || isTruthyPlanFlag(data.pro) || isTruthyPlanFlag(data.isPro)) {
      if (proUntil && proUntil <= nowMs()) return FREE_PLAN;
      if (!rawStatus || ACTIVE_STATUSES.indexOf(rawStatus) !== -1) return PRO_PLAN;
    }

    if (ACTIVE_STATUSES.indexOf(rawStatus) !== -1 && (rawPlan === PRO_PLAN || isTruthyPlanFlag(data.pro) || isTruthyPlanFlag(data.isPro))) {
      return PRO_PLAN;
    }

    return FREE_PLAN;
  }

  function isPro(profile) {
    return normalizePlan(profile) === PRO_PLAN;
  }

  window.closeUpgradeModal = function () {
    var el = document.getElementById('upgrade-modal');
    if (el) el.classList.remove('open');
  };

  window.manaPlan = {
    get: function () { return normalizePlan(); },
    isPro: isPro,
    canCreateMap: function (currentMapCount, profile) {
      if (isPro(profile)) return true;
      return Number(currentMapCount || 0) < 3;
    },
    set: function () {}
  };

})();
