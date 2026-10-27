// ── tutorial.js ─ Interactive onboarding tour for Maña Maps ──
// Highlights the real editor UI and explains the basic workflow to a
// first-time user. Launch it with the "Tutorial" pill, the shortcut
// /map/?tutorial=1 or any step with /map/?tutorial=4.
(function () {
  'use strict';

  var STORAGE_KEY = 'mana_tutorial_seen_v1';

  var container = null;
  var highlight = null;
  var card = null;
  var titleEl = null;
  var bodyEl = null;
  var tipEl = null;
  var eyebrowEl = null;
  var actionsEl = null;
  var prevBtn = null;
  var nextBtn = null;
  var closeBtn = null;

  var steps = [];
  var index = 0;
  var active = false;
  var tickTimer = null;

  function isEn() {
    return typeof LANG !== 'undefined' && LANG === 'en';
  }
  function txt(es, en) {
    return isEn() ? en : es;
  }
  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }
  function clearInline(el) {
    el.style.top = '';
    el.style.left = '';
    el.style.right = '';
    el.style.bottom = '';
    el.style.width = '';
  }

  // ── Helpers that talk to the editor ────────────────────────
  function openPanel(name) {
    var panel = document.getElementById('panel-' + name);
    if (!panel) return;
    if (panel.classList.contains('visible')) return;
    if (typeof window.togglePanel === 'function') window.togglePanel(name);
  }
  function openDraw() {
    openPanel('draw');
  }
  function openLayers() {
    openPanel('layers');
  }
  function ensureChatOpen() {
    if (
      typeof window.expandChatPanel === 'function' &&
      document.documentElement.getAttribute('data-chat-collapsed') === 'true'
    ) {
      try {
        window.expandChatPanel();
      } catch (e) {}
    }
  }
  function toggle3D() {
    if (typeof window.toggle2D3D === 'function') window.toggle2D3D();
  }
  function isMobileView() {
    return window.innerWidth <= 768;
  }
  function showMobileSidebar() {
    var sidebar = document.getElementById('sidebar');
    var chat = document.getElementById('chat-panel');
    var backdrop = document.getElementById('mobile-backdrop');
    if (chat) chat.classList.remove('mobile-open');
    if (sidebar) sidebar.classList.add('mobile-open');
    if (backdrop) backdrop.classList.add('active');
    document.body.classList.add('panel-open');
  }
  function closeMobilePanels() {
    if (!isMobileView()) return;
    var sidebar = document.getElementById('sidebar');
    var chat = document.getElementById('chat-panel');
    var backdrop = document.getElementById('mobile-backdrop');
    if (sidebar) sidebar.classList.remove('mobile-open');
    if (chat) chat.classList.remove('mobile-open');
    if (backdrop) backdrop.classList.remove('active');
    document.body.classList.remove('panel-open');
    window.setTimeout(function () {
      try {
        if (typeof map !== 'undefined' && map.invalidateSize) map.invalidateSize();
      } catch (e) {}
    }, 320);
  }

  // ── Tour content ───────────────────────────────────────────
  function buildSteps() {
    return isMobileView() ? buildMobileSteps() : buildDesktopSteps();
  }

  function buildDesktopSteps() {
    return [
      {
        target: '.mana-logo-wrap',
        placement: 'bottom',
        title: txt('Bienvenido a Maña Maps', 'Welcome to Maña Maps'),
        body: txt(
          'Este es tu editor de mapas online. En menos de dos minutos aprenderás a crear un mapa desde cero, darle estilo y compartirlo. El tutorial no bloquea la app: puedes probar los elementos resaltados mientras avanzas.',
          'This is your online map editor. In under two minutes you will learn how to create a map from scratch, style it and share it. The tour does not block the app: you can try the highlighted elements as you go.'
        )
      },
      {
        target: '#project-name-input',
        placement: 'bottom',
        title: txt('1. Ponle nombre a tu mapa', '1. Give your map a name'),
        body: txt(
          'Escribe un título como «Rutas de mi barrio» o «Volcanes del mundo». Ese nombre aparecerá al guardar y compartir el mapa.',
          'Type a title such as “My neighbourhood routes” or “Volcanoes of the world”. That name will appear when you save and share the map.'
        )
      },
      {
        target: '#search-wrap',
        placement: 'bottom',
        title: txt('2. Encuentra tu punto de partida', '2. Find your starting point'),
        body: txt(
          'Busca una ciudad, una calle o un lugar. Al elegir un resultado el mapa vuela hasta allí. También puedes navegar arrastrando y usando la rueda del ratón.',
          'Search for a city, a street or a place. When you pick a result the map flies there. You can also navigate by dragging and using the mouse wheel.'
        )
      },
      {
        target: '#toolbar .tool-icon[data-panel="draw"]',
        placement: 'right',
        before: openDraw,
        title: txt('3. Tus herramientas de dibujo', '3. Your drawing tools'),
        body: txt(
          'En esta barra están las herramientas para crear geometrías. El panel de la izquierda muestra las opciones del modo activo.',
          'This bar holds the tools that create geometries. The panel on the left shows the options for the active mode.'
        )
      },
      {
        target: '#btn-point',
        placement: 'right',
        before: openDraw,
        title: txt('4. Añade tu primer punto', '4. Add your first point'),
        body: txt(
          'Pulsa «Añadir punto» y después haz clic en el mapa. Maña te pedirá un nombre y guardará las coordenadas automáticamente.',
          'Click “Add point” and then click on the map. Maña will ask for a name and save the coordinates automatically.'
        ),
        tip: txt(
          'Los puntos son ideales para lugares concretos: una fuente, una tienda o un pico.',
          'Points are ideal for specific places: a fountain, a shop or a peak.'
        )
      },
      {
        target: '#btn-polygon',
        placement: 'right',
        before: openDraw,
        title: txt('5. Dibuja líneas y polígonos', '5. Draw lines and polygons'),
        body: txt(
          'Con «Dibujar línea» trazas rutas o fronteras. Con «Dibujar polígono» delimitas una zona: haz clic en cada vértice y cierra el polígono en el primer punto.',
          '“Draw line” traces routes or borders. “Draw polygon” delimits an area: click each vertex and close the shape on the first point.'
        )
      },
      {
        target: '#panel-layers',
        placement: 'right',
        before: openLayers,
        title: txt('6. Organiza y da estilo a tus capas', '6. Organise and style your layers'),
        body: txt(
          'El icono de capas lista todos los elementos. Haz clic en uno para abrirlo; con el botón derecho accedes a color, grosor, opacidad, iconos y etiquetas. En «Propiedades» puedes añadir datos reales que aparecerán en los popups.',
          'The layers icon lists every element. Click one to open it; right-click to change colour, weight, opacity, icons and labels. In “Properties” you can add real data that will appear in the popups.'
        ),
        tip: txt(
          'Si representas un dato numérico, usa una rampa de color ordenada de claro a oscuro.',
          'If you are mapping a numeric value, use an ordered colour ramp from light to dark.'
        )
      },
      {
        target: '#basemap-stack',
        placement: 'top',
        title: txt('7. Elige el mapa base y la vista 3D', '7. Choose the basemap and 3D view'),
        body: txt(
          'Abajo a la derecha cambias entre mapa estándar, satélite o relieve. En la misma barra tienes zoom, brújula, rotación automática y el botón 2D/3D para ver tu mapa sobre el globo terráqueo.',
          'At the bottom right you can switch between the standard map, satellite or terrain. The same bar holds zoom, compass, auto-rotate and the 2D/3D button to view your map on the globe.'
        ),
        action: {
          label: txt('Probar vista 3D', 'Try the 3D view'),
          run: toggle3D
        }
      },
      {
        target: '#chat-panel',
        placement: 'left',
        before: ensureChatOpen,
        title: txt('8. Pídele cosas a Maña AI', '8. Ask Maña AI'),
        body: txt(
          'El asistente entiende lenguaje natural: «dibuja un polígono sobre el Ebro» o «ponle rojo a las capitales». Configura tu clave de IA con el engranaje si quieres usarlo.',
          'The assistant understands natural language: “draw a polygon over the Ebro” or “make the capitals red”. Set your AI key with the gear icon if you want to use it.'
        )
      },
      {
        target: '#import-btn',
        placement: 'bottom',
        title: txt('9. Importa datos que ya tengas', '9. Import data you already have'),
        body: txt(
          'Puedes traer GeoJSON, KML, KMZ o Shapefile (.zip). Arrastra el archivo al mapa o usa el botón de importar de la barra superior.',
          'You can bring in GeoJSON, KML, KMZ or Shapefile (.zip). Drag the file onto the map or use the import button in the top bar.'
        )
      },
      {
        target: '#export-btn',
        placement: 'bottom',
        title: txt('10. Exporta tu mapa', '10. Export your map'),
        body: txt(
          'Descarga el resultado en GeoJSON, KML/KMZ, CSV o Shapefile. Así podrás abrirlo en QGIS, Google Earth o cualquier otro SIG.',
          'Download the result as GeoJSON, KML/KMZ, CSV or Shapefile. You can then open it in QGIS, Google Earth or any other GIS.'
        )
      },
      {
        target: '#share-btn',
        placement: 'bottom',
        title: txt('11. Guarda y comparte', '11. Save and share'),
        body: txt(
          'Tu mapa se guarda solo en este navegador (verás «Auto-guardado» abajo). Con el botón de compartir generas un enlace para enviarlo. Si inicias sesión, el mapa también aparece en «Mis mapas».',
          'Your map is saved automatically in this browser (look for “Auto-save” below). The share button creates a link you can send. If you sign in, the map also appears in “My maps”.'
        )
      },
      {
        target: null,
        title: txt('¡Listo para crear tu primer mapa!', 'Ready to create your first map!'),
        body: txt(
          'Ya conoces el flujo básico: nombra, busca, dibuja, estiliza y exporta. Pulsa «Empezar a mapear» y prueba con un lugar que conozcas.',
          'You now know the basic workflow: name, search, draw, style and export. Click “Start mapping” and try a place you know.'
        ),
        tip: txt(
          'Consulta los atajos de teclado con el botón «Atajos» o la tecla ?.',
          'Check the keyboard shortcuts with the “Shortcuts” button or the ? key.'
        )
      }
    ];
  }

  function buildMobileSteps() {
    return [
      {
        target: '.mana-logo-wrap',
        placement: 'bottom',
        title: txt('Bienvenido a Maña Maps', 'Welcome to Maña Maps'),
        body: txt(
          'Este es tu editor de mapas online. Te enseñamos el flujo básico en menos de dos minutos. Puedes tocar los elementos resaltados mientras avanzas.',
          'This is your online map editor. We will show you the basic workflow in under two minutes. You can tap the highlighted elements as you go.'
        )
      },
      {
        target: '#mobile-sidebar-toggle',
        placement: 'bottom',
        title: txt('1. Abre las herramientas', '1. Open the tools'),
        body: txt(
          'Toca el menú ☰ para desplegar la barra de herramientas y las capas. En el móvil los controles se esconden para dejar sitio al mapa.',
          'Tap the ☰ menu to open the toolbar and layers. On mobile the controls hide to leave room for the map.'
        )
      },
      {
        target: '#btn-point',
        placement: 'right',
        before: function () {
          showMobileSidebar();
          openDraw();
        },
        title: txt('2. Añade tu primer punto', '2. Add your first point'),
        body: txt(
          'Toca «Añadir punto» y después toca el mapa. Maña te pedirá un nombre y guardará las coordenadas automáticamente.',
          'Tap “Add point” and then tap the map. Maña will ask for a name and save the coordinates automatically.'
        ),
        tip: txt(
          'Los puntos son ideales para lugares concretos: una fuente, una tienda o un pico.',
          'Points are ideal for specific places: a fountain, a shop or a peak.'
        )
      },
      {
        target: '#btn-polygon',
        placement: 'right',
        before: function () {
          showMobileSidebar();
          openDraw();
        },
        title: txt('3. Dibuja líneas y polígonos', '3. Draw lines and polygons'),
        body: txt(
          'Con «Dibujar línea» trazas rutas o fronteras. Con «Dibujar polígono» delimitas una zona: toca cada vértice y cierra el polígono en el primer punto.',
          '“Draw line” traces routes or borders. “Draw polygon” delimits an area: tap each vertex and close the shape on the first point.'
        )
      },
      {
        target: '#panel-layers',
        placement: 'right',
        before: function () {
          showMobileSidebar();
          openLayers();
        },
        title: txt('4. Organiza y da estilo a tus capas', '4. Organise and style your layers'),
        body: txt(
          'El icono de capas lista todos los elementos. Toca uno para editarlo; desde su menú cambias color, grosor, opacidad, iconos y etiquetas. En «Propiedades» puedes añadir datos que aparecerán en los popups.',
          'The layers icon lists every element. Tap one to edit it; its menu lets you change colour, weight, opacity, icons and labels. In “Properties” you can add data that will appear in the popups.'
        ),
        tip: txt(
          'Si representas un dato numérico, usa una rampa de color ordenada de claro a oscuro.',
          'If you are mapping a numeric value, use an ordered colour ramp from light to dark.'
        )
      },
      {
        target: '#basemap-stack',
        placement: 'top',
        before: closeMobilePanels,
        title: txt('5. Cambia el mapa base', '5. Change the basemap'),
        body: txt(
          'Abajo a la derecha cambias entre mapa estándar, satélite o relieve. Usa dos dedos para hacer zoom y arrastra para moverte por el mapa.',
          'At the bottom right you can switch between the standard map, satellite or terrain. Pinch with two fingers to zoom and drag to move around the map.'
        )
      },
      {
        target: '#autosave-pill',
        placement: 'top',
        before: closeMobilePanels,
        title: txt('6. Tu mapa se guarda solo', '6. Your map saves itself'),
        body: txt(
          'Maña guarda automáticamente tu mapa en este navegador. Para importar archivos, exportar a GeoJSON/KML/Shapefile o compartir un enlace, abre el editor en un ordenador.',
          'Maña saves your map automatically in this browser. To import files, export to GeoJSON/KML/Shapefile or share a link, open the editor on a computer.'
        )
      },
      {
        target: null,
        title: txt('¡Listo para crear tu primer mapa!', 'Ready to create your first map!'),
        body: txt(
          'Ya conoces el flujo básico: abre las herramientas, dibuja, estiliza y guarda. Pulsa «Empezar a mapear» y prueba con un lugar que conozcas.',
          'You now know the basic workflow: open the tools, draw, style and save. Click “Start mapping” and try a place you know.'
        )
      }
    ];
  }

  // ── DOM ────────────────────────────────────────────────────
  function ensureDom() {
    if (container) return;

    container = document.createElement('div');
    container.id = 'mana-tutorial';
    container.hidden = true;
    container.innerHTML =
      '<div class="mt-highlight" aria-hidden="true"></div>' +
      '<div class="mt-card" role="dialog" aria-modal="false" aria-labelledby="mt-title" aria-describedby="mt-body">' +
        '<div class="mt-head">' +
          '<span class="mt-eyebrow"><span class="mt-dot" aria-hidden="true"></span><span id="mt-step-label"></span></span>' +
          '<button type="button" class="mt-close" id="mt-close" aria-label="Cerrar tutorial">&times;</button>' +
        '</div>' +
        '<h3 class="mt-title" id="mt-title"></h3>' +
        '<p class="mt-body" id="mt-body"></p>' +
        '<div class="mt-tip" id="mt-tip" hidden></div>' +
        '<div class="mt-actions" id="mt-actions" hidden></div>' +
        '<div class="mt-footer">' +
          '<button type="button" class="mt-btn mt-prev" id="mt-prev"></button>' +
          '<button type="button" class="mt-btn mt-next" id="mt-next"></button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(container);

    highlight = container.querySelector('.mt-highlight');
    card = container.querySelector('.mt-card');
    titleEl = container.querySelector('#mt-title');
    bodyEl = container.querySelector('#mt-body');
    tipEl = container.querySelector('#mt-tip');
    actionsEl = container.querySelector('#mt-actions');
    prevBtn = container.querySelector('#mt-prev');
    nextBtn = container.querySelector('#mt-next');
    closeBtn = container.querySelector('#mt-close');
    eyebrowEl = container.querySelector('#mt-step-label');

    closeBtn.addEventListener('click', close);
    prevBtn.addEventListener('click', prev);
    nextBtn.addEventListener('click', next);
  }

  function injectLauncher() {
    if (document.getElementById('mana-tutorial-launch')) return;
    var bar = document.getElementById('map-bottom-bar');
    if (!bar) return;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'mana-tutorial-launch';
    btn.className = 'stat-pill tutorial-pill';
    btn.title = txt('Ver tutorial interactivo', 'Open interactive tutorial');
    btn.setAttribute('aria-label', txt('Ver tutorial interactivo', 'Open interactive tutorial'));
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<circle cx="12" cy="12" r="9"/>' +
        '<polygon points="15.6 8.4 13.2 13.2 8.4 15.6 10.8 10.8"/>' +
      '</svg>' +
      '<span>' + txt('Tutorial', 'Tutorial') + '</span>';
    btn.addEventListener('click', function () {
      start(0);
    });

    var shortcuts = bar.querySelector('.shortcuts-pill');
    if (shortcuts) bar.insertBefore(btn, shortcuts);
    else bar.appendChild(btn);
  }

  // ── Positioning ────────────────────────────────────────────
  function currentTarget(step) {
    if (!step || !step.target) return null;
    return document.querySelector(step.target);
  }

  function updatePosition() {
    if (!active || !container || container.hidden) return;
    var step = steps[index];
    if (!step) return;

    var target = currentTarget(step);
    var rect = target ? target.getBoundingClientRect() : null;
    if (!rect || (rect.width < 1 && rect.height < 1)) {
      highlight.style.display = 'none';
      centerCard();
      return;
    }

    var pad = typeof step.padding === 'number' ? step.padding : 7;
    highlight.style.display = 'block';
    highlight.style.top = rect.top - pad + 'px';
    highlight.style.left = rect.left - pad + 'px';
    highlight.style.width = rect.width + pad * 2 + 'px';
    highlight.style.height = rect.height + pad * 2 + 'px';

    placeCard(rect, step.placement || 'bottom');
  }

  function centerCard() {
    if (window.innerWidth < 680) {
      card.classList.add('mt-sheet');
      card.classList.remove('mt-sheet-top');
      clearInline(card);
      return;
    }
    card.classList.remove('mt-sheet');
    card.style.visibility = 'hidden';
    var cw = card.offsetWidth || 360;
    var ch = card.offsetHeight || 200;
    var left = Math.max(12, (window.innerWidth - cw) / 2);
    var top = Math.max(12, (window.innerHeight - ch) / 2);
    card.style.left = left + 'px';
    card.style.top = top + 'px';
    card.style.right = '';
    card.style.bottom = '';
    card.style.visibility = '';
  }

  function placeCard(rect, preferred) {
    var vw = window.innerWidth;
    var vh = window.innerHeight;

    if (vw < 680) {
      card.classList.add('mt-sheet');
      card.classList.toggle('mt-sheet-top', rect && rect.top > vh * 0.55);
      clearInline(card);
      return;
    }
    card.classList.remove('mt-sheet');
    card.classList.remove('mt-sheet-top');

    var gap = 14;
    var margin = 12;
    var cw = Math.min(360, vw - 24);
    var ch = card.offsetHeight || 200;

    var fits = {
      top: rect.top - gap - ch >= margin,
      bottom: rect.bottom + gap + ch <= vh - margin,
      left: rect.left - gap - cw >= margin,
      right: rect.right + gap + cw <= vw - margin
    };
    var alternatives = {
      top: ['bottom', 'right', 'left'],
      bottom: ['top', 'right', 'left'],
      left: ['right', 'bottom', 'top'],
      right: ['left', 'bottom', 'top']
    };
    var placement = preferred in fits ? preferred : 'bottom';
    if (!fits[placement]) {
      var order = alternatives[placement] || ['bottom', 'top', 'right', 'left'];
      for (var i = 0; i < order.length; i++) {
        if (fits[order[i]]) {
          placement = order[i];
          break;
        }
      }
    }

    var left;
    var top;
    if (placement === 'top') {
      left = rect.left + rect.width / 2 - cw / 2;
      top = rect.top - gap - ch;
    } else if (placement === 'left') {
      left = rect.left - gap - cw;
      top = rect.top + rect.height / 2 - ch / 2;
    } else if (placement === 'right') {
      left = rect.right + gap;
      top = rect.top + rect.height / 2 - ch / 2;
    } else {
      placement = 'bottom';
      left = rect.left + rect.width / 2 - cw / 2;
      top = rect.bottom + gap;
    }

    left = clamp(left, margin, Math.max(margin, vw - cw - margin));
    top = clamp(top, margin, Math.max(margin, vh - ch - margin));

    card.style.left = left + 'px';
    card.style.top = top + 'px';
    card.style.right = '';
    card.style.bottom = '';
    card.style.width = '';
    card.dataset.placement = placement;
  }

  // ── Rendering ──────────────────────────────────────────────
  function render() {
    ensureDom();
    var step = steps[index];
    if (!step) {
      close();
      return;
    }

    if (typeof step.before === 'function') {
      try {
        step.before();
      } catch (e) {}
    }

    container.hidden = false;
    eyebrowEl.textContent = txt('Tutorial', 'Tutorial') + ' · ' + (index + 1) + ' / ' + steps.length;
    titleEl.textContent = step.title;
    bodyEl.textContent = step.body;

    if (step.tip) {
      tipEl.textContent = step.tip;
      tipEl.hidden = false;
    } else {
      tipEl.hidden = true;
      tipEl.textContent = '';
    }

    actionsEl.innerHTML = '';
    if (step.action && typeof step.action.run === 'function') {
      actionsEl.hidden = false;
      var actionBtn = document.createElement('button');
      actionBtn.type = 'button';
      actionBtn.className = 'mt-action';
      actionBtn.textContent = step.action.label;
      actionBtn.addEventListener('click', function () {
        try {
          step.action.run();
        } catch (e) {}
      });
      actionsEl.appendChild(actionBtn);
    } else {
      actionsEl.hidden = true;
    }

    prevBtn.disabled = index === 0;
    prevBtn.textContent = txt('Anterior', 'Back');
    nextBtn.textContent =
      index === steps.length - 1 ? txt('Empezar a mapear', 'Start mapping') : txt('Siguiente', 'Next');
    closeBtn.setAttribute('aria-label', txt('Cerrar tutorial', 'Close tutorial'));

    updatePosition();
    requestAnimationFrame(updatePosition);
    window.setTimeout(updatePosition, 90);
    window.setTimeout(updatePosition, 330);
  }

  function start(startIndex) {
    ensureDom();
    if (active) {
      if (typeof startIndex === 'number') goTo(startIndex);
      return;
    }

    steps = buildSteps();
    index = clamp(typeof startIndex === 'number' ? startIndex : 0, 0, steps.length - 1);
    active = true;
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    tickTimer = window.setInterval(updatePosition, 200);
    render();
    window.dispatchEvent(new CustomEvent('mana:tutorial-start'));
  }

  function close() {
    if (!active) return;
    active = false;
    if (tickTimer) {
      window.clearInterval(tickTimer);
      tickTimer = null;
    }
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', updatePosition);
    window.removeEventListener('scroll', updatePosition, true);
    if (container) container.hidden = true;
    if (highlight) highlight.style.display = 'none';
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch (e) {}
    window.dispatchEvent(new CustomEvent('mana:tutorial-end'));
  }

  function next() {
    if (!active) return;
    if (index >= steps.length - 1) {
      close();
      return;
    }
    index += 1;
    render();
  }

  function prev() {
    if (!active || index === 0) return;
    index -= 1;
    render();
  }

  function goTo(i) {
    if (!active) {
      start(i);
      return;
    }
    index = clamp(i, 0, steps.length - 1);
    render();
  }

  function onKey(e) {
    if (!active) return;
    var tag = (e.target.tagName || '').toLowerCase();
    var typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
    var onControl = tag === 'button' || tag === 'a';

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (typing || onControl) return;
    if (e.key === 'ArrowRight' || e.key === 'Enter') {
      e.preventDefault();
      next();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      prev();
    }
  }

  // ── Init ───────────────────────────────────────────────────
  function init() {
    ensureDom();
    injectLauncher();

    var params = new URLSearchParams(window.location.search);
    var q = params.get('tutorial');
    var startAt = 0;
    if (q && q !== '1') {
      if (/^\d+$/.test(q)) startAt = Math.max(0, parseInt(q, 10) - 1);
      else return;
    } else if (q !== '1' && window.location.hash !== '#tutorial') {
      return;
    }

    window.setTimeout(function () {
      start(startAt);
    }, 800);
  }

  window.ManaTutorial = {
    start: start,
    close: close,
    next: next,
    prev: prev,
    showStep: goTo,
    reset: function () {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (e) {}
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
