// ── globe-hand.js ─ Easter egg: a hand spins the 3D globe on one finger ──
// When the user drags the 3D globe fast, the globe lifts/shrinks a touch and a
// hand rises from the bottom, balancing the world on its index finger while it
// keeps spinning in the direction of the gesture.

(function () {
  var POINTER_VEL_MIN = 2.2;  // px/ms medios del puntero para disparar (fuerza)
  var COOLDOWN = 2600;        // ms between hand cameos
  var SPIN_GAIN = 0.3;        // giro inicial base (deg/ms; se escala con la fuerza)
  var SPIN_DECAY = 0.95;       // decaimiento por 16.7 ms de giro
  var SPIN_MAX = 0.65;         // tope deg/ms: por encima estroboscopia a 60 Hz
  var SPIN_STOP = 0.012;       // umbral deg/ms para detener el impulso
  var LIFT_ZOOM = 1.05;       // globe shrinks to at most this zoom during the cameo
  var LIFT_PAD_FRAC = 0.30;   // bottom padding added to make room for the hand
  var HAND_SCALE = 2.0;       // hand height relative to the globe's screen radius
  var HOLD_MS = 1750;         // how long the hand stays up
  var VB_W = 900, VB_H = 900; // SVG canvas
  var TIP_X = 563 / VB_W, TIP_Y = 108 / VB_H; // default fingertip inside the canvas

  function selectedVariantNumber() {
    if (window.GLOBE_HAND_VARIANT === '3d') return 1;
    var n = parseInt(window.GLOBE_HAND_VARIANT, 10);
    return (n >= 1 && n <= 5) ? n : 1;
  }

  function selectedVariant() {
    var variants = window.GlobeHandVariants || {};
    return variants[selectedVariantNumber()] || null;
  }

  // Mano 3D (Three.js) por defecto; SVG como fallback. Se fuerza SVG con
  // window._manaGlobeHand2D = true o eligiendo una variante numérica 1-5.
  function threeUsable() {
    return !!(window.GlobeHand3D &&
      typeof window.GlobeHand3D.isUsable === 'function' &&
      window.GlobeHand3D.isUsable());
  }

  function renderMode() {
    if (window._manaGlobeHand2D) return 'svg';
    var v = window.GLOBE_HAND_VARIANT;
    if (v === '3d') return threeUsable() ? '3d' : 'svg';
    if (v != null && !isNaN(parseInt(v, 10))) return 'svg';
    return threeUsable() ? '3d' : 'svg';
  }

  function is3d() { return !!(el && el.dataset.mode === '3d'); }

  function currentTip() {
    if (is3d() && window.GlobeHand3D && typeof window.GlobeHand3D.tip === 'function') {
      var t = window.GlobeHand3D.tip();
      if (t) return t;
    }
    var variant = selectedVariant();
    if (variant && variant.tip) {
      return { x: variant.tip[0] / VB_W, y: variant.tip[1] / VB_H };
    }
    return { x: TIP_X, y: TIP_Y };
  }

  var el = null, rotEl = null;
  var ready = false;
  var active = false;
  var cooldownUntil = 0;
  var samples = [];
  var spinRAF = null, spinVel = 0, spinLast = 0;
  var savedZoom = null, savedPadding = null;
  var liftTimer = null, hideTimer = null;
  var handW = 0, handH = 0;      // tamaño CSS aplicado (evita churn)
  var handX = NaN, handY = NaN;  // posición CSS aplicada (evita sub-píxel)
  var flickSpeed = 0;            // velocidad media del último gesto (px/ms)

  function buildDefaultSvg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 900">
  <defs>
    <!-- ===== Siluetas ===== -->
    <path id="ghPBack" d="M302,472 C298,436 306,410 322,396 C348,376 392,368 438,370 C510,374 586,396 626,438 C654,468 662,512 656,566 C648,630 630,700 618,764 C608,818 606,860 606,900 L338,900 C339,854 333,812 327,766 C316,698 309,620 306,548 C305,522 303,496 302,472 Z"/>
    <path id="ghPPnk" d="M306,556 C304,508 303,456 306,412 C307,386 321,371 341,371 C361,371 375,386 376,412 C379,456 379,508 378,556 Z"/>
    <path id="ghPRng" d="M384,552 C382,496 381,442 384,398 C385,366 401,348 423,348 C445,348 461,366 462,398 C465,442 466,496 464,552 Z"/>
    <path id="ghPMid" d="M458,550 C456,492 455,436 459,390 C461,356 478,336 501,336 C524,336 541,356 542,390 C546,436 546,492 544,550 Z"/>
    <path id="ghPIdx" d="M532,496 C529,438 530,384 534,330 C538,276 541,232 544,192 C546,166 548,148 553,132 C558,116 563,108 571,108 C579,108 587,114 591,124 C595,134 597,150 599,168 C601,188 602,208 603,232 C604,260 607,296 610,340 C613,384 615,438 615,496 Z"/>
    <path id="ghPThm" d="M676,492 C662,468 634,458 598,459 C548,461 488,464 438,465 C405,466 377,464 357,470 C335,477 325,497 330,517 C335,537 353,548 377,549 C414,550 456,550 498,554 C542,558 586,565 622,561 C654,557 675,539 676,515 C676,507 674,498 676,492 Z"/>

    <!-- ===== Gradientes ===== -->
    <radialGradient id="ghGFlesh" gradientUnits="userSpaceOnUse" cx="390" cy="360" r="620">
      <stop offset="0" stop-color="#f7d2b2"/>
      <stop offset=".35" stop-color="#efb48f"/>
      <stop offset=".68" stop-color="#da9870"/>
      <stop offset="1" stop-color="#a3633f"/>
    </radialGradient>
    <linearGradient id="ghGIdxBase" gradientUnits="userSpaceOnUse" x1="0" y1="108" x2="0" y2="496">
      <stop offset="0" stop-color="#f4c39e"/>
      <stop offset=".55" stop-color="#eba87f"/>
      <stop offset="1" stop-color="#d9986a"/>
    </linearGradient>
    <linearGradient id="ghGThumb" gradientUnits="userSpaceOnUse" x1="0" y1="440" x2="0" y2="560">
      <stop offset="0" stop-color="#f2c3a3"/>
      <stop offset=".22" stop-color="#f7d4b5"/>
      <stop offset=".48" stop-color="#eab28c"/>
      <stop offset=".78" stop-color="#cd9066"/>
      <stop offset="1" stop-color="#ab6b48"/>
    </linearGradient>
    <!-- sombreado cilíndrico (objectBoundingBox): sirve para índice y nudillos -->
    <linearGradient id="ghGCyl" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#7a3c1e" stop-opacity=".30"/>
      <stop offset=".09" stop-color="#7a3c1e" stop-opacity=".14"/>
      <stop offset=".27" stop-color="#fff4e8" stop-opacity=".46"/>
      <stop offset=".5" stop-color="#7a3c1e" stop-opacity="0"/>
      <stop offset=".76" stop-color="#7a3c1e" stop-opacity=".13"/>
      <stop offset=".93" stop-color="#6a3016" stop-opacity=".34"/>
      <stop offset="1" stop-color="#b0653a" stop-opacity=".20"/>
    </linearGradient>
    <linearGradient id="ghGBackL" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#6a3016" stop-opacity=".36"/>
      <stop offset=".08" stop-color="#6a3016" stop-opacity=".24"/>
      <stop offset=".2" stop-color="#6a3016" stop-opacity=".09"/>
      <stop offset=".32" stop-color="#6a3016" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="ghGBackR" x1="0" y1="0" x2="1" y2="0">
      <stop offset=".68" stop-color="#6a3016" stop-opacity="0"/>
      <stop offset=".84" stop-color="#6a3016" stop-opacity=".10"/>
      <stop offset=".95" stop-color="#6a3016" stop-opacity=".26"/>
      <stop offset="1" stop-color="#8a4a28" stop-opacity=".34"/>
    </linearGradient>
    <linearGradient id="ghGBackV" x1="0" y1="0" x2="0" y2="1">
      <stop offset=".6" stop-color="#4a2410" stop-opacity="0"/>
      <stop offset="1" stop-color="#4a2410" stop-opacity=".4"/>
    </linearGradient>
    <!-- luz de borde cálida (subsuperficie), lado derecho -->
    <linearGradient id="ghGRim" gradientUnits="userSpaceOnUse" x1="480" y1="0" x2="650" y2="0">
      <stop offset="0" stop-color="#ff9a52" stop-opacity="0"/>
      <stop offset="1" stop-color="#ff9a52" stop-opacity=".55"/>
    </linearGradient>
    <!-- fundidos entre sombreado de nudillos y del dorso -->
    <linearGradient id="ghGFadeOut" gradientUnits="userSpaceOnUse" x1="0" y1="470" x2="0" y2="545">
      <stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/>
    </linearGradient>
    <linearGradient id="ghGFadeIn" gradientUnits="userSpaceOnUse" x1="0" y1="470" x2="0" y2="545">
      <stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/>
    </linearGradient>
    <mask id="ghMkOut" maskUnits="userSpaceOnUse" x="0" y="0" width="900" height="900">
      <rect x="0" y="0" width="900" height="900" fill="url(#ghGFadeOut)"/>
    </mask>
    <mask id="ghMkIn" maskUnits="userSpaceOnUse" x="0" y="0" width="900" height="900">
      <rect x="0" y="0" width="900" height="900" fill="url(#ghGFadeIn)"/>
    </mask>

    <!-- ===== Filtros (región explícita para que nunca se recorten) ===== -->
    <filter id="ghB1" filterUnits="userSpaceOnUse" x="-80" y="-80" width="1060" height="1060" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation=".6"/></filter>
    <filter id="ghB3" filterUnits="userSpaceOnUse" x="-80" y="-80" width="1060" height="1060" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="3"/></filter>
    <filter id="ghB6" filterUnits="userSpaceOnUse" x="-80" y="-80" width="1060" height="1060" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="6"/></filter>
    <filter id="ghB8" filterUnits="userSpaceOnUse" x="-80" y="-80" width="1060" height="1060" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="8"/></filter>
    <filter id="ghB12" filterUnits="userSpaceOnUse" x="-80" y="-80" width="1060" height="1060" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="12"/></filter>
    <filter id="ghB18" filterUnits="userSpaceOnUse" x="-80" y="-80" width="1060" height="1060" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="18"/></filter>

    <!-- ===== Recortes ===== -->
    <clipPath id="ghCpBack"><use href="#ghPBack"/></clipPath>
    <clipPath id="ghCpIdx"><use href="#ghPIdx"/></clipPath>
    <clipPath id="ghCpThm"><use href="#ghPThm"/></clipPath>
    <clipPath id="ghCpBmp"><use href="#ghPPnk"/><use href="#ghPRng"/><use href="#ghPMid"/></clipPath>
    <clipPath id="ghCpFist"><use href="#ghPBack"/><use href="#ghPPnk"/><use href="#ghPRng"/><use href="#ghPMid"/></clipPath>
    <clipPath id="ghCpTop"><rect x="0" y="0" width="900" height="884"/></clipPath>
  </defs>
  <ellipse class="gh-contact" cx="563" cy="100" rx="40" ry="10" fill="#2b1307" opacity=".22" filter="url(#ghB6)"/>
  <ellipse cx="563" cy="92" rx="58" ry="17" fill="#bfd9f7" opacity=".18" filter="url(#ghB12)"/>

  <g fill="none" stroke="#4a2110" stroke-opacity=".14" stroke-width="4" stroke-linejoin="round">
    <use href="#ghPBack"/><use href="#ghPPnk"/><use href="#ghPRng"/><use href="#ghPMid"/><use href="#ghPIdx"/><use href="#ghPThm"/>
  </g>

  <g fill="url(#ghGFlesh)">
    <use href="#ghPBack"/><use href="#ghPPnk"/><use href="#ghPRng"/><use href="#ghPMid"/>
  </g>

  <!-- ============ 3. Sombreado del dorso / muñeca ============ -->
  <g mask="url(#ghMkIn)"><use href="#ghPBack" fill="url(#ghGBackL)"/></g>
  <use href="#ghPBack" fill="url(#ghGBackR)"/>
  <use href="#ghPBack" fill="url(#ghGBackV)"/>

  <g clip-path="url(#ghCpBack)">
    <ellipse cx="598" cy="648" rx="38" ry="78" fill="#fff" fill-opacity=".18" filter="url(#ghB18)"/>
    <g filter="url(#ghB3)" fill="none" stroke-linecap="round">
      <g stroke="#fff" stroke-opacity=".14" stroke-width="6">
        <path d="M392,572 C396,612 402,654 410,704"/>
        <path d="M452,566 C456,616 462,668 470,726"/>
        <path d="M512,568 C516,614 524,662 534,714"/>
      </g>
      <g stroke="#4a2110" stroke-opacity=".13" stroke-width="7" transform="translate(9,0)">
        <path d="M392,572 C396,612 402,654 410,704"/>
        <path d="M452,566 C456,616 462,668 470,726"/>
        <path d="M512,568 C516,614 524,662 534,714"/>
      </g>
    </g>
    <ellipse cx="360" cy="760" rx="150" ry="120" fill="#4a2110" opacity=".14" filter="url(#ghB18)"/>
  </g>
  <!-- rim light cálido del dorso -->
  <g clip-path="url(#ghCpBack)"><g clip-path="url(#ghCpTop)">
    <use href="#ghPBack" fill="none" stroke="url(#ghGRim)" stroke-width="16" filter="url(#ghB6)"/>
  </g></g>

  <g mask="url(#ghMkOut)">
    <use href="#ghPPnk" fill="url(#ghGCyl)"/>
    <use href="#ghPRng" fill="url(#ghGCyl)"/>
    <use href="#ghPMid" fill="url(#ghGCyl)"/>
  </g>
  <g clip-path="url(#ghCpBmp)">
    <path d="M342,412 L342,520 M424,402 L424,520 M502,384 L502,520" stroke="#3d1c0b" stroke-width="9" stroke-linecap="round" filter="url(#ghB3)" opacity=".34"/>
    <g filter="url(#ghB6)" fill="#fff">
      <ellipse cx="504" cy="362" rx="16" ry="12" fill-opacity=".55"/>
      <ellipse cx="424" cy="374" rx="15" ry="11" fill-opacity=".5"/>
      <ellipse cx="342" cy="396" rx="12" ry="9" fill-opacity=".46"/>
    </g>
  </g>
  <g filter="url(#ghB1)" fill="none" stroke-linecap="round">
    <g stroke="#6b3317" stroke-opacity=".18" stroke-width="2">
      <path d="M484,392 Q502,397 521,392"/><path d="M406,404 Q424,409 443,404"/><path d="M326,426 Q342,431 359,426"/>
    </g>
    <g stroke="#fff" stroke-opacity=".24" stroke-width="1.4" transform="translate(0,2.6)">
      <path d="M484,392 Q502,397 521,392"/><path d="M406,404 Q424,409 443,404"/><path d="M326,426 Q342,431 359,426"/>
    </g>
  </g>

  <!-- ============ 5. Sombra proyectada del pulgar sobre el puño ============ -->
  <g clip-path="url(#ghCpFist)">
    <use href="#ghPThm" transform="translate(5,15)" fill="#3a1808" fill-opacity=".38" filter="url(#ghB12)"/>
  </g>

  <g class="gh-finger">
    <use href="#ghPIdx" fill="url(#ghGIdxBase)" stroke="#4a2110" stroke-opacity=".14" stroke-width="2.5" stroke-linejoin="round"/>
    <use href="#ghPIdx" fill="url(#ghGCyl)"/>
    <g clip-path="url(#ghCpIdx)">
      <g filter="url(#ghB8)" fill="#3a1808">
        <ellipse cx="570" cy="440" rx="50" ry="12" fill-opacity=".3"/>
        <rect x="530" y="320" width="11" height="120" fill-opacity=".2"/>
        <rect x="602" y="256" width="10" height="190" fill-opacity=".18"/>
      </g>
      <ellipse cx="567" cy="122" rx="23" ry="12" fill="#d9776a" fill-opacity=".26" filter="url(#ghB8)"/>
      <g filter="url(#ghB6)" fill="#fff">
        <ellipse cx="557" cy="132" rx="12" ry="8" fill-opacity=".55"/>
        <ellipse cx="559" cy="212" rx="9" ry="6" fill-opacity=".3"/>
        <ellipse cx="563" cy="292" rx="13" ry="8" fill-opacity=".32"/>
        <ellipse cx="558" cy="250" rx="5" ry="40" fill-opacity=".24"/>
        <ellipse cx="561" cy="362" rx="6" ry="46" fill-opacity=".22"/>
      </g>
      <g opacity=".78">
        <use href="#ghPIdx" fill="none" stroke="url(#ghGRim)" stroke-width="14" filter="url(#ghB6)"/>
      </g>
    </g>
    <g filter="url(#ghB1)" fill="none" stroke-linecap="round">
      <g stroke="#6b3317" stroke-opacity=".2" stroke-width="2">
        <path d="M548,208 Q570,213 594,207"/><path d="M547,292 Q573,298 600,291"/><path d="M548,304 Q573,310 600,303"/>
      </g>
      <g stroke="#fff" stroke-opacity=".3" stroke-width="1.4" transform="translate(0,2.6)">
        <path d="M548,208 Q570,213 594,207"/><path d="M547,292 Q573,298 600,291"/><path d="M548,304 Q573,310 600,303"/>
      </g>
    </g>
  </g>

  <g class="gh-thumb">
    <use href="#ghPThm" fill="url(#ghGThumb)" stroke="#4a2110" stroke-opacity=".16" stroke-width="2.5" stroke-linejoin="round"/>
    <g clip-path="url(#ghCpThm)">
      <g filter="url(#ghB12)" fill="#3a1808">
        <ellipse cx="672" cy="520" rx="32" ry="60" fill-opacity=".3"/>
        <ellipse cx="500" cy="552" rx="168" ry="13" fill-opacity=".26"/>
      </g>
      <g filter="url(#ghB6)" fill="#fff">
        <ellipse cx="490" cy="474" rx="105" ry="7" fill-opacity=".36"/>
        <ellipse cx="360" cy="492" rx="13" ry="8" fill-opacity=".4"/>
        <ellipse cx="578" cy="470" rx="24" ry="7" fill-opacity=".3"/>
      </g>
      <g opacity=".8">
        <use href="#ghPThm" fill="none" stroke="url(#ghGRim)" stroke-width="15" filter="url(#ghB6)"/>
      </g>
    </g>
    <g filter="url(#ghB1)" fill="none" stroke-linecap="round">
      <g stroke="#6b3317" stroke-opacity=".18" stroke-width="2">
        <path d="M444,476 Q450,504 443,532"/><path d="M562,478 Q567,508 561,538"/>
      </g>
      <g stroke="#fff" stroke-opacity=".26" stroke-width="1.4" transform="translate(2.4,0)">
        <path d="M444,476 Q450,504 443,532"/><path d="M562,478 Q567,508 561,538"/>
      </g>
    </g>
  </g>
</svg>`;
  }

  function buildSvg() {
    var variant = selectedVariant();
    return variant ? variant.svg() : buildDefaultSvg();
  }

  function ensureEl() {
    var wrap = document.getElementById('map-wrap');
    if (!wrap) return null;
    if (!el || !el.isConnected) {
      el = document.getElementById('globe-hand');
      if (!el) {
        el = document.createElement('div');
        el.id = 'globe-hand';
        el.setAttribute('aria-hidden', 'true');
        wrap.appendChild(el);
      }
    }
    var mode = renderMode();
    var renderKey = mode === '3d' ? '3d' : 'svg:' + selectedVariantNumber();
    if (!el.firstChild || el.dataset.renderKey !== renderKey) {
      var built3d = false;
      if (mode === '3d') {
        el.innerHTML = '<div class="gh-rot gh-3d"></div>';
        built3d = !!(window.GlobeHand3D && window.GlobeHand3D.build(el.firstChild));
      }
      if (built3d) {
        el.dataset.renderKey = '3d';
        el.dataset.mode = '3d';
      } else {
        el.dataset.renderKey = 'svg:' + selectedVariantNumber();
        el.dataset.mode = 'svg';
        el.innerHTML = '<div class="gh-rot">' + buildSvg() + '</div>';
      }
    }
    rotEl = el.firstChild;
    handW = 0; handH = 0; handX = NaN; handY = NaN; // fuerza recolocar/medir
    return el;
  }

  // Projected globe disc on screen (centre + radius + bottom), robust to
  // zoom and padding: sample a lat/lng grid and measure the silhouette.
  function globeGeometry() {
    if (!globeMap || typeof maplibregl === 'undefined') return null;
    try {
      var minX = 1e9, maxX = -1e9, maxY = -1e9, minY = 1e9;
      for (var lat = -84; lat <= 84; lat += 16) {
        for (var lng = -180; lng <= 180; lng += 16) {
          var p = globeMap.project([lng, lat]);
          if (!isFinite(p.x) || !isFinite(p.y)) continue;
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
          if (p.y < minY) minY = p.y;
        }
      }
      if (!isFinite(minX) || !isFinite(maxX) || maxX <= minX) return null;
      return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, r: (maxX - minX) / 2, bottom: maxY };
    } catch (e) { return null; }
  }

  function positionHand() {
    var wrap = document.getElementById('map-wrap');
    if (!wrap) return;
    var h = wrap.clientHeight, w = wrap.clientWidth;
    var m = globeGeometry();
    var height, contactX, contactY;
    if (m) {
      height = Math.max(300, Math.min(m.r * HAND_SCALE, h * 1.6));
      contactX = m.cx;
      contactY = (m.bottom != null ? m.bottom : m.cy + m.r) - Math.max(4, m.r * 0.03);
    } else {
      height = h * 0.9; contactX = w / 2; contactY = h * 0.58;
    }
    var wpx = height * VB_W / VB_H;
    var tip = currentTip();
    // Tamaño CSS únicamente: el buffer del canvas está fijado en globe-hand-3d
    // (no se redimensiona durante el cameo, así no hay flash al girar) y el
    // navegador escala el canvas suavemente.
    var H = Math.round(height), W = Math.round(wpx);
    if (H !== handH || W !== handW) {
      el.style.height = H + 'px';
      el.style.width = W + 'px';
      handW = W; handH = H;
    }
    // Posición redondeada a píxel entero y sin reescribir si no cambia: evita
    // el reescalado sub-píxel del canvas fotograma a fotograma.
    var L = Math.round(contactX - tip.x * wpx), T = Math.round(contactY - tip.y * height);
    if (L !== handX || T !== handY) {
      el.style.left = L + 'px';
      el.style.top = T + 'px';
      handX = L; handY = T;
    }
  }

  // Un gesto más rápido arranca un giro más rápido (tipo baloncesto): cuanto
  // más fuerte giras con el ratón, más vueltas da la bola al soltar.
  function flickSpeedBoost() {
    if (!flickSpeed) return 1;
    return Math.min(Math.max(flickSpeed / POINTER_VEL_MIN, 1.1), 3.0);
  }

  function nowMs() {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now());
  }

  function startMomentum(dir) {
    if (spinRAF) { cancelAnimationFrame(spinRAF); spinRAF = null; }
    var v0 = SPIN_GAIN * flickSpeedBoost();
    if (v0 > SPIN_MAX) v0 = SPIN_MAX;
    spinVel = dir * v0;
    spinLast = nowMs();
    var step = function () {
      if (!globeMap || (typeof activeBase !== 'undefined' && activeBase !== 'globe')) {
        spinRAF = null; return;
      }
      var t = nowMs();
      var dt = t - spinLast;
      spinLast = t;
      if (dt < 0) dt = 0; else if (dt > 50) dt = 50;
      if (dt > 0) {
        var c = globeMap.getCenter();
        c.lng += spinVel * dt;
        globeMap.setCenter(c);
        spinVel *= Math.pow(SPIN_DECAY, dt / 16.7);
      }
      if (Math.abs(spinVel) > SPIN_STOP) spinRAF = requestAnimationFrame(step);
      else spinRAF = null;
    };
    spinRAF = requestAnimationFrame(step);
  }

  function showHand(dir) {
    if (!el || (typeof activeBase !== 'undefined' && activeBase !== 'globe')) { active = false; return; }
    if (is3d() && window.GlobeHand3D) window.GlobeHand3D.start();
    positionHand();
    var tip = currentTip();
    if (rotEl) rotEl.style.transformOrigin = (tip.x * 100) + '% ' + (tip.y * 100) + '%';
    el.style.setProperty('--flick', dir >= 0 ? '1' : '-1');
    el.classList.remove('gh-in');
    void el.offsetWidth;
    el.classList.add('gh-in');
    startMomentum(dir);
    // Keep it glued while the camera eases / the globe settles.
    window.setTimeout(positionHand, 180);
    window.setTimeout(positionHand, 420);
    window.setTimeout(positionHand, 760);
  }

  function restoreGlobe() {
    if (!globeMap || savedZoom == null) return;
    if (typeof activeBase !== 'undefined' && activeBase !== 'globe') return;
    // El impulso (setCenter por frame) cancelaría el easeTo de vuelta.
    if (spinRAF) { cancelAnimationFrame(spinRAF); spinRAF = null; }
    spinVel = 0;
    try {
      globeMap.easeTo({ zoom: savedZoom, padding: savedPadding || { top: 0, bottom: 0, left: 0, right: 0 }, duration: 420, essential: false });
    } catch (e) {}
    savedZoom = null; savedPadding = null;
  }

  function trigger(dir) {
    var now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (window._manaGlobeHandDisabled) return;
    if (active || now < cooldownUntil) return;
    if (typeof activeBase !== 'undefined' && activeBase !== 'globe') return;
    if (!ensureEl() || !globeMap) return;
    active = true;
    cooldownUntil = now + COOLDOWN + HOLD_MS;

    var wrap = document.getElementById('map-wrap');
    savedZoom = globeMap.getZoom();
    savedPadding = globeMap.getPadding();
    var liftPad = Math.round((wrap ? wrap.clientHeight : 600) * LIFT_PAD_FRAC);
    var liftZoom = Math.min(savedZoom, LIFT_ZOOM);
    try {
      globeMap.easeTo({
        zoom: liftZoom,
        padding: { top: savedPadding.top, bottom: liftPad, left: savedPadding.left, right: savedPadding.right },
        duration: 300, essential: false
      });
    } catch (e) {}

    if (liftTimer) clearTimeout(liftTimer);
    liftTimer = setTimeout(function () { showHand(dir); }, 200);

    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(function () {
      if (el) el.classList.remove('gh-in');
      if (window.GlobeHand3D) window.GlobeHand3D.stop();
      if (spinRAF) { cancelAnimationFrame(spinRAF); spinRAF = null; }
      spinVel = 0;
      active = false;
      setTimeout(restoreGlobe, 420);
    }, HOLD_MS);
  }

  function previewHand(dir) {
    hideGlobeHand();
    cooldownUntil = 0;
    trigger(dir || 1);
  }

  function hideGlobeHand() {
    if (spinRAF) { cancelAnimationFrame(spinRAF); spinRAF = null; }
    spinVel = 0;
    active = false;
    if (liftTimer) { clearTimeout(liftTimer); liftTimer = null; }
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    savedZoom = null; savedPadding = null;
    if (window.GlobeHand3D) window.GlobeHand3D.stop();
    if (el) el.classList.remove('gh-in');
  }

  function pointerXY(e) {
    if (!e) return null;
    if (typeof e.clientX === 'number') return { x: e.clientX, y: e.clientY };
    if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    return null;
  }

  function sample(e) {
    if (!globeMap) return;
    var p = pointerXY(e);
    samples.push({
      lng: globeMap.getCenter().lng,
      x: p ? p.x : null,
      y: p ? p.y : null,
      t: (typeof performance !== 'undefined' ? performance.now() : Date.now())
    });
    if (samples.length > 40) samples.shift();
  }

  function onDragStart() {
    // El usuario agarra el globo: cancela el impulso para que no pelee con su
    // dedo (si no, el globo se resiste/al revés y el giro rápido se ve laggy).
    if (spinRAF) { cancelAnimationFrame(spinRAF); spinRAF = null; }
    spinVel = 0;
    samples = [];
    sample();
    window.addEventListener('mousemove', sample, { passive: true });
    window.addEventListener('touchmove', sample, { passive: true });
  }

  function onDragEnd() {
    window.removeEventListener('mousemove', sample);
    window.removeEventListener('touchmove', sample);
    if (samples.length < 2) { samples = []; return; }
    var peak = 0, dist = 0, first = null, last = null;
    for (var i = 1; i < samples.length; i++) {
      var a = samples[i - 1], b = samples[i];
      var dt = Math.max(1, b.t - a.t);
      var dl = b.lng - a.lng;
      if (dl > 180) dl -= 360; else if (dl < -180) dl += 360;
      var v = dl / dt;
      if (Math.abs(v) > Math.abs(peak)) peak = v;
      if (a.x != null && b.x != null) {
        if (!first) first = a;
        dist += Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y));
        last = b;
      }
    }
    // Velocidad media del gesto (px/ms): independiente del zoom y robusta ante
    // la granularidad de mousemove. Solo con fuerza de verdad.
    var avgSpeed = (first && last) ? dist / Math.max(1, last.t - first.t) : 0;
    if (avgSpeed >= POINTER_VEL_MIN) { flickSpeed = avgSpeed; trigger(peak >= 0 ? 1 : -1); }
    samples = [];
  }

  // Mientras la mano está arriba, sigue pegada a la base del globo aunque el
  // usuario lo arrastre o se asiente la cámara (antes solo se recolocaba en 3
  // instantes fijos).
  function onMapMove() {
    if (active) positionHand();
  }

  function initGlobeHand() {
    if (ready || !globeMap) return;
    ready = true;
    ensureEl();
    globeMap.on('dragstart', onDragStart);
    globeMap.on('dragend', onDragEnd);
    globeMap.on('move', onMapMove);
    // Precarga three.js y precalienta el build en segundo plano: así el primer
    // giro ya sale 3D sin pagar el coste de contexto/shaders en el trigger.
    if (window.GlobeHand3D && typeof window.GlobeHand3D.preload === 'function') {
      var kick = function () {
        var p = window.GlobeHand3D.preload();
        if (p && p.then) p.then(function () {
          if (renderMode() === '3d' && window.GlobeHand3D.warm && window.GlobeHand3D.warm()) ensureEl();
        }, function () {});
      };
      if (window.requestIdleCallback) requestIdleCallback(kick, { timeout: 4000 });
      else setTimeout(kick, 1200);
    }
  }

  window.initGlobeHand = initGlobeHand;
  window.hideGlobeHand = hideGlobeHand;
  window.manaSpinHand = function (dir) { trigger(dir || 1); };
  window.previewGlobeHand = previewHand;
  window.buildGlobeHandSvg = buildSvg; // exposed for console testing
})();
