import { describe, it, expect } from "vitest";
import { registerBackground, DISPLAY_SCRIPTS, COMPOSE_SCRIPT } from "../src/background.js";

function mockMessenger() {
  const captured = {};
  return {
    captured,
    messenger: {
      runtime: { onMessage: { addListener: (fn) => (captured.onMessage = fn) } },
      messageDisplay: {
        getDisplayedMessages: async (tabId) => captured.displayed || [],
      },
      messageDisplayScripts: { register: async (spec) => (captured.display = spec) },
      composeScripts: { register: async (spec) => (captured.compose = spec) },
      tabs: {
        query: async () => captured.tabs || [],
        executeScript: async (tabId, opts) => {
          captured.executed = [...(captured.executed || []), { tabId, ...opts }];
        },
      },
      storage: {
        local: {
          get: async (defaults) => ({ ...defaults, ...(captured.store || {}) }),
          set: async (patch) => {
            captured.store = { ...(captured.store || {}), ...patch };
          },
        },
        onChanged: { addListener: (fn) => (captured.storageChanged = fn) },
      },
    },
  };
}

const stubEngine = {
  translateBatch: async (texts, opts) => ({
    translations: texts.map((t) => `T:${t}`),
    engine: opts?.engine || "google",
    targetLang: opts?.targetLang || "en",
  }),
  status: () => ({ google: { available: true } }),
};

/** Mirrors the zh_CN catalogue entries the error classifier maps onto. */
const stubI18n = {
  getMessage: (key) =>
    ({
      errorTranslationWithMessage: "翻译错误：$ERROR_MESSAGE$",
      errorAiNoResponse: "AI 服务未返回响应，请检查 API Key 和模型名称是否正确。",
      errorTranslationTimeout: "翻译请求超时",
      errorApiKeyNotFound: "未找到 API 密钥！",
    })[key] || key,
};

