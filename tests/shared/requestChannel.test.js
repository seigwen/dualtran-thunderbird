import { describe, it, expect } from "vitest";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  requestViaStorage,
  REQUEST_STORAGE_KEY,
  RESPONSE_STORAGE_KEY,
} from "../../src/shared/requestChannel.mjs";

describe("requestChannel", () => {
  it("waits longer than the slowest observed AI reply", () => {
    // Measured on the Thunderbird host: a 24-block AI translation took ~200 s
    // and a 4-block one exceeded 300 s on a slow day. The previous 120 s budget
    // expired mid-flight, the background kept working, and the reply landed with
    // nobody listening - the UI showed neither a translation nor an error.
    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(300000);
  });

  it("resolves with the background reply once the response arrives", async () => {
    const listeners = [];
    let written = null;
    const browser = {
      storage: {
        onChanged: {
          addListener: (fn) => listeners.push(fn),
          removeListener: (fn) => {
            const i = listeners.indexOf(fn);
            if (i >= 0) listeners.splice(i, 1);
          },
        },
        local: {
          set: async (patch) => {
            written = patch;
            const request = patch[REQUEST_STORAGE_KEY];
            // reply on the next tick, as the background would
            setTimeout(() => {
              for (const fn of [...listeners]) {
                fn({ [RESPONSE_STORAGE_KEY]: { newValue: { id: request.id, translations: ["你好"] } } }, "local");
              }
            }, 0);
          },
        },
      },
      runtime: { sendMessage: async () => ({}) },
    };

    const reply = await requestViaStorage(browser, { command: "dt-translate", texts: ["Hello"] });
    expect(written[REQUEST_STORAGE_KEY].command).toBe("dt-translate");
    expect(reply.translations).toEqual(["你好"]);
    // the id is transport detail, not part of the reply contract
    expect(reply.id).toBeUndefined();
    expect(listeners).toHaveLength(0);
  });

  it("ignores responses that belong to another request", async () => {
    const listeners = [];
    const browser = {
      storage: {
        onChanged: {
          addListener: (fn) => listeners.push(fn),
          removeListener: (fn) => {
            const i = listeners.indexOf(fn);
            if (i >= 0) listeners.splice(i, 1);
          },
        },
        local: {
          set: async (patch) => {
            const request = patch[REQUEST_STORAGE_KEY];
            setTimeout(() => {
              for (const fn of [...listeners]) {
                fn({ [RESPONSE_STORAGE_KEY]: { newValue: { id: "someone-else", translations: ["x"] } } }, "local");
                fn({ [RESPONSE_STORAGE_KEY]: { newValue: { id: request.id, translations: ["好"] } } }, "local");
              }
            }, 0);
          },
        },
      },
      runtime: { sendMessage: async () => ({}) },
    };

    const reply = await requestViaStorage(browser, { command: "dt-translate", texts: ["Hi"] });
    expect(reply.translations).toEqual(["好"]);
  });

  it("falls back to sendMessage where storage events do not exist", async () => {
    const sent = [];
    const browser = {
      runtime: { sendMessage: async (payload) => (sent.push(payload), { translations: ["ok"] }) },
    };
    const reply = await requestViaStorage(browser, { command: "dt-translate", texts: ["Hi"] });
    expect(sent).toHaveLength(1);
    expect(reply.translations).toEqual(["ok"]);
  });
});
