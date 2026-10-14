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
  var handGroup = null, tipAnchor = null, fingerAnchors = null, flexPivots = null;
  var rafId = null, running = false, startTime = 0, lastFrameT = 0;
  var lastW = 0, lastH = 0;

  // ── muelles del cameo ─────────────────────────────────────────────────
  // La mano no es un maniquí: cede con el peso de la bola (dip), hace
  // follow-through en la dirección del guantazo (lean) y los dedos absorben
  // el golpe (curl). Todo con muelles amortiguados integrados por frame.
  var springs = null;
  function makeSpring(k, c) { return { x: 0, v: 0, k: k, c: c }; }
  function resetSprings() {
    springs = {
      dip: makeSpring(110, 14),   // ~1.7 Hz, ζ≈0.67: rebote corto y creíble
      lean: makeSpring(85, 11),   // giro de follow-through, ζ≈0.6
      curl: makeSpring(140, 16)   // dedos: rápido y sin rebote visible
    };
  }
  resetSprings();
  function stepSpring(s, dt) {
    var a = -s.k * s.x - s.c * s.v;
    s.v += a * dt;
    s.x += s.v * dt;
  }

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

  // ── la mano (modelado propio; devuelve el ancla de la yema) ───────────
  function createHand() {
    var skinMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xd99a7c,
      roughness: 0.44,
      metalness: 0.0,
      bumpMap: createSkinBumpMap(),
      bumpScale: 0.01,
      clearcoat: 0.16,
      clearcoatRoughness: 0.36
    });

    var nailMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xe8b2a4,
      roughness: 0.22,
      metalness: 0.0,
      clearcoat: 0.7,
      clearcoatRoughness: 0.08,
      side: THREE.DoubleSide
    });

    // La última falange lleva su propio material: permite teñir la almohadilla
    // con un degradado de vértices (la carne de la yema es más rosada que la
    // del resto del dedo) y bajarle el brillo, que es lo que la hace parecer
    // plástico. El color base va a blanco: los vertex colors se MULTIPLICAN,
    // no sustituyen, así que el degradado ya lleva el color de la piel.
    var tipMaterial = skinMaterial.clone();
    tipMaterial.color.setHex(0xffffff);
    tipMaterial.vertexColors = true;
    tipMaterial.roughness = 0.54;
    tipMaterial.clearcoat = 0.10;

// Radio del perfil de una falange en la fracción t (0..1) de su longitud.
    // Interpolación SUAVE (derivada 0 en los extremos) + bombeo central: dos
    // falanges contiguas comparten plano, radio y tangente en la articulación,
    // así que la unión es invisible (solo queda el pliegue, como en una
    // articulación real) en vez del escalón esfera-vs-cilindro.
    function phalanxRadius(t, rStart, rEnd) {
      var e = t * t * (3 - 2 * t);            // smoothstep
      var r = rStart + (rEnd - rStart) * e;
      return r * (1 + 0.055 * Math.sin(Math.PI * t)); // bombeo de la falange
    }

    function smooth01(t) {
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      return t * t * (3 - 2 * t);
    }

    // Hermite con pendientes en unidades reales (r por unidad de Y), para
    // encadenar tramos de perfil sin quiebro en la unión.
    function hermiteSlope(y, y0, y1, p0, p1, s0, s1) {
      var h = y1 - y0;
      if (h <= 1e-6) return p1;
      var t = (y - y0) / h, t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * (s0 * h) +
             (-2 * t3 + 3 * t2) * p1 + (t3 - t2) * (s1 * h);
    }

    // Cierra un extremo de la revolución con una CÚPULA suave hacia dentro
    // (un disco plano queda casi coplanar con el cilindro que lo rodea y
    // z-fightea con él; un cono afilado asomaba en el meñique como un corte
    // diagonal). El anillo que recibe la cúpula se DUPLICA antes de cerrar:
    // LatheGeometry comparte esos vértices entre el muro y el cierre, así que
    // computeVertexNormals() promedia la normal del muro (hacia fuera) con la
    // del cierre (hacia arriba) y el canto se orienta al cielo → se pintaba
    // una banda blanca en cada articulación. Entre los dos anillos
    // coincidentes solo quedan triángulos de área cero, que no aportan a la
    // normal. La cúpula añade puntos en un cuarto de círculo para que el
    // redondeo sea continuo, no un vértice apuntado.
    function capEnds(pts) {
      if (pts.length < 2) return pts;
      var SEG = 6;
      if (pts[0].x > 1e-3) {
        var first = pts[0];
        var capH0 = Math.max(0.03, first.x * 0.4);
        pts.unshift(first.clone());
        for (var i = 1; i <= SEG; i++) {
          var a0 = (i / SEG) * Math.PI / 2;
          pts.unshift(new THREE.Vector2(
            Math.max(0.0001, first.x * Math.cos(a0)),
            first.y + capH0 * Math.sin(a0)
          ));
        }
      }
      var last = pts[pts.length - 1];
      if (last.x > 1e-3) {
        var capH1 = Math.max(0.03, last.x * 0.4);
        pts.push(last.clone());
        for (var j = 1; j <= SEG; j++) {
          var a1 = (j / SEG) * Math.PI / 2;
          pts.push(new THREE.Vector2(
            Math.max(0.0001, last.x * Math.cos(a1)),
            last.y - capH1 * Math.sin(a1)
          ));
        }
      }
      return pts;
    }

