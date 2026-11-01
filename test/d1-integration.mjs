import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { statements, activationSql } from "../scripts/import-jobs.mjs";
import { fixture, req } from "./helpers.mjs";
import { JobQuery } from "../lib/job-query.mjs";
import { researchRequest } from "../lib/research-server.mjs";

const mf = new Miniflare({
  modules: true,
  script: 'export default {fetch(){return new Response("ok")}}',
  compatibilityDate: "2026-05-15",
  d1Databases: { DB: "native-test" },
});
try {
  const DB = await mf.getD1Database("DB");
  for (const name of [
    "0000_public_outlaw_kid.sql",
    "0001_fair_wolfsbane.sql",
    "0002_jobs.sql",
    "0003_query_indexes.sql",
  ]) {
    for (const statement of readFileSync(
      new URL("../drizzle/" + name, import.meta.url),
      "utf8",
    )
      .split("--> statement-breakpoint")
      .filter((s) => s.trim()))
      await DB.prepare(statement).run();
  }
  const snapshot = fixture();
  let batch = [];
  for (const statement of statements(snapshot)) {
    batch.push(DB.prepare(statement));
    if (batch.length === 40) {
      await DB.batch(batch);
      batch = [];
    }
  }
  if (batch.length) await DB.batch(batch);
  // D1 batch is atomic. Each statement is separated explicitly for this API.
  await DB.batch(
    activationSql(snapshot)
      .split(";")
      .filter((s) => s.trim())
      .map((s) => DB.prepare(s)),
  );
  const engine = await JobQuery.open(DB),
    scope = await engine.scope(
      {},
      undefined,
      "SELECT DISTINCT id FROM job_search WHERE city IN (?, ?)",
      ["深圳", "杭州"],
    );
  const summary = await engine.summary(scope);
  assert.equal(summary.records, 40);
  assert.equal(summary.salaryN, 30);
  assert.equal(summary.p50, 5450);
  const response = await researchRequest(
    req("query", {
      dataset: "test-v1",
      sql: "SELECT DISTINCT id FROM job_search WHERE city = ?",
      params: ["深圳"],
    }),
    { DB },
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.results[0].summary.records, 21);
  const cookie = response.headers.get("set-cookie").split(";")[0];
  const page = await researchRequest(
    req(
      "page",
      {
        dataset: "test-v1",
        turn: result.turn,
        ref: "R1",
        cursor: result.results[0].cursor,
      },
      cookie,
    ),
    { DB },
  );
  assert.equal(page.status, 200);
  assert.equal((await page.json()).jobs.length, 8);
  const unsafe = await researchRequest(
    req("query", {
      dataset: "test-v1",
      sql: "SELECT DISTINCT id FROM research_turns",
      params: [],
    }),
    { DB },
  );
  assert.equal(unsafe.status, 422);
  console.log(
    "PASS: native workerd/D1 migrations, import activation, window percentiles, SQL guard, API and session pagination.",
  );
} finally {
  await mf.dispose();
}
