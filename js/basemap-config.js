// Basemap provider configuration.
// Set window.MANA_BASEMAP_CONFIG before this file, or use:
// localStorage.setItem('mana_basemap_provider', 'selfHosted')
(function() {
  var DEFAULTS = {
    provider: 'openfreemap',
    providers: {
      openfreemap: {
        lightStyle: '/styles/mana-positron.json?v=1776927833',
        darkStyle: '/styles/mana-dark.json?v=1776927833',
        satelliteStyle: '/styles/mana-openfreemap-alt.json?v=1776927833',
        satelliteTileUrl: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
        satelliteAttribution: 'Imagery &copy; <a href="https://www.google.com/help/terms_maps/" target="_blank" rel="noopener noreferrer">Google</a>',
        attribution: '<a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a>'
      },
      selfHosted: {
        lightStyle: '/tiles/styles/positron/style.json',
        darkStyle: '/tiles/styles/dark/style.json',
        satelliteStyle: '/tiles/styles/alternative/style.json',
        satelliteTileUrl: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
        satelliteAttribution: 'Imagery &copy; <a href="https://www.google.com/help/terms_maps/" target="_blank" rel="noopener noreferrer">Google</a>',
        attribution: '<a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a>',
        thumb: '/tiles/previews/positron.png'
      }
    }
  };

  var userConfig = window.MANA_BASEMAP_CONFIG || {};
  var providers = Object.assign({}, DEFAULTS.providers, userConfig.providers || {});

  function storedProvider() {
    try { return localStorage.getItem('mana_basemap_provider'); }
    catch (e) { return null; }
  }

  function providerName() {
    var fromQuery = null;
    try { fromQuery = new URLSearchParams(window.location.search).get('basemap'); }
    catch (e) {}
    var name = fromQuery || storedProvider() || userConfig.provider || DEFAULTS.provider;
    return providers[name] ? name : DEFAULTS.provider;
  }

  function provider() {
    return providers[providerName()] || providers[DEFAULTS.provider];
  }

  window.MANA_BASEMAPS = {
    providers: providers,
    getProviderName: providerName,
    getProvider: provider,
    getStyleUrl: function(isDark) {
      var p = provider();
      return isDark ? (p.darkStyle || p.lightStyle) : p.lightStyle;
    },
    getSatelliteStyleUrl: function() {
      var p = provider();
      return p.satelliteStyle || p.lightStyle;
    },
    getSatelliteTileUrl: function() {
      var p = provider();
      return p.satelliteTileUrl || 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}';
    },
    getSatelliteAttribution: function() {
      var p = provider();
      return p.satelliteAttribution || 'Imagery &copy; <a href="https://www.google.com/help/terms_maps/" target="_blank" rel="noopener noreferrer">Google</a>';
    },
    getAttribution: function() {
      return provider().attribution || DEFAULTS.providers.openfreemap.attribution;
    },
    getThumb: function() {
      return provider().thumb || '';
    },
    setProvider: function(name) {
      if (!providers[name]) return false;
      try { localStorage.setItem('mana_basemap_provider', name); }
      catch (e) {}
      return true;
    }
  };
})();
