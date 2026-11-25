/**
 * The floating engine group shared by the reading pane and the compose window.
 *
 * Three buttons — Original | Google | AI — replace the single toggle the host
 * shipped first. Colours are the browser extension's `BTN_COLORS` verbatim so
 * the two products read as one design; "Google" and "AI" are brand/initialism
 * tokens and stay untranslated, "Original" comes from `btnOriginal`.
 *
 * Drag and resize mirror the browser extension: a grip at the top moves the
 * group, a bar on the left edge changes its width (48-240px). Both survive a
 * reopen because the layout is written to `storage.local.dtFabLayout`.
 */

const STYLE_ID = "dt-fab-style";
const ROOT_ID = "dt-fab-group";

const MIN_WIDTH = 48;
const MAX_WIDTH = 240;
const DEFAULT_WIDTH = 92;
const DEFAULT_OFFSET = 18;
const LAYOUT_KEY = "dtFabLayout";

const STYLE = `
.dt-fab-group{position:fixed;right:18px;bottom:18px;z-index:2147483000;display:flex;flex-direction:column;gap:6px;width:92px;min-width:48px;max-width:240px;padding:6px;box-sizing:border-box;background:#fff;border:1px solid #d1d5db;border-radius:12px;box-shadow:0 10px 24px rgba(15,23,42,.18);font:12px/1.4 system-ui,sans-serif}
.dt-fab-drag{height:12px;border-radius:999px;background:#f3f4f6;cursor:grab;display:flex;align-items:center;justify-content:center;flex:0 0 auto;touch-action:none}
.dt-fab-drag::after{content:"";width:22px;height:2px;border-radius:999px;background:#9ca3af}
.dt-fab-drag:active{cursor:grabbing}
.dt-fab-resize{position:absolute;left:-6px;top:22px;bottom:6px;width:12px;display:flex;align-items:center;justify-content:center;cursor:ew-resize;touch-action:none}
.dt-fab-resize::after{content:"";width:3px;height:26px;border-radius:999px;background:#cbd5e1}
.dt-fab-btn{padding:8px 10px;border-radius:8px;border:1px solid;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-sizing:border-box;width:100%}
.dt-fab-btn[data-engine="original"]{color:#6b7280;background:#f3f4f6;border-color:#d1d5db}
.dt-fab-btn[data-engine="google"]{color:#1d4ed8;background:#eff6ff;border-color:#bfdbfe}
.dt-fab-btn[data-engine="ai"]{color:#7c3aed;background:#f5f3ff;border-color:#ddd6fe}
.dt-fab-btn.active[data-engine="original"]{color:#fff;background:#374151;border-color:#374151}
.dt-fab-btn.active[data-engine="google"]{color:#fff;background:#1d4ed8;border-color:#1d4ed8}
.dt-fab-btn.active[data-engine="ai"]{color:#fff;background:#7c3aed;border-color:#7c3aed}
.dt-fab-btn:disabled{cursor:progress;opacity:.7}
.dt-fab-error{position:absolute;right:0;bottom:calc(100% + 8px);width:240px;padding:7px 9px;border-radius:8px;background:#fef2f2;border:1px solid #fecaca;color:#991b1b;font-size:11px;line-height:1.35;word-break:break-word;box-shadow:0 4px 12px rgba(15,23,42,.12)}
@media (prefers-color-scheme:dark){
.dt-fab-group{background:#1f2937;border-color:#374151}
.dt-fab-drag{background:#374151}
.dt-fab-drag::after{background:#6b7280}
.dt-fab-resize::after{background:#4b5563}
.dt-fab-btn[data-engine="original"]{color:#9ca3af;background:#374151;border-color:#4b5563}
.dt-fab-btn[data-engine="google"]{color:#93c5fd;background:#1e3a8a;border-color:#1d4ed8}
.dt-fab-btn[data-engine="ai"]{color:#c4b5fd;background:#4c1d95;border-color:#6d28d9}
.dt-fab-error{background:#450a0a;border-color:#7f1d1d;color:#fca5a5}
}
`;

const ENGINES = ["original", "google", "ai"];

function injectStyle(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLE;
  (doc.head || doc.documentElement).appendChild(style);
}

function buttonLabel(engine, t) {
  if (engine === "original") return t("btnOriginal");
  if (engine === "google") return "Google";
  return "AI";
}

function toNumber(value, fallback) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function applyLayout(root, layout) {
  if (!layout) return;
  if (Number.isFinite(layout.width)) {
    root.style.width = `${clamp(layout.width, MIN_WIDTH, MAX_WIDTH)}px`;
  }
  if (Number.isFinite(layout.right)) root.style.right = `${Math.max(0, layout.right)}px`;
  if (Number.isFinite(layout.bottom)) root.style.bottom = `${Math.max(0, layout.bottom)}px`;
}

function readLayout(storage) {
  if (!storage || typeof storage.get !== "function") return Promise.resolve(null);
  return Promise.resolve(storage.get({ [LAYOUT_KEY]: null }))
    .then((result) => (result && result[LAYOUT_KEY]) || null)
    .catch(() => null);
}

function saveLayout(storage, layout) {
  if (!storage || typeof storage.set !== "function") return;
  Promise.resolve(storage.set({ [LAYOUT_KEY]: layout })).catch(() => {});
}

/**
 * Wire the two grips. Listeners live on the document because a pointer that
 * leaves the 12px handle must keep driving the gesture.
 */
