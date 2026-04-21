// ── plans.js — Monetización y gating de features · Maña Maps ──
// Cargado DESPUÉS de todos los módulos + tracking.js
// Las variables const/let de otros scripts son accesibles vía typeof

(function () {

  /* ═══════════════════════════════════════
     DEFINICIÓN DE PLANES
     ═══════════════════════════════════════ */
  var PLANS = {
    free:  { name: 'Gratis', price: '0 €',  period: 'para siempre',             ord: 0 },
    pro:   { name: 'Pro',    price: '6 €',  period: '/ mes · facturado anual',  ord: 1 },
    teams: { name: 'Teams',  price: '18 €', period: '/ mes · hasta 5 usuarios', ord: 2 }
  };

  var GATES = {
    shareMap:        { min: 'pro',   label: 'Compartir mapas via URL' },
    ogcUnlimited:    { min: 'pro',   label: 'Servicios OGC ilimitados' },
    chatIncluded:    { min: 'pro',   label: 'Chat IA incluido (sin clave propia)' },
    attributeTable:  { min: 'pro',   label: 'Tabla de atributos' },
    advancedStats:   { min: 'pro',   label: 'Estadísticas avanzadas' },
    exportShapefile: { min: 'teams', label: 'Exportar Shapefile comprimido' },
    teamUsers:       { min: 'teams', label: 'Usuarios del equipo' }
  };

  var FREE_OGC_MAX   = 2;
  var PRO_CHAT_DAILY  = 50;

  /* ═══════════════════════════════════════
     PLAN ACTUAL (localStorage)
     ═══════════════════════════════════════ */
  function plan()    { return localStorage.getItem('mana-plan') || 'free'; }
  function planOrd() { return PLANS[plan()].ord; }

  function allowed(feat) {
    var g = GATES[feat];
    if (!g) return true;
    return planOrd() >= PLANS[g.min].ord;
  }

  /* ═══════════════════════════════════════
     GATE — devuelve true si OK, muestra
     modal de upgrade si bloqueado
     ═══════════════════════════════════════ */
  function gate(feat) {
    if (allowed(feat)) return true;
    showUpgrade(feat);
    return false;
  }

  /* OGC: free = max 2, pro+ = ilimitado */
  function gateOGC(currentCount) {
    if (planOrd() >= PLANS.pro.ord) return true;
    if (currentCount < FREE_OGC_MAX) return true;
    showUpgrade('ogcUnlimited');
    return false;
  }

  /* Chat: free = solo clave propia, pro = 50/día, teams = ilimitado */
  function gateChat() {
    try { if (typeof hasAIKey === 'function' && hasAIKey()) return true; } catch (e) {}
    if (!allowed('chatIncluded')) { showUpgrade('chatIncluded'); return false; }
    if (plan() === 'pro') {
      var dk = 'mana-chat-' + new Date().toISOString().slice(0, 10);
      var used = parseInt(localStorage.getItem(dk) || '0');
      if (used >= PRO_CHAT_DAILY) {
        if (typeof manaAlert === 'function')
          manaAlert('Límite diario de ' + PRO_CHAT_DAILY + ' mensajes IA alcanzado. Pasa a Teams para uso ilimitado.', 'warning');
        return false;
      }
      localStorage.setItem(dk, String(used + 1));
    }
    return true;
  }

  /* ═══════════════════════════════════════
     MODAL DE UPGRADE
     ═══════════════════════════════════════ */
  function showUpgrade(feat) {
    var g = GATES[feat]; if (!g) return;
    var p = PLANS[g.min];
    var el = document.getElementById('upgrade-modal'); if (!el) return;
    document.getElementById('upgrade-feature').textContent = g.label;
    document.getElementById('upgrade-plan-name').textContent = p.name;
    document.getElementById('upgrade-plan-price').textContent = p.price;
    document.getElementById('upgrade-plan-period').textContent = p.period;
    el.classList.add('open');
  }

  window.closeUpgradeModal = function () {
    var m = document.getElementById('upgrade-modal');
    if (m) m.classList.remove('open');
  };

  /* ═══════════════════════════════════════
     WRAPPERS — interceptan funciones ya
     existentes (incl. wrappers de tracking)
     ═══════════════════════════════════════ */

  // 1. Compartir mapa
  if (typeof shareMapURL === 'function') {
    var _share = shareMapURL;
    window.shareMapURL = function () {
      if (!gate('shareMap')) return;
      return _share.apply(this, arguments);
    };
  }

  // 2. Exportar shapefile (geojson/csv/kml siguen gratis)
  if (typeof exportAs === 'function') {
    var _exp = exportAs;
    window.exportAs = function (fmt) {
      if (fmt === 'shapefile' && !gate('exportShapefile')) return;
      return _exp.apply(this, arguments);
    };
  }

  // 3. Panel de estadísticas avanzadas
  if (typeof toggleStatsPanel === 'function') {
    var _tStats = toggleStatsPanel;
    window.toggleStatsPanel = function () {
      if (!gate('advancedStats')) return;
      return _tStats.apply(this, arguments);
    };
  }
  if (typeof openStatsPanel === 'function') {
    var _oStats = openStatsPanel;
    window.openStatsPanel = function () {
      if (!gate('advancedStats')) return;
      return _oStats.apply(this, arguments);
    };
  }

  // 4. Tabla de atributos (se abre vía lctxShowAttrTable en el menú contextual)
  if (typeof lctxShowAttrTable === 'function') {
    var _oAttr = lctxShowAttrTable;
    window.lctxShowAttrTable = function () {
      if (!gate('attributeTable')) return;
      return _oAttr.apply(this, arguments);
    };
  }

  // 5. OGC loader
  if (typeof loadUnifiedOGC === 'function') {
    var _loadOGC = loadUnifiedOGC;
    window.loadUnifiedOGC = function () {
      var count = 0;
      try { if (typeof _wmsOverlays !== 'undefined') count = _wmsOverlays.length; } catch (e) {}
      if (!gateOGC(count)) return;
      return _loadOGC.apply(this, arguments);
    };
  }

  // 6. Chat IA
  if (typeof sendMsg === 'function') {
    var _sendMsg = sendMsg;
    window.sendMsg = function () {
      if (!gateChat()) return;
      return _sendMsg.apply(this, arguments);
    };
    var btn = document.getElementById('chat-send');
    if (btn) btn.onclick = window.sendMsg;
  }

  /* ═══════════════════════════════════════
     BADGES — añade indicadores PRO / TEAMS
     en los elementos de UI bloqueados
     ═══════════════════════════════════════ */
  function addBadge(selector, planTag) {
    if (allowed(Object.keys(GATES).find(function (k) { return GATES[k].min === planTag; }))) return;
    var els = document.querySelectorAll(selector);
    els.forEach(function (el) {
      if (el.querySelector('.plan-badge')) return;
      var b = document.createElement('span');
      b.className = 'plan-badge plan-badge-' + planTag;
      b.textContent = PLANS[planTag].name.toUpperCase();
      el.appendChild(b);
    });
  }

  function injectBadges() {
    var p = plan();
    // Compartir
    if (p === 'free') {
      document.querySelectorAll('[onclick*="shareMapURL"]').forEach(function (el) {
        if (el.querySelector('.plan-badge')) return;
        var b = document.createElement('span');
        b.className = 'plan-badge plan-badge-pro';
        b.textContent = 'PRO';
        el.appendChild(b);
      });
    }
    // Shapefile export
    if (PLANS[p].ord < PLANS.teams.ord) {
      document.querySelectorAll('[onclick*="shapefile"]').forEach(function (el) {
        if (el.querySelector('.plan-badge')) return;
        var b = document.createElement('span');
        b.className = 'plan-badge plan-badge-teams';
        b.textContent = 'TEAMS';
        el.appendChild(b);
      });
    }
    // Stats pills → PRO badge
    if (p === 'free') {
      document.querySelectorAll('.stat-pill').forEach(function (el) {
        if (el.id === 'autosave-pill') return;
        if (el.querySelector('.plan-badge')) return;
        var b = document.createElement('span');
        b.className = 'plan-badge plan-badge-pro';
        b.textContent = 'PRO';
        el.appendChild(b);
      });
    }
    // OGC hint
    if (p === 'free') {
      var ogcBtn = document.getElementById('ogc-add-btn');
      if (ogcBtn && !ogcBtn.querySelector('.plan-badge')) {
        var hint = document.createElement('span');
        hint.className = 'plan-limit-hint';
        hint.textContent = FREE_OGC_MAX + ' máx';
        ogcBtn.parentElement.appendChild(hint);
      }
    }
  }

  // Inyectar badges cuando el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectBadges);
  } else {
    injectBadges();
  }

  /* ═══════════════════════════════════════
     API PÚBLICA
     ═══════════════════════════════════════ */
  window.manaPlan = {
    get: plan,
    set: function (p) { localStorage.setItem('mana-plan', p); location.reload(); },
    allowed: allowed,
    gate: gate,
    PLANS: PLANS,
    GATES: GATES
  };

})();
