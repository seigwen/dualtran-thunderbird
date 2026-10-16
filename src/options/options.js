(() => {
  const api = globalThis.messenger ?? globalThis.browser;
  const t = (key) => api.i18n.getMessage(key) || key;

  for (const el of document.querySelectorAll("[data-i18n]")) {
    el.textContent = t(el.dataset.i18n);
  }

  const $ = (id) => document.getElementById(id);
  const engineSel = $("engine");
  const aiFields = $("ai-fields");

  function renderAiVisibility() {
    aiFields.hidden = engineSel.value !== "ai";
  }
  engineSel.addEventListener("change", renderAiVisibility);

  (async () => {
    const stored = (await api.storage.local.get({ dtSettings: {} })).dtSettings || {};
    $("targetLang").value = stored.targetLang || "en";
    engineSel.value = stored.engine || "google";
    const ai = stored.ai || {};
    $("provider").value = ai.provider || "openai";
    $("apiKey").value = ai.apiKey || "";
    $("model").value = ai.model || "gpt-4o-mini";
    $("baseURL").value = ai.baseURL || "";
    renderAiVisibility();
  })();

  $("save").addEventListener("click", async () => {
    const patch = {
      targetLang: $("targetLang").value,
      engine: engineSel.value,
      ai: {
        provider: $("provider").value.trim() || "openai",
        apiKey: $("apiKey").value.trim(),
        model: $("model").value.trim() || "gpt-4o-mini",
        baseURL: $("baseURL").value.trim(),
      },
    };
    await api.runtime.sendMessage({ command: "dt-save-settings", patch });
    $("status").textContent = t("optionSaved");
    setTimeout(() => ($("status").textContent = ""), 2500);
  });
})();