// Falange de revolución: perfil continuo de rStart (nudillo base) a rEnd
    // (nudillo siguiente) y, si es la última, cúpula de yema del MISMO radio
    // para que la punta sea una continuación — no una esfera pegada encima.
    // `root` engorda y hunde el arranque para que el dedo se funda con el
    // puño (si no, se ve un corte entre la base del dedo y la palma).
    function phalanx(len, rStart, rEnd, root) {
      var pts = [];
      if (root) {
        pts.push(new THREE.Vector2(Math.max(0.0001, rStart * 1.28), -rStart * 1.15));
        pts.push(new THREE.Vector2(rStart * 1.06, -rStart * 0.25));
      }
      var n = 9;
      for (var s = 0; s <= n; s++) {
        var t = s / n;
        pts.push(new THREE.Vector2(Math.max(0.0001, phalanxRadius(t, rStart, rEnd)), len * t));
      }
      var geo = new THREE.LatheGeometry(capEnds(pts), 40);
      geo.computeVertexNormals();
      var mesh = new THREE.Mesh(geo, skinMaterial);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    }

    // Falange distal: la YEMA. La cámara mira la PALMA (+Z: ahí están el
    // thenar, el hypothenar y la raíz del pulgar), así que lo que el usuario
    // ve es la almohadilla de carne —no el dorso—. El perfil se arma en tres
    // tramos con tangente emparejada en cada unión:
    //   A) base un pelín más ancha (3.5 %) que el tope de la falange anterior,
    //      para cubrir su borde durante el solape y no dejar escalón,
    //   B) cuello que AFINA hacia la punta (un dedo estrecha; antes abombaba
    //      un 8 % y eso daba la silueta de bala),
    //   C) cuarto de elipse: redondea a partir del 70 % de la longitud y con
    //      el radio casi igual a la altura → media esfera, no un huevo.
    // Después, una pasada de deformación suave por anillo rompe la simetría
    // de revolución: afina en X, da profundidad en Z y corre la carne hacia
    // la palma (+Z), que es donde de verdad está el pulpejo.
    function tipPhalanx(len, rStart, capH, prevLen) {
      var L = len + capH;                    // NO cambiar: fija el ancla de la yema
      var seam = Math.max(0, (prevLen - len) / 2);  // fin visible de la anterior
      var yCap = L * 0.70;                   // ecuador de la almohadilla
      if (seam > yCap * 0.5) seam = yCap * 0.5;
      var r0 = rStart * 1.035;               // ≥ radio de la falange anterior
      var rCap = rStart * 0.97;              // afina antes de redondear
      var capLen = L - yCap;
      var sJoint = (seam > 1e-5) ? (rCap - rStart) / (yCap - seam) : 0;

      function radiusAt(y) {
        if (y >= yCap) {
          var s = capLen > 1e-6 ? Math.min(1, (y - yCap) / capLen) : 1;
          return Math.max(0.0001, rCap * Math.sqrt(Math.max(0, 1 - s * s)));
        }
        if (seam > 1e-5 && y <= seam) {
          return hermiteSlope(y, 0, seam, r0, rStart, 0, sJoint);
        }
        var a = seam > 1e-5 ? seam : 0;
        var pa = seam > 1e-5 ? rStart : r0;
        var sa = seam > 1e-5 ? sJoint : 0;
        return hermiteSlope(y, a, yCap, pa, rCap, sa, 0);
      }

      var apex = L;
      var pts = [];
      // Collar de arranque: hunde y engorda la base para que el dedo se funda
      // con el puño (solo aplica si la falange nace en la palma).
      if (prevLen == null) {
        pts.push(new THREE.Vector2(rStart * 1.28, -rStart * 1.15));
        pts.push(new THREE.Vector2(rStart * 1.06, -rStart * 0.25));
      }
      var n = 36;
      for (var i = 0; i <= n; i++) {
        var y = L * i / n;
        pts.push(new THREE.Vector2(radiusAt(y), y));
      }
      var geo = new THREE.LatheGeometry(capEnds(pts), 48);

      // Deformación por anillo + color de la almohadilla.
      var pos = geo.attributes.position;
      var col = new Float32Array(pos.count * 3);
      var skinC = [0.851, 0.604, 0.486];   // 0xd99a7c
      var padC = [0.831, 0.478, 0.396];    // 0xd47a65: la yema se inyecta
      for (var v = 0; v < pos.count; v++) {
        var px = pos.getX(v), py = pos.getY(v), pz = pos.getZ(v);
        var u = py / L;
        var g = smooth01((u - 0.32) / 0.68);
        pos.setXYZ(v, px * (1 - 0.07 * g), py, pz * (1 + 0.16 * g) + 0.14 * rCap * g);
        var k = smooth01((u - 0.22) / 0.78);
        col[v * 3] = skinC[0] + (padC[0] - skinC[0]) * k;
        col[v * 3 + 1] = skinC[1] + (padC[1] - skinC[1]) * k;
        col[v * 3 + 2] = skinC[2] + (padC[2] - skinC[2]) * k;
      }
      pos.needsUpdate = true;
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.computeVertexNormals();

      var mesh = new THREE.Mesh(geo, tipMaterial);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return { mesh: mesh, apex: apex, radiusAt: radiusAt, L: L, seam: seam, rCap: rCap };
    }

    // Uña: placa curva muestreada sobre el MISMO perfil y la MISMA deformación
    // que la piel de la falange distal, con un pequeño alejamiento radial, así
    // se apoya en el dedo por construcción (antes era una esfera achatada que
    // acababa flotando o metiéndose dentro). Va en el DORSO (-Z): la cámara
    // mira la palma, así que en el cameo no se ve — pero es donde va.
    // Contorno en planta: cutillo redondeado, cuerpo a ancho completo y borde
    // libre recto (como una uña de verdad).
    function buildNail(tipInfo, yA, yB, halfFrac, lift) {
      var L = tipInfo.L, rCap = tipInfo.rCap, radiusAt = tipInfo.radiusAt;
      var NU = 18, NV = 16;
      var halfChord = radiusAt((yA + yB) / 2) * halfFrac;
      var verts = [], idx = [];
      for (var i = 0; i <= NU; i++) {
        var u = i / NU;
        var y = yA + (yB - yA) * u;
        var s = Math.min(1, u / 0.26);
        var outline = Math.sqrt(Math.max(0, 1 - (1 - s) * (1 - s)));
        var r = Math.max(1e-4, radiusAt(y));
        var ax = Math.asin(Math.min(0.97, (halfChord * outline) / r));
        var uu = y / L;
        var g = smooth01((uu - 0.32) / 0.68);
        var xs = 1 - 0.07 * g, zs = 1 + 0.16 * g, sh = 0.14 * rCap * g;
        for (var j = 0; j <= NV; j++) {
          var psi = ((j / NV) * 2 - 1) * ax;
          var dx = r * Math.sin(psi) * xs;
          var dz = -r * Math.cos(psi) * zs + sh;
          var m = Math.sqrt(dx * dx + dz * dz);
          if (m > 1e-6) { var k = (m + lift) / m; dx *= k; dz *= k; }
          verts.push(dx, y, dz);
        }
      }
      for (var a = 0; a < NU; a++) {
        for (var b = 0; b < NV; b++) {
          var p0 = a * (NV + 1) + b, p1 = p0 + 1, p2 = p0 + NV + 1, p3 = p2 + 1;
          idx.push(p0, p2, p1, p1, p2, p3);
        }
      }
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      return new THREE.Mesh(geo, nailMaterial);
    }

    // Construye un dedo completo: falanges de revolución encadenadas por
    // pivotes (para flexionar) y yemaContinua en la punta.
    function buildFinger(spec) {
      var group = new THREE.Group();
      group.position.copy(spec.root);
      var g = spec.groupRot || {};
      // `spread` inclina el dedo sobre su raíz: abre los dedos cerrados
      // respecto al vecino para que se lean como dedos, no como una masa.
      group.rotation.set(g.x || 0, g.y || 0, (g.z || 0) + (spec.spread || 0));

      var parent = group, tip = null;
      var tipInfo = null;
      var pivots = [];
      var last = spec.lengths.length - 1;
      for (var i = 0; i < spec.lengths.length; i++) {
        var pivot = new THREE.Group();
        var rot = spec.rot[i] || {};
        pivot.rotation.set(rot.x || 0, rot.y || 0, rot.z || 0);
        pivot.userData.baseRX = pivot.rotation.x;
        pivots.push(pivot);
        parent.add(pivot);

        // Radio compartido en la articulación: el tope de esta falange y la base
        // de la siguiente son el MISMO radio → unión sin costura.
        var rStart = spec.radii[i];
        var rEnd = (i + 1 < spec.radii.length) ? spec.radii[i + 1] : spec.radii[i] * 0.92;
        var isLast = i === last;
        // La última falange lleva la bola de carne; las demás, huso simple.
        var seg, apex = 0;
        // Desplazamiento de la malla dentro de su pivote: el collar hunde el
        // arranque bajo el pivote para que la falange se descentre y su base
        // quede dentro del puño. NO tocar: fija dónde nace cada falange y,
        // con ello, el ancla de la yema.
        var offsetY = (i === 0) ? spec.lengths[i] / 2 - rStart * 0.4 : spec.lengths[i] / 2;
        if (isLast) {
          // capH ≈ cuánto sobresale la carne del pulpejo más allá del hueso.
          // `prevLen` = longitud de la falange anterior: con ella se calcula
          // hasta dónde llega el solape y así el perfil empieza exactamente en
          // el mismo radio → unión sin escalón.
          var prevLen = i > 0 ? spec.lengths[i - 1] : 0;
          tipInfo = tipPhalanx(spec.lengths[i], rStart, spec.lengths[i] * 0.38, i > 0 ? prevLen : null);
          seg = tipInfo.mesh;
          apex = tipInfo.apex;
        } else {
          // La falange SÍ se solapa con la siguiente ((len_i − len_{i+1})/2):
          // el solape es lo que tapa la bisagra cuando el nudillo se dobla (el
          // anillo de la falange siguiente se inclina y abre una cuña). Sin
          // él se ven agujeros en el puño. Ese muro extra no es el que pintaba
          // la banda blanca: eso venía de capEnds (anillo compartido con el
          // cono de cierre), ya corregido.
          seg = phalanx(spec.lengths[i], rStart, rEnd, i === 0);
        }
        seg.position.y = offsetY;
        pivot.add(seg);

        var next = new THREE.Group();
        next.position.y = spec.lengths[i];
        pivot.add(next);
        parent = next;
        if (isLast) {
          // Ancla de la yema en el vértice real de la bola (no en el nudillo):
          // es lo que se clava contra el globo.
          parent.userData.tipLift = apex - spec.lengths[i];
          parent.position.y = apex;
        }
      }
      tip = parent;

      // Uña sobre el dorso (-Z) de la última falange (solo índice y pulgar).
      // Las coordenadas son las de la malla de la yema, así que el translate
      // es exactamente el mismo que el de esa malla y la uña cae sobre el dedo.
      if (spec.nail && tipInfo) {
        var vis = tipInfo.L - tipInfo.seam;
        var yA = tipInfo.seam + vis * 0.22;   // cutillo
        var yB = tipInfo.seam + vis * 0.90;   // borde libre
        var nail = buildNail(tipInfo, yA, yB, 0.68, tipInfo.rCap * 0.05);
        nail.position.y = spec.lengths[spec.lengths.length - 1] / 2;
        parent.parent.add(nail);
      }

      group.userData.tipAnchor = tip;
      group.userData.pivots = pivots;
      return group;
    }

    var hand = new THREE.Group();

    // Antebrazo: tronco cónico que entra desde abajo y muñeca redondeada.
    var arm = new THREE.Mesh(new THREE.CylinderGeometry(1.02, 1.42, 7, 32), skinMaterial);
    arm.position.set(0.1, -4.4, -0.15);
    arm.castShadow = true;
    arm.receiveShadow = true;
    hand.add(arm);

    var cuff = new THREE.Mesh(new THREE.SphereGeometry(1.15, 28, 28), skinMaterial);
    cuff.scale.set(0.92, 0.5, 0.62);
    cuff.position.set(0.1, -2.6, -0.15);
    cuff.castShadow = true;
    hand.add(cuff);

    var wrist = new THREE.Mesh(new THREE.SphereGeometry(1.0, 30, 30), skinMaterial);
    wrist.scale.set(0.98, 0.72, 0.66);
    wrist.position.set(0.05, -1.35, -0.08);
    wrist.castShadow = true;
    hand.add(wrist);

    // Palma y eminencias tenar / hipotenar.
    var palm = new THREE.Mesh(new THREE.SphereGeometry(1.45, 34, 34), skinMaterial);
    palm.scale.set(1.0, 1.12, 0.5);
    palm.position.set(0, 0.32, 0);
    palm.castShadow = true;
    palm.receiveShadow = true;
    hand.add(palm);

    var thenar = new THREE.Mesh(new THREE.SphereGeometry(0.78, 28, 28), skinMaterial);
    thenar.scale.set(0.92, 1.18, 0.66);
    thenar.position.set(-0.86, -0.35, 0.2);
    thenar.castShadow = true;
    hand.add(thenar);

    var hypothenar = new THREE.Mesh(new THREE.SphereGeometry(0.62, 28, 28), skinMaterial);
    hypothenar.scale.set(0.82, 1.1, 0.56);
    hypothenar.position.set(0.86, -0.3, 0.12);
    hypothenar.castShadow = true;
    hand.add(hypothenar);

    // Membranas entre las raíces de los dedos.
    var web = new THREE.Mesh(new THREE.SphereGeometry(0.62, 24, 24), skinMaterial);
    web.scale.set(1.5, 0.5, 0.5);
    web.position.set(0.28, 1.28, 0.02);
    web.castShadow = true;
    hand.add(web);

    // Índice extendido: la yema sostiene el globo.
    var indexFinger = buildFinger({
      root: new THREE.Vector3(-0.7, 1.4, 0.04),
      radii: [0.35, 0.32, 0.285],
      lengths: [1.32, 0.88, 0.66],
      rot: [{ x: 0.02, z: -0.02 }, { x: 0, z: -0.01 }, { x: 0, z: -0.01 }],
      nail: true,
      spread: 0.04
    });
    hand.add(indexFinger);

    // Dedos cerrados: se curvan para apoyarse en la cara delantera de la
    // palma, a la altura de los nudillos (visibles, no enterrados en el brazo).
    var closedSpecs = [
      { root: new THREE.Vector3(-0.08, 1.42, 0.2), radii: [0.36, 0.33, 0.3], lengths: [1.28, 0.88, 0.66],
        rot: [{ x: 1.42 }, { x: 1.22 }, { x: 0.9 }], spread: 0.06 },
      { root: new THREE.Vector3(0.6, 1.3, 0.14), radii: [0.34, 0.31, 0.28], lengths: [1.22, 0.84, 0.62],
        rot: [{ x: 1.5 }, { x: 1.3 }, { x: 0.96 }], spread: -0.02 },
      { root: new THREE.Vector3(1.22, 0.94, 0.04), radii: [0.29, 0.26, 0.235], lengths: [1.0, 0.7, 0.54],
        rot: [{ x: 1.56 }, { x: 1.36 }, { x: 1.0 }], spread: -0.12 }
    ];
    var closedFingers = closedSpecs.map(function (spec) {
      var f = buildFinger(spec);
      hand.add(f);
      return f;
    });

    // Pulgar cruzado POR DELANTE de los dedos cerrados, apoyado en la palma.
    var thumbFinger = buildFinger({
      root: new THREE.Vector3(-0.8, -0.1, 0.78),
      groupRot: { z: -1.05, y: 0.7 },
      radii: [0.42, 0.38, 0.35],
      lengths: [0.88, 0.72, 0.56],
      rot: [{ x: 1.14 }, { x: 0.94 }, { x: 0.58 }],
      nail: true,
      nailSpin: -1.2
    });
    hand.add(thumbFinger);

    // Pivotes flexibles para absorber el impacto: el índice cede en cascada
    // (más en la punta), los dedos cerrados aprietan un poco y el pulgar
    // acompaña. Cada pivote guarda su rotación base en userData.baseRX.
    var flexPivots = [];
    function collect(finger, factors) {
      var ps = finger.userData.pivots || [];
      for (var i = 0; i < ps.length; i++) {
        flexPivots.push({ pivot: ps[i], flex: factors[Math.min(i, factors.length - 1)] });
      }
    }
    collect(indexFinger, [0.10, 0.16, 0.22]);
    closedFingers.forEach(function (f) { collect(f, [0.10, 0.14, 0.12]); });
    collect(thumbFinger, [0.05, 0.07, 0.07]);

    return {
      group: hand,
      tip: indexFinger.userData.tipAnchor,
      anchors: {
        index: indexFinger.userData.tipAnchor,
        middle: closedFingers[0].userData.tipAnchor,
        ring: closedFingers[1].userData.tipAnchor,
        pinky: closedFingers[2].userData.tipAnchor,
        thumb: thumbFinger.userData.tipAnchor
      },
      flexPivots: flexPivots
    };
  }

  // ── luces de estudio del demo ─────────────────────────────────────────
  function addLights() {
    scene.add(new THREE.AmbientLight(0xfff5ea, 0.62));

    var keyLight = new THREE.DirectionalLight(0xfffaee, 2.4);
    keyLight.position.set(7, 13, 11);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 32;
    keyLight.shadow.bias = -0.0001;
    scene.add(keyLight);

    var fillLight = new THREE.DirectionalLight(0x6f8cbb, 0.75);
    fillLight.position.set(-9, -3, 7);
    scene.add(fillLight);

    // Contra desde atrás: separa la silueta del fondo claro del mapa.
    var rimLight = new THREE.SpotLight(0xffffff, 5.2);
    rimLight.position.set(-5, 11, -13);
    rimLight.angle = Math.PI / 3;
    rimLight.penumbra = 0.85;
    scene.add(rimLight);

    // Luz cenital suave para que la palma no queme plana.
    var topLight = new THREE.DirectionalLight(0xfff8f0, 0.5);
    topLight.position.set(1, 14, 2);
    scene.add(topLight);
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
      flexPivots = hand.flexPivots;
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
      console.error('GLOBEHAND3D_BUILD_ERR', e && e.message, e && e.stack);
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

  function applyRestPose() {
    if (!handGroup) return;
    handGroup.position.y = BASE_HAND_Y;
    handGroup.rotation.z = 0;
    if (flexPivots) {
      for (var i = 0; i < flexPivots.length; i++) {
        flexPivots[i].pivot.rotation.x = flexPivots[i].pivot.userData.baseRX;
      }
    }
  }

  // Un frame de vida: respiración sutil + muelles del impacto.
  function applyPose(tt, dt) {
    if (!handGroup) return;
    stepSpring(springs.dip, dt);
    stepSpring(springs.lean, dt);
    stepSpring(springs.curl, dt);
    var curl = Math.max(0, Math.min(0.75, springs.curl.x));
    handGroup.position.y = BASE_HAND_Y + Math.sin(tt) * 0.04 + springs.dip.x;
    handGroup.rotation.z = Math.sin(tt * 0.8) * 0.01 + springs.lean.x;
    if (flexPivots) {
      for (var i = 0; i < flexPivots.length; i++) {
        var fp = flexPivots[i];
        fp.pivot.rotation.x = fp.pivot.userData.baseRX + curl * fp.flex;
      }
    }
  }

  // El guantazo: impulsos sobre los muelles, escalados con la fuerza del gesto.
  function impact(strength, dir) {
    var st = Math.max(0, Math.min(1, strength == null ? 0.5 : strength));
    var d = dir >= 0 ? 1 : -1;
    springs.dip.v -= 2.4 * st;    // la bola pesa: la mano cede y recupera
    springs.lean.v += d * 1.15 * st; // follow-through del golpe
    springs.curl.v += 5.5 * st;   // los dedos amortiguan la caída
  }

  function start() {
    if (!renderer) return;
    stop();
    running = true;
    startTime = now();
    lastFrameT = startTime;
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      applyRestPose();
      renderFrame();
      return;
    }
    var loop = function () {
      if (!running) return;
      rafId = requestAnimationFrame(loop);
      var t = now();
      var dt = Math.min(0.05, Math.max(0.001, (t - lastFrameT) / 1000));
      lastFrameT = t;
      applyPose((t - startTime) * 0.0015, dt);
      renderFrame();
    };
    rafId = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    resetSprings();
    applyRestPose();
  }

  function hardDispose() {
    try { if (renderer) { renderer.dispose(); renderer.forceContextLoss && renderer.forceContextLoss(); } } catch (e) {}
    renderer = null; scene = null; camera = null; handGroup = null; tipAnchor = null;
    fingerAnchors = null; flexPivots = null;
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
    impact: impact,
    start: start,
    stop: stop,
    dispose: dispose
  };
})();
