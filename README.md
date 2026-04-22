# Tracer Sketch

> Trace anything. Draw simply.

A lightweight offline PWA that converts any photo into a clean sketch, then lets you trace it onto real paper using your phone as a transparent overlay — a modern take on the classic [Camera Lucida](https://en.wikipedia.org/wiki/Camera_lucida).

---

## How It Works

1. **Upload** any photo from your device
2. **Convert** it to a pencil, ink, or charcoal sketch using on-device processing
3. **Place** your phone on a glass sheet elevated above paper
4. **Trace** the sketch overlay onto the paper below

---

## Features

- ✏️ **3 sketch styles** — Pencil, Ink, Charcoal
- 🎛️ **Adjustable** detail, darkness, and smoothness
- 🔍 **Trace Mode** — live camera + sketch overlay at adjustable opacity
- 👆 **Touch controls** — drag to pan, pinch to zoom, rotate, flip
- ⊞ **Grid overlay** — helps with proportions while drawing
- 🔒 **Lock Reference** — freezes sketch position so you can draw freely
- 🖼️ **Local gallery** — saves sketches to your device via IndexedDB
- ⬇️ **Export** sketches as PNG
- 📴 **100% offline** — no server, no account, no data ever leaves your device

---

## Tech Stack

| Concern | Solution |
|---|---|
| UI | Vanilla HTML, CSS, JS — no framework |
| Sketch engine | Canvas API (Color Dodge, Sobel edge detection) |
| Offline | Service Worker + Cache API |
| Storage | IndexedDB |
| Camera | `getUserMedia` + `requestAnimationFrame` |
| Screen-on | Wake Lock API |

---

## Getting Started

No build step required. Just open the files in a browser.

```bash
# Option 1 — any static server
npx serve .

# Option 2 — Python
python -m http.server 5500

# Option 3 — VS Code
# Install "Live Server" extension → right-click index.html → Open with Live Server
```

Then visit `http://localhost:5500` and optionally tap **Add to Home Screen** to install as a PWA.

---

## File Structure

```
tracer-sketch/
├── index.html   # Markup — 3 screens (Home, Studio, Trace)
├── style.css    # All styles, organized by screen
└── app.js       # All logic (router, engine, studio, trace, gallery)
```

---

## Privacy

Everything runs on your device. No images, sketches, or data are ever uploaded anywhere.

---

## License

MIT