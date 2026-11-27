// ── lang-detect.js ─ Detección del idioma por defecto ──
// Prioridad:
//   1. Preferencia guardada por el usuario (mana-lang / mana-landing-lang).
//   2. Ruta /en explícita.
//   3. País inferido por la zona horaria del navegador.
//   4. Idioma del navegador (solo si la zona horaria no está disponible).
//   5. Inglés (idioma por defecto para países no hispanohablantes).
// Debe cargarse antes de i18n.js y de los scripts de idioma inline.

(function () {
  var LANG_KEY = 'mana-lang';
  var LEGACY_LANG_KEY = 'mana-landing-lang';

  // Zonas horarias IANA correspondientes a países de habla hispana.
  // Claves en minúsculas para comparar de forma insensible a mayúsculas.
  var ES_TIMEZONES = [
    // España
    'Europe/Madrid', 'Africa/Ceuta', 'Atlantic/Canary',
    // México
    'America/Mexico_City', 'America/Cancun', 'America/Merida',
    'America/Monterrey', 'America/Matamoros', 'America/Mazatlan',
    'America/Chihuahua', 'America/Ojinaga', 'America/Hermosillo',
    'America/Tijuana', 'America/Bahia_Banderas',
    // Centroamérica
    'America/Guatemala', 'America/Tegucigalpa', 'America/El_Salvador',
    'America/Managua', 'America/Costa_Rica', 'America/Panama',
    // Caribe hispanohablante
    'America/Havana', 'America/Santo_Domingo', 'America/Puerto_Rico',
    // Sudamérica
    'America/Bogota', 'America/Caracas', 'America/Guayaquil',
    'Pacific/Galapagos', 'America/Lima', 'America/La_Paz',
    'America/Santiago', 'Pacific/Easter', 'America/Punta_Arenas',
    'America/Asuncion', 'America/Montevideo',
    // Argentina (canónicas y alias habituales)
    'America/Argentina/Buenos_Aires', 'America/Argentina/Cordoba',
    'America/Argentina/Salta', 'America/Argentina/Jujuy',
    'America/Argentina/Tucuman', 'America/Argentina/Catamarca',
    'America/Argentina/La_Rioja', 'America/Argentina/San_Juan',
    'America/Argentina/Mendoza', 'America/Argentina/San_Luis',
    'America/Argentina/Rio_Gallegos', 'America/Argentina/Ushuaia',
    'America/Buenos_Aires', 'America/Cordoba', 'America/Mendoza',
    'America/Catamarca', 'America/Jujuy',
    // Guinea Ecuatorial
    'Africa/Malabo'
  ];

  var ES_TIMEZONE_LOOKUP = {};
  for (var i = 0; i < ES_TIMEZONES.length; i++) {
    ES_TIMEZONE_LOOKUP[ES_TIMEZONES[i].toLowerCase()] = true;
  }

  function getStored() {
    try {
      var stored = localStorage.getItem(LANG_KEY) || localStorage.getItem(LEGACY_LANG_KEY);
      return (stored === 'es' || stored === 'en') ? stored : null;
    } catch (e) {
      return null;
    }
  }

  function persist(lang) {
    if (lang !== 'es' && lang !== 'en') return;
    try {
      localStorage.setItem(LANG_KEY, lang);
      localStorage.setItem(LEGACY_LANG_KEY, lang);
    } catch (e) {}
  }

  function getTimezone() {
    try {
      if (typeof Intl === 'undefined' || !Intl.DateTimeFormat) return null;
      return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    } catch (e) {
      return null;
    }
  }

  // Zonas que no identifican un país real (entornos sin configurar, servidores).
  var NEUTRAL_TIMEZONES = {
    'utc': true, 'etc/utc': true, 'gmt': true, 'etc/gmt': true,
    'etc/unknown': true
  };

  // Devuelve 'es' | 'en' | null (null si no hay zona horaria fiable).
  function detectByTimezone() {
    var tz = getTimezone();
    if (!tz) return null;
    var key = tz.toLowerCase();
    if (NEUTRAL_TIMEZONES[key]) return null;
    return ES_TIMEZONE_LOOKUP[key] ? 'es' : 'en';
  }

  // Devuelve 'es' | 'en' | null.
  function detectByBrowserLanguage() {
    try {
      var langs = navigator.languages && navigator.languages.length
        ? navigator.languages
        : [navigator.language || ''];
      for (var i = 0; i < langs.length; i++) {
        if (/^es(-|$)/i.test(langs[i] || '')) return 'es';
      }
      return 'en';
    } catch (e) {
      return null;
    }
  }

  function detectDefault() {
    var byTimezone = detectByTimezone();
    if (byTimezone) return byTimezone;
    var byLanguage = detectByBrowserLanguage();
    if (byLanguage) return byLanguage;
    return 'en';
  }

  function initial() {
    var stored = getStored();
    if (stored) return stored;
    if (window.location.pathname.indexOf('/en') === 0) return 'en';
    return detectDefault();
  }

  window.manaGetStoredLang = getStored;
  window.manaPersistLang = persist;
  window.manaDetectDefaultLang = detectDefault;
  window.manaInitialLang = initial;
  window.manaEsTimezones = ES_TIMEZONE_LOOKUP;
})();
