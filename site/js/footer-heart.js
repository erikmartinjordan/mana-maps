/* ── Easter egg del pie: corazón pixel al pasar por encima ───────────── */
(function () {
  if (window.__manaFooterHeartEgg) return;
  window.__manaFooterHeartEgg = true;

  var ROWS = [
    '01100110',
    '11111111',
    '11111111',
    '11111111',
    '01111110',
    '00111100',
    '00011000'
  ];
  var LIGHTS = [[2, 1], [3, 1], [1, 2], [1, 3]];

  function heartSvg() {
    var s = 6, base = '', light = '';
    ROWS.forEach(function (row, y) {
      for (var x = 0; x < row.length; x++) {
        if (row.charAt(x) === '1') {
          base += '<rect x="' + (x * s) + '" y="' + (y * s) + '" width="' + s + '" height="' + s + '"/>';
        }
      }
    });
    LIGHTS.forEach(function (p) {
      light += '<rect x="' + (p[0] * s) + '" y="' + (p[1] * s) + '" width="' + s + '" height="' + s + '"/>';
    });
    return '<svg class="site-footer__px-heart" viewBox="0 0 48 42" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<g fill="#ff2d55">' + base + '</g>' +
      '<g fill="#ff8fa3">' + light + '</g>' +
      '<rect x="12" y="0" width="6" height="6" fill="#fff7d6" opacity=".95"/>' +
      '</svg>' +
      '<span class="site-footer__heart-spark"></span>' +
      '<span class="site-footer__heart-spark site-footer__heart-spark--2"></span>';
  }

  function wrap(el) {
    if (!el || el.querySelector('.site-footer__heart')) return;
    var text = el.textContent || '';
    var idx = text.indexOf('\u2665');
    if (idx < 0) idx = text.indexOf('♥');
    if (idx < 0) return;

    var heart = document.createElement('span');
    heart.className = 'site-footer__heart';
    heart.setAttribute('aria-hidden', 'true');
    heart.textContent = '♥';

    var egg = document.createElement('span');
    egg.className = 'site-footer__heart-egg';
    egg.setAttribute('aria-hidden', 'true');
    egg.innerHTML = heartSvg();

    heart.addEventListener('click', function (event) {
      event.preventDefault();
      heart.classList.toggle('is-open');
    });

    el.textContent = '';
    el.appendChild(document.createTextNode(text.slice(0, idx)));
    el.appendChild(heart);
    el.appendChild(document.createTextNode(text.slice(idx + 1)));
    el.appendChild(egg);
  }

  function enhance() {
    document.querySelectorAll('.site-footer__made').forEach(function (el) {
      wrap(el);
      if (el.__manaHeartObserver) return;
      el.__manaHeartObserver = true;
      if (typeof MutationObserver !== 'undefined') {
        var observer = new MutationObserver(function () {
          setTimeout(function () { wrap(el); }, 0);
        });
        observer.observe(el, { childList: true, subtree: true, characterData: true });
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enhance);
  } else {
    enhance();
  }
  setTimeout(enhance, 0);
  document.addEventListener('mana:langchange', function () { setTimeout(enhance, 0); });
})();
