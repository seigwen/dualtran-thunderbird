(() => {
  const api = globalThis.messenger ?? globalThis.browser;
  const t = (key) => api.i18n.getMessage(key) || key;

  for (const el of document.querySelectorAll("[data-i18n]")) {
    el.textContent = t(el.dataset.i18n);
  }

  const $ = (id) => document.getElementById(id);
  const engineSel = $("engine");
  const aiFields = $("ai-fields");
  const langSel = $("targetLang");
  const providerSel = $("provider");
  const modelSel = $("modelSelect");
  const modelInput = $("model");
  const customLabel = $("customModelLabel");
  const reasoningSel = $("reasoning");
  const baseInput = $("baseURL");
  const CUSTOM_MODEL = "__custom__";
  const CATALOG_KEY = "dtCatalog";
  const CATALOG_TTL = 24 * 60 * 60 * 1000;
  const LABEL_ORDER = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

  /** Projected models.dev data: { providers, modelsById, reasoning }. */
  let catalog = { providers: [], modelsById: {}, reasoning: {} };
  let providerList = [];
  let providerApi = new Map();
  /** True once the endpoint holds something the user typed: stops the autofill. */
  let endpointDirty = false;
  /** Last real pick, so the disabled placeholder can never win a revert. */
  let lastProvider = "";

  function renderLanguages(selected) {
    langSel.innerHTML = "";
    for (const language of DualTranLanguages.languageOptions()) {
      const option = document.createElement("option");
      option.value = language.value;
      option.textContent = language.label;
      langSel.appendChild(option);
    }
    langSel.value = DualTranLanguages.normalizeCode(selected);
  }

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
    // One flat list: built-ins and the catalogue merged, alias twins removed by
    // the catalog layer, ordered by what the user actually reads.
    providerList.sort((a, b) => LABEL_ORDER.compare(a.name, b.name));
    providerApi = new Map(providerList.map((provider) => [provider.id, provider.api]));
    providerSel.innerHTML = "";
    // SPEC 2.1: the empty pick is a disabled placeholder, not a provider. It
    // leads the list so a fresh install shows what to do, but it is never
    // sorted in and never offered as a choice (an empty provider stays empty;
    // the user cannot return to it after picking one).
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = t("providerPlaceholder");
    placeholder.disabled = true;
    providerSel.appendChild(placeholder);
    for (const provider of providerList) {
      const option = document.createElement("option");
      option.value = provider.id;
      option.textContent = provider.name;
      providerSel.appendChild(option);
    }
    // Stored values are never rewritten: an unknown id still shows as empty
    // rather than silently becoming some other provider.
    const known = providerList.some((provider) => provider.id === selectedId);
    providerSel.value = known ? selectedId : "";
  }

  function providerChosen() {
    return providerSel.value !== "";
  }

  /** Autofill the endpoint for the current provider unless the user owns the value. */
  function syncEndpoint() {
    if (endpointDirty) return;
    baseInput.value = providerChosen() ? DualTranCatalog.endpointFor(providerSel.value, providerApi.get(providerSel.value)) : "";
  }

  /** Placeholder of the endpoint field: bare scheme until a provider exists. */
  function renderEndpointPlaceholder() {
    baseInput.placeholder = providerChosen() ? "" : "https://";
  }

  function toggleCustomModel() {
    const custom = providerChosen() && modelSel.value === CUSTOM_MODEL;
    modelInput.hidden = !custom;
    customLabel.hidden = !custom;
  }

  function renderModels(selectedModelId) {
    const provider = providerById(providerSel.value);
    const models = providerChosen() && provider ? provider.models.slice().sort((a, b) => LABEL_ORDER.compare(a.label, b.label)) : [];
    modelSel.innerHTML = "";
    if (!providerChosen()) {
      // Nothing to choose from until a provider is picked: one disabled row
      // says so, and the custom-model entry stays out of the way.
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = t("providerRequiredForModel");
      modelSel.appendChild(placeholder);
      modelSel.disabled = true;
      modelSel.value = "";
      modelInput.hidden = true;
      customLabel.hidden = true;
      return;
    }
    modelSel.disabled = false;
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
    const levels = providerChosen() ? reasoningLevels() : [];
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
    // SPEC 2.1: disabled until a provider is picked, but the stored sentinel
    // (`lowest`) is kept — the picker never invents a concrete level.
    reasoningSel.disabled = !providerChosen();
  }

  function renderAiVisibility() {
    aiFields.hidden = engineSel.value !== "ai";
  }
  engineSel.addEventListener("change", renderAiVisibility);

  (async () => {
    await loadCatalog();
    const stored = (await api.storage.local.get({ dtSettings: {} })).dtSettings || {};
    engineSel.value = stored.engine || "google";
    const ai = stored.ai || {};
    // SPEC 2.1: no `|| "openai"` — an unset provider stays unset.
    renderProviders(ai.provider || "");
    renderLanguages(stored.targetLang);
    $("apiKey").value = ai.apiKey || "";
    renderModels(ai.model || "");
    renderReasoning(ai.reasoning || "lowest");
    // A stored endpoint is the user's own choice; otherwise show the provider's.
    baseInput.value = ai.baseURL || "";
    endpointDirty = Boolean(ai.baseURL);
    renderEndpointPlaceholder();
    syncEndpoint();
    renderAiVisibility();
  })();

  providerSel.addEventListener("change", () => {
    if (!providerChosen()) {
      // The placeholder is disabled; a synthetic change lands back on it.
      providerSel.value = lastProvider;
      return;
    }
    lastProvider = providerSel.value;
    renderEndpointPlaceholder();
    syncEndpoint();
    renderModels("");
    renderReasoning(reasoningSel.value);
    reasoningSel.disabled = false;
  });
  modelSel.addEventListener("change", () => {
    toggleCustomModel();
    renderReasoning(reasoningSel.value);
  });
  modelInput.addEventListener("input", () => renderReasoning(reasoningSel.value));
  baseInput.addEventListener("input", () => {
    endpointDirty = true;
  });

  $("save").addEventListener("click", async () => {
    const patch = {
      targetLang: $("targetLang").value,
      engine: engineSel.value,
      ai: {
        provider: providerSel.value,
        reasoning: reasoningSel.value,
        apiKey: $("apiKey").value.trim(),
        // SPEC 2.1: store what the user picked, including "nothing picked yet".
        model: providerChosen() ? selectedModel() : "",
        baseURL: $("baseURL").value.trim(),
      },
    };
    await api.runtime.sendMessage({ command: "dt-save-settings", patch });
    $("status").textContent = t("optionSaved");
    setTimeout(() => ($("status").textContent = ""), 2500);
  });
})();
