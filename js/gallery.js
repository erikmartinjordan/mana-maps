// ── gallery.js ─ share modal + gallery publish ─

(function() {
  const MAPS_COLLECTION = 'maps';
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

  function waitForAuthUser(timeoutMs) {
    return new Promise(function(resolve) {
      if (!firebase || !firebase.auth || typeof firebase.auth !== 'function') {
        resolve(null);
        return;
      }
      var auth = firebase.auth();
      if (auth.currentUser && auth.currentUser.uid) {
        resolve(auth.currentUser);
        return;
      }
      var settled = false;
      var timer = setTimeout(function() {
        if (settled) return;
        settled = true;
        if (typeof unsubscribe === 'function') unsubscribe();
        resolve(auth.currentUser || null);
      }, timeoutMs || 5000);
      var unsubscribe = auth.onAuthStateChanged(function(user) {
        if (settled || !user) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(user);
      }, function() {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(null);
      });
    });
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

  function getMapMeta() {
    const input = document.getElementById('project-name-input');
    const value = (input && input.value ? input.value : '').trim();
    return {
      name: value || (typeof t === 'function' ? t('map_name_placeholder') : 'Mapa sin título'),
      lang: (typeof LANG !== 'undefined' ? LANG : 'es')
    };
  }

  async function getCurrentUserUid() {
    try {
      // Firestore write metadata: prefer authenticated uid when available.
      if (firebase && firebase.auth && firebase.auth().currentUser && firebase.auth().currentUser.uid) {
        return firebase.auth().currentUser.uid;
      }
      if (firebase && firebase.auth && typeof firebase.auth === 'function') {
        await firebase.auth().signInAnonymously();
        var authUser = await waitForAuthUser(6000);
        if (authUser && authUser.uid) return authUser.uid;
      }
    } catch (e) {
      console.warn('auth uid unavailable:', e);
    }
    return null;
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
    geo.features.forEach(function(feature) {
      var geom = feature && feature.geometry;
      if (!geom || !Array.isArray(geom.coordinates)) return;
      var type = geom.type;
      if (type === 'Point') {
        points.push(geom.coordinates);
      } else if (type === 'LineString' || type === 'MultiPoint') {
        geom.coordinates.forEach(function(c) { points.push(c); });
      } else if (type === 'Polygon' || type === 'MultiLineString') {
        geom.coordinates.forEach(function(ring) {
          if (Array.isArray(ring)) ring.forEach(function(c) { points.push(c); });
        });
      } else if (type === 'MultiPolygon') {
        geom.coordinates.forEach(function(poly) {
          if (!Array.isArray(poly)) return;
          poly.forEach(function(ring) {
            if (Array.isArray(ring)) ring.forEach(function(c) { points.push(c); });
          });
        });
      }
    });
    if (!points.length) return null;
    var minX = Infinity; var maxX = -Infinity; var minY = Infinity; var maxY = -Infinity;
    points.forEach(function(c) {
      var x = Number(c[0]); var y = Number(c[1]);
      if (!isFinite(x) || !isFinite(y)) return;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    });
    if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minY) || !isFinite(maxY)) return null;
    return {
      bbox: [minX, minY, maxX, maxY],
      features: geo.features.slice(0, 40).map(function(feature) {
        var props = feature && feature.properties ? feature.properties : {};
        return {
          geometry: feature ? feature.geometry : null,
          color: props._manaColor || props.color || '#0ea5e9'
        };
      })
    };
  }

  function setPublishButtonState(isSaving, errorMessage) {
    const publishBtn = document.querySelector('#share-modal .share-action-btn-primary');
    if (!publishBtn) return;
    publishBtn.disabled = !!isSaving;
    publishBtn.style.opacity = isSaving ? '0.7' : '';
    publishBtn.style.pointerEvents = isSaving ? 'none' : '';
    publishBtn.setAttribute('aria-busy', isSaving ? 'true' : 'false');
    if (!publishBtn.dataset.defaultLabel) {
      const labelEl = publishBtn.querySelector('.share-action-title');
      publishBtn.dataset.defaultLabel = labelEl ? labelEl.textContent : 'Publish map';
    }
    const labelEl = publishBtn.querySelector('.share-action-title');
    if (labelEl) {
      labelEl.textContent = isSaving
        ? (LANG === 'en' ? 'Publishing…' : 'Publicando…')
        : publishBtn.dataset.defaultLabel;
    }
    if (errorMessage && typeof manaAlert === 'function') {
      manaAlert(errorMessage, 'error');
    }
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

  window.closeShareModal = function() {
    const modal = document.getElementById('share-modal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  };

  window.publishMapToGallery = async function() {
    const rawGeo = getCurrentGeo();
    if (!rawGeo) {
      manaAlert(LANG === 'en' ? 'No elements to publish.' : t('persist_no_elements'), 'warning');
      return;
    }
    const geo = sanitizeFirestorePayload(rawGeo);
    if (!geo || !geo.features || !geo.features.length) {
      setPublishButtonState(false, LANG === 'en'
        ? 'Invalid map data for Firestore publish.'
        : 'Datos de mapa no válidos para publicar en Firestore.');
      return;
    }

    const meta = getMapMeta();
    const slug = slugifyMapName(meta.name);
    const userUid = await getCurrentUserUid();
    const preview = buildMapPreview(geo);
    const shareUrl = buildGalleryURL(slug);
    const geoString = toGeoJSONString(geo);
    if (!geoString) {
      setPublishButtonState(false, LANG === 'en'
        ? 'Invalid map data for Firestore publish.'
        : 'Datos de mapa no válidos para publicar en Firestore.');
      return;
    }
    const payload = {
      id: slug,
      title: meta.name,
      name: meta.name,
      createdBy: userUid || 'anonymous',
      lang: meta.lang,
      featureCount: geo.features.length,
      mapDataText: geoString,
      geojsonText: geoString,
      mapPreview: preview,
      isPublished: true,
      shareUrl: shareUrl,
      createdAtMs: Date.now()
    };

    const db = getGalleryDb();
    if (!db) {
      setPublishButtonState(false, LANG === 'en'
        ? 'Firestore unavailable. Map was not published.'
        : 'Firestore no disponible. El mapa no se ha publicado.');
      return;
    }

    setPublishButtonState(true);
    try {
      // Firestore write: persist the published map as a public record in /maps.
      await db.collection(MAPS_COLLECTION).doc(slug).set({
        slug: slug,
        ...payload,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (e) {
      console.warn('gallery publish failed:', e);
      setPublishButtonState(false, LANG === 'en'
        ? 'Publish failed in Firestore. Please try again.'
        : 'Error al publicar en Firestore. Vuelve a intentarlo.');
      return;
    } finally {
      setPublishButtonState(false);
    }

    const shareURL = buildGalleryURL(slug);
    await copyToClipboard(
      shareURL,
      LANG === 'en'
        ? 'Gallery URL copied ✓'
        : 'URL de galería copiada ✓'
    );
    if (typeof showToast === 'function') {
      showToast(LANG === 'en' ? 'Map published ✓' : 'Mapa publicado ✓');
    }

    closeShareModal();
    window.location.href = shareURL;
  };

  document.addEventListener('click', function(e) {
    const modal = document.getElementById('share-modal');
    if (!modal || !modal.classList.contains('open')) return;
    if (e.target === modal) closeShareModal();
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeShareModal();
  });
})();
