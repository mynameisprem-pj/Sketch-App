'use strict';

/* ═══════════════════════════════════════════════════════
   TRACER SKETCH — app.js
   Modules:
     1. Service Worker (PWA offline)
     2. Router
     3. Toast
     4. IndexedDB / Gallery
     5. Image Processing Engine
     6. Sketch Studio
     7. Trace Module
     8. DOM event bindings & init
═══════════════════════════════════════════════════════ */


/* ─────────────────────────────────────────────────────
   1. SERVICE WORKER — offline PWA
───────────────────────────────────────────────────── */
(function registerSW() {
  if (!('serviceWorker' in navigator)) return;

  const swCode = `
    const CACHE = 'tracer-sketch-v1';
    self.addEventListener('install', e => {
      self.skipWaiting();
      e.waitUntil(caches.open(CACHE).then(c => c.addAll([self.registration.scope])));
    });
    self.addEventListener('activate', e => {
      e.waitUntil(clients.claim());
    });
    self.addEventListener('fetch', e => {
      e.respondWith(
        caches.match(e.request).then(r =>
          r || fetch(e.request).then(res => {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
            return res;
          }).catch(() => caches.match(e.request))
        )
      );
    });
  `;

  try {
    const blob = new Blob([swCode], { type: 'application/javascript' });
    const url  = URL.createObjectURL(blob);
    navigator.serviceWorker.register(url).catch(() => {});
  } catch (e) {}
})();


/* ─────────────────────────────────────────────────────
   2. ROUTER
───────────────────────────────────────────────────── */
let currentScreen = 'home';

function goTo(name) {
  if (name === currentScreen) return;

  const prev = document.getElementById('s-' + currentScreen);
  const next = document.getElementById('s-' + name);
  if (!prev || !next) return;

  prev.classList.remove('active');
  prev.classList.add('exit');
  setTimeout(() => prev.classList.remove('exit'), 320);

  next.classList.add('active');
  currentScreen = name;

  if (name === 'trace') {
    Trace.start();
  } else if (currentScreen !== 'trace') {
    Trace.stop();
  }
}


/* ─────────────────────────────────────────────────────
   3. TOAST
───────────────────────────────────────────────────── */
function toast(msg) {
  const wrap = document.getElementById('toast-wrap');
  const el   = document.createElement('div');
  el.className  = 'toast';
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}


/* ─────────────────────────────────────────────────────
   4. INDEXEDDB / GALLERY
───────────────────────────────────────────────────── */
let db = null;

function initDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('TracerSketch', 1);

    req.onupgradeneeded = e => {
      e.target.result.createObjectStore('sketches', {
        keyPath: 'id',
        autoIncrement: true
      });
    };

    req.onsuccess = e => { db = e.target.result; resolve(); };
    req.onerror   = reject;
  });
}

function dbSave(dataURL) {
  if (!db) return;
  const tx = db.transaction('sketches', 'readwrite');
  tx.objectStore('sketches').add({ dataURL, date: Date.now() });
}

function dbGetAll() {
  return new Promise(resolve => {
    if (!db) { resolve([]); return; }
    const req = db.transaction('sketches').objectStore('sketches').getAll();
    req.onsuccess = () => resolve((req.result || []).reverse());
    req.onerror   = () => resolve([]);
  });
}

function dbDelete(id) {
  if (!db) return;
  db.transaction('sketches', 'readwrite').objectStore('sketches').delete(id);
}

/* Open gallery bottom sheet */
async function openGallery() {
  const sheet = document.getElementById('gallery-sheet');
  sheet.classList.add('open');

  const items   = await dbGetAll();
  const content = document.getElementById('gallery-content');

  if (!items.length) {
    content.innerHTML = `
      <div class="gallery-empty-state">
        No saved sketches yet.<br>Save one from the Studio!
      </div>`;
    return;
  }

  content.innerHTML =
    '<div class="gallery-grid-g">' +
    items.map(item => `
      <div class="gallery-thumb" onclick="loadFromGallery('${item.dataURL}')">
        <img src="${item.dataURL}" loading="lazy" alt="Sketch">
        <button
          class="gallery-thumb-del"
          onclick="event.stopPropagation(); deleteGalleryItem(${item.id})"
        >✕</button>
      </div>
    `).join('') +
    '</div>';
}

