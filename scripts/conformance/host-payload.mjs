#!/usr/bin/env node
/**
 * Host harness for the shared conformance kit (SPEC 2.0.0).
 *
 *   node scripts/conformance/host-payload.mjs   # print the payload as JSON
 *
 * The payload generator is the vitest test named in conformance.json → payload.
 * This process runs that one test with DT_CONFORMANCE_OUT pointing at a
 * scratch file and prints what the test wrote there, so the DOM boot lives in
 * exactly one place: the test itself. Kept separate from host.mjs so a failed
 * generation is reported as such, not as a validation failure.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");

export function emitPayload() {
  const config = JSON.parse(fs.readFileSync(resolve(repoRoot, "conformance.json"), "utf8"));
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dt-conformance-")), "payload.json");
  try {
    execFileSync(resolve(repoRoot, "node_modules/.bin/vitest"), ["run", config.payload, "-t", "payload the shared SPEC"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
      env: { ...process.env, DT_CONFORMANCE_OUT: out },
    });
    if (!fs.existsSync(out)) throw new Error(`conformance test did not write a payload to ${out}`);
    return JSON.parse(fs.readFileSync(out, "utf8"));
  } finally {
    fs.rmSync(path.dirname(out), { recursive: true, force: true });
  }
}

if (process.argv[2] === "--dump") process.stdout.write(JSON.stringify(emitPayload()));
