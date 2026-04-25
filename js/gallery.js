// ── gallery.js ─ share modal + gallery publish ─

(function() {
  const GALLERY_COLLECTION = 'galleryMaps';
  const LOCAL_GALLERY_KEY = 'mana-gallery-maps';
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

  function getCurrentGeo() {
    if (typeof getEnrichedGeoJSON !== 'function') return null;
    const geo = getEnrichedGeoJSON();
    if (!geo || !geo.features || !geo.features.length) return null;
    return geo;
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

  function saveLocalPublishedMap(payload) {
    const list = JSON.parse(localStorage.getItem(LOCAL_GALLERY_KEY) || '[]');
    const id = 'local-' + Math.random().toString(36).slice(2, 11);
    list.unshift({ id, ...payload, createdAtMs: Date.now() });
    localStorage.setItem(LOCAL_GALLERY_KEY, JSON.stringify(list.slice(0, 60)));
    return id;
  }
  
  function cachePublishedMap(id, payload) {
    const list = JSON.parse(localStorage.getItem(LOCAL_GALLERY_KEY) || '[]');
    const filtered = list.filter(function(item) { return item.id !== id; });
    filtered.unshift({ id, ...payload, createdAtMs: Date.now() });
    localStorage.setItem(LOCAL_GALLERY_KEY, JSON.stringify(filtered.slice(0, 60)));
  }

  function buildGalleryURL(id) {
    return window.location.origin + '/gallery/?map=' + encodeURIComponent(id);
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
    const geo = getCurrentGeo();
    if (!geo) {
      manaAlert(LANG === 'en' ? 'No elements to publish.' : t('persist_no_elements'), 'warning');
      return;
    }

    const meta = getMapMeta();
    const payload = {
      name: meta.name,
      lang: meta.lang,
      featureCount: geo.features.length,
      geojson: geo,
      createdAtMs: Date.now()
    };

    let id;
    const db = getGalleryDb();
    if (db) {
      try {
        id = slugifyMapName(meta.name);
        await db.collection(GALLERY_COLLECTION).doc(id).set({
          id: id,
          ...payload,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        cachePublishedMap(id, payload);
      } catch (e) {
        console.warn('gallery publish fallback local:', e);
        id = saveLocalPublishedMap(payload);
      }
    } else {
      id = saveLocalPublishedMap(payload);
    }

    const shareURL = buildGalleryURL(id);
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
