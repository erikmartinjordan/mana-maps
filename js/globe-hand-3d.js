// ── globe-hand-3d.js ─ Easter egg 3D: mano realista que equilibra el globo ──
// Carga three.js bajo demanda y renderiza la mano PBR del demo «Mano Realista
// con Balón» (sin balón: la pelota es el globo de MapLibre, sin rejilla y sin
// controles) sobre un lienzo transparente dentro de #globe-hand.
// Si three.js o WebGL no están disponibles, globe-hand.js usa la mano SVG.
// Fuerza el fallback SVG con: window._manaGlobeHand2D = true

(function () {
  var THREE_URL = 'https://unpkg.com/three@0.128.0/build/three.min.js';
  var FOV = 38;
  var VIEW_DIST = 14;                 // distancia de la cámara a la yema
  var VIEW_POS = [0, 3.5, 20];        // encuadre original del demo
  var VIEW_TARGET = [-0.2, 1.2, 0];
  var TIP_FRAC = { x: 0.43, y: 0.12 }; // yema dentro del lienzo (misma
                                        // convención que la mano SVG)
  var BASE_HAND_Y = -2.5;

  var loadPromise = null, loaded = false, broken = false;
  var renderer = null, scene = null, camera = null;
  var handGroup = null, tipAnchor = null, fingerAnchors = null;
  var rafId = null, running = false, startTime = 0;
  var lastW = 0, lastH = 0;

  function now() {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now());
  }

  // ── three.js bajo demanda ──────────────────────────────────────────────
  function preload() {
    if (loaded || loadPromise) return loadPromise || Promise.resolve(false);
    loadPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = THREE_URL;
      s.async = true;
      s.onload = function () { loaded = true; resolve(true); };
      s.onerror = function () { loadPromise = null; reject(new Error('three.js no se pudo cargar')); };
      document.head.appendChild(s);
    });
    loadPromise.catch(function () {}); // el fallo se reintenta en la próxima llamada
    return loadPromise;
  }

  function isLoaded() { return loaded && typeof THREE !== 'undefined'; }
  function isUsable() { return isLoaded() && !broken; }

  // ── textura de poros y arrugas de la piel (del demo) ──────────────────
  function createSkinBumpMap() {
    var canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, 512, 512);

    var imgData = ctx.getImageData(0, 0, 512, 512);
    var data = imgData.data;
    for (var i = 0; i < data.length; i += 4) {
      var grain = (Math.random() - 0.5) * 28;
      var v = Math.min(255, Math.max(0, 128 + grain));
      data[i] = v; data[i + 1] = v; data[i + 2] = v;
    }
    ctx.putImageData(imgData, 0, 0);

    ctx.strokeStyle = 'rgba(60,60,60,0.3)';
    ctx.lineWidth = 1.5;
    for (var j = 0; j < 20; j++) {
      ctx.beginPath();
      ctx.moveTo(Math.random() * 512, Math.random() * 512);
      ctx.bezierCurveTo(
        Math.random() * 512, Math.random() * 512,
        Math.random() * 512, Math.random() * 512,
        Math.random() * 512, Math.random() * 512
      );
      ctx.stroke();
    }

    var texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 4);
    return texture;
  }

  // ── la mano (adaptada del demo; devuelve el ancla de la yema) ─────────
  function createHand() {
    var skinMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xe09b82,
      roughness: 0.48,
      metalness: 0.0,
      bumpMap: createSkinBumpMap(),
      bumpScale: 0.008,
      clearcoat: 0.12,
      clearcoatRoughness: 0.4,
      transmission: 0.08
    });

    var nailMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xeeaba0,
      roughness: 0.25,
      metalness: 0.0,
      clearcoat: 0.6,
      clearcoatRoughness: 0.1
    });

    function buildFinger(radius, lengths, rotations, startPos, hasNail) {
      var fingerGroup = new THREE.Group();
      fingerGroup.position.copy(startPos);
      var currentParent = fingerGroup;

      for (var i = 0; i < lengths.length; i++) {
        var len = lengths[i];
        var jointRadius = radius * (1 - i * 0.1);

        var joint = new THREE.Mesh(new THREE.SphereGeometry(jointRadius * 1.08, 24, 24), skinMaterial);
        joint.castShadow = true;
        joint.receiveShadow = true;
        currentParent.add(joint);

        var pivot = new THREE.Group();
        pivot.rotation.set(rotations[i].x, rotations[i].y, rotations[i].z);
        joint.add(pivot);

        var boneGeo = new THREE.CylinderGeometry(jointRadius * 0.88, jointRadius, len, 24);
        var bone = new THREE.Mesh(boneGeo, skinMaterial);
        bone.position.y = len / 2;
        bone.castShadow = true;
        bone.receiveShadow = true;
        pivot.add(bone);

        if (i === lengths.length - 1 && hasNail !== false) {
          var nailGeo = new THREE.BoxGeometry(jointRadius * 1.1, len * 0.45, jointRadius * 0.3);
          var nail = new THREE.Mesh(nailGeo, nailMaterial);
          nail.position.set(0, len * 0.65, jointRadius * 0.65);
          nail.rotation.x = -0.1;
          pivot.add(nail);
        }

        var nextParent = new THREE.Group();
        nextParent.position.y = len;
        pivot.add(nextParent);

        currentParent = nextParent;
        radius *= 0.88;
      }
      // Extremo de la última falange: donde se apoya la pelota (el globo).
      fingerGroup.userData.tipAnchor = currentParent;
      return fingerGroup;
    }

    var hand = new THREE.Group();

    // Antebrazo y muñeca
    var arm = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.45, 6, 32), skinMaterial);
    arm.position.set(0.1, -4.2, -0.2);
    arm.castShadow = true;
    arm.receiveShadow = true;
    hand.add(arm);

    var wrist = new THREE.Mesh(new THREE.SphereGeometry(1.28, 32, 32), skinMaterial);
    wrist.scale.set(0.95, 0.65, 0.55);
    wrist.position.set(0.05, -1.2, -0.1);
    wrist.castShadow = true;
    hand.add(wrist);

    // Palma y eminencias
    var palm = new THREE.Mesh(new THREE.SphereGeometry(1.5, 32, 32), skinMaterial);
    palm.scale.set(1.0, 1.15, 0.48);
    palm.position.set(0, 0.3, 0);
    palm.castShadow = true;
    palm.receiveShadow = true;
    hand.add(palm);

    var thenar = new THREE.Mesh(new THREE.SphereGeometry(0.85, 32, 32), skinMaterial);
    thenar.scale.set(0.85, 1.2, 0.65);
    thenar.position.set(-0.75, -0.2, 0.25);
    thenar.rotation.z = -0.3;
    thenar.castShadow = true;
    hand.add(thenar);

    var hypothenar = new THREE.Mesh(new THREE.SphereGeometry(0.7, 32, 32), skinMaterial);
    hypothenar.scale.set(0.7, 1.1, 0.55);
    hypothenar.position.set(0.8, -0.3, 0.15);
    hypothenar.castShadow = true;
    hand.add(hypothenar);

    // Índice extendido hacia arriba (la yema sostiene el globo)
    var indexFinger = buildFinger(0.34, [1.35, 0.9, 0.7], [
      { x: 0.0, y: 0.0, z: -0.02 },
      { x: 0.0, y: 0.0, z: 0.0 },
      { x: 0.0, y: 0.0, z: 0.0 }
    ], new THREE.Vector3(-0.72, 1.45, 0.05));
    hand.add(indexFinger);

    // Dedos cerrados
    hand.add(buildFinger(0.36, [1.4, 0.95, 0.72], [
      { x: 1.62, y: 0.05, z: -0.05 },
      { x: 1.55, y: 0.0, z: 0.0 },
      { x: 1.1, y: 0.0, z: 0.0 }
    ], new THREE.Vector3(-0.02, 1.5, 0.05)));

    hand.add(buildFinger(0.33, [1.3, 0.88, 0.68], [
      { x: 1.65, y: -0.05, z: 0.05 },
      { x: 1.58, y: 0.0, z: 0.0 },
      { x: 1.15, y: 0.0, z: 0.0 }
    ], new THREE.Vector3(0.65, 1.38, 0.02)));

    hand.add(buildFinger(0.28, [1.0, 0.68, 0.55], [
      { x: 1.7, y: -0.1, z: 0.12 },
      { x: 1.62, y: 0.0, z: 0.0 },
      { x: 1.2, y: 0.0, z: 0.0 }
    ], new THREE.Vector3(1.22, 1.05, -0.02)));

    // Pulgar relajado POR DEBAJO de los dedos cerrados: recorre el bajo palma
    // y la punta sube ligeramente, metida bajo el meñique.
    var thumbFinger = buildFinger(0.38, [1.25, 0.85, 0.65], [
      { x: 0.4061, y: -0.3582, z: -1.4427 },
      { x: -0.6927, y: -0.5173, z: -0.3501 },
      { x: 0.1823, y: -0.5677, z: 1.4304 }
    ], new THREE.Vector3(-1.05, -0.75, 0.35));
    hand.add(thumbFinger);

    return {
      group: hand,
      tip: indexFinger.userData.tipAnchor,
      anchors: {
        index: indexFinger.userData.tipAnchor,
        middle: hand.children[6].userData.tipAnchor,
        ring: hand.children[7].userData.tipAnchor,
        pinky: hand.children[8].userData.tipAnchor,
        thumb: thumbFinger.userData.tipAnchor
      }
    };
  }

  // ── luces de estudio del demo ─────────────────────────────────────────
  function addLights() {
    scene.add(new THREE.AmbientLight(0xfff5ea, 0.55));

    var keyLight = new THREE.DirectionalLight(0xfffaee, 2.2);
    keyLight.position.set(6, 12, 10);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 30;
    keyLight.shadow.bias = -0.0001;
    scene.add(keyLight);

    var fillLight = new THREE.DirectionalLight(0x6080b0, 0.8);
    fillLight.position.set(-8, -2, 6);
    scene.add(fillLight);

    var rimLight = new THREE.SpotLight(0xffffff, 4.5);
    rimLight.position.set(-4, 10, -12);
    rimLight.angle = Math.PI / 3;
    rimLight.penumbra = 0.8;
    scene.add(rimLight);
  }

  // La yema se proyecta siempre en TIP_FRAC del lienzo: la cámara mira en la
  // dirección del demo, se sitúa a VIEW_DIST de la yema y se desplaza en su
  // plano hasta clavarla en el objetivo (resolución exacta, sin iterar).
  function frameCamera() {
    if (!camera || !scene || !tipAnchor) return;
    scene.updateMatrixWorld(true);
    var tipWorld = tipAnchor.getWorldPosition(new THREE.Vector3());
    var dir = new THREE.Vector3(
      VIEW_TARGET[0] - VIEW_POS[0],
      VIEW_TARGET[1] - VIEW_POS[1],
      VIEW_TARGET[2] - VIEW_POS[2]
    ).normalize();

    camera.up.set(0, 1, 0);
    camera.position.copy(tipWorld).addScaledVector(dir, -VIEW_DIST);
    camera.lookAt(camera.position.clone().add(dir));
    camera.updateMatrixWorld(true);

    var tanHalf = Math.tan(camera.fov * Math.PI / 360);
    var wantX = TIP_FRAC.x * 2 - 1;
    var wantY = 1 - TIP_FRAC.y * 2;
    camera.translateX(-wantX * VIEW_DIST * tanHalf * camera.aspect);
    camera.translateY(-wantY * VIEW_DIST * tanHalf);
    camera.updateMatrixWorld(true);
  }

  function renderFrame() {
    if (renderer && scene && camera) renderer.render(scene, camera);
  }

  function onContextLost(e) {
    e.preventDefault();
    broken = true;
    stop();
  }

  // ── API pública ───────────────────────────────────────────────────────
  function build(containerEl) {
    if (!containerEl || !isUsable()) return false;
    if (renderer) {
      if (renderer.domElement.parentNode !== containerEl) containerEl.appendChild(renderer.domElement);
      frameCamera();
      renderFrame();
      return true;
    }
    try {
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setClearColor(0x000000, 0);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;

      addLights();

      var hand = createHand();
      handGroup = hand.group;
      tipAnchor = hand.tip;
      fingerAnchors = hand.anchors;
      handGroup.position.set(0, BASE_HAND_Y, 0);
      scene.add(handGroup);

      renderer.domElement.addEventListener('webglcontextlost', onContextLost, false);
      containerEl.appendChild(renderer.domElement);
      // Buffer FIJO: se pinta una vez a esta resolución y el CSS lo escala al
      // tamaño que toque. Así no se reasigna el buffer (ni parpadea) mientras
      // el globo gira o se eleva durante el cameo.
      resize(1024, 1024);
      renderFrame();
      return true;
    } catch (e) {
      broken = true;
      hardDispose();
      return false;
    }
  }

  function resize(w, h) {
    if (!renderer || !camera) return;
    w = Math.round(w); h = Math.round(h);
    if (!w || !h) return;
    // setSize() reasigna canvas.width aunque la medida no cambie, lo que
    // vacía el buffer: evitarlo en cada positionHand (entrance ×4 + globe) y
    // ante fluctuaciones de ~1 px de la geometría del globo al rotar (si no,
    // la mano parpadea al agarrar/arrastrar).
    if (Math.abs(w - lastW) <= 2 && Math.abs(h - lastH) <= 2) return;
    lastW = w; lastH = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    frameCamera();
    // Sin bucle RAF (modo estático / reduced-motion) el redimensionado vacía
    // el buffer: hay que volver a pintar.
    if (!rafId) renderFrame();
  }

  // Posición de la yema como fracción del lienzo (para pegarla al globo).
  function tip() {
    if (!renderer || !camera || !tipAnchor) return { x: TIP_FRAC.x, y: TIP_FRAC.y };
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    var v = tipAnchor.getWorldPosition(new THREE.Vector3());
    v.project(camera);
    if (!isFinite(v.x) || !isFinite(v.y)) return { x: TIP_FRAC.x, y: TIP_FRAC.y };
    return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
  }

  // Depuración: yemas de los dedos en coordenadas de mundo y como fracción
  // del lienzo (para ajustar poses mirando dónde caen en pantalla).
  function tips() {
    if (!scene || !camera || !fingerAnchors) return null;
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    var world = {}, screen = {};
    Object.keys(fingerAnchors).forEach(function (k) {
      var v = fingerAnchors[k].getWorldPosition(new THREE.Vector3());
      world[k] = [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)];
      var p = v.clone().project(camera);
      screen[k] = [+(0.5 + p.x / 2).toFixed(3), +(0.5 - p.y / 2).toFixed(3)];
    });
    return { world: world, screen: screen };
  }

  function resetPose(t) {
    if (!handGroup) return;
    handGroup.position.y = BASE_HAND_Y + Math.sin(t) * 0.04;
    handGroup.rotation.z = Math.sin(t * 0.8) * 0.01;
  }

  function start() {
    if (!renderer) return;
    stop();
    running = true;
    startTime = now();
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      resetPose(0);
      renderFrame();
      return;
    }
    var loop = function () {
      if (!running) return;
      rafId = requestAnimationFrame(loop);
      resetPose((now() - startTime) * 0.0015);
      renderFrame();
    };
    rafId = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    resetPose(0);
  }

  function hardDispose() {
    try { if (renderer) { renderer.dispose(); renderer.forceContextLoss && renderer.forceContextLoss(); } } catch (e) {}
    renderer = null; scene = null; camera = null; handGroup = null; tipAnchor = null;
    rafId = null; running = false; lastW = 0; lastH = 0;
  }

  function dispose() {
    stop();
    if (renderer && renderer.domElement && renderer.domElement.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
    hardDispose();
  }

  // Precalienta contexto WebGL + shaders + texturas en un div detached, fuera
  // del momento del giro: así la primera aparición no sufre el coste de build.
  function warm() {
    return build(document.createElement('div'));
  }

  window.GlobeHand3D = {
    preload: preload,
    isLoaded: isLoaded,
    isUsable: isUsable,
    build: build,
    warm: warm,
    resize: resize,
    tip: tip,
    tips: tips,
    start: start,
    stop: stop,
    dispose: dispose
  };
})();
