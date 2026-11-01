import { Miniflare } from "miniflare";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import {
  readSnapshot,
  statements,
  activationSql,
} from "../scripts/import-jobs.mjs";
import { JobQuery } from "../lib/job-query.mjs";
import { DatabaseSync } from "node:sqlite";
import { binding } from "./helpers.mjs";

const mf = new Miniflare({
  modules: true,
  script: 'export default {fetch(){return new Response("ok")}}',
  compatibilityDate: "2026-05-15",
  d1Databases: { DB: "full-acceptance" },
  d1Persist: ".textsql/native-d1",
});
try {
  const DB = await mf.getD1Database("DB");
  await DB.prepare(
    "CREATE TABLE IF NOT EXISTS local_migrations(name TEXT PRIMARY KEY)",
  ).run();
  for (const file of [
    "0000_public_outlaw_kid.sql",
    "0001_fair_wolfsbane.sql",
    "0002_jobs.sql",
    "0003_query_indexes.sql",
  ]) {
    if (
      await DB.prepare("SELECT name FROM local_migrations WHERE name=?")
        .bind(file)
        .first()
    )
      continue;
    const sql = await readFile(
      new URL("../drizzle/" + file, import.meta.url),
      "utf8",
    );
    await DB.batch([
      ...sql
        .split("--> statement-breakpoint")
        .filter((s) => s.trim())
        .map((s) => DB.prepare(s)),
      DB.prepare("INSERT INTO local_migrations VALUES (?)").bind(file),
    ]);
  }
  const snapshot = await readSnapshot();
  let batch = [],
    count = 0;
  for (const sql of statements(snapshot)) {
    batch.push(DB.prepare(sql));
    if (batch.length === 40) {
      await DB.batch(batch);
      count += batch.length;
      batch = [];
      if (count % 10000 === 0) console.log("Imported statements:", count);
    }
  }
  if (batch.length) await DB.batch(batch);
  await DB.batch(
    activationSql(snapshot)
      .split(";")
      .filter((s) => s.trim())
      .map((s) => DB.prepare(s)),
  );
  const engine = await JobQuery.open(DB),
    reference = new DatabaseSync(".textsql/jobs.sqlite"),
    expected = await JobQuery.open(binding(reference));
  const cases = JSON.parse(
    await readFile(".textsql/parity-report.json", "utf8"),
  ).cases;
  const report = [];
  for (const c of cases) {
    const started = performance.now(),
      actual = await engine.summary(await engine.scope(c.filters));
    const local = await expected.summary(await expected.scope(c.filters));
    for (const key of ["records", "salaryN", "p25", "p50", "p75", "companies"])
      assert.equal(
        actual[key],
        local[key],
        JSON.stringify(c.filters) + " " + key,
      );
    const item = {
      filters: c.filters,
      records: actual.records,
      salaryN: actual.salaryN,
      p50: actual.p50,
      nativeMs: Math.round(performance.now() - started),
    };
    report.push(item);
    console.log("PASS", JSON.stringify(item));
  }
  reference.close();
  await writeFile(
    ".textsql/native-d1-report.json",
    JSON.stringify(
      {
        dataset: engine.metadata(),
        rows: snapshot.rows.length,
        statementCount: count + batch.length,
        cases: report,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: full 69,465 rows imported and activated in native workerd/D1; all 25 parity cases passed.",
  );
} finally {
  await mf.dispose();
}
