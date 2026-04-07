// ── responsive.js ─ Mobile / tablet responsive behavior ──

(function () {
  'use strict';

  var sidebar   = document.getElementById('sidebar');
  var chatPanel = document.getElementById('chat-panel');
  var backdrop  = document.getElementById('mobile-backdrop');
  var btnSidebar = document.getElementById('mobile-sidebar-toggle');
  var btnChat    = document.getElementById('mobile-chat-toggle');

  function isMobile() {
    return window.innerWidth <= 768;
  }

  function closeAll() {
    sidebar.classList.remove('mobile-open');
    chatPanel.classList.remove('mobile-open');
    backdrop.classList.remove('active');
    document.body.classList.remove('panel-open');
    setTimeout(function () { map.invalidateSize(); }, 320);
  }

  function openSidebar() {
    closeAll();
    sidebar.classList.add('mobile-open');
    backdrop.classList.add('active');
    document.body.classList.add('panel-open');
  }

  function openChat() {
    closeAll();
    chatPanel.classList.add('mobile-open');
    backdrop.classList.add('active');
    document.body.classList.add('panel-open');
  }

  if (btnSidebar) {
    btnSidebar.addEventListener('click', function (e) {
      e.stopPropagation();
      if (sidebar.classList.contains('mobile-open')) { closeAll(); }
      else { openSidebar(); }
    });
  }

  if (btnChat) {
    btnChat.addEventListener('click', function (e) {
      e.stopPropagation();
      if (chatPanel.classList.contains('mobile-open')) { closeAll(); }
      else { openChat(); }
    });
  }

  if (backdrop) {
    backdrop.addEventListener('click', closeAll);
  }

  // Close panels on Escape key
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isMobile()) { closeAll(); }
  });

  // Close panels if resized to desktop
  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (!isMobile()) {
        closeAll();
        sidebar.classList.remove('mobile-open');
        chatPanel.classList.remove('mobile-open');
      }
      map.invalidateSize();
    }, 150);
  });
})();
