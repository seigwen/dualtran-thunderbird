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
 * Same rule for the floating engine group: only the AI button can be blocked,
 * and it is blocked exactly when no provider is stored. The Google button is
 * always live (no account, no key).
 */
export function applyGroupProviderState(group, settings, t) {
  const aiButton = group && group.root && group.root.querySelector('[data-engine="ai"]');
  if (!aiButton) return "";
  const blocked = !providerChosen(settings && settings.ai);
  const message = blocked ? (typeof t === "function" ? t("providerRequiredError") : "") || PROVIDER_REQUIRED_FALLBACK : "";
  aiButton.disabled = blocked;
  if (message) aiButton.setAttribute("title", message);
  else aiButton.removeAttribute("title");
  return message;
}
