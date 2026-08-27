import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function run(args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      windowsHide: true,
      stdio: "inherit",
    });
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (code === 0 && signal === null) {
        resolveRun();
        return;
      }
      rejectRun(new Error(
        `recovery native check failed: code=${String(code)} signal=${String(signal)}`,
      ));
    });
  });
}

await run([resolve(root, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json"]);
await run([
  "--test",
  "dist/test/recovery-observation.test.js",
  "dist/test/recovery-observation-adapter.test.js",
  "dist/test/host-cdp-renderer.test.js",
  "dist/test/host-cdp-adapter.test.js",
  "dist/test/host-workspace-companion.test.js",
]);
await run([resolve(root, "scripts", "renderer-close-headless-acceptance.mjs")]);
