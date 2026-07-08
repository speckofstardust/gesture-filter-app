/**
 * trippy-filters.js
 *
 * Initializes a transparent PixiJS v7 Application on the existing #pixi-canvas
 * and exposes window.TrippyFilters with a small zone-management API:
 *
 *   addZone(id, rect, filterType)  — create a live-video sprite with a vivid filter
 *   removeZone(id)                 — destroy that sprite + filter
 *   clearAllZones()                — destroy all sprites + filters
 *   updateZoneRect(id, rect)       — reposition / resize an existing zone's sprite
 *
 * rect is always { x, y, w, h } in the same mirrored canvas pixel space that the
 * main #overlay canvas uses (i.e. matching what the user sees, not raw video coords).
 *
 * filterType is one of: 'glitch' | 'rgbSplit' | 'oldFilm' | 'crt' | 'twist' | 'zoomBlur'
 *
 * Assumes PIXI (pixi.js v7) and PIXI.filters (pixi-filters v5) are already on window
 * before this script runs. See the note at the bottom for the exact <script> tags.
 */

(function () {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────────────
  //
  // NOTE: The video element in this project has id="webcam", NOT "video".
  //       If you ever rename it in index.html, update this constant.
  const VIDEO_ID  = 'webcam';
  const CANVAS_ID = 'pixi-canvas';

  // ── Module state ───────────────────────────────────────────────────────────────

  let app          = null;   // PIXI.Application
  let videoBaseTex = null;   // PIXI.BaseTexture — shared by every zone sprite
  const zoneMap    = new Map(); // id → { sprite, filter, filterType }

  // ── Initialization ─────────────────────────────────────────────────────────────

  function init() {
    const pixiCanvas = document.getElementById(CANVAS_ID);
    if (!pixiCanvas) {
      console.error('[TrippyFilters] Cannot find #' + CANVAS_ID + ' in the DOM.');
      return;
    }

    const w = window.innerWidth;
    const h = window.innerHeight;
    pixiCanvas.width  = w;
    pixiCanvas.height = h;

    app = new PIXI.Application({
      view:            pixiCanvas,
      width:           w,
      height:          h,
      backgroundAlpha: 0,   // fully transparent — #overlay canvas shows through
      antialias:       false,
      resolution:      1,
    });

    // Build the shared video base texture now if the element exists.
    // autoPlay: false → we own the update cadence via the ticker below.
    const videoEl = document.getElementById(VIDEO_ID);
    if (videoEl) {
      videoBaseTex = PIXI.BaseTexture.from(videoEl, {
        resourceOptions: { autoPlay: false },
      });
    } else {
      console.warn('[TrippyFilters] #' + VIDEO_ID + ' not found at init time. ' +
                   'videoBaseTex will be created lazily when addZone() is first called.');
    }

    // Single ticker entry: upload the latest video frame and animate time-driven filters
    app.ticker.add(onTick);

    window.addEventListener('resize', onResize);
  }

  // ── Ticker ─────────────────────────────────────────────────────────────────────

  function onTick() {
    // Push the current decoded video frame to the GPU texture every PIXI tick.
    // PixiJS VideoResource marks itself dirty via update(); the GPU upload happens
    // automatically when the stage renders.
    if (videoBaseTex) {
      const res = videoBaseTex.resource;
      if (res && typeof res.update === 'function') res.update();
    }

    // Animate filters that need per-frame state changes to look alive
    for (const zone of zoneMap.values()) tickFilter(zone);
  }

  function onResize() {
    if (!app) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const c = document.getElementById(CANVAS_ID);
    if (c) { c.width = w; c.height = h; }
    app.renderer.resize(w, h);
    // Existing zone rects stay as-is; caller should re-add them if layout changed.
  }

  // ── Filter construction ────────────────────────────────────────────────────────

  function buildFilter(type, rect) {
    if (typeof PIXI === 'undefined' || !PIXI.filters) return null;

    // Center coordinates in the sprite's local pixel space (used by twist / zoomBlur)
    const cx = rect ? rect.w / 2 : 200;
    const cy = rect ? rect.h / 2 : 200;

    try {
      switch (type) {
        case 'glitch':
          return new PIXI.filters.GlitchFilter({
            slices: 8, offset: 20, fillMode: 4, seed: 0.5,
          });

        case 'rgbSplit':
          // Red shifted right, blue shifted left — classic chromatic aberration
          return new PIXI.filters.RGBSplitFilter([20, 0], [0, 0], [-20, 0]);

        case 'oldFilm':
          return new PIXI.filters.OldFilmFilter({
            sepia: 0.5, noise: 0.35, noiseSize: 2,
            scratch: 0.6, scratchDensity: 0.4, scratchWidth: 1,
            vignetting: 0.5, vignettingAlpha: 0.8, vignettingBlur: 0.3,
          });

        case 'crt':
          return new PIXI.filters.CRTFilter({
            curvature: 3, lineWidth: 4, lineContrast: 0.4,
            noise: 0.25, vignetting: 0.5, vignettingAlpha: 0.8,
          });

        case 'twist': {
          const f = new PIXI.filters.TwistFilter({
            angle:   5,
            radius:  Math.max(cx, cy) * 1.2,
            padding: 20,
          });
          return f;
        }

        case 'zoomBlur': {
          const f = new PIXI.filters.ZoomBlurFilter({ strength: 0.25, innerRadius: 0 });
          // Set center defensively — some pixi-filters versions use a Point, some an array
          if (f.center) {
            if (Array.isArray(f.center)) {
              f.center[0] = cx;
              f.center[1] = cy;
            } else if (typeof f.center === 'object') {
              f.center.x = cx;
              f.center.y = cy;
            }
          }
          return f;
        }

        default:
          console.warn('[TrippyFilters] Unknown filterType:', type);
          return null;
      }
    } catch (e) {
      console.warn('[TrippyFilters] Filter "' + type + '" unavailable:', e);
      return null;
    }
  }

  function tickFilter(zone) {
    if (!zone.filter) return;
    switch (zone.filterType) {
      case 'glitch':
        zone.filter.seed = Math.random();
        break;
      case 'oldFilm':
        zone.filter.seed = Math.random();
        break;
      case 'crt':
        zone.filter.time = (zone.filter.time || 0) + 0.5;
        break;
    }
  }

  // ── Sprite / rect helpers ──────────────────────────────────────────────────────
  //
  // The rect is in mirrored-canvas space (what the user sees).
  // The <video> element contains the raw, unmirrored camera feed.
  // Strategy:
  //   1. Map the mirrored canvas rect to the corresponding native-video region
  //      (flip the x-origin horizontally in video coordinates).
  //   2. Set sprite.scale.x negative to re-mirror the content on screen.
  //   3. Compensate sprite.x so the sprite still lands at rect.x on screen.
  //
  // This means the sprites match the exact region visible on the main #overlay canvas.

  function applyRect(sprite, rect) {
    const videoEl = document.getElementById(VIDEO_ID);
    const vw = (videoEl && videoEl.videoWidth)  || 1280;
    const vh = (videoEl && videoEl.videoHeight) || 720;
    const cw = app.renderer.width;
    const ch = app.renderer.height;

    // Native video coordinates of the zone (accounting for horizontal mirror)
    const frame = new PIXI.Rectangle(
      (cw - rect.x - rect.w) * (vw / cw),
      rect.y * (vh / ch),
      rect.w * (vw / cw),
      rect.h * (vh / ch),
    );
    sprite.texture.frame = frame;
    sprite.texture.updateUvs();

    // scale.x: negative flips the image; magnitude converts video px → canvas px
    // scale.y: positive, same conversion
    sprite.scale.x = -(cw / vw);
    sprite.scale.y =  (ch / vh);

    // With scale.x < 0 the sprite draws leftward from sprite.x, so push x to the
    // right edge of the zone so it fills [rect.x, rect.x + rect.w] correctly.
    sprite.x = rect.x + rect.w;
    sprite.y = rect.y;
  }

  // ── Public API ─────────────────────────────────────────────────────────────────

  /**
   * addZone(id, rect, filterType)
   *   id         — any string/number key; uniquely identifies this zone
   *   rect       — { x, y, w, h } in mirrored canvas pixel coordinates
   *   filterType — 'glitch' | 'rgbSplit' | 'oldFilm' | 'crt' | 'twist' | 'zoomBlur'
   */
  function addZone(id, rect, filterType) {
    removeZone(id); // replace silently if same id already exists

    if (!app) {
      console.warn('[TrippyFilters] Not yet initialized.');
      return;
    }

    // Lazily create the base texture if the video element wasn't ready at init() time
    if (!videoBaseTex) {
      const videoEl = document.getElementById(VIDEO_ID);
      if (!videoEl) {
        console.warn('[TrippyFilters] Cannot find #' + VIDEO_ID + '; zone not created.');
        return;
      }
      videoBaseTex = PIXI.BaseTexture.from(videoEl, { resourceOptions: { autoPlay: false } });
    }

    // Each zone gets its own Texture wrapper (UV frame) over the shared base texture
    const texture = new PIXI.Texture(videoBaseTex);
    const sprite  = new PIXI.Sprite(texture);

    applyRect(sprite, rect);

    const filter = buildFilter(filterType, rect);
    if (filter) sprite.filters = [filter];

    app.stage.addChild(sprite);
    zoneMap.set(id, { sprite, filter, filterType });
  }

  /**
   * removeZone(id)
   *   Removes the sprite from the stage and frees the per-zone Texture wrapper.
   *   The shared video BaseTexture is NOT destroyed.
   */
  function removeZone(id) {
    const zone = zoneMap.get(id);
    if (!zone || !app) return;
    app.stage.removeChild(zone.sprite);
    // Destroy the Texture UV wrapper only (false = keep the shared BaseTexture alive)
    zone.sprite.texture.destroy(false);
    zone.sprite.destroy({ texture: false, baseTexture: false });
    zoneMap.delete(id);
  }

  /**
   * clearAllZones()
   *   Equivalent to calling removeZone() on every current zone.
   */
  function clearAllZones() {
    for (const id of [...zoneMap.keys()]) removeZone(id);
  }

  /**
   * updateZoneRect(id, rect)
   *   Repositions and resizes the zone's sprite to the new rect without recreating
   *   it or changing the filter. Useful if zone coordinates drift (e.g. on resize).
   */
  function updateZoneRect(id, rect) {
    const zone = zoneMap.get(id);
    if (!zone || !app) return;
    applyRect(zone.sprite, rect);
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init(); // DOMContentLoaded already fired (e.g. script tag deferred / at body end)
  }

  window.TrippyFilters = { addZone, removeZone, clearAllZones, updateZoneRect };
}());
