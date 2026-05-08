// ── firebase.js ─ runtime Firebase environment selection (no secrets committed) ──
// Load js/firebase-config.local.js before this file to provide window.MANA_FIREBASE_CONFIGS.

(function() {
  'use strict';

  var LOCAL_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
  var DEFAULT_ENV = 'pro';
  var LOCAL_ENV = 'pre';

  function getRuntimeConfigs() {
    return (window.MANA_FIREBASE_CONFIGS && typeof window.MANA_FIREBASE_CONFIGS === 'object')
      ? window.MANA_FIREBASE_CONFIGS
      : {};
  }

  function isLocalHostname(hostname) {
    if (!hostname) return true;
    if (LOCAL_HOSTS.indexOf(hostname) !== -1) return true;
    return hostname.endsWith('.local') || hostname.endsWith('.localhost');
  }

  function detectEnv() {
    if (window.MANA_FIREBASE_ENV === LOCAL_ENV || window.MANA_FIREBASE_ENV === DEFAULT_ENV) {
      return window.MANA_FIREBASE_ENV;
    }

    try {
      var envParam = new URLSearchParams(window.location.search || '').get('firebaseEnv');
      if (envParam === LOCAL_ENV || envParam === DEFAULT_ENV) return envParam;
    } catch (_) {}

    var protocol = window.location.protocol;
    var hostname = window.location.hostname;
    return protocol === 'file:' || isLocalHostname(hostname) ? LOCAL_ENV : DEFAULT_ENV;
  }

  function isValidConfig(config) {
    return !!(config && config.apiKey && config.authDomain && config.projectId && config.appId);
  }

  function getConfig(env) {
    var selectedEnv = env || detectEnv();
    var config = getRuntimeConfigs()[selectedEnv];
    if (!isValidConfig(config)) {
      console.warn('[firebase] Missing Firebase config for environment:', selectedEnv);
      return null;
    }
    return config;
  }

  function initializeApp(env) {
    if (typeof firebase === 'undefined') return null;
    if (firebase.apps && firebase.apps.length) return firebase.app();

    var config = getConfig(env);
    if (!config) return null;
    return firebase.initializeApp(config);
  }

  function getDb(env) {
    if (!initializeApp(env) || !firebase.firestore) return null;
    return firebase.firestore();
  }

  window.ManaFirebase = {
    detectEnv: detectEnv,
    getConfig: getConfig,
    initializeApp: initializeApp,
    getDb: getDb
  };
})();
