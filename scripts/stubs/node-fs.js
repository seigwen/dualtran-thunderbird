/**
 * Browser stub for the Node-only file cache factory in the dualtran core
 * (src/core/cache/file.js). The extension injects storage-backed caches and
 * never calls createFileCache; throwing here surfaces accidental usage.
 */
const notAvailable = () => {
  throw new Error("node:fs is not available in the browser extension bundle");
};
export const readFileSync = notAvailable;
export const writeFileSync = notAvailable;
export const mkdirSync = notAvailable;
