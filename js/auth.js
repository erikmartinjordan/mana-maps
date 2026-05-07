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
  let _authReady = false;
  let _authReadyResolve = null;
  const _authReadyPromise = new Promise(function(resolve) { _authReadyResolve = resolve; });

  function _markAuthReady() {
    if (_authReady) return;
    _authReady = true;
    if (_authReadyResolve) _authReadyResolve();
  }

  // ═══════════════════════════════════════════════════════════════
  // AUTH STATE LISTENER
  // ═══════════════════════════════════════════════════════════════

  function initAuthListener() {
    const auth = getAuth();
    if (!auth) return;
    auth.onAuthStateChanged(async function (user) {
      _markAuthReady();
      _currentUser = user;
      if (user && !user.isAnonymous) {
        try {
          await _loadOrPromptHandle(user);
        } catch (err) {
          console.warn('[auth] Failed to load profile handle; continuing without handle.', err);
          _handle = null;
          _profile = null;
        }
        _renderAvatar();
        // Resume pending action only after the user's handle/profile exists.
        // This prevents signed-in users from being bounced back to the login modal
        // while Firestore is still resolving their profile document.
        if (_pendingCallback && _handle) {
          const cb = _pendingCallback;
          _pendingCallback = null;
          _runAuthCallback(cb, user);
        }
      } else {
        _handle = null;
        _profile = null;
        _removeAvatar();
        _renderLoginButton();
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

  function _isPermissionDenied(err) {
    var code = err && (err.code || err.message || '');
    return code === 'permission-denied' || String(code).indexOf('Missing or insufficient permissions') !== -1;
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
          try {
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
          } catch (err) {
            if (!_isPermissionDenied(err)) {
              console.warn('[auth] Handle availability check failed:', err);
            }
            hint.textContent = txt(
              'No se pudo comprobar ahora. Lo verificaremos al guardar.',
              'Could not check now. We will verify when saving.'
            );
            hint.className = 'handle-hint';
            btn.disabled = false;
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
            uid: user.uid,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            avatarUrl: user.photoURL || ''
          });

          _handle = handle;
          _profile = {
            displayName: user.displayName || handle,
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

  function _runAuthCallback(callback, authUser) {
    try {
      Promise.resolve(callback(authUser)).catch(function(err) {
        console.warn('[auth] Auth callback failed', err);
      });
    } catch (err) {
      console.warn('[auth] Auth callback failed', err);
    }
  }

  function _showAuthGateError() {
    if (typeof manaAlert === 'function') {
      manaAlert(txt(
        'No se pudo cargar tu perfil. Prueba de nuevo o abre Configuración.',
        'Could not load your profile. Try again or open Settings.'
      ), 'warning');
    }
  }

  async function _finishAuthenticatedAction(authUser, callback) {
    _currentUser = authUser;
    if (!_handle) await _loadOrPromptHandle(authUser);
    _renderAvatar();
    if (_handle) {
      _runAuthCallback(callback, authUser);
      return;
    }
    _showAuthGateError();
  }

  function requireAuth(callback) {
    var auth = getAuth();
    var authUser = _currentUser || (auth && auth.currentUser);

    if (authUser && !authUser.isAnonymous && _handle) {
      _runAuthCallback(callback, authUser);
      return;
    }

    _pendingCallback = callback;

    function continueAfterReady() {
      authUser = _currentUser || (auth && auth.currentUser);
      if (authUser && !authUser.isAnonymous) {
        _finishAuthenticatedAction(authUser, callback).then(function () {
          if (_handle && _pendingCallback === callback) _pendingCallback = null;
        }).catch(function (err) {
          console.warn('[auth] Failed to finish authenticated action', err);
          _showAuthGateError();
        });
        return;
      }
      openAuthModal();
    }

    if (!_authReady) {
      _authReadyPromise.then(continueAfterReady).catch(function () { openAuthModal(); });
      return;
    }

    continueAfterReady();
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
  async function checkQuota(callback, options) {
    const opts = options || {};
    const isNewMap = !!opts.isNewMap;
    const FREE_MAP_LIMIT = 3;
    if (!isNewMap || !window.manaMaps || typeof window.manaMaps.countMaps !== 'function') {
      callback();
      return;
    }
    try {
      const mapCount = await window.manaMaps.countMaps();
      if (mapCount >= FREE_MAP_LIMIT) {
        if (typeof window.showUpsell === 'function') window.showUpsell('map-limit');
        return;
      }
      callback();
    } catch (e) {
      console.warn('quota check failed:', e);
      callback();
    }
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

  function closeAuthModal(options) {
    var modal = document.getElementById('auth-modal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    if (!options || !options.keepPending) _pendingCallback = null;
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
      closeAuthModal({ keepPending: true });
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
      closeAuthModal({ keepPending: true });
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
      closeAuthModal({ keepPending: true });
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

    // Remove existing avatar/dropdown if any
    _removeAvatar();

    var displayName = (_profile && _profile.displayName) || (_currentUser && _currentUser.displayName) || _handle || '';
    var uid = _currentUser ? _currentUser.uid : '';

    var wrap = document.createElement('div');
    wrap.id = 'mana-avatar-wrap';
    wrap.className = 'mana-avatar-wrap';

    var circle = document.createElement('div');
    circle.className = 'mana-avatar-circle';
    var photoUrl = (_currentUser && _currentUser.photoURL) || (_profile && _profile.avatarUrl) || '';
    if (photoUrl) {
      var img = document.createElement('img');
      img.className = 'mana-avatar-photo';
      img.src = photoUrl;
      img.alt = displayName || 'Avatar';
      img.referrerPolicy = 'no-referrer';
      img.loading = 'lazy';
      circle.appendChild(img);
    } else {
      circle.style.backgroundColor = _getAvatarColor(uid);
      circle.textContent = _getInitials(displayName);
    }
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
      <a class="avatar-dd-item" href="/my-maps/">
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

    document.body.appendChild(dropdown);

    // Insert avatar before the existing toolbar-bottom items
    bottom.insertBefore(wrap, bottom.firstChild);
    _removeLoginButton();

    function toggleDropdown() {
      if (!dropdown.classList.contains('open')) _positionAvatarDropdown(circle, dropdown);
      dropdown.classList.toggle('open');
    }

    // Toggle dropdown on click
    circle.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleDropdown();
    });
    circle.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleDropdown();
      }
    });

    // Close dropdown on outside click
    document.addEventListener('click', function () {
      dropdown.classList.remove('open');
    });
  }

  function _positionAvatarDropdown(anchor, dropdown) {
    if (!anchor || !dropdown) return;
    var rect = anchor.getBoundingClientRect();
    var width = Math.max(dropdown.offsetWidth || 200, 200);
    var margin = 8;
    var left = Math.min(
      Math.max(margin, rect.left + (rect.width / 2) - (width / 2)),
      window.innerWidth - width - margin
    );
    var top = rect.top - (dropdown.offsetHeight || 180) - margin;
    if (top < margin) top = rect.bottom + margin;
    dropdown.style.left = left + 'px';
    dropdown.style.top = top + 'px';
  }

  function _removeAvatar() {
    var el = document.getElementById('mana-avatar-wrap');
    if (el) el.remove();
    var dd = document.getElementById('mana-avatar-dropdown');
    if (dd) dd.remove();
  }

  function _renderLoginButton() {
    var right = document.querySelector('.topbar-right');
    if (!right || document.getElementById('mana-login-btn')) return;
    var btn = document.createElement('button');
    btn.id = 'mana-login-btn';
    btn.className = 'btn btn-login';
    btn.textContent = txt('Iniciar sesión', 'Sign in');
    btn.onclick = openAuthModal;

    // Keep auth on the far right of the action group so it remains the
    // clearest account action as the toolbar collapses on small screens.
    var chatToggle = document.getElementById('mobile-chat-toggle');
    if (chatToggle && chatToggle.parentNode === right) {
      right.insertBefore(btn, chatToggle);
    } else {
      right.appendChild(btn);
    }
  }

  function _removeLoginButton() {
    var btn = document.getElementById('mana-login-btn');
    if (btn) btn.remove();
  }

  function _escHtml(str) {
    var div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }


  async function updateProfileSettings(options) {
    var user = _currentUser || (getAuth() && getAuth().currentUser);
    if (!user || user.isAnonymous) throw new Error('not-authenticated');
    var db = getDb();
    if (!db) throw new Error('firestore-unavailable');

    var opts = options || {};
    var nextDisplayName = (opts.displayName || '').trim() || (_profile && _profile.displayName) || user.displayName || _handle || '';
    var nextAvatarUrl = (opts.avatarUrl || '').trim() || user.photoURL || (_profile && _profile.avatarUrl) || '';
    var nextBio = (opts.bio || '').trim().slice(0, 180);
    var nextHandle = (opts.handle || '').trim().toLowerCase();
    var currentHandle = _handle || _getCachedHandle(user.uid) || '';
    if (!nextHandle) nextHandle = currentHandle;
    if (!_validateHandle(nextHandle)) throw new Error('invalid-handle');

    var profilePayload = {
      displayName: nextDisplayName || nextHandle,
      uid: user.uid,
      avatarUrl: nextAvatarUrl,
      bio: nextBio,
      email: firebase.firestore.FieldValue.delete(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (!currentHandle || nextHandle === currentHandle) {
      await db.collection('users').doc(nextHandle).set(profilePayload, { merge: true });
      _handle = nextHandle;
      _profile = Object.assign({}, _profile || {}, profilePayload, { updatedAt: Date.now() });
      _setCachedHandle(user.uid, nextHandle);
      if (user.updateProfile && (nextDisplayName !== user.displayName || nextAvatarUrl !== user.photoURL)) {
        try { await user.updateProfile({ displayName: nextDisplayName, photoURL: nextAvatarUrl || null }); } catch (e) { console.warn('[auth] Firebase profile update failed', e); }
      }
      _renderAvatar();
      return { handle: _handle, profile: _profile };
    }

    var oldRef = db.collection('users').doc(currentHandle);
    var newRef = db.collection('users').doc(nextHandle);
    await db.runTransaction(async function(transaction) {
      var oldDoc = await transaction.get(oldRef);
      var newDoc = await transaction.get(newRef);
      if (!oldDoc.exists || oldDoc.data().uid !== user.uid) throw new Error('profile-not-found');
      if (newDoc.exists) throw new Error('handle-taken');
      transaction.set(newRef, Object.assign({}, oldDoc.data(), profilePayload, {
        previousHandle: currentHandle,
        handleChangedAt: firebase.firestore.FieldValue.serverTimestamp()
      }), { merge: true });
    });

    var mapsSnap = await oldRef.collection('maps').get();
    for (var i = 0; i < mapsSnap.docs.length; i++) {
      var mapDoc = mapsSnap.docs[i];
      var targetMapRef = newRef.collection('maps').doc(mapDoc.id);
      await targetMapRef.set(mapDoc.data(), { merge: true });
      var chunksSnap = await mapDoc.ref.collection('geoChunks').get();
      var chunkBatch = db.batch();
      chunksSnap.forEach(function(chunkDoc) {
        chunkBatch.set(targetMapRef.collection('geoChunks').doc(chunkDoc.id), chunkDoc.data(), { merge: true });
      });
      await chunkBatch.commit();
      if (mapDoc.data() && mapDoc.data().public) {
        try { await db.collection('maps').doc(mapDoc.id).set({ authorHandle: nextHandle }, { merge: true }); }
        catch (e) { console.warn('[auth] Public map author update failed', e); }
      }
    }

    for (var j = 0; j < mapsSnap.docs.length; j++) {
      var oldMapDoc = mapsSnap.docs[j];
      var oldChunksSnap = await oldMapDoc.ref.collection('geoChunks').get();
      var deleteBatch = db.batch();
      oldChunksSnap.forEach(function(chunkDoc) { deleteBatch.delete(chunkDoc.ref); });
      deleteBatch.delete(oldMapDoc.ref);
      await deleteBatch.commit();
    }
    await oldRef.delete();

    _handle = nextHandle;
    _profile = Object.assign({}, _profile || {}, profilePayload, { updatedAt: Date.now() });
    _setCachedHandle(user.uid, nextHandle);
    if (user.updateProfile && (nextDisplayName !== user.displayName || nextAvatarUrl !== user.photoURL)) {
      try { await user.updateProfile({ displayName: nextDisplayName, photoURL: nextAvatarUrl || null }); } catch (e) { console.warn('[auth] Firebase profile update failed', e); }
    }
    _renderAvatar();
    return { handle: _handle, profile: _profile };
  }

  function _openProfileSettings() {
    // Close dropdown
    var dd = document.getElementById('mana-avatar-dropdown');
    if (dd) dd.classList.remove('open');
    window.location.href = '/profile/';
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
    updateProfileSettings: updateProfileSettings,
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
