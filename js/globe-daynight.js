var RAD = Math.PI / 180;

function subsolarPoint(date) {
  var jd = date.getTime() / 86400000 + 2440587.5;
  var T = (jd - 2451545) / 36525;
  var L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  var M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  var e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  var Mr = M * RAD;
  var C = Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T))
    + Math.sin(2 * Mr) * (0.019993 - 0.000101 * T)
    + Math.sin(3 * Mr) * 0.000289;
  var trueLong = L0 + C;
  var omega = 125.04 - 1934.136 * T;
  var lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  var e0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  var eps = e0 + 0.00256 * Math.cos(omega * RAD);
  var decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) / RAD;
  var y = Math.pow(Math.tan(eps * RAD / 2), 2);
  var L0r = L0 * RAD;
  var eqTime = 4 * (y * Math.sin(2 * L0r) - 2 * e * Math.sin(Mr)
    + 4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r)
    - 0.5 * y * y * Math.sin(4 * L0r)
    - 1.25 * e * e * Math.sin(2 * Mr)) / RAD;
  var utcHours = date.getUTCHours()
    + date.getUTCMinutes() / 60
    + date.getUTCSeconds() / 3600
    + date.getUTCMilliseconds() / 3600000;
  var lon = 15 * (12 - utcHours - eqTime / 60);
  lon = ((lon + 180) % 360 + 360) % 360 - 180;
  return { lat: decl, lon: lon };
}

function earthVector(point) {
  var lat = point.lat * RAD;
  var lon = point.lon * RAD;
  var cosLat = Math.cos(lat);
  return {
    x: cosLat * Math.cos(lon),
    y: Math.sin(lat),
    z: -cosLat * Math.sin(lon)
  };
}

export function createDayNightOverlay(wrapper, options) {
  var opts = options || {};
  var scale = Number(opts.scale) || 1.05;
  var color = opts.color || [3, 9, 26];
  var maxAlpha = opts.opacity == null ? 0.62 : opts.opacity;
  var maxResolution = opts.maxResolution || 480;
  var sunAge = opts.sunAge || 60000;

  var canvas = document.createElement('canvas');
  canvas.className = 'globe-daynight';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;';
  wrapper.appendChild(canvas);

  var ctx = canvas.getContext('2d');
  var off = document.createElement('canvas');
  var octx = off.getContext('2d');
  var image = null;
  var offSize = 0;
  var width = 0;
  var height = 0;
  var dpr = 1;
  var lastSun = -Infinity;
  var lastDraw = -Infinity;
  var lastPhi = Infinity;
  var lastTheta = Infinity;
  var sizeDirty = true;
  var sun = { x: 1, y: 0, z: 0 };

  function refreshSun(now) {
    if (now - lastSun < sunAge) return false;
    lastSun = now;
    sun = earthVector(subsolarPoint(new Date()));
    return true;
  }

  function resize() {
    if (!sizeDirty) return false;
    sizeDirty = false;
    var rect = wrapper.getBoundingClientRect();
    var nextWidth = Math.max(1, Math.round(rect.width));
    var nextHeight = Math.max(1, Math.round(rect.height));
    if (nextWidth === width && nextHeight === height) return false;
    width = nextWidth;
    height = nextHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    offSize = Math.max(32, Math.min(maxResolution, Math.round(0.8 * scale * height)));
    off.width = offSize;
    off.height = offSize;
    image = octx.createImageData(offSize, offSize);
    lastPhi = Infinity;
    lastTheta = Infinity;
    return true;
  }

  function shade(phi, theta) {
    var data = image.data;
    var size = offSize;
    var c = Math.cos(theta);
    var sTheta = Math.sin(theta);
    var d = Math.cos(phi);
    var sPhi = Math.sin(phi);
    var index = 0;
    for (var row = 0; row < size; row++) {
      var v = (row + 0.5) / size * 2 - 1;
      var hy = -v;
      for (var col = 0; col < size; col++) {
        var u = (col + 0.5) / size * 2 - 1;
        var radius2 = u * u + v * v;
        if (radius2 >= 1) {
          data[index + 3] = 0;
          index += 4;
          continue;
        }
        var hz = Math.sqrt(1 - radius2);
        var r0 = d * u + sPhi * sTheta * hy - sPhi * c * hz;
        var r1 = c * hy + sTheta * hz;
        var r2 = sPhi * u - d * sTheta * hy + d * c * hz;
        var light = r0 * sun.x + r1 * sun.y + r2 * sun.z;
        var t = (0.06 - light) / 0.18;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
        t = t * t * (3 - 2 * t);
        data[index] = color[0];
        data[index + 1] = color[1];
        data[index + 2] = color[2];
        data[index + 3] = Math.round(255 * maxAlpha * t);
        index += 4;
      }
    }
    octx.putImageData(image, 0, 0);
  }

  function draw() {
    var radius = 0.4 * scale * height;
    var left = (width / 2 - radius) * dpr;
    var top = (height / 2 - radius) * dpr;
    var side = 2 * radius * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, left, top, side, side);
  }

  function update(phi, theta, now) {
    var time = now == null ? performance.now() : now;
    var resized = resize();
    var sunChanged = refreshSun(time);
    var moved = phi !== lastPhi || theta !== lastTheta;
    if (!resized && !sunChanged && !moved) return;
    if (!resized && !sunChanged && time - lastDraw < 32) return;
    lastDraw = time;
    lastPhi = phi;
    lastTheta = theta;
    shade(phi, theta);
    draw();
  }

  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(function() {
      sizeDirty = true;
      lastPhi = Infinity;
    }).observe(wrapper);
  } else {
    window.addEventListener('resize', function() {
      sizeDirty = true;
      lastPhi = Infinity;
    });
  }

  update(0, 0);
  return { update: update, canvas: canvas };
}
