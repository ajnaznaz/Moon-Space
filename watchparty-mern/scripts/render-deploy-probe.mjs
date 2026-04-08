import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const distMainPath = path.join(rootDir, "apps/api/dist/main.js");
const distNestedMainPath = path.join(rootDir, "apps/api/dist/apps/api/src/main.js");
const apiTsconfigPath = path.join(rootDir, "apps/api/tsconfig.json");

function emit(runId, hypothesisId, location, message, data) {
  // #region agent log
  fetch("http://127.0.0.1:7601/ingest/6c11b2bd-cfa2-4bb3-aa39-7fe4c66e58ea", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "7576e9"
    },
    body: JSON.stringify({
      sessionId: "7576e9",
      runId,
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now()
    })
  }).catch(() => {});
  // #endregion
}

const runId = process.argv[2] ?? "probe-default";
const buildCommand = process.env.RENDER_BUILD_COMMAND ?? process.env.BUILD_COMMAND ?? "";
const startCommand = process.env.RENDER_START_COMMAND ?? process.env.START_COMMAND ?? "";

const tsconfigText = fs.existsSync(apiTsconfigPath) ? fs.readFileSync(apiTsconfigPath, "utf8") : "";
const outDirMatch = tsconfigText.match(/"outDir"\s*:\s*"([^"]+)"/);
const outDir = outDirMatch?.[1] ?? "dist (default)";

emit(runId, "H1", "scripts/render-deploy-probe.mjs:42", "Probe started with cwd and commands", {
  cwd: rootDir,
  buildCommand,
  startCommand
});

emit(runId, "H3", "scripts/render-deploy-probe.mjs:48", "API tsconfig outDir detected", {
  outDir,
  tsconfigExists: fs.existsSync(apiTsconfigPath)
});

emit(runId, "H2", "scripts/render-deploy-probe.mjs:53", "dist/main.js existence check", {
  distMainPath,
  distExists: fs.existsSync(path.dirname(distMainPath)),
  distMainExists: fs.existsSync(distMainPath)
});

emit(runId, "H4", "scripts/render-deploy-probe.mjs:59", "nested emitted main.js existence check", {
  distNestedMainPath,
  distNestedMainExists: fs.existsSync(distNestedMainPath)
});

