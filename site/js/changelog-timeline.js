/**
 * Changelog: muestra por defecto la última semana y permite revelar el resto.
 *
 * La página la genera `.github/scripts/generate_changelog.py` con todo el
 * historial en el HTML (SEO y usuarios sin JavaScript). Este script solo
 * oculta los días anteriores a la ventana semanal y ofrece un botón «Ver más»
 * accesible. Sin JavaScript no se oculta nada: el documento queda intacto.
 */
(function () {
  'use strict';

  var WINDOW_DAYS = 7;
  var MS_PER_DAY = 24 * 60 * 60 * 1000;

  var MONTHS_ES = {
    enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
    julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
  };

  var STRINGS = {
    es: {
      more: 'Ver más',
      less: 'Ver menos',
      moreLabel: 'Ver las entradas anteriores a los últimos 7 días',
      lessLabel: 'Contraer el historial y volver a los últimos 7 días',
      collapsed: 'Mostrando los últimos 7 días.',
      expanded: 'Mostrando todo el historial.',
      fallback: 'No hay entradas en los últimos 7 días; se muestra la más reciente.',
    },
    en: {
      more: 'Show more',
      less: 'Show less',
      moreLabel: 'Show entries older than the last 7 days',
      lessLabel: 'Collapse the history back to the last 7 days',
      collapsed: 'Showing the last 7 days.',
      expanded: 'Showing the full history.',
      fallback: 'No entries in the last 7 days; showing the most recent one.',
    },
  };

  function getLang() {
    var stored = null;
    try {
      stored = localStorage.getItem('mana-lang');
    } catch (e) {
      stored = null;
    }
    if (stored === 'en' || stored === 'es') return stored;
    if (window.location.pathname.indexOf('/en/') === 0 || window.location.pathname === '/en') return 'en';
    var htmlLang = (document.documentElement.getAttribute('lang') || '').toLowerCase();
    return htmlLang.indexOf('en') === 0 ? 'en' : 'es';
  }

  function strings() {
    return STRINGS[getLang()] || STRINGS.es;
  }

  // Las etiquetas del generador siempre están en español: «26 de noviembre de 2026».
  // Devuelve el día en milisegundos UTC para comparar sin sustos de zona horaria.
  function parseDayLabel(text) {
    if (!text) return null;
    var match = /(\d{1,2})\s+de\s+([a-záéíóúüñ]+)\s+de\s+(\d{4})/i.exec(String(text));
    if (!match) return null;
    var month = MONTHS_ES[match[2].toLowerCase()];
    if (month === undefined) return null;
    var day = Number(match[1]);
    var year = Number(match[3]);
    if (!day || day > 31) return null;
    return Date.UTC(year, month, day);
  }

  function startOfTodayUtc() {
    var now = new Date();
    return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function weeklyCutoff(today) {
    return today - (WINDOW_DAYS - 1) * MS_PER_DAY;
  }

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function init() {
    var timeline = document.getElementById('timeline');
    var button = document.getElementById('timeline-more');
    var status = document.getElementById('timeline-status');
    if (!timeline || !button) return;

    var groups = Array.prototype.slice.call(timeline.querySelectorAll('.day-group'));
    if (groups.length === 0) return;

    var today = startOfTodayUtc();
    var cutoff = weeklyCutoff(today);
    var dated = groups.map(function (group) {
      var label = group.querySelector('.day-label');
      return {
        group: group,
        date: parseDayLabel(label ? label.textContent : ''),
      };
    });

    var recent = dated.filter(function (item) {
      // Si la etiqueta no se puede leer, se conserva a la vista: nunca ocultar
      // contenido por un formato inesperado.
      return item.date === null || item.date >= cutoff;
    });
    var fallback = false;
    if (recent.length === 0) {
      // Página sin commits en la última semana: mostrar al menos el día más
      // reciente para no dejar el historial vacío.
      fallback = true;
      var newest = dated
        .filter(function (item) { return item.date !== null; })
        .sort(function (a, b) { return b.date - a.date; })[0];
      if (newest) recent = [newest];
    }

    var recentGroups = recent.map(function (item) { return item.group; });
    var olderGroups = groups.filter(function (group) {
      return recentGroups.indexOf(group) === -1;
    });
    if (olderGroups.length === 0) return;

    var expanded = false;

    function renderLabels() {
      var copy = strings();
      button.textContent = expanded ? copy.less : copy.more;
      button.setAttribute('aria-label', expanded ? copy.lessLabel : copy.moreLabel);
      if (status) {
        status.textContent = expanded ? copy.expanded : (fallback ? copy.fallback : copy.collapsed);
      }
    }

    function setExpanded(next) {
      expanded = !!next;
      timeline.setAttribute('data-expanded', expanded ? 'true' : 'false');
      button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      olderGroups.forEach(function (group) {
        if (expanded) {
          group.hidden = false;
          group.classList.remove('is-hidden');
          if (!prefersReducedMotion()) {
            group.classList.remove('is-entering');
            // Reinicia la animación de entrada aunque el día ya existiera.
            void group.offsetWidth;
            group.classList.add('is-entering');
          }
        } else {
          group.classList.add('is-hidden');
          group.hidden = true;
          group.classList.remove('is-entering');
        }
      });
      renderLabels();
    }

    olderGroups.forEach(function (group) {
      group.classList.add('is-hidden');
      group.hidden = true;
    });
    timeline.setAttribute('data-expanded', 'false');
    button.hidden = false;
    button.setAttribute('aria-expanded', 'false');

    button.addEventListener('click', function () {
      setExpanded(!expanded);
      if (!expanded) {
        // Al plegar, el botón queda al final del documento: devolvemos la
        // vista al inicio del historial sin robar el foco del botón.
        var firstVisible = timeline.querySelector('.day-group:not([hidden])');
        if (firstVisible && firstVisible.scrollIntoView) {
          firstVisible.scrollIntoView({
            block: 'start',
            behavior: prefersReducedMotion() ? 'auto' : 'smooth',
          });
        }
      }
    });

    document.addEventListener('mana:langchange', renderLabels);

    renderLabels();
  }

  // El script se carga al final del body, después del historial: si el
  // timeline ya está en el DOM se aplica el corte antes del primer pintado
  // para que no aparezca un instante el historial completo.
  if (document.getElementById('timeline') || document.readyState !== 'loading') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }

  // Expuesto para las pruebas de regresión del corte semanal.
  window.ManaChangelogTimeline = {
    parseDayLabel: parseDayLabel,
    weeklyCutoff: weeklyCutoff,
    startOfTodayUtc: startOfTodayUtc,
  };
})();
