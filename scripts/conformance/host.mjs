#!/usr/bin/env node
/**
 * Conformance — the host's entry point into the shared SPEC 2.0.0 kit.
 *
 *   node scripts/conformance/host.mjs
 *
 * Unlike the stock run.mjs, the payload generator is a vitest test (jsdom is a
 * vitest dependency; the options page needs a DOM). So this file keeps the
 * same contract — self-test, generate, static scan, validate — but takes the
 * payload from `host-payload.mjs`, which runs that single test and prints
 * whatever it emitted. Exit code 1 on any failure, with the rule named.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SPEC_VERSION, selfTest, validatePayload } from "./validate.mjs";
import { scanFiles } from "./scan.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");

const die = (message) => {
  console.error(message);
  process.exit(1);
};

let config;
try {
  config = JSON.parse(readFileSync(resolve(repoRoot, "conformance.json"), "utf8"));
} catch (error) {
  die(`conformance.json is missing or invalid: ${error.message}`);
}
if (config.spec !== SPEC_VERSION) {
  die(`conformance.json targets spec ${config.spec}, this kit is ${SPEC_VERSION}`);
}

try {
  console.log(`self-test: ${selfTest()} negative controls caught`);
} catch (error) {
  die(`conformance self-test failed:\n${error.message}`);
}

let payload;
try {
  const output = execFileSync(process.execPath, [resolve(here, "host-payload.mjs"), "--dump"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 32 * 1024 * 1024,
  });
  payload = JSON.parse(output);
} catch (error) {
  die(`payload generation failed: ${error.message}`);
}

if (config.static) payload.static = { ...(payload.static || {}), hits: scanFiles(repoRoot, config.static) };
payload.conformance = config;

try {
  const summary = validatePayload(payload, config);
  console.log(
    `PASS ${summary.host}: ${summary.languages} languages, ${summary.providers} providers, ${summary.localeCount} locales (spec ${summary.spec})`
  );
} catch (error) {
  console.error(error.message);
  if (error.detail) console.error(JSON.stringify(error.detail));
  process.exit(1);
}
