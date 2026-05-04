// ── gallery.js ─ share (save + copy URL) + gallery publish ─
// Redesigned flow: Share button → if logged in, save & copy URL.
//                                  if not logged in, open auth modal → after login, save & copy URL.

(function() {
  const MAPS_COLLECTION = 'maps';
  const FIRESTORE_FIELD_MAX_BYTES = 1048487;
  const firebaseConfig = {
    apiKey: 'AIzaSyBjtW1SUhgnLyagREHESEl4Vb4zI5yHgDg',
    authDomain: 'mana-maps-pro.firebaseapp.com',
    databaseURL: 'https://mana-maps-pro-default-rtdb.firebaseio.com',
    projectId: 'mana-maps-pro',
    storageBucket: 'mana-maps-pro.firebasestorage.app',
    messagingSenderId: '212469378297',
    appId: '1:212469378297:web:83e17ed0e38dd202944628',
    measurementId: 'G-F1Z7C21BZ6'
  };

  // ═══════════════════════════════════════════════════════════════
  // FIREBASE HELPERS
  // ═══════════════════════════════════════════════════════════════

  function getGalleryDb() {
    if (typeof firebase === 'undefined') return null;
    try {
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(firebaseConfig);
      return firebase.firestore();
    } catch (e) {
      console.warn('gallery db unavailable:', e);
      return null;
    }
  }

  function getCurrentUser() {
    if (!firebase || !firebase.auth || typeof firebase.auth !== 'function') return null;
    return firebase.auth().currentUser || null;
  }

  function getCurrentGeo() {
    if (typeof getEnrichedGeoJSON !== 'function') return null;
    const geo = getEnrichedGeoJSON();
    if (!geo || !geo.features || !geo.features.length) return null;
    return geo;
  }

  function sanitizeFirestorePayload(value) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (e) {
      console.warn('sanitizeFirestorePayload failed:', e);
      return null;
    }
  }

  function toGeoJSONString(geo) {
    try {
      return JSON.stringify(geo);
    } catch (e) {
      console.warn('toGeoJSONString failed:', e);
      return '';
    }
  }

  function compactGeoForPublish(geo) {
    function roundNum(n) {
      return typeof n === 'number' && isFinite(n) ? Number(n.toFixed(6)) : n;
    }
    function roundCoords(coords) {
      if (!Array.isArray(coords)) return coords;
      if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
        return [roundNum(coords[0]), roundNum(coords[1])];
      }
      return coords.map(roundCoords);
    }
    try {
      return {
        type: 'FeatureCollection',
        features: (geo.features || []).map(function(feature) {
          var props = feature && feature.properties ? feature.properties : {};
          var compactProps = sanitizeFirestorePayload(props) || {};
          return {
            type: 'Feature',
            geometry: feature && feature.geometry ? {
              type: feature.geometry.type,
              coordinates: roundCoords(feature.geometry.coordinates)
            } : null,
            properties: compactProps
          };
        })
      };
    } catch (e) {
      console.warn('compactGeoForPublish failed:', e);
      return geo;
    }
  }

  function payloadByteSize(value) {
    try {
      var text = JSON.stringify(value);
      if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
      return unescape(encodeURIComponent(text)).length;
    } catch (e) {
      return Infinity;
    }
  }

  function splitTextIntoChunks(text, chunkSize) {
    if (typeof text !== 'string' || !text) return [];
    const chunks = [];
    let i = 0;
    while (i < text.length) {
      chunks.push(text.slice(i, i + chunkSize));
      i += chunkSize;
    }
    return chunks;
  }

  function getMapMeta() {
    const input = document.getElementById('project-name-input');
    const value = (input && input.value ? input.value : '').trim();
    return {
      name: value || (typeof t === 'function' ? t('map_name_placeholder') : 'Mapa sin título'),
      lang: (typeof LANG !== 'undefined' ? LANG : 'es')
    };
  }

  function slugifyMapName(name) {
    const base = (name || 'mapa')
      .toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40);
    const rnd = Math.random().toString(36).slice(2, 8);
    return (base || 'mapa') + '-' + rnd;
  }

  function buildGalleryURL(slug) {
    return window.location.origin + '/gallery/?slug=' + encodeURIComponent(slug);
  }

  function buildMapPreview(geo) {
    if (!geo || !Array.isArray(geo.features) || !geo.features.length) return null;
    var points = [];
    function collectCoordPairs(coords, out) {
      if (!Array.isArray(coords)) return;
      if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
        out.push([coords[0], coords[1]]);
        return;
      }
      coords.forEach(function(child) { collectCoordPairs(child, out); });
    }
    geo.features.forEach(function(feature) {
      var geom = feature && feature.geometry;
      if (!geom || !Array.isArray(geom.coordinates)) return;
      collectCoordPairs(geom.coordinates, points);
    });
    if (!points.length) return null;
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    points.forEach(function(c) {
      var x = Number(c[0]), y = Number(c[1]);
      if (!isFinite(x) || !isFinite(y)) return;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    });
    if (!isFinite(minX)) return null;
    return { bbox: [minX, minY, maxX, maxY] };
  }

  function getLastPrivateMapId() {
    try { return localStorage.getItem('mana-private-map-id') || ''; }
    catch (e) { return ''; }
  }

  function setLastPrivateMapId(mapId) {
    if (!mapId) return;
    try { localStorage.setItem('mana-private-map-id', mapId); }
    catch (e) { console.warn('setLastPrivateMapId failed:', e); }
  }

  function getFirestoreErrorMessage(err) {
    var code = err && (err.code || err.errorCode || '');
    var message = err && err.message ? String(err.message) : '';
    if (code === 'permission-denied' || code === 'auth/operation-not-allowed') {
      return LANG === 'en'
        ? 'Publish blocked by Firebase permissions.'
        : 'Publicación bloqueada por permisos de Firebase.';
    }
    if (code === 'unauthenticated' || code === 'auth/network-request-failed') {
      return LANG === 'en'
        ? 'Authentication failed. Please try again.'
        : 'Falló la autenticación. Vuelve a intentarlo.';
    }
    return LANG === 'en'
      ? 'Save failed. Please try again.'
      : 'Error al guardar. Vuelve a intentarlo.';
  }

  function copyToClipboard(text, okMessage) {
    return navigator.clipboard.writeText(text).then(function() {
      if (typeof showToast === 'function') showToast(okMessage);
    }).catch(function() {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      if (typeof showToast === 'function') showToast(okMessage);
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // PERSIST MAP (core save logic)
  // ═══════════════════════════════════════════════════════════════

  async function persistMapRecord(authUser) {
    const db = getGalleryDb();
    if (!db) throw new Error('firestore-unavailable');

    const rawGeo = getCurrentGeo();
    if (!rawGeo) throw new Error('empty-map');
    const geo = sanitizeFirestorePayload(rawGeo);
    if (!geo || !geo.features || !geo.features.length) throw new Error('invalid-geo');

    const meta = getMapMeta();
    const userUid = authUser.uid;

    const existingId = getLastPrivateMapId();
    const slug = existingId || slugifyMapName(meta.name);
    const preview = buildMapPreview(geo);
    const shareUrl = buildGalleryURL(slug);

    var geoToPublish = geo;
    var geoString = toGeoJSONString(geoToPublish);
    if (!geoString) throw new Error('invalid-geo');
    var geoFieldSize = payloadByteSize({ geojsonText: geoString });
    if (geoFieldSize > FIRESTORE_FIELD_MAX_BYTES) {
      geoToPublish = compactGeoForPublish(geo);
      geoString = toGeoJSONString(geoToPublish);
      geoFieldSize = payloadByteSize({ geojsonText: geoString });
    }

    const payload = {
      id: slug, slug: slug,
      title: meta.name, name: meta.name,
      createdBy: userUid,
      ownerUid: userUid,
      lang: meta.lang || 'es',
      featureCount: geo.features.length,
      mapPreview: preview || null,
      visibility: 'public',
      isPublished: true,
      shareUrl: shareUrl,
      updatedAtMs: Date.now()
    };
    if (!existingId) payload.createdAtMs = Date.now();

    const useChunkedGeo = geoFieldSize > FIRESTORE_FIELD_MAX_BYTES;
    if (!useChunkedGeo) payload.geojsonText = geoString;
    else payload.geojsonChunked = { collection: 'geoChunks', chunkCount: 0 };

    const docRef = db.collection(MAPS_COLLECTION).doc(slug);
    const writePayload = { ...payload, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
    if (!existingId) writePayload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    await docRef.set(writePayload, { merge: true });

    if (useChunkedGeo) {
      var chunks = splitTextIntoChunks(geoString, 900000);
      writePayload.geojsonChunked.chunkCount = chunks.length;
      await docRef.set({ geojsonChunked: writePayload.geojsonChunked }, { merge: true });
      var writeOps = chunks.map(function(chunkText, index) {
        return docRef.collection(writePayload.geojsonChunked.collection).doc(String(index)).set({ index: index, text: chunkText });
      });
      await Promise.all(writeOps);
    }

    setLastPrivateMapId(slug);
    return { slug: slug, shareUrl: shareUrl };
  }

  // ═══════════════════════════════════════════════════════════════
  // AUTH MODAL (only for login, no share options)
  // ═══════════════════════════════════════════════════════════════

  // Callback executed after successful auth when share was pending
  var _pendingShareAfterAuth = false;

  function openAuthModal() {
    var modal = document.getElementById('auth-modal');
    if (!modal) return;
    // Reset form state
    _authModeSignup = false;
    var emailInput = document.getElementById('auth-email');
    var passInput = document.getElementById('auth-password');
    if (emailInput) emailInput.value = '';
    if (passInput) passInput.value = '';
    var btn = modal.querySelector('.auth-submit-btn');
    if (btn) btn.textContent = LANG === 'en' ? 'Sign in' : 'Iniciar sesi\u00f3n';
    var hint = modal.querySelector('.auth-signup-hint');
    if (hint) hint.innerHTML = (LANG === 'en' ? '<span>No account yet?</span> ' : '<span>\u00bfNo tienes cuenta?</span> ') + '<a href="#" onclick="toggleAuthMode(event)">' + (LANG === 'en' ? 'Create account' : 'Crear cuenta') + '</a>';
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    // Focus email field
    setTimeout(function() { if (emailInput) emailInput.focus(); }, 80);
  }

  window.closeAuthModal = function() {
    var modal = document.getElementById('auth-modal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    _pendingShareAfterAuth = false;
  };

  window.continueAsGuest = async function() {
    try {
      await firebase.auth().signInAnonymously();
      closeAuthModal();
      if (_pendingShareAfterAuth) {
        _pendingShareAfterAuth = false;
        await _doShareMap();
      }
    } catch (e) {
      console.warn('anonymous sign-in failed:', e);
      manaAlert(LANG === 'en' ? 'Guest sign-in failed.' : 'No se pudo iniciar como invitado.', 'error');
    }
  };

  window.signInWithGoogle = async function() {
    try {
      var provider = new firebase.auth.GoogleAuthProvider();
      await firebase.auth().signInWithPopup(provider);
      closeAuthModal();
      if (_pendingShareAfterAuth) {
        _pendingShareAfterAuth = false;
        await _doShareMap();
      }
    } catch (e) {
      console.warn('google sign-in failed:', e);
      manaAlert(LANG === 'en' ? 'Google sign-in failed.' : 'No se pudo iniciar con Google.', 'error');
    }
  };
  // Track whether we're in login or signup mode
  var _authModeSignup = false;

  window.signInWithEmail = async function(e) {
    if (e) e.preventDefault();
    var email = document.getElementById('auth-email').value.trim();
    var password = document.getElementById('auth-password').value;
    if (!email || !password) {
      manaAlert(LANG === 'en' ? 'Enter email and password.' : 'Introduce email y contraseña.', 'warning');
      return;
    }
    try {
      if (_authModeSignup) {
        await firebase.auth().createUserWithEmailAndPassword(email, password);
      } else {
        await firebase.auth().signInWithEmailAndPassword(email, password);
      }
      closeAuthModal();
      if (_pendingShareAfterAuth) {
        _pendingShareAfterAuth = false;
        await _doShareMap();
      }
    } catch (e) {
      var msg = '';
      var code = e && e.code ? e.code : '';
      if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        msg = LANG === 'en' ? 'Incorrect email or password.' : 'Email o contraseña incorrectos.';
      } else if (code === 'auth/email-already-in-use') {
        msg = LANG === 'en' ? 'This email is already registered. Try logging in.' : 'Este email ya está registrado. Prueba a iniciar sesión.';
      } else if (code === 'auth/weak-password') {
        msg = LANG === 'en' ? 'Password must be at least 6 characters.' : 'La contraseña debe tener al menos 6 caracteres.';
      } else if (code === 'auth/invalid-email') {
        msg = LANG === 'en' ? 'Invalid email format.' : 'Formato de email no válido.';
      } else {
        msg = LANG === 'en' ? 'Sign-in failed. Try again.' : 'No se pudo iniciar sesión. Inténtalo de nuevo.';
      }
      manaAlert(msg, 'error');
      console.warn('email sign-in failed:', e);
    }
  };

  window.toggleAuthMode = function(e) {
    if (e) e.preventDefault();
    _authModeSignup = !_authModeSignup;
    var btn = document.querySelector('.auth-submit-btn');
    var hint = document.querySelector('.auth-signup-hint');
    if (_authModeSignup) {
      if (btn) btn.textContent = LANG === 'en' ? 'Create account' : 'Crear cuenta';
      if (hint) hint.innerHTML = (LANG === 'en' ? '<span>Already have an account?</span> ' : '<span>\u00bfYa tienes cuenta?</span> ') + '<a href="#" onclick="toggleAuthMode(event)">' + (LANG === 'en' ? 'Sign in' : 'Iniciar sesi\u00f3n') + '</a>';
    } else {
      if (btn) btn.textContent = LANG === 'en' ? 'Sign in' : 'Iniciar sesi\u00f3n';
      if (hint) hint.innerHTML = (LANG === 'en' ? '<span>No account yet?</span> ' : '<span>\u00bfNo tienes cuenta?</span> ') + '<a href="#" onclick="toggleAuthMode(event)">' + (LANG === 'en' ? 'Create account' : 'Crear cuenta') + '</a>';
    }
  };



  // ═══════════════════════════════════════════════════════════════
  // SHARE MAP — the new unified entry point
  // ═══════════════════════════════════════════════════════════════

  // Internal: performs save + copy URL (assumes user is authenticated)
  async function _doShareMap() {
    const geo = getCurrentGeo();
    if (!geo) {
      manaAlert(LANG === 'en' ? 'No elements to share.' : t('persist_no_elements'), 'warning');
      return;
    }
    const user = getCurrentUser();
    if (!user || !user.uid) {
      // Should not happen here, but handle gracefully
      manaAlert(LANG === 'en' ? 'Authentication required.' : 'Necesitas iniciar sesión.', 'warning');
      return;
    }
    try {
      const result = await persistMapRecord(user);
      await copyToClipboard(result.shareUrl, LANG === 'en' ? 'Link copied ✓' : 'Enlace copiado ✓');
    } catch (e) {
      const msg = e && e.message === 'empty-map'
        ? (LANG === 'en' ? 'No elements to share.' : t('persist_no_elements'))
        : getFirestoreErrorMessage(e);
      manaAlert(msg, 'warning');
    }
  }

  // Public: called by the Share button
  window.shareMap = async function() {
    // 1. Check there's something to share
    const geo = getCurrentGeo();
    if (!geo) {
      manaAlert(LANG === 'en' ? 'No elements to share.' : t('persist_no_elements'), 'warning');
      return;
    }

    // 2. Check if user is already logged in
    const user = getCurrentUser();
    if (user && user.uid) {
      // Already authenticated → save + copy URL immediately
      await _doShareMap();
      return;
    }

    // 3. Not logged in → open auth modal, set pending flag
    _pendingShareAfterAuth = true;
    openAuthModal();
  };

  // ═══════════════════════════════════════════════════════════════
  // LEGACY COMPAT: keep closeShareModal for any residual references
  // ═══════════════════════════════════════════════════════════════
  window.closeShareModal = function() {
    var modal = document.getElementById('share-modal');
    if (modal) {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
    }
  };

  // Close auth modal on backdrop click or Escape
  document.addEventListener('click', function(e) {
    var modal = document.getElementById('auth-modal');
    if (modal && modal.classList.contains('open') && e.target === modal) closeAuthModal();
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      closeAuthModal();
    }
  });
})();
