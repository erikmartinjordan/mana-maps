(function () {
  'use strict';

  var list = document.querySelector('[data-news-list]');
  var button = document.querySelector('[data-news-load-more]');
  if (!list || !button) return;

  var cards = Array.prototype.slice.call(list.querySelectorAll(':scope > .post-card'));
  var batchSize = parseInt(list.getAttribute('data-batch-size'), 10) || 10;
  var revealed = Math.min(batchSize, cards.length);

  var isEnglish = document.documentElement.lang.indexOf('en') === 0;
  var labels = isEnglish
    ? { more: 'See more', aria: 'Show more articles', remaining: 'remaining' }
    : { more: 'Ver más', aria: 'Mostrar más artículos', remaining: 'restantes' };

  function render() {
    cards.forEach(function (card, index) {
      card.hidden = index >= revealed;
    });

    var remaining = cards.length - revealed;
    button.textContent = labels.more;
    button.hidden = remaining === 0;
    if (remaining > 0) {
      button.setAttribute('aria-label', labels.aria + ' (' + remaining + ' ' + labels.remaining + ')');
    }
  }

  button.addEventListener('click', function () {
    var firstNewIndex = revealed;
    revealed = Math.min(revealed + batchSize, cards.length);
    render();

    if (revealed >= cards.length) {
      var firstNew = cards[firstNewIndex];
      var target = firstNew && firstNew.querySelector('h2 a, a');
      if (target) target.focus({ preventScroll: true });
    }
  });

  render();
}());
