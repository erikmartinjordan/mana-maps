// ── gallery.js ─ share modal + gallery publish ─

(function() {
  const GALLERY_COLLECTION = 'galleryMaps';
  const LOCAL_GALLERY_KEY = 'mana-gallery-maps';

  function getGalleryDb() {
    if (typeof firebase === 'undefined') return null;
    if (!firebase.apps || !firebase.apps.length) return null;
    try {
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

  function saveLocalPublishedMap(payload) {
    const list = JSON.parse(localStorage.getItem(LOCAL_GALLERY_KEY) || '[]');
    const id = 'local-' + Math.random().toString(36).slice(2, 11);
    list.unshift({ id, ...payload, createdAtMs: Date.now() });
    try {
      localStorage.setItem(LOCAL_GALLERY_KEY, JSON.stringify(list.slice(0, 20)));
    } catch (e) {
      if (e && e.name === 'QuotaExceededError') {
        // Retry with metadata-only payload (no geometry) so at least the card exists
        const compact = list.map(function(item) {
          return {
            id: item.id,
            name: item.name,
            lang: item.lang,
            featureCount: item.featureCount,
            createdAtMs: item.createdAtMs
          };
        }).slice(0, 20);
        localStorage.setItem(LOCAL_GALLERY_KEY, JSON.stringify(compact));
      } else {
        throw e;
      }
    }
    return id;
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
    const geoText = JSON.stringify(geo);
    const payload = {
      name: meta.name,
      lang: meta.lang,
      featureCount: geo.features.length,
      geojsonText: geoText,
      createdAtMs: Date.now()
    };

    let id;
    const db = getGalleryDb();
    if (db) {
      try {
        const ref = await db.collection(GALLERY_COLLECTION).add({
          ...payload,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        id = ref.id;
      } catch (e) {
        console.warn('gallery publish fallback local:', e);
        if (geoText.length > 1200000) {
          manaAlert(
            LANG === 'en'
              ? 'Map is too large for local fallback. Copying direct URL instead.'
              : 'El mapa es demasiado grande para guardado local. Se copiará la URL directa.',
            'warning'
          );
          const directURL = (typeof buildShareHashURL === 'function' && buildShareHashURL()) || window.location.href;
          await copyToClipboard(directURL, LANG === 'en' ? 'Link copied ✓' : 'Enlace copiado ✓');
          closeShareModal();
          return;
        }
        id = saveLocalPublishedMap(payload);
      }
    } else {
      if (geoText.length > 1200000) {
        manaAlert(
          LANG === 'en'
            ? 'Map is too large for local fallback. Copying direct URL instead.'
            : 'El mapa es demasiado grande para guardado local. Se copiará la URL directa.',
          'warning'
        );
        const directURL = (typeof buildShareHashURL === 'function' && buildShareHashURL()) || window.location.href;
        await copyToClipboard(directURL, LANG === 'en' ? 'Link copied ✓' : 'Enlace copiado ✓');
        closeShareModal();
        return;
      }
      id = saveLocalPublishedMap(payload);
    }

    const shareURL = buildGalleryURL(id);
    await copyToClipboard(
      shareURL,
      LANG === 'en'
        ? 'Gallery URL copied ✓'
        : 'URL de galería copiada ✓'
    );

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
