/* Ensures certain cache directories exist for buildpacks that attempt to copy them.
 *
 * Railway/Railpack (observed) tries to copy /root/.yarn after build; if it doesn't exist,
 * the build can fail during image layer caching.
 */

const fs = require('fs');

function ensureDir(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch {
    // best-effort: never fail install/build for this
  }
}

function main() {
  // Only relevant for Linux containers; avoid odd behaviour on Windows dev.
  if (process.platform !== 'linux') return;

  ensureDir('/root/.yarn');
  ensureDir('/root/.cache');
}

main();
