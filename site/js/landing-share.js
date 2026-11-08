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

  function track(params) {
    if (typeof window.trackEvent === 'function') {
      try { window.trackEvent('share', params); } catch (e) { /* medición best-effort */ }
    }
  }

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

      if (navigator.share) {
        navigator.share({ title: title, text: title, url: url }).then(function () {
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
