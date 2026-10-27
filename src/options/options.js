(() => {
  const api = globalThis.messenger ?? globalThis.browser;
  const t = (key) => api.i18n.getMessage(key) || key;

  for (const el of document.querySelectorAll("[data-i18n]")) {
    el.textContent = t(el.dataset.i18n);
  }

  const $ = (id) => document.getElementById(id);
  const engineSel = $("engine");
  const aiFields = $("ai-fields");
  const providerSel = $("provider");
  const modelSel = $("modelSelect");
  const modelInput = $("model");
  const customLabel = $("customModelLabel");
  const reasoningSel = $("reasoning");
  const CUSTOM_MODEL = "__custom__";
  const MORE_DIVIDER = "__separator__";
  const CATALOG_KEY = "dtCatalog";
  const CATALOG_TTL = 24 * 60 * 60 * 1000;

  /** Projected models.dev data: { providers, modelsById, reasoning }. */
  let catalog = { providers: [], modelsById: {}, reasoning: {} };
  let providerList = [];

  async function loadCatalog() {
    const stored = (await api.storage.local.get({ [CATALOG_KEY]: null }))[CATALOG_KEY];
    if (stored && Date.now() - stored.ts < CATALOG_TTL) {
      catalog = stored.data;
      return;
    }
    try {
      const res = await fetch(DualTranCatalog.MODELS_DEV_URL);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = DualTranCatalog.projectCatalog(await res.json());
      await api.storage.local.set({ [CATALOG_KEY]: { ts: Date.now(), data } });
      catalog = data;
    } catch (_) {
      catalog = (stored && stored.data) || { providers: [], modelsById: {}, reasoning: {} };
    }
  }

  function providerById(id) {
    return providerList.find((provider) => provider.id === id);
  }

  function devIdFor(providerId) {
    const builtIn = DualTranCatalog.BUILTINS.find((entry) => entry.id === providerId);
    return builtIn ? builtIn.dev : providerId;
  }

  function selectedModel() {
    return modelSel.value === CUSTOM_MODEL ? modelInput.value.trim() : modelSel.value;
  }

  function reasoningLevels() {
    const levels = catalog.reasoning[devIdFor(providerSel.value)] || {};
    return levels[selectedModel()] || [];
  }

  function renderProviders(selectedId) {
    providerList = DualTranCatalog.buildProviderList(catalog.providers, catalog.modelsById);
    providerSel.innerHTML = "";
    let dividerAdded = false;
    for (const provider of providerList) {
      if (!provider.builtIn && !dividerAdded) {
        const divider = document.createElement("option");
        divider.disabled = true;
        divider.value = MORE_DIVIDER;
        divider.textContent = "──── " + t("optionMore") + " ────";
        providerSel.appendChild(divider);
        dividerAdded = true;
      }
      const option = document.createElement("option");
      option.value = provider.id;
      option.textContent = provider.name;
      providerSel.appendChild(option);
    }
    const known = providerList.some((provider) => provider.id === selectedId);
    providerSel.value = known ? selectedId : "openai";
  }

  function toggleCustomModel() {
    const custom = modelSel.value === CUSTOM_MODEL;
    modelInput.hidden = !custom;
    customLabel.hidden = !custom;
  }

  function renderModels(selectedModelId) {
    const provider = providerById(providerSel.value);
    const models = (provider && provider.models) || [];
    modelSel.innerHTML = "";
    for (const model of models) {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = model.label;
      modelSel.appendChild(option);
    }
    const custom = document.createElement("option");
    custom.value = CUSTOM_MODEL;
    custom.textContent = t("optionCustomModel");
    modelSel.appendChild(custom);

    const known = models.some((model) => model.id === selectedModelId);
    if (known) modelSel.value = selectedModelId;
    else if (selectedModelId) modelSel.value = CUSTOM_MODEL;
    else modelSel.value = models.length ? models[0].id : CUSTOM_MODEL;
    if (modelSel.value === CUSTOM_MODEL) modelInput.value = selectedModelId || "";
    toggleCustomModel();
  }

  function renderReasoning(selected) {
    const levels = reasoningLevels();
    const values = DualTranCatalog.LEVEL_ORDER.filter((level) => levels.includes(level));
    reasoningSel.innerHTML = "";
    const entries = [["lowest", t("optionReasoningLowest")], ["", t("optionReasoningDefault")]].concat(
      values.map((level) => [level, level])
    );
    for (const [value, label] of entries) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      reasoningSel.appendChild(option);
    }
    const known = entries.some(([value]) => value === selected);
    reasoningSel.value = known ? selected : "lowest";
  }

  function renderAiVisibility() {
    aiFields.hidden = engineSel.value !== "ai";
  }
  engineSel.addEventListener("change", renderAiVisibility);

  (async () => {
    await loadCatalog();
    const stored = (await api.storage.local.get({ dtSettings: {} })).dtSettings || {};
    $("targetLang").value = stored.targetLang || "en";
    engineSel.value = stored.engine || "google";
    const ai = stored.ai || {};
    renderProviders(ai.provider || "openai");
    $("apiKey").value = ai.apiKey || "";
    renderModels(ai.model || "");
    renderReasoning(ai.reasoning || "lowest");
    $("baseURL").value = ai.baseURL || "";
    renderAiVisibility();
  })();

  providerSel.addEventListener("change", () => {
    renderModels("");
    renderReasoning(reasoningSel.value);
  });
  modelSel.addEventListener("change", () => {
    toggleCustomModel();
    renderReasoning(reasoningSel.value);
  });
  modelInput.addEventListener("input", () => renderReasoning(reasoningSel.value));

  $("save").addEventListener("click", async () => {
    const patch = {
      targetLang: $("targetLang").value,
      engine: engineSel.value,
      ai: {
        provider: providerSel.value,
        reasoning: reasoningSel.value,
        apiKey: $("apiKey").value.trim(),
        model: selectedModel() || "gpt-4o-mini",
        baseURL: $("baseURL").value.trim(),
      },
    };
    await api.runtime.sendMessage({ command: "dt-save-settings", patch });
    $("status").textContent = t("optionSaved");
    setTimeout(() => ($("status").textContent = ""), 2500);
  });
})();