/* Close gallery when tapping backdrop */
function closeGallery(e) {
  if (e.target === document.getElementById('gallery-sheet')) {
    document.getElementById('gallery-sheet').classList.remove('open');
  }
}

/* Load a gallery sketch directly into Trace Mode */
function loadFromGallery(dataURL) {
  document.getElementById('gallery-sheet').classList.remove('open');
  Trace.setSketch(dataURL);
  goTo('trace');
  toast('Sketch loaded ✓');
}

/* Delete a gallery item and refresh */
async function deleteGalleryItem(id) {
  dbDelete(id);
  toast('Deleted');
  await openGallery();
}


/* ─────────────────────────────────────────────────────
   5. IMAGE PROCESSING ENGINE
   Pure canvas-based algorithms — zero dependencies
───────────────────────────────────────────────────── */
const Engine = {

  MAX_SIZE: 900,

  /* Load image file → resize → return { data, w, h } */
  load(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        URL.revokeObjectURL(url);
        let w = img.naturalWidth;
        let h = img.naturalHeight;

        if (w > this.MAX_SIZE || h > this.MAX_SIZE) {
          if (w > h) { h = Math.round(h * this.MAX_SIZE / w); w = this.MAX_SIZE; }
          else       { w = Math.round(w * this.MAX_SIZE / h); h = this.MAX_SIZE; }
        }

        const canvas = document.getElementById('work-canvas');
        canvas.width  = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve({ data: canvas.getContext('2d').getImageData(0, 0, w, h), w, h });
      };

      img.onerror = reject;
      img.src     = url;
    });
  },

  /* RGB → grayscale Float32Array */
  toGray(d) {
    const g = new Float32Array(d.length >> 2);
    for (let i = 0; i < d.length; i += 4) {
      g[i >> 2] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    }
    return g;
  },

  /* Two-pass box blur */
  blur(src, w, h, radius) {
    const r   = Math.max(1, Math.round(radius));
    const tmp = new Float32Array(src.length);
    const dst = new Float32Array(src.length);

    // Horizontal pass
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0, cnt = 0;
        for (let d = -r; d <= r; d++) {
          const nx = x + d;
          if (nx >= 0 && nx < w) { sum += src[y * w + nx]; cnt++; }
        }
        tmp[y * w + x] = sum / cnt;
      }
    }

    // Vertical pass
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0, cnt = 0;
        for (let d = -r; d <= r; d++) {
          const ny = y + d;
          if (ny >= 0 && ny < h) { sum += tmp[ny * w + x]; cnt++; }
        }
        dst[y * w + x] = sum / cnt;
      }
    }

    return dst;
  },

  /* Sobel edge detection */
  sobel(g, w, h) {
    const out = new Float32Array(g.length);

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const gx =
          -g[(y-1)*w + (x-1)] + g[(y-1)*w + (x+1)]
          -2*g[y*w + (x-1)]   + 2*g[y*w + (x+1)]
          -g[(y+1)*w + (x-1)] + g[(y+1)*w + (x+1)];

        const gy =
           g[(y-1)*w + (x-1)] + 2*g[(y-1)*w + x] + g[(y-1)*w + (x+1)]
          -g[(y+1)*w + (x-1)] - 2*g[(y+1)*w + x] - g[(y+1)*w + (x+1)];

        out[y * w + x] = Math.sqrt(gx * gx + gy * gy);
      }
    }

    return out;
  },

  /* Pencil sketch: color-dodge blend */
  pencil(gray, w, h, blurRadius, darkMultiplier) {
    const inv = new Float32Array(gray.length);
    for (let i = 0; i < gray.length; i++) inv[i] = 255 - gray[i];

    const blurred = this.blur(inv, w, h, blurRadius);
    const out     = new Uint8ClampedArray(gray.length);

    for (let i = 0; i < gray.length; i++) {
      const b     = blurred[i];
      const dodge = b >= 255 ? 255 : Math.min(255, (gray[i] * 255) / (255 - b));
      out[i]      = Math.min(255, dodge + (255 - dodge) * (1 - darkMultiplier));
    }

    return out;
  },

  /* Ink sketch: sobel + threshold */
  ink(gray, w, h, threshold, detailScale) {
    const edges = this.sobel(gray, w, h);

    // Safe max — never use Math.max(...largeArray), causes stack overflow
    let maxVal = 0;
    for (let i = 0; i < edges.length; i++) {
      if (edges[i] > maxVal) maxVal = edges[i];
    }
    if (maxVal === 0) maxVal = 1;

    const norm = 255 / maxVal;
    const out  = new Uint8ClampedArray(gray.length);
    for (let i = 0; i < out.length; i++) {
      out[i] = edges[i] * norm * detailScale > threshold ? 0 : 255;
    }
    return out;
  },

  /* Charcoal: pencil base + noise grain */
  charcoal(gray, w, h, blurRadius, darkMultiplier, roughness) {
    const base = this.pencil(gray, w, h, blurRadius, darkMultiplier * 0.7);
    const out  = new Uint8ClampedArray(base.length);
    for (let i = 0; i < base.length; i++) {
      out[i] = Math.min(255, Math.max(0, base[i] * 0.82 + (Math.random() - 0.5) * roughness * 35));
    }
    return out;
  },

  /* Write grayscale output array into an ImageData */
  writeToImageData(values, imageData) {
    const d = imageData.data;
    for (let i = 0; i < values.length; i++) {
      const v = values[i], j = i * 4;
      d[j] = v; d[j+1] = v; d[j+2] = v; d[j+3] = 255;
    }
  }
};


