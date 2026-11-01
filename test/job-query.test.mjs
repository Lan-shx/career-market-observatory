import { test } from "node:test";
import assert from "node:assert/strict";
import { JobQuery, validateFilters } from "../lib/job-query.mjs";
import { defaults, quantiles } from "../lib/job-domain.mjs";
import { database } from "./helpers.mjs";

test("server statistics, city union and percentiles agree with reference rows", async () => {
  const { sqlite, DB, snapshot } = database();
  try {
    const e = await JobQuery.open(DB),
      scope = await e.scope({}),
      s = await e.summary(scope);
    assert.equal(s.records, 40);
    assert.equal(s.salaryN, 30);
    assert.equal(s.companies, 5);
    assert.deepEqual(
      [s.p25, s.p50, s.p75],
      quantiles(snapshot.rows.map((r) => r.salary_midpoint)),
    );
    const city = await e.scope({ cities: ["深圳", "杭州"] });
    assert.equal((await e.summary(city)).records, 40);
    assert.equal(
      (
        await e.summary(
          await e.scope(
            {},
            scope,
            "SELECT DISTINCT id FROM job_search WHERE city IN (?, ?)",
            ["深圳", "杭州"],
          ),
        )
      ).records,
      40,
    );
    assert.equal(
      (await e.summary(await e.scope({ nlExclude: { cities: ["深圳"] } })))
        .records,
      19,
    );
    assert.equal(
      (
        await e.summary(
          await e.scope({ skills: ["SQL", "Python"], skillMode: "all" }),
        )
      ).records,
      20,
    );
    assert.equal(
      (await e.summary(await e.scope({ query: "' OR 1=1 --" }))).records,
      0,
    );
    assert.equal(
      (
        await e.summary(
          await e.scope({ dateFrom: "2026-10-01", keepUnknownDate: true }),
        )
      ).records,
      40,
    );
    assert.equal(
      (
        await e.summary(
          await e.scope({ dateFrom: "2026-10-01", keepUnknownDate: false }),
        )
      ).records,
      30,
    );
    const small = await e.summary(
      await e.scope(
        {},
        scope,
        "SELECT DISTINCT id FROM job_search WHERE salary_min < ?",
        [3500],
      ),
    );
    assert.equal(small.salaryN, 5);
    assert.equal(small.p50, null);
    const page = await e.page(scope);
    assert.equal(page.jobs.length, 8);
    assert.equal(page.cursor, 7);
    const next = await e.page(scope, page.cursor);
    assert.equal(next.jobs[0].id, "job-8");
  } finally {
    sqlite.close();
  }
});
test("dimension replacement preserves other SQL predicates, clears requested filters", async () => {
  const { sqlite, DB } = database();
  try {
    const e = await JobQuery.open(DB),
      base = await e.scope({ cities: ["深圳"], occupations: ["0"] });
    const a = await e.scope(
      {},
      base,
      "SELECT DISTINCT id FROM job_search WHERE city = ?",
      ["杭州"],
    );
    assert.deepEqual(a.filters.cities, []);
    assert.deepEqual(a.filters.occupations, ["0"]);
    const b = await e.scope(
      {},
      a,
      "SELECT DISTINCT id FROM job_search WHERE city = ?",
      ["深圳"],
    );
    assert.equal(b.predicates.length, 1);
    assert.equal(b.predicates[0].values[0], "深圳");
    const c = await e.scope({ cities: [] }, b);
    assert.equal(c.predicates.length, 0);
    await assert.rejects(() => e.scope({ cities: ["不存在"] }));
    await assert.rejects(() => e.scope({ salaryLow: 9000, salaryHigh: 1000 }));
    assert.throws(() => validateFilters({ sql: "DROP TABLE jobs" }));
    assert.throws(() => validateFilters({ dateFrom: "2026-02-30" }));
    assert.throws(() => validateFilters(JSON.parse('{"__proto__":{}}')));
  } finally {
    sqlite.close();
  }
});
