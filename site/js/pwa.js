if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // updateViaCache:'none' makes the browser always revalidate sw.js against
    // the network, so a cached service worker can't strand users on old code.
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then((reg) => { if (reg && typeof reg.update === 'function') reg.update(); })
      .catch(() => {});
  });
}