/* ─────────────────────────────────────────────────────
   6. SKETCH STUDIO
───────────────────────────────────────────────────── */
const Studio = {

  src:        null,   // { data: ImageData, w, h }
  style:      'pencil',
  sketchURL:  null,
  _debounce:  null,

  async loadFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      toast('Please select an image file');
      return;
    }

    try {
      this.src = await Engine.load(file);

      // Draw original to canvas
      const oc = document.getElementById('orig-canvas');
      oc.width  = this.src.w;
      oc.height = this.src.h;
      oc.getContext('2d').putImageData(this.src.data, 0, 0);

      // Show preview section
      document.getElementById('preview-section').classList.remove('preview-hidden');
      document.getElementById('preview-section').style.display = 'flex';
      document.getElementById('preview-section').style.flexDirection = 'column';
      document.getElementById('upload-zone').style.display = 'none';

      await this.process();
    } catch (e) {
      toast('Could not load image');
    }
  },

  async process() {
    if (!this.src) return;

    const veil = document.getElementById('proc-veil');
    veil.classList.add('show');

    // Yield to browser so spinner renders before heavy work
    await new Promise(r => setTimeout(r, 30));

    const { data, w, h } = this.src;
    const gray    = Engine.toGray(data.data);
    const detail  = +document.getElementById('r-detail').value;
    const dark    = +document.getElementById('r-dark').value;
    const smooth  = +document.getElementById('r-smooth').value;

    let output;

    if (this.style === 'pencil') {
      output = Engine.pencil(gray, w, h, smooth * 2.5 + 3, dark / 10);
    } else if (this.style === 'ink') {
      output = Engine.ink(gray, w, h, (10 - detail) * 18 + 8, detail / 5);
    } else {
      output = Engine.charcoal(gray, w, h, smooth * 2 + 4, dark / 10, (10 - detail) / 10);
    }

    const result = new ImageData(w, h);
    Engine.writeToImageData(output, result);

    const sc = document.getElementById('sketch-canvas');
    sc.width  = w;
    sc.height = h;
    sc.getContext('2d').putImageData(result, 0, 0);

    this.sketchURL = sc.toDataURL('image/png');
    veil.classList.remove('show');
  },

  scheduleProcess() {
    clearTimeout(this._debounce);
    this._debounce = setTimeout(() => this.process(), 280);
  }
};

