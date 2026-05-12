(function () {
  var deferredInstallPrompt = null;
  var installButtons = [];
  var statusNode = null;

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function setInstallState(state) {
    document.documentElement.setAttribute('data-pwa-state', state);
    installButtons.forEach(function (button) {
      if (state === 'installed') {
        button.setAttribute('aria-disabled', 'true');
      } else {
        button.removeAttribute('aria-disabled');
      }
    });
  }

  function installHelpMessage() {
    var isiOS = /iphone|ipad|ipod/i.test(window.navigator.userAgent || '');
    if (isiOS) {
      return 'Para instalar Maña Maps, toca Compartir y después “Añadir a pantalla de inicio”.';
    }
    return 'Si no aparece el instalador, abre el menú del navegador y elige “Instalar app” o “Añadir a pantalla de inicio”.';
  }

  async function installManaApp(event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (isStandalone()) {
      window.alert('Maña Maps ya está instalada en este dispositivo.');
      return;
    }
    if (!deferredInstallPrompt) {
      if (statusNode) statusNode.textContent = installHelpMessage();
      window.alert(installHelpMessage());
      return;
    }

    deferredInstallPrompt.prompt();
    var choice = await deferredInstallPrompt.userChoice;
    if (choice && choice.outcome === 'accepted') {
      setInstallState('installing');
      if (statusNode) statusNode.textContent = 'Instalando Maña Maps…';
    }
    deferredInstallPrompt = null;
  }

  window.installManaApp = installManaApp;

  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    deferredInstallPrompt = event;
    setInstallState('ready');
    if (statusNode) statusNode.textContent = 'Lista para instalar en este dispositivo.';
  });

  window.addEventListener('appinstalled', function () {
    deferredInstallPrompt = null;
    setInstallState('installed');
    if (statusNode) statusNode.textContent = 'Maña Maps instalada correctamente.';
  });

  function openMapWhenLaunchedFromHome() {
    if (!isStandalone()) return;
    if (window.location.pathname === '/' || window.location.pathname === '/index.html') {
      window.location.replace('/map/');
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    openMapWhenLaunchedFromHome();
    installButtons = Array.prototype.slice.call(document.querySelectorAll('[data-pwa-install]'));
    statusNode = document.querySelector('[data-pwa-status]');
    setInstallState(isStandalone() ? 'installed' : (deferredInstallPrompt ? 'ready' : 'manual'));

    installButtons.forEach(function (button) {
      button.addEventListener('click', installManaApp);
    });

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function (error) {
        console.warn('Maña Maps service worker registration failed:', error);
      });
    }
  });
})();
