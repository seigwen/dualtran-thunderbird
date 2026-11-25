import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));

describe("manifest guards", () => {
  it("is a Thunderbird MV2 mail extension", () => {
    // MV3 is not viable here: an installed event page is never evaluated again
    // after a browser restart, so nothing re-registers the message scripts.
    expect(manifest.manifest_version).toBe(2);
    expect(manifest.browser_specific_settings.gecko.id).toBe("dualtran@seigwen.dev");
    expect(manifest.browser_specific_settings.gecko.strict_min_version).toBe("128.0");
  });

  it("uses an exact, reviewed permission set", () => {
    expect([...manifest.permissions].sort()).toEqual([
      "<all_urls>",
      "compose",
      "messagesModify",
      "messagesRead",
      "storage",
    ]);
    // MV2 has no host_permissions key: host grants live in permissions.
    expect(manifest.host_permissions).toBeUndefined();
    // scripting.* only exists in MV3; the MV2 host registers via
    // messageDisplayScripts / composeScripts instead.
    expect(manifest.permissions).not.toContain("scripting");
  });

  it("can reach any AI provider endpoint (BYOK)", () => {
    // MV3 blocks fetch() to hosts the manifest did not grant. With only the
    // Google endpoint listed, the AI engine fails with the browser's generic
    // "NetworkError when attempting to fetch resource." while Google keeps
    // working - the exact split users report. BYOK means arbitrary providers
    // plus user-supplied base URLs, so the host set cannot be enumerated and
    // has to be all_urls.
    expect(manifest.permissions).toContain("<all_urls>");
  });

  it("runs a persistent background page", () => {
    // An MV3 event page is never re-evaluated after a browser restart in
    // Thunderbird 160, so no message script ever gets registered again and the
    // floating button disappears on a cold start. MV2 keeps the page alive.
    expect(manifest.background.scripts).toEqual(["background.js"]);
    expect(manifest.background.persistent).toBe(true);
  });

  it("ships locales, options and icons", () => {
    expect(manifest.default_locale).toBe("en");
    expect(manifest.options_ui.page).toBe("options/options.html");
    for (const size of ["16", "32", "64", "128"]) {
      expect(manifest.icons[size]).toBeTruthy();
    }
  });
});
