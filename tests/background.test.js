import { describe, it, expect } from "vitest";
import { registerBackground, DISPLAY_SCRIPTS, COMPOSE_SCRIPT } from "../src/background.js";

function mockMessenger() {
  const captured = {};
  return {
    captured,
    messenger: {
      runtime: { onMessage: { addListener: (fn) => (captured.onMessage = fn) } },
      scripting: {
        compose: { registerScripts: async (spec) => (captured.compose = spec) },
        messageDisplay: { registerScripts: async (spec) => (captured.display = spec) },
      },
      tabs: { query: async () => [] },
      storage: {
        local: {
          get: async (defaults) => ({ ...defaults }),
          set: async () => {},
        },
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

describe("registerBackground", () => {
  it("registers the message display script via the MV3 scripting API", async () => {
    const { messenger, captured } = mockMessenger();
    await registerBackground({ messenger, engine: stubEngine });
    expect(captured.display).toHaveLength(1);
    expect(captured.display[0].js).toEqual([...DISPLAY_SCRIPTS]);
    expect(typeof captured.display[0].id).toBe("string");
  });

  it("registers the compose script with an id", async () => {
    const { messenger, captured } = mockMessenger();
    await registerBackground({ messenger, engine: stubEngine });
    expect(captured.compose).toHaveLength(1);
    expect(typeof captured.compose[0].id).toBe("string");
    expect(captured.compose[0].js).toEqual([...COMPOSE_SCRIPT]);
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
});
