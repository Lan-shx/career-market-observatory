import { readFile, mkdir, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { DOMAIN_VERSION, normalizeJob } from "../lib/job-domain.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const hash = (b) => createHash("sha256").update(b).digest("hex");
const literal = (v) =>
  v === null
    ? "NULL"
    : typeof v === "number"
      ? String(v)
      : "'" + String(v).replaceAll("'", "''") + "'";
export async function readSnapshot(publicRoot = path.join(root, "public")) {
  const bytes = await readFile(path.join(publicRoot, "jobs.json")),
    manifest = JSON.parse(bytes),
    rows = [],
    seen = new Set();
  if (
    !Array.isArray(manifest.chunks) ||
    manifest.chunks.length > 100 ||
    !manifest.sampling?.poolSha256
  )
    throw Error("Invalid snapshot manifest");
  const safe = (p) => {
    const resolved = path.resolve(publicRoot, p);
    if (!resolved.startsWith(path.resolve(publicRoot) + path.sep))
      throw Error("Invalid shard path");
    return resolved;
  };
  for (const c of manifest.chunks) {
    const plain = await readFile(safe(c.jsonPath)),
      zipped = gunzipSync(await readFile(safe(c.gzipPath)));
    if (hash(plain) !== c.sha256 || !plain.equals(zipped))
      throw Error("Shard checksum mismatch: " + c.jsonPath);
    const part = JSON.parse(plain);
    if (!Array.isArray(part) || part.length !== c.rowCount)
      throw Error("Shard row count mismatch");
    for (const r of part) {
      if (typeof r.id !== "string" || !r.id || seen.has(r.id))
        throw Error("Missing or duplicate job id");
      seen.add(r.id);
      for (const key of [
        "title",
        "company",
        "country",
        "location",
        "occupation",
        "source",
      ])
        if (typeof r[key] !== "string")
          throw Error("Invalid job field: " + key);
      for (const key of ["workCities", "cityGroups", "skills", "relatedMajors"])
        if (
          !Array.isArray(r[key]) ||
          r[key].some((v) => typeof v !== "string" || v.length > 150)
        )
          throw Error("Invalid job array: " + key);
      for (const key of ["salaryMin", "salaryMax"])
        if (r[key] !== null && !Number.isFinite(r[key]))
          throw Error("Invalid salary type");
      for (const key of ["publishedAt", "updatedAt", "expiresAt"])
        if (
          r[key] != null &&
          (!/^\d{4}-\d{2}-\d{2}$/.test(r[key]) ||
            new Date(r[key]).toISOString().slice(0, 10) !== r[key])
        )
          throw Error("Invalid date: " + key);
      rows.push(normalizeJob(r, rows.length, manifest.geography));
    }
  }
  if (
    rows.length !== manifest.rowCount ||
    rows.length !== manifest.sampling.sampleCount
  )
    throw Error("Snapshot total mismatch");
  const id = `${manifest.sampling.poolSha256}-${rows.length}-v${DOMAIN_VERSION}`;
  const salaryCount = rows.filter((r) => r.salary_valid).length;
  // The 2.5 MB source-request audit stays in the checksummed public manifest;
  // D1 rows and individual SQL statements have smaller platform limits.
  const { sources, ...header } = manifest;
  const dataset = {
    id,
    domain_version: DOMAIN_VERSION,
    manifest_sha256: hash(bytes),
    row_count: rows.length,
    salary_count: salaryCount,
    collected_at: manifest.collectedAt,
    date_from: manifest.sampling.dateFrom,
    date_to: manifest.sampling.dateTo,
    taxonomy_json: JSON.stringify(manifest.taxonomy),
    manifest_json: JSON.stringify({
      ...header,
      sourceRequestCount: sources.length,
      importExpected: {
        job_cities: rows.reduce((n,r)=>n+r.cities.length,0),
        job_skills: rows.reduce((n,r)=>n+r.skills.length,0),
        job_related_majors: rows.reduce((n,r)=>n+r.relatedMajors.length,0),
      },
    }),
  };
  return { manifest, rows, dataset };
}
export function insertSql(table, object, ignore = false) {
  const entries = Object.entries(object);
  const sql = `INSERT ${ignore ? "OR IGNORE " : ""}INTO ${table} (${entries.map(([k]) => k).join(",")}) VALUES (${entries.map(([, v]) => literal(v)).join(",")});`;
  if (Buffer.byteLength(sql) > 99000)
    throw Error("D1 statement limit exceeded: " + table);
  return sql;
}
export function* statements(snapshot) {
  const { dataset, rows } = snapshot;
  // Immutable versions: repeated imports only add missing identical rows.
  yield insertSql("datasets", dataset, true);
  yield "CREATE TABLE IF NOT EXISTS import_check (ok INTEGER NOT NULL CHECK(ok=1));";
  yield "DELETE FROM import_check;";
  yield `INSERT INTO import_check SELECT (manifest_sha256=${literal(dataset.manifest_sha256)} AND domain_version=${DOMAIN_VERSION}) FROM datasets WHERE id=${literal(dataset.id)};`;
  yield "DROP TABLE import_check;";
  for (const r of rows) {
    const { cities, skills, relatedMajors, ...job } = r;
    yield insertSql("jobs", { dataset_id: dataset.id, ...job }, true);
    for (const c of cities)
      yield insertSql(
        "job_cities",
        { dataset_id: dataset.id, job_id: r.id, ...c },
        true,
      );
    for (const skill of skills)
      yield insertSql(
        "job_skills",
        { dataset_id: dataset.id, job_id: r.id, skill },
        true,
      );
    for (const major of relatedMajors)
      yield insertSql(
        "job_related_majors",
        { dataset_id: dataset.id, job_id: r.id, major },
        true,
      );
  }
}
export function activationSql(snapshot) {
  const { dataset: d, rows } = snapshot,
    id = literal(d.id);
  // The CHECK intentionally aborts activation if ANY expected count differs.
  const expected = {
    jobs: rows.length,
    job_cities: rows.reduce((n, r) => n + r.cities.length, 0),
    job_skills: rows.reduce((n, r) => n + r.skills.length, 0),
    job_related_majors: rows.reduce((n, r) => n + r.relatedMajors.length, 0),
  };
  const checks = Object.entries(expected).map(
    ([table, n]) =>
      `(SELECT count(*) FROM ${table} WHERE dataset_id=${id})=${n}`,
  );
  checks.push(
    `(SELECT coalesce(sum(salary_valid),0) FROM jobs WHERE dataset_id=${id})=${d.salary_count}`,
  );
  return `CREATE TABLE IF NOT EXISTS import_check (ok INTEGER NOT NULL CHECK(ok=1));\nDELETE FROM import_check;\nINSERT INTO import_check VALUES (${checks.join(" AND ")});\nINSERT INTO active_dataset(singleton,dataset_id) SELECT 1,${id} WHERE ${checks.join(" AND ")} ON CONFLICT(singleton) DO UPDATE SET dataset_id=excluded.dataset_id;\nDROP TABLE import_check;\n`;
}
export async function importLocal(snapshot, filename) {
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;");
  try {
    for (const name of (await readdir(path.join(root, "drizzle")))
      .filter((n) => /^\d+_.*\.sql$/.test(n))
      .sort()) {
      db.exec(
        "CREATE TABLE IF NOT EXISTS local_migrations(name TEXT PRIMARY KEY)",
      );
      if (
        !db.prepare("SELECT name FROM local_migrations WHERE name=?").get(name)
      ) {
        db.exec("BEGIN");
        db.exec(await readFile(path.join(root, "drizzle", name), "utf8"));
        db.prepare("INSERT INTO local_migrations VALUES (?)").run(name);
        db.exec("COMMIT");
      }
    }
    const previous = db
      .prepare("SELECT manifest_sha256 FROM datasets WHERE id=?")
      .get(snapshot.dataset.id);
    if (
      previous &&
      previous.manifest_sha256 !== snapshot.dataset.manifest_sha256
    )
      throw Error("Immutable dataset version changed; bump domain version");
    db.exec("BEGIN");
    let n = 0;
    for (const sql of statements(snapshot)) {
      db.exec(sql);
      if (++n % 1000 === 0) {
        db.exec("COMMIT");
        db.exec("BEGIN");
      }
    }
    db.exec(activationSql(snapshot));
    db.exec("COMMIT");
    db.exec("PRAGMA optimize");
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw e;
  } finally {
    db.close();
  }
}
async function main() {
  const args = process.argv.slice(2),
    snapshot = await readSnapshot();
  if (args[0] === "--local") {
    const filename = path.resolve(args[1] || ".textsql/jobs.sqlite");
    await mkdir(path.dirname(filename), { recursive: true });
    await importLocal(snapshot, filename);
    console.log("Local SQLite import verified:", snapshot.dataset.id);
  } else if (args[0] === "--sql") {
    const output = path.resolve(args[1] || ".textsql/import");
    await mkdir(output, { recursive: true });
    let chunk = "",
      chunkBytes = 0,
      part = 0;
    const files = [],
      checksums = {};
    const flush = async () => {
      if (!chunk) return;
      const name = `${String(part++).padStart(4, "0")}.sql`;
      await writeFile(path.join(output, name), chunk);
      files.push(name);
      checksums[name] = hash(chunk);
      chunk = "";
      chunkBytes = 0;
    };
    for (const sql of statements(snapshot)) {
      const size = Buffer.byteLength(sql) + 1;
      if (chunkBytes + size > 2 * 1024 * 1024) await flush();
      chunk += sql + "\n";
      chunkBytes += size;
    }
    await flush();
    const activation = activationSql(snapshot);
    await writeFile(path.join(output, "activate.sql"), activation);
    checksums["activate.sql"] = hash(activation);
    await writeFile(
      path.join(output, "plan.json"),
      JSON.stringify(
        {
          dataset: snapshot.dataset.id,
          manifestSha256: snapshot.dataset.manifest_sha256,
          rowCount: snapshot.rows.length,
          salaryCount: snapshot.dataset.salary_count,
          files,
          checksums,
          activate: "activate.sql",
        },
        null,
        2,
      ),
    );
    console.log(
      "D1 import files prepared:",
      files.length,
      "Activate only after all files succeed.",
    );
  } else if (args.length)
    throw Error(
      "Usage: node scripts/import-jobs.mjs [--local [file] | --sql [directory]]",
    );
  console.log(
    JSON.stringify({
      dataset: snapshot.dataset.id,
      rows: snapshot.rows.length,
      salaryCount: snapshot.dataset.salary_count,
      headCountStrings: snapshot.rows.filter(
        (r) => typeof JSON.parse(r.raw_json).headCount === "string",
      ).length,
    }),
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