describe("registerBackground", () => {
  it("registers the message display script through the MV2 API", async () => {
    const { messenger, captured } = mockMessenger();
    await registerBackground({ messenger, engine: stubEngine });
    expect(captured.display.js).toEqual(DISPLAY_SCRIPTS.map((file) => ({ file })));
  });

  it("registers the compose script through the MV2 API", async () => {
    const { messenger, captured } = mockMessenger();
    await registerBackground({ messenger, engine: stubEngine });
    expect(captured.compose.js).toEqual(COMPOSE_SCRIPT.map((file) => ({ file })));
  });

  it("injects into a mail tab that already has a message on screen", async () => {
    // Registration only covers documents opened later, so tabs restored at
    // startup need the explicit tabs.executeScript path.
    const { messenger, captured } = mockMessenger();
    captured.tabs = [{ id: 11, type: "mail" }];
    captured.displayed = [{ id: 1 }];
    await registerBackground({ messenger, engine: stubEngine, tabInjectRetries: 0 });
    const calls = captured.executed || [];
    expect(calls.length).toBe(1);
    expect(calls[0].tabId).toBe(11);
    expect(calls[0].file).toBe(DISPLAY_SCRIPTS[0]);
  });

  it("never touches the MV3-only scripting namespace", async () => {
    // MV2 hosts have no messenger.scripting at all; referencing it throws at
    // registration time and no script is ever injected.
    const fs = await import("node:fs");
    const source = fs.readFileSync(new URL("../src/background.js", import.meta.url), "utf8");
    expect(source.includes("messenger.scripting")).toBe(false);
  });

  it("routes dt-translate messages to the engine with settings applied", async () => {
    const { messenger, captured } = mockMessenger();
    await registerBackground({ messenger, engine: stubEngine });
    const out = await captured.onMessage({ command: "dt-translate", texts: ["Hola"] });
    expect(out.translations).toEqual(["T:Hola"]);
    expect(out.engine).toBe("google");
  });

  it("returns a structured error when the engine throws", async () => {
    const { messenger, captured } = mockMessenger();
    const failing = { translateBatch: async () => { throw new Error("network down"); } };
    await registerBackground({ messenger, engine: failing });
    const out = await captured.onMessage({ command: "dt-translate", texts: ["Hola"] });
    expect(out.error).toMatch(/network down/);
  });

  it("classifies an HTTP 401 with a technical detail in the payload", async () => {
    const { messenger, captured } = mockMessenger();
    const failing = {
      translateBatch: async () => {
        throw { statusCode: 401, responseBody: { error: { message: "Unauthorized" } } };
      },
    };
    await registerBackground({ messenger, engine: failing, i18n: stubI18n });
    const out = await captured.onMessage({ command: "dt-translate", texts: ["Hola"] });
    expect(out.error).toContain("401");
    expect(out.error).toContain("check your API key");
    expect(out.errorDetail).toContain("check your API key");
  });

  it("never surfaces a bare null error", async () => {
    const { messenger, captured } = mockMessenger();
    const failing = { translateBatch: async () => { throw null; } };
    await registerBackground({ messenger, engine: failing, i18n: stubI18n });
    const out = await captured.onMessage({ command: "dt-translate", texts: ["Hola"] });
    expect(out.error).not.toBe("null");
    expect(out.error).toContain("AI 服务未返回响应");
  });

  it("never lets the literal null reach the banner", async () => {
    const { messenger, captured } = mockMessenger();
    const failing = { translateBatch: async () => { throw { message: "null" }; } };
    await registerBackground({ messenger, engine: failing, i18n: stubI18n });
    const out = await captured.onMessage({ command: "dt-translate", texts: ["Hola"] });
    expect(out.error).not.toContain("null");
    expect(out.error).toContain("AI 服务未返回响应");
    expect(out.errorDetail).toBe("");
  });

  it("passes the detail to i18n as a placeholder argument", async () => {
    const { messenger, captured } = mockMessenger();
    const calls = [];
    const i18n = {
      getMessage: (key, args) => {
        calls.push([key, args]);
        const raw = stubI18n.getMessage(key);
        return args && args.length ? raw.replace("$ERROR_MESSAGE$", args[0]) : raw;
      },
    };
    const failing = { translateBatch: async () => { throw { statusCode: 429 }; } };
    await registerBackground({ messenger, engine: failing, i18n });
    const out = await captured.onMessage({ command: "dt-translate", texts: ["Hola"] });
    expect(out.error).toContain("429");
    const call = calls.find(([key]) => key === "errorTranslationWithMessage");
    expect(call, "the localized template must be requested").toBeTruthy();
    expect(call[1][0]).toContain("429");
  });

  it("records the raw failure so a null message can be diagnosed", async () => {
    const { messenger, captured } = mockMessenger();
    const failing = {
      translateBatch: async () => {
        throw { statusCode: 401, message: "null" };
      },
    };
    await registerBackground({ messenger, engine: failing, i18n: stubI18n });
    await captured.onMessage({ command: "dt-translate", texts: ["Hola"] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const raw = captured.store && captured.store.dtLastError;
    expect(raw, "the failure snapshot must be stored").toBeTruthy();
    expect(typeof raw).toBe("string");
    const recorded = JSON.parse(raw);
    expect(recorded.detail).toContain("HTTP 401");
    expect(recorded.error.statusCode).toBe(401);
    expect(recorded.error.message).toBe("null");
  });

  it("survives a messenger without storage", async () => {
    const { captured } = mockMessenger();
    const messenger = {
      runtime: captured.runtimeLike || { onMessage: { addListener: (fn) => (captured.onMessage = fn) } },
      scripting: {
        compose: { registerScripts: async () => {} },
        messageDisplay: { registerScripts: async () => {} },
      },
      tabs: { query: async () => [] },
    };
    const failing = { translateBatch: async () => { throw new Error("boom"); } };
    await registerBackground({ messenger, engine: failing });
    const out = await captured.onMessage({ command: "dt-translate", texts: ["Hola"] });
    expect(out.error).toContain("boom");
  });

  it("forwards diag notes to the debug sink", async () => {
    const { messenger, captured } = mockMessenger();
    const notes = [];
    await registerBackground({ messenger, engine: stubEngine, debugFn: (n) => notes.push(n) });
    const out = await captured.onMessage({ command: "dt-diag", note: "fab mounted" });
    expect(out).toEqual({ ok: true });
    expect(notes.some((n) => n.includes("fab mounted"))).toBe(true);
  });

  it("ignores unknown commands", async () => {
    const { messenger, captured } = mockMessenger();
    await registerBackground({ messenger, engine: stubEngine });
    expect(await captured.onMessage({ command: "nope" })).toBeUndefined();
  });

  it("serves a translation request delivered over storage.onChanged", async () => {
    // storage.onChanged is a persisted wake event; runtime.sendMessage is not
    // delivered to a stopped event page in Thunderbird 160.
    const { messenger, captured } = mockMessenger();
    await registerBackground({ messenger, engine: stubEngine });
    expect(typeof captured.storageChanged).toBe("function");
    await captured.storageChanged(
      {
        dtRequest: {
          newValue: { id: "r1", command: "dt-translate", texts: ["Hola"], engine: "google" },
        },
      },
      "local"
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    const reply = captured.store && captured.store.dtResponse;
    expect(reply).toBeTruthy();
    expect(reply.id).toBe("r1");
    expect(reply.translations).toEqual(["T:Hola"]);
    expect(reply.engine).toBe("google");
  });

  it("ignores storage changes that are not translation requests", async () => {
    const { messenger, captured } = mockMessenger();
    await registerBackground({ messenger, engine: stubEngine });
    await captured.storageChanged({ dtSettings: { newValue: { engine: "ai" } } }, "local");
    await captured.storageChanged({ dtRequest: { newValue: null } }, "local");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(captured.store && captured.store.dtResponse).toBeUndefined();
  });
});
