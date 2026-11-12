/**
 * SPEC 2.1 — the unconfigured-AI state shared by the in-mail buttons.
 *
 * A fresh install has no AI provider (`""`). The reading-pane and compose
 * buttons are the primary action on those surfaces, so instead of letting a
 * click fail they are disabled and explain, in the user's language, what is
 * missing. The text is the same `providerRequiredError` the background and the
 * engine return, so every surface says one thing.
 *
 * No fallback provider is ever guessed here: the button asks the background
 * for the stored settings and stays shut until a provider is actually chosen.
 */

/** English source string: used when the catalogue lookup yields nothing. */
export const PROVIDER_REQUIRED_FALLBACK = "Choose an AI provider in settings before translating.";

/** Same rule as engine.isProviderChosen: only a non-blank string is a pick. */
export function providerChosen(ai) {
  return typeof (ai && ai.provider) === "string" && ai.provider.trim() !== "";
}

/**
 * The tooltip a primary button carries right now: empty when translating can
 * proceed, `providerRequiredError` when the AI engine has no provider yet.
 */
export function providerBlockMessage(settings, t) {
  const engine = settings && settings.engine;
  if (engine !== "ai") return "";
  if (providerChosen(settings.ai)) return "";
  const text = typeof t === "function" ? t("providerRequiredError") : "";
  return text || PROVIDER_REQUIRED_FALLBACK;
}

/** Ask the background for the stored settings; never throws. */
export async function readSettings(browser) {
  try {
    const response = await browser.runtime.sendMessage({ command: "dt-settings" });
    return (response && response.settings) || {};
  } catch (_) {
    return {};
  }
}

/**
 * Put the button into the state its settings imply. Returns the tooltip text
 * that was applied ("" when the button is live), so callers can log/persist.
 */
export function applyProviderState(button, settings, t) {
  const message = providerBlockMessage(settings, t);
  button.disabled = message !== "";
  if (message) button.setAttribute("title", message);
  else button.removeAttribute("title");
  return message;
}
