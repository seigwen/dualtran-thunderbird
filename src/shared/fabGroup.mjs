/**
 * The floating engine group shared by the reading pane and the compose window.
 *
 * Three buttons — Original | Google | AI — replace the single toggle the host
 * shipped first. Colours are the browser extension's `BTN_COLORS` verbatim so
 * the two products read as one design; "Google" and "AI" are brand/initialism
 * tokens and stay untranslated, "Original" comes from `btnOriginal`.
 */

const STYLE_ID = "dt-fab-style";
const ROOT_ID = "dt-fab-group";

const STYLE = `
.dt-fab-group{position:fixed;right:18px;bottom:18px;z-index:2147483000;display:flex;flex-direction:column;gap:6px;width:92px;padding:6px;box-sizing:border-box;background:#fff;border:1px solid #d1d5db;border-radius:12px;box-shadow:0 10px 24px rgba(15,23,42,.18);font:12px/1.4 system-ui,sans-serif}
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

/**
 * @param {Document} doc
 * @param {{ t: (key: string) => string,
 *           onTranslate: (engine: "google"|"ai") => void,
 *           onOriginal: () => void }} handlers
 */
export function mountFabGroup(doc, { t, onTranslate, onOriginal }) {
  injectStyle(doc);

  let root = doc.getElementById(ROOT_ID);
  if (!root) {
    root = doc.createElement("div");
    root.id = ROOT_ID;
    root.className = "dt-fab-group";
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
      root.appendChild(button);
    }
    (doc.body || doc.documentElement).appendChild(root);
  }

  const buttons = () => [...root.querySelectorAll(".dt-fab-btn")];
  const byEngine = (engine) => root.querySelector(`[data-engine="${engine}"]`);
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
