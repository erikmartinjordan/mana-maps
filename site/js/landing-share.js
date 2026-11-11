// ── landing-share.js ─
// Compartir en las landings estáticas de mapas (/gallery/<slug>/).
//
// Las landings son la URL canónica indexada y no cargan el SDK de la app. Este
// script usa la Web Share API (hoja nativa en móvil) y, cuando no está
// disponible (escritorio), copia el enlace canónico al portapapeles. Cada
// acción registra un evento `share` con `source: static_map` para poder medir
// el canal (objetivo de noviembre: ≥30 shares), junto al botón de X/Reddit.

(function () {
  'use strict';
  if (window.__manaLandingShare) return;
  window.__manaLandingShare = true;

  function track(params) {
    if (typeof window.trackEvent === 'function') {
      try { window.trackEvent('share', params); } catch (e) { /* medición best-effort */ }
    }
  }

  // ── Gancho de datos para compartir ──
  // Compartir solo el título no dice nada a quien ve el enlace en Reddit o X:
  // la landing ya trae «Datos clave» con el valor más alto y el más bajo del
  // mapa. Ese dato es el gancho que puede convertir una impresión en visita y
  // es la única señal social con volumen real (Reddit, informe de octubre).
  function collapse(text) {
    return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  }

  function plainTitle() {
    var h1 = document.querySelector('main h1') || document.querySelector('h1');
    if (h1 && collapse(h1.textContent)) return collapse(h1.textContent);
    var btn = document.querySelector('[data-share-native]');
    var attr = btn && btn.getAttribute('data-share-title');
    if (attr) return collapse(attr);
    return collapse(document.title.split('—')[0]);
  }

  function dataHook() {
    var facts = document.querySelector('.facts-lede');
    var hook = facts ? collapse(facts.textContent) : '';
    if (!hook) {
      var lede = document.querySelector('.lede');
      hook = lede ? collapse(lede.textContent) : '';
    }
    // El prefijo editorial no aporta nada fuera de la página.
    hook = hook.replace(/^Según los datos del mapa,?\s*/i, '');
    if (!hook) return '';
    return hook.charAt(0).toUpperCase() + hook.slice(1);
  }

  function trimWords(text, max) {
    if (text.length <= max) return text;
    var cut = text.slice(0, max);
    var space = cut.lastIndexOf(' ');
    if (space > max * 0.6) cut = cut.slice(0, space);
    return cut.replace(/[\s,;:.]+$/, '') + '…';
  }

  function shareText(title, hook) {
    if (!hook) return title;
    var text = title + ': ' + hook;
    // X cuenta el enlace como 23 caracteres y limita el tuit a 280.
    return trimWords(text, 220);
  }

  function setQueryParam(anchor, key, value) {
    var href = anchor.getAttribute('href');
    if (!href) return;
    try {
      var url = new URL(href, window.location.href);
      url.searchParams.set(key, value);
      anchor.setAttribute('href', url.href);
    } catch (e) { /* href malformado: se deja el original */ }
  }

  function applyDataHook() {
    var title = plainTitle();
    var hook = dataHook();
    if (!hook) return;
    var text = shareText(title, hook);
    if (!text || text === title) return;

    var natives = document.querySelectorAll('[data-share-native]');
    for (var i = 0; i < natives.length; i++) {
      natives[i].setAttribute('data-share-title', title);
      natives[i].setAttribute('data-share-text', text);
    }
    var xLinks = document.querySelectorAll(
      'a[href*="twitter.com/intent/tweet"], a[href*="x.com/intent/tweet"]'
    );
    for (var j = 0; j < xLinks.length; j++) setQueryParam(xLinks[j], 'text', text);
    var redditLinks = document.querySelectorAll('a[href*="reddit.com/submit"]');
    for (var k = 0; k < redditLinks.length; k++) setQueryParam(redditLinks[k], 'title', text);
  }

  applyDataHook();

  function statusFor(btn) {
    var id = btn.getAttribute('data-share-status');
    return id ? document.getElementById(id) : null;
  }

  function announce(btn, message) {
    var status = statusFor(btn);
    if (!status) return;
    status.textContent = message;
    // Deja el mensaje visible unos segundos sin ensuciar el CTA.
    setTimeout(function () {
      if (status.textContent === message) status.textContent = '';
    }, 4000);
  }

  // navigator.clipboard solo existe en contextos seguros; en http local se usa
  // un textarea temporal para que el fallback también funcione en predeploy.
  function copyText(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.top = '-1000px';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try {
        if (document.execCommand('copy')) resolve();
        else reject(new Error('copy-failed'));
      } catch (e) {
        reject(e);
      } finally {
        document.body.removeChild(area);
      }
    });
  }

  function copyAndTrack(btn, url) {
    return copyText(url).then(function () {
      track({ network: 'copy_link', source: 'static_map' });
      announce(btn, 'Enlace copiado');
    }).catch(function () {
      announce(btn, 'No se pudo copiar el enlace');
    });
  }

  function bind(btn) {
    btn.addEventListener('click', function () {
      var url = btn.getAttribute('data-share-url') || window.location.href;
      var title = btn.getAttribute('data-share-title') || document.title;
      var text = btn.getAttribute('data-share-text') || title;

      if (navigator.share) {
        navigator.share({ title: title, text: text, url: url }).then(function () {
          track({ network: 'native', source: 'static_map' });
          announce(btn, 'Mapa compartido');
        }).catch(function (err) {
          // El usuario que cancela la hoja nativa no es un fallo: no copiamos
          // ni registramos un share que no ha ocurrido.
          if (err && err.name === 'AbortError') return;
          copyAndTrack(btn, url);
        });
        return;
      }

      copyAndTrack(btn, url);
    });
  }

  var buttons = document.querySelectorAll('[data-share-native]');
  for (var i = 0; i < buttons.length; i++) bind(buttons[i]);
})();