function installGestures(doc, root, storage) {
  const drag = doc.createElement("div");
  drag.className = "dt-fab-drag";
  drag.setAttribute("role", "separator");
  drag.setAttribute("aria-label", "Drag to move");

  const resize = doc.createElement("div");
  resize.className = "dt-fab-resize";
  resize.setAttribute("role", "separator");
  resize.setAttribute("aria-label", "Drag to resize");

  root.insertBefore(drag, root.firstChild);
  root.appendChild(resize);

  const layoutNow = () => ({
    width: toNumber(root.style.width, DEFAULT_WIDTH),
    right: toNumber(root.style.right, DEFAULT_OFFSET),
    bottom: toNumber(root.style.bottom, DEFAULT_OFFSET),
  });

  let gesture = null;

  const start = (mode, event) => {
    const layout = layoutNow();
    gesture =
      mode === "move"
        ? { mode, startX: event.clientX || 0, startY: event.clientY || 0, right: layout.right, bottom: layout.bottom }
        : { mode, startX: event.clientX || 0, width: layout.width };
    const handle = mode === "move" ? drag : resize;
    if (typeof handle.setPointerCapture === "function" && event.pointerId !== undefined) {
      try {
        handle.setPointerCapture(event.pointerId);
      } catch (_) {
        /* jsdom and older Gecko */
      }
    }
    if (typeof event.preventDefault === "function") event.preventDefault();
  };

  const move = (event) => {
    if (!gesture) return;
    if (gesture.mode === "move") {
      const dx = (event.clientX || 0) - gesture.startX;
      const dy = (event.clientY || 0) - gesture.startY;
      root.style.right = `${Math.max(0, gesture.right - dx)}px`;
      root.style.bottom = `${Math.max(0, gesture.bottom - dy)}px`;
    } else {
      // Pulling the left edge left makes the group wider.
      const dx = gesture.startX - (event.clientX || 0);
      root.style.width = `${clamp(gesture.width + dx, MIN_WIDTH, MAX_WIDTH)}px`;
    }
    if (typeof event.preventDefault === "function") event.preventDefault();
  };

  const end = () => {
    if (!gesture) return;
    gesture = null;
    saveLayout(storage, layoutNow());
  };

  drag.addEventListener("pointerdown", (event) => start("move", event));
  resize.addEventListener("pointerdown", (event) => start("resize", event));
  doc.addEventListener("pointermove", move);
  doc.addEventListener("pointerup", end);
  doc.addEventListener("pointercancel", end);

  return { drag, resize };
}

/**
 * @param {Document} doc
 * @param {{ t: (key: string) => string,
 *           onTranslate: (engine: "google"|"ai") => void,
 *           onOriginal: () => void,
 *           storage?: { get: Function, set: Function } }} handlers
 */
export function mountFabGroup(doc, { t, onTranslate, onOriginal, storage }) {
  injectStyle(doc);

  let root = doc.getElementById(ROOT_ID);
  if (!root) {
    root = doc.createElement("div");
    root.id = ROOT_ID;
    root.className = "dt-fab-group";
    // Inline defaults so a gesture can read the current values back; the
    // stylesheet only supplies the fallback look.
    root.style.right = `${DEFAULT_OFFSET}px`;
    root.style.bottom = `${DEFAULT_OFFSET}px`;
    root.style.width = `${DEFAULT_WIDTH}px`;
    (doc.body || doc.documentElement).appendChild(root);
    installGestures(doc, root, storage);
    readLayout(storage).then((layout) => applyLayout(root, layout));
  }

  // Buttons are (re)built after the grips so the grips stay at the edges.
  let buttonHost = root.querySelector(".dt-fab-buttons");
  if (!buttonHost) {
    buttonHost = doc.createElement("div");
    buttonHost.className = "dt-fab-buttons";
    buttonHost.style.cssText = "display:flex;flex-direction:column;gap:6px";
    for (const engine of ENGINES) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "dt-fab-btn";
      button.dataset.engine = engine;
      button.textContent = buttonLabel(engine, t);
      button.addEventListener("click", () => {
        // jsdom (and synthetic events generally) still dispatch on disabled
        // buttons; the browser does not. Guard here so both behave the same.
        if (button.disabled) return;
        if (engine === "original") onOriginal();
        else onTranslate(engine);
      });
      buttonHost.appendChild(button);
    }
    root.appendChild(buttonHost);
  }

  const buttons = () => [...root.querySelectorAll(".dt-fab-btn")];
  const clearError = () => {
    const old = root.querySelector(".dt-fab-error");
    if (old) old.remove();
  };
  const setActive = (engine) => {
    for (const button of buttons()) {
      button.classList.toggle("active", button.dataset.engine === engine);
    }
  };

  setActive("original");

  return {
    root,
    /** Disable the group and show the spinner label on the engine at work. */
    setBusy(engine) {
      clearError();
      setActive(engine);
      for (const button of buttons()) {
        button.disabled = true;
        if (button.dataset.engine === engine) button.textContent = t("btnTranslating");
      }
    },
    /** Back to the resting three-button state. */
    setIdle(engine = "original") {
      for (const button of buttons()) {
        button.disabled = false;
        button.textContent = buttonLabel(button.dataset.engine, t);
      }
      setActive(engine);
    },
    /** Localized message + the raw provider detail kept in the tooltip. */
    setError(message, detail) {
      clearError();
      for (const button of buttons()) {
        button.disabled = false;
        button.textContent = buttonLabel(button.dataset.engine, t);
      }
      const error = doc.createElement("div");
      error.className = "dt-fab-error";
      error.textContent = message;
      if (detail) error.setAttribute("title", detail);
      root.appendChild(error);
    },
    destroy() {
      root.remove();
    },
  };
}
