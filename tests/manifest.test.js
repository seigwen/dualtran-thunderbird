import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));

describe("manifest guards", () => {
  it("is a Thunderbird MV3 mail extension", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.browser_specific_settings.gecko.id).toBe("dualtran@seigwen.dev");
    expect(manifest.browser_specific_settings.gecko.strict_min_version).toBe("128.0");
  });

  it("uses an exact, reviewed permission set", () => {
    expect([...manifest.permissions].sort()).toEqual(["compose", "messagesRead", "scripting", "storage"]);
    expect(manifest.host_permissions).toEqual(["https://translate.googleapis.com/*"]);
  });

  it("runs a module event page", () => {
    expect(manifest.background.scripts).toEqual(["background.js"]);
    expect(manifest.background.type).toBe("module");
  });

  it("ships locales, options and icons", () => {
    expect(manifest.default_locale).toBe("en");
    expect(manifest.options_ui.page).toBe("options/options.html");
    for (const size of ["16", "32", "64", "128"]) {
      expect(manifest.icons[size]).toBeTruthy();
    }
  });
});
