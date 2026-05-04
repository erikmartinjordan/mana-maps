// ── auth.js ─ Unified auth module: state, handles, gate, avatar ──
// Exposes window.manaAuth with: requireAuth, getCurrentUser, getHandle,
// logout, openAuthModal, checkQuota.

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════
  // FIREBASE CONFIG & INIT
  // ═══════════════════════════════════════════════════════════════

  const firebaseConfig = {
    apiKey: 'AIzaSyBjtW1SUhgnLyagREHESEl4Vb4zI5yHgDg',
    authDomain: 'mana-maps-pro.firebaseapp.com',
    projectId: 'mana-maps-pro',
    storageBucket: 'mana-maps-pro.firebasestorage.app',
    messagingSenderId: '212469378297',
    appId: '1:212469378297:web:83e17ed0e38dd202944628'
  };

  function ensureFirebase() {
    if (typeof firebase === 'undefined') return false;
    if (!firebase.apps || !firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    return true;
  }

  function getDb() {
    if (!ensureFirebase()) return null;
    return firebase.firestore();
  }

  function getAuth() {
    if (!ensureFirebase()) return null;
    return firebase.auth();
  }

  // ═══════════════════════════════════════════════════════════════
  // I18N HELPER
  // ═══════════════════════════════════════════════════════════════

  function isEn() {
    return typeof LANG !== 'undefined' && LANG === 'en';
  }

  function txt(es, en) {
    return isEn() ? en : es;
  }

  // ═══════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════

  let _currentUser = null;   // Firebase auth user object
  let _handle = null;        // Username handle string
  let _profile = null;       // Full profile doc from /users/{handle}
  let _pendingCallback = null; // Callback waiting for auth to complete
  let _authModeSignup = false;

  // ═══════════════════════════════════════════════════════════════
  // AUTH STATE LISTENER
  // ═══════════════════════════════════════════════════════════════

  function initAuthListener() {
    const auth = getAuth();
    if (!auth) return;
    auth.onAuthStateChanged(async function (user) {
      _currentUser = user;
      if (user && !user.isAnonymous) {
        await _loadOrPromptHandle(user);
        _renderAvatar();
        // Resume pending action if any
        if (_pendingCallback) {
          const cb = _pendingCallback;
          _pendingCallback = null;
          cb(user);
        }
      } else {
        _handle = null;
        _profile = null;
        _removeAvatar();
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // USERNAME HANDLE SYSTEM
  // ═══════════════════════════════════════════════════════════════

  async function _loadOrPromptHandle(user) {
    const db = getDb();
    if (!db) return;

    // Check if user already has a handle stored in localStorage cache
    const cachedHandle = _getCachedHandle(user.uid);
    if (cachedHandle) {
      const doc = await db.collection('users').doc(cachedHandle).get();
      if (doc.exists && doc.data().uid === user.uid) {
        _handle = cachedHandle;
        _profile = doc.data();
        return;
      }
    }

    // Search for existing handle by uid
    const snapshot = await db.collection('users')
      .where('uid', '==', user.uid)
      .limit(1)
      .get();

    if (!snapshot.empty) {
      const doc = snapshot.docs[0];
      _handle = doc.id;
      _profile = doc.data();
      _setCachedHandle(user.uid, _handle);
      return;
    }

    // First login — prompt for handle selection
    await _showHandleModal(user);
  }

  function _getCachedHandle(uid) {
    try { return localStorage.getItem('mana-handle-' + uid) || ''; }
    catch (e) { return ''; }
  }

  function _setCachedHandle(uid, handle) {
    try { localStorage.setItem('mana-handle-' + uid, handle); }
    catch (e) { /* silent */ }
  }

  function _validateHandle(handle) {
    if (!handle || handle.length < 3 || handle.length > 24) return false;
    return /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/.test(handle);
  }

  async function _isHandleAvailable(handle) {
    const db = getDb();
    if (!db) return false;
    const doc = await db.collection('users').doc(handle).get();
    return !doc.exists;
  }

  function _showHandleModal(user) {
    return new Promise(function (resolve) {
      // Create handle modal overlay
      let overlay = document.getElementById('handle-modal');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'handle-modal';
        overlay.className = 'share-modal';
        overlay.innerHTML = `
          <div class="auth-modal-box" role="dialog" aria-modal="true" aria-labelledby="handle-modal-title">
            <div class="auth-modal-header">
              <h3 id="handle-modal-title">${txt('Elige tu nombre de usuario', 'Choose your username')}</h3>
              <p class="auth-subtitle">${txt('Este será tu identificador público en Maña Maps.', 'This will be your public identifier on Maña Maps.')}</p>
            </div>
            <div class="auth-form">
              <div class="auth-field">
                <label for="handle-input">${txt('Nombre de usuario', 'Username')}</label>
                <input id="handle-input" type="text" placeholder="${txt('ej: erik.maps', 'e.g.: erik.maps')}" maxlength="24" autocomplete="off" spellcheck="false"/>
                <span id="handle-hint" class="handle-hint"></span>
              </div>
              <button type="button" id="handle-submit-btn" class="auth-submit-btn" disabled>${txt('Continuar', 'Continue')}</button>
            </div>
          </div>
        `;
        document.body.appendChild(overlay);
      }

      overlay.classList.add('open');
      overlay.setAttribute('aria-hidden', 'false');

      const input = document.getElementById('handle-input');
      const hint = document.getElementById('handle-hint');
      const btn = document.getElementById('handle-submit-btn');
      let debounceTimer = null;

      input.value = _suggestHandle(user);
      input.focus();
      input.select();

      // Real-time validation
      input.addEventListener('input', function () {
        clearTimeout(debounceTimer);
        const val = input.value.toLowerCase().replace(/[^a-z0-9._-]/g, '');
        input.value = val;
        btn.disabled = true;

        if (!_validateHandle(val)) {
          hint.textContent = txt(
            'Mín. 3 caracteres. Solo letras, números, puntos, guiones.',
            'Min 3 chars. Letters, numbers, dots, hyphens only.'
          );
          hint.className = 'handle-hint handle-hint-error';
          return;
        }

        hint.textContent = txt('Comprobando...', 'Checking...');
        hint.className = 'handle-hint';

        debounceTimer = setTimeout(async function () {
          const available = await _isHandleAvailable(val);
          if (available) {
            hint.textContent = txt('✓ Disponible', '✓ Available');
            hint.className = 'handle-hint handle-hint-ok';
            btn.disabled = false;
          } else {
            hint.textContent = txt('✗ Ya en uso', '✗ Already taken');
            hint.className = 'handle-hint handle-hint-error';
            btn.disabled = true;
          }
        }, 400);
      });

      // Trigger initial validation
      input.dispatchEvent(new Event('input'));

      btn.onclick = async function () {
        const handle = input.value.trim().toLowerCase();
        if (!_validateHandle(handle)) return;
        btn.disabled = true;
        btn.textContent = txt('Guardando...', 'Saving...');

        try {
          const db = getDb();
          await db.collection('users').doc(handle).set({
            displayName: user.displayName || handle,
            email: user.email || '',
            uid: user.uid,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            avatarUrl: user.photoURL || ''
          });

          _handle = handle;
          _profile = {
            displayName: user.displayName || handle,
            email: user.email || '',
            uid: user.uid,
            avatarUrl: user.photoURL || ''
          };
          _setCachedHandle(user.uid, handle);
          overlay.classList.remove('open');
          overlay.setAttribute('aria-hidden', 'true');
          resolve();
        } catch (e) {
          console.warn('handle save failed:', e);
          hint.textContent = txt('Error al guardar. Inténtalo de nuevo.', 'Save failed. Try again.');
          hint.className = 'handle-hint handle-hint-error';
          btn.disabled = false;
          btn.textContent = txt('Continuar', 'Continue');
        }
      };

      // Enter key submits
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !btn.disabled) btn.click();
      });

      // Close on Escape (cancel — user must pick a handle, but we allow dismissal)
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) {
          overlay.classList.remove('open');
          resolve();
        }
      });
    });
  }

  function _suggestHandle(user) {
    // Try to derive a handle from displayName or email
    let base = '';
    if (user.displayName) {
      base = user.displayName.toLowerCase().replace(/\s+/g, '.').replace(/[^a-z0-9._-]/g, '');
    } else if (user.email) {
      base = user.email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '');
    }
    return base.slice(0, 20) || '';
  }

  // ═══════════════════════════════════════════════════════════════
  // AUTH GATE — requireAuth(callback)
  // ═══════════════════════════════════════════════════════════════

  function requireAuth(callback) {
    if (_currentUser && !_currentUser.isAnonymous && _handle) {
      callback(_currentUser);
      return;
    }
    // Store callback and open auth modal
    _pendingCallback = callback;
    openAuthModal();
  }

  // ═══════════════════════════════════════════════════════════════
  // PAYWALL INSERTION POINT — checkQuota(callback)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Placeholder for future paywall logic.
   * Insert quota check between auth success and the save action.
   * Currently passes through immediately.
   *
   * Future implementation:
   *   1. Count maps in /users/{handle}/maps
   *   2. Compare against free tier quota (e.g. 5 maps)
   *   3. If over quota → show upgrade modal, do NOT call callback
   *   4. If under quota → call callback()
   */
  function checkQuota(callback) {
    // TODO: Implement quota check against free tier
    // const mapCount = await countUserMaps(_handle);
    // if (mapCount >= FREE_TIER_LIMIT) { showUpgradeModal(); return; }
    callback();
  }

  // ═══════════════════════════════════════════════════════════════
  // AUTH MODAL — login/signup with email + Google
  // ═══════════════════════════════════════════════════════════════

  function openAuthModal() {
    var modal = document.getElementById('auth-modal');
    if (!modal) return;
    _authModeSignup = false;
    var emailInput = document.getElementById('auth-email');
    var passInput = document.getElementById('auth-password');
    if (emailInput) emailInput.value = '';
    if (passInput) passInput.value = '';
    var btn = modal.querySelector('.auth-submit-btn');
    if (btn) btn.textContent = txt('Iniciar sesión', 'Sign in');
    var hint = modal.querySelector('.auth-signup-hint');
    if (hint) {
      hint.innerHTML = '<span>' + txt('¿No tienes cuenta?', 'No account yet?') + '</span> '
        + '<a href="#" onclick="manaAuth._toggleAuthMode(event)">'
        + txt('Crear cuenta', 'Create account') + '</a>';
    }
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    setTimeout(function () { if (emailInput) emailInput.focus(); }, 80);
  }

  function closeAuthModal() {
    var modal = document.getElementById('auth-modal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    _pendingCallback = null;
  }

  function _toggleAuthMode(e) {
    if (e) e.preventDefault();
    _authModeSignup = !_authModeSignup;
    var btn = document.querySelector('#auth-modal .auth-submit-btn');
    var hint = document.querySelector('#auth-modal .auth-signup-hint');
    if (_authModeSignup) {
      if (btn) btn.textContent = txt('Crear cuenta', 'Create account');
      if (hint) hint.innerHTML = '<span>' + txt('¿Ya tienes cuenta?', 'Already have an account?') + '</span> '
        + '<a href="#" onclick="manaAuth._toggleAuthMode(event)">'
        + txt('Iniciar sesión', 'Sign in') + '</a>';
    } else {
      if (btn) btn.textContent = txt('Iniciar sesión', 'Sign in');
      if (hint) hint.innerHTML = '<span>' + txt('¿No tienes cuenta?', 'No account yet?') + '</span> '
        + '<a href="#" onclick="manaAuth._toggleAuthMode(event)">'
        + txt('Crear cuenta', 'Create account') + '</a>';
    }
  }

  async function signInWithGoogle() {
    try {
      var provider = new firebase.auth.GoogleAuthProvider();
      await firebase.auth().signInWithPopup(provider);
      closeAuthModal();
    } catch (e) {
      console.warn('google sign-in failed:', e);
      if (typeof manaAlert === 'function') {
        manaAlert(txt('No se pudo iniciar con Google.', 'Google sign-in failed.'), 'error');
      }
    }
  }

  async function signInWithEmail(e) {
    if (e) e.preventDefault();
    var email = document.getElementById('auth-email').value.trim();
    var password = document.getElementById('auth-password').value;
    if (!email || !password) {
      if (typeof manaAlert === 'function') {
        manaAlert(txt('Introduce email y contraseña.', 'Enter email and password.'), 'warning');
      }
      return;
    }
    try {
      if (_authModeSignup) {
        await firebase.auth().createUserWithEmailAndPassword(email, password);
      } else {
        await firebase.auth().signInWithEmailAndPassword(email, password);
      }
      closeAuthModal();
    } catch (err) {
      var msg = '';
      var code = err && err.code ? err.code : '';
      if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        msg = txt('Email o contraseña incorrectos.', 'Incorrect email or password.');
      } else if (code === 'auth/email-already-in-use') {
        msg = txt('Este email ya está registrado. Prueba a iniciar sesión.', 'This email is already registered. Try logging in.');
      } else if (code === 'auth/weak-password') {
        msg = txt('La contraseña debe tener al menos 6 caracteres.', 'Password must be at least 6 characters.');
      } else if (code === 'auth/invalid-email') {
        msg = txt('Formato de email no válido.', 'Invalid email format.');
      } else {
        msg = txt('No se pudo iniciar sesión. Inténtalo de nuevo.', 'Sign-in failed. Try again.');
      }
      if (typeof manaAlert === 'function') manaAlert(msg, 'error');
      console.warn('email sign-in failed:', err);
    }
  }

  async function continueAsGuest() {
    try {
      await firebase.auth().signInAnonymously();
      closeAuthModal();
    } catch (e) {
      console.warn('anonymous sign-in failed:', e);
      if (typeof manaAlert === 'function') {
        manaAlert(txt('No se pudo iniciar como invitado.', 'Guest sign-in failed.'), 'error');
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // AVATAR MENU
  // ═══════════════════════════════════════════════════════════════

  function _getInitials(name) {
    if (!name) return '?';
    var parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }

  function _getAvatarColor(uid) {
    // Deterministic hue from uid
    var hash = 0;
    for (var i = 0; i < (uid || '').length; i++) {
      hash = uid.charCodeAt(i) + ((hash << 5) - hash);
    }
    var hue = Math.abs(hash) % 360;
    return 'hsl(' + hue + ', 55%, 48%)';
  }

  function _renderAvatar() {
    var toolbar = document.getElementById('toolbar');
    if (!toolbar) return;
    var bottom = toolbar.querySelector('.toolbar-bottom');
    if (!bottom) return;

    // Remove existing avatar if any
    var existing = document.getElementById('mana-avatar-wrap');
    if (existing) existing.remove();

    var displayName = (_profile && _profile.displayName) || (_currentUser && _currentUser.displayName) || _handle || '';
    var uid = _currentUser ? _currentUser.uid : '';

    var wrap = document.createElement('div');
    wrap.id = 'mana-avatar-wrap';
    wrap.className = 'mana-avatar-wrap';

    var circle = document.createElement('div');
    circle.className = 'mana-avatar-circle';
    circle.style.backgroundColor = _getAvatarColor(uid);
    circle.textContent = _getInitials(displayName);
    circle.title = displayName;
    circle.setAttribute('role', 'button');
    circle.setAttribute('aria-label', txt('Menú de usuario', 'User menu'));
    circle.tabIndex = 0;

    wrap.appendChild(circle);

    // Dropdown panel
    var dropdown = document.createElement('div');
    dropdown.className = 'mana-avatar-dropdown';
    dropdown.id = 'mana-avatar-dropdown';
    dropdown.innerHTML = `
      <div class="avatar-dd-header">
        <strong>${_escHtml(displayName)}</strong>
        <span class="avatar-dd-handle">@${_escHtml(_handle || '')}</span>
      </div>
      <div class="avatar-dd-sep"></div>
      <a class="avatar-dd-item" href="/${_escHtml(_handle || '')}/maps">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
        ${txt('Mis mapas', 'My Maps')}
      </a>
      <button class="avatar-dd-item" onclick="manaAuth._openProfileSettings()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1.08-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1.08 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001.08 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9c.26.6.84 1 1.51 1.08H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1.08z"/></svg>
        ${txt('Configuración', 'Settings')}
      </button>
      <div class="avatar-dd-sep"></div>
      <button class="avatar-dd-item avatar-dd-logout" onclick="manaAuth.logout()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        ${txt('Cerrar sesión', 'Log out')}
      </button>
    `;

    wrap.appendChild(dropdown);

    // Insert avatar before the existing toolbar-bottom items
    bottom.insertBefore(wrap, bottom.firstChild);

    // Toggle dropdown on click
    circle.addEventListener('click', function (e) {
      e.stopPropagation();
      dropdown.classList.toggle('open');
    });
    circle.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        dropdown.classList.toggle('open');
      }
    });

    // Close dropdown on outside click
    document.addEventListener('click', function () {
      dropdown.classList.remove('open');
    });
  }

  function _removeAvatar() {
    var el = document.getElementById('mana-avatar-wrap');
    if (el) el.remove();
  }

  function _escHtml(str) {
    var div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function _openProfileSettings() {
    // Close dropdown
    var dd = document.getElementById('mana-avatar-dropdown');
    if (dd) dd.classList.remove('open');
    // For now, navigate to gallery as profile settings placeholder
    window.location.href = '/' + (_handle || '') + '/maps';
  }

  // ═══════════════════════════════════════════════════════════════
  // LOGOUT
  // ═══════════════════════════════════════════════════════════════

  async function logout() {
    var dd = document.getElementById('mana-avatar-dropdown');
    if (dd) dd.classList.remove('open');
    try {
      await firebase.auth().signOut();
      _currentUser = null;
      _handle = null;
      _profile = null;
      _removeAvatar();
      if (typeof showToast === 'function') {
        showToast(txt('Sesión cerrada', 'Logged out'));
      }
    } catch (e) {
      console.warn('logout failed:', e);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════

  window.manaAuth = {
    requireAuth: requireAuth,
    checkQuota: checkQuota,
    getCurrentUser: function () { return _currentUser; },
    getHandle: function () { return _handle; },
    getProfile: function () { return _profile; },
    logout: logout,
    openAuthModal: openAuthModal,
    closeAuthModal: closeAuthModal,
    signInWithGoogle: signInWithGoogle,
    signInWithEmail: signInWithEmail,
    continueAsGuest: continueAsGuest,
    // Internal — exposed for onclick handlers in generated HTML
    _toggleAuthMode: _toggleAuthMode,
    _openProfileSettings: _openProfileSettings
  };

  // Also expose for legacy gallery.js compat (onclick attributes in HTML)
  window.closeAuthModal = closeAuthModal;
  window.signInWithGoogle = signInWithGoogle;
  window.signInWithEmail = signInWithEmail;
  window.continueAsGuest = continueAsGuest;
  window.toggleAuthMode = _toggleAuthMode;

  // ═══════════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════════

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAuthListener);
  } else {
    initAuthListener();
  }

})();