/* Studio: style pill handler */
function setStyle(el) {
  document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  Studio.style = el.dataset.s;
  Studio.scheduleProcess();
}

/* Studio: slider change handler */
function onCtrl() {
  document.getElementById('v-detail').textContent = document.getElementById('r-detail').value;
  document.getElementById('v-dark').textContent   = document.getElementById('r-dark').value;
  document.getElementById('v-smooth').textContent = document.getElementById('r-smooth').value;
  Studio.scheduleProcess();
}

/* Studio: send sketch to Trace Mode */
function useForTrace() {
  if (!Studio.sketchURL) { toast('Generate a sketch first'); return; }
  Trace.setSketch(Studio.sketchURL);
  goTo('trace');
}

/* Studio: save to gallery */
function saveSketch() {
  if (!Studio.sketchURL) { toast('No sketch yet'); return; }
  dbSave(Studio.sketchURL);
  toast('Saved to gallery ✓');
}

/* Studio: export as PNG download */
function exportSketch() {
  if (!Studio.sketchURL) { toast('No sketch yet'); return; }
  const a      = document.createElement('a');
  a.href       = Studio.sketchURL;
  a.download   = 'sketch-' + Date.now() + '.png';
  a.click();
  toast('Exported ✓');
}

/* Studio: reset to upload state */
function resetStudio() {
  Studio.src       = null;
  Studio.sketchURL = null;
  document.getElementById('preview-section').style.display = 'none';
  document.getElementById('upload-zone').style.display     = 'flex';
  document.getElementById('file-input').value              = '';
}

/* Sample sketch — draws a programmatic apple, runs through pencil engine */
function loadSampleSketch() {
  const c   = document.getElementById('work-canvas');
  c.width   = 400;
  c.height  = 460;
  const ctx = c.getContext('2d');

  // Radial-gradient apple
  const gr = ctx.createRadialGradient(160, 140, 20, 200, 200, 200);
  gr.addColorStop(0,   '#e0e0e0');
  gr.addColorStop(0.4, '#a0a0a0');
  gr.addColorStop(1,   '#404040');

  ctx.beginPath();
  ctx.moveTo(200, 80);
  ctx.bezierCurveTo(120, 78,  80, 130,  80, 200);
  ctx.bezierCurveTo(80,  280, 120, 360, 200, 370);
  ctx.bezierCurveTo(280, 360, 320, 280, 320, 200);
  ctx.bezierCurveTo(320, 130, 280, 78,  200, 80);
  ctx.closePath();
  ctx.fillStyle = gr;
  ctx.fill();

  // Stem
  ctx.strokeStyle = '#5a4030';
  ctx.lineWidth   = 5;
  ctx.beginPath();
  ctx.moveTo(200, 80);
  ctx.quadraticCurveTo(210, 50, 225, 55);
  ctx.stroke();

  // Leaf
  ctx.fillStyle = '#808070';
  ctx.beginPath();
  ctx.moveTo(200, 78);
  ctx.quadraticCurveTo(225, 55, 235, 68);
  ctx.quadraticCurveTo(220, 80, 200, 78);
  ctx.closePath();
  ctx.fill();

  // Run pencil sketch on it
  const imgData = ctx.getImageData(0, 0, 400, 460);
  const gray    = Engine.toGray(imgData.data);
  const out     = Engine.pencil(gray, 400, 460, 14, 0.5);
  const result  = new ImageData(400, 460);
  Engine.writeToImageData(out, result);
  ctx.putImageData(result, 0, 0);

  const sampleURL = c.toDataURL('image/png');
  Trace.setSketch(sampleURL);
  goTo('trace');
  toast('Sample sketch loaded ✓');
}


