// Deliberate CLI: local by default, remote only with an explicit --remote.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parse } from "jsonc-parser";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
if (
  args.some((a) => !["--local", "--remote", "--skip-migrations"].includes(a)) ||
  new Set(args).size !== args.length ||
  (args.includes("--local") && args.includes("--remote"))
)
  throw Error(
    "Usage: node scripts/d1-import.mjs [--local | --remote] [--skip-migrations]",
  );
const target = args.includes("--remote") ? "--remote" : "--local";
const configErrors = [];
const config = parse(
  await readFile(path.join(root, "wrangler.research.jsonc"), "utf8"),
  configErrors,
  { allowTrailingComma: true },
);
if (configErrors.length) throw Error("Invalid Wrangler JSONC configuration");
if (
  target === "--remote" &&
  config.d1_databases[0].database_id.startsWith("00000000-")
)
  throw Error(
    "Set the verified production database ID in wrangler.research.jsonc before remote import.",
  );
const directory = path.join(root, ".textsql/import"),
  plan = JSON.parse(await readFile(path.join(directory, "plan.json"), "utf8"));
const manifest = await readFile(path.join(root, "public/jobs.json"));
const hash = (b) => createHash("sha256").update(b).digest("hex");
if (hash(manifest) !== plan.manifestSha256)
  throw Error(
    "Import plan does not match the current snapshot. Regenerate it.",
  );
const files = [...plan.files, plan.activate];
for (const name of files) {
  if (
    !/^(?:\d{4}|activate)\.sql$/.test(name) ||
    hash(await readFile(path.join(directory, name))) !== plan.checksums[name]
  )
    throw Error("Invalid import file: " + name);
}
function run(...parameters) {
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, "node_modules/wrangler/bin/wrangler.js"),
      ...parameters,
      "--config",
      path.join(root, "wrangler.research.jsonc"),
    ],
    {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw Error(
      "D1 command failed; activation stopped. Re-run the immutable import after fixing the error.",
    );
}
if (!args.includes("--skip-migrations"))
  run("d1", "migrations", "apply", "DB", target);
// This also checks schema readiness when a managed platform owns migrations.
run(
  "d1",
  "execute",
  "DB",
  target,
  "--command",
  "SELECT d.id FROM active_dataset a JOIN datasets d ON d.id=a.dataset_id LEFT JOIN job_search s ON s.dataset_id=d.id LIMIT 1",
);
for (const name of files) {
  console.log("Importing", name, target);
  run("d1", "execute", "DB", target, "--file", path.join(directory, name));
}
console.log("Verified snapshot activated:", plan.dataset);
