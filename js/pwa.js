(function () {
  document.addEventListener('DOMContentLoaded', function () {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function (error) {
        console.warn('Maña Maps service worker registration failed:', error);
      });
    }
  });
})();