/* ─────────────────────────────────────────────────────
   7. TRACE MODULE
───────────────────────────────────────────────────── */
const Trace = {

  sketchImg:   null,
  sketchURL:   null,
  stream:      null,
  raf:         null,
  wakeLock:    null,
  facingMode:  'environment',

  // Overlay transform state
  opacity:   0.6,
  thickness: 1,
  flipH:     false,
  flipV:     false,
  rotation:  0,
  gridOn:    false,
  locked:    false,

  // Pan/zoom via touch
  panX:      0,
  panY:      0,
  zoom:      1,
  dragging:  false,
  lastX:     0,
  lastY:     0,
  pinchDist: null,
  pinchZoom: 1,

  /* Load a sketch dataURL into an Image element */
  setSketch(dataURL) {
    this.sketchURL = dataURL;
    const img  = new Image();
    img.onload = () => { this.sketchImg = img; };
    img.src    = dataURL;
  },

  /* Called when entering Trace screen */
  async start() {
    const emptyEl = document.getElementById('trace-empty');
    emptyEl.style.display = this.sketchImg ? 'none' : 'flex';
    if (!this.sketchImg) return;

    document.getElementById('cam-error').classList.remove('show');
    await this.startCamera();
    this.acquireWakeLock();
    this.setupTouch();
    this.renderLoop();
  },

  /* Stop camera + RAF when leaving Trace screen */
  stop() {
    cancelAnimationFrame(this.raf);
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    if (this.wakeLock) {
      this.wakeLock.release().catch(() => {});
      this.wakeLock = null;
    }
  },

  /* Request camera access */
  async startCamera() {
    try {
      if (this.stream) this.stream.getTracks().forEach(t => t.stop());

      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: this.facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });

      const video    = document.getElementById('cam-video');
      video.srcObject = this.stream;
      await video.play();
    } catch (e) {
      document.getElementById('cam-error').classList.add('show');
    }
  },

  /* Keep screen on while tracing */
  async acquireWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        this.wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch (e) {}
  },

  /* 60fps render: camera + sketch overlay */
  renderLoop() {
    const vp      = document.getElementById('trace-vp');
    const camC    = document.getElementById('cam-canvas');
    const ovC     = document.getElementById('overlay-canvas');
    const video   = document.getElementById('cam-video');

    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      const W = vp.clientWidth;
      const H = vp.clientHeight;

      /* ── Camera frame ── */
      if (video.readyState >= 2) {
        camC.width  = W;
        camC.height = H;
        const ctx = camC.getContext('2d');
        ctx.save();
        ctx.translate(W / 2, H / 2);
        const vw = video.videoWidth  || 1;
        const vh = video.videoHeight || 1;
        const sc = Math.max(W / vw, H / vh);
        ctx.drawImage(video, -vw * sc / 2, -vh * sc / 2, vw * sc, vh * sc);
        ctx.restore();
      }

      /* ── Sketch overlay ── */
      if (!this.sketchImg || this.locked) return;

      ovC.width  = W;
      ovC.height = H;
      const ctx  = ovC.getContext('2d');
      ctx.clearRect(0, 0, W, H);

      ctx.save();
      ctx.globalAlpha = this.opacity;
      ctx.translate(W / 2 + this.panX, H / 2 + this.panY);
      ctx.rotate(this.rotation * Math.PI / 180);
      if (this.flipH) ctx.scale(-1,  1);
      if (this.flipV) ctx.scale( 1, -1);

      const sw   = this.sketchImg.naturalWidth;
      const sh   = this.sketchImg.naturalHeight;
      const base = Math.min(W / sw, H / sh);
      const s    = base * this.zoom;

      if (this.thickness > 1) {
        ctx.filter = `blur(${(this.thickness - 1) * 0.8}px) contrast(12)`;
      }
      ctx.drawImage(this.sketchImg, -sw * s / 2, -sh * s / 2, sw * s, sh * s);
      ctx.restore();

      /* ── Grid overlay ── */
      if (this.gridOn) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth   = 1;
        for (let x = W / 3; x < W; x += W / 3) {
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        }
        for (let y = H / 3; y < H; y += H / 3) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        }
        ctx.restore();
      }
    };

    loop();
  },

  /* Touch: single-finger pan, two-finger pinch-zoom */
  setupTouch() {
    const vp = document.getElementById('trace-vp');

    vp.addEventListener('touchstart', e => {
      if (e.touches.length === 1) {
        this.dragging = true;
        this.lastX    = e.touches[0].clientX;
        this.lastY    = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        this.dragging = false;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        this.pinchDist = Math.sqrt(dx * dx + dy * dy);
        this.pinchZoom = this.zoom;
      }
      e.preventDefault();
    }, { passive: false });

    vp.addEventListener('touchmove', e => {
      if (e.touches.length === 1 && this.dragging && !this.locked) {
        this.panX += e.touches[0].clientX - this.lastX;
        this.panY += e.touches[0].clientY - this.lastY;
        this.lastX  = e.touches[0].clientX;
        this.lastY  = e.touches[0].clientY;
      } else if (e.touches.length === 2 && this.pinchDist && !this.locked) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const d  = Math.sqrt(dx * dx + dy * dy);
        this.zoom = Math.min(4, Math.max(0.2, this.pinchZoom * d / this.pinchDist));
      }
      e.preventDefault();
    }, { passive: false });

    vp.addEventListener('touchend', () => {
      this.dragging  = false;
      this.pinchDist = null;
    });
  }
};

/* Trace control handlers */
function setOpacity(v) {
  Trace.opacity = v / 100;
  document.getElementById('v-opacity').textContent = v + '%';
}

function setThickness(v) {
  Trace.thickness = +v;
  document.getElementById('v-thick').textContent = v;
}

function rotateSketch() {
  Trace.rotation = (Trace.rotation + 90) % 360;
  toast('Rotated ' + Trace.rotation + '°');
}

function toggleFlipH() {
  Trace.flipH = !Trace.flipH;
  document.getElementById('btn-flip-h').classList.toggle('on', Trace.flipH);
}

function toggleFlipV() {
  Trace.flipV = !Trace.flipV;
  document.getElementById('btn-flip-v').classList.toggle('on', Trace.flipV);
}

function toggleGrid() {
  Trace.gridOn = !Trace.gridOn;
  document.getElementById('btn-grid').classList.toggle('on', Trace.gridOn);
}

function toggleLock() {
  Trace.locked = !Trace.locked;
  const btn    = document.getElementById('btn-lock');
  btn.textContent = Trace.locked ? '🔒 Reference Locked' : 'Lock Reference';
  btn.classList.toggle('locked', Trace.locked);
  toast(Trace.locked ? 'Locked — now draw!' : 'Reference unlocked');
}

function flipCamera() {
  Trace.facingMode = Trace.facingMode === 'environment' ? 'user' : 'environment';
  Trace.startCamera();
}

function exitTrace() {
  Trace.stop();
  goTo('home');
}


/* ─────────────────────────────────────────────────────
   8. DOM EVENT BINDINGS & INIT
───────────────────────────────────────────────────── */

/* File input change */
document.getElementById('file-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) Studio.loadFile(file);
});

/* Drag-and-drop onto upload zone */
const uploadZone = document.getElementById('upload-zone');

uploadZone.addEventListener('dragover', e => {
  e.preventDefault();
  uploadZone.classList.add('drag');
});

uploadZone.addEventListener('dragleave', () => {
  uploadZone.classList.remove('drag');
});

uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.classList.remove('drag');
  const file = e.dataTransfer.files[0];
  if (file) Studio.loadFile(file);
});

/* Initialise IndexedDB on load */
initDB().catch(() => {});