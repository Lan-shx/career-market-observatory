import { test } from "node:test";
import assert from "node:assert/strict";
import { JobQuery } from "../lib/job-query.mjs";
import { researchRequest } from "../lib/research-server.mjs";
import { database, req } from "./helpers.mjs";

test("salary follow-ups retain the unmodified boundary in SQL and filter scopes", async () => {
  const { sqlite, DB } = database();
  try {
    const e = await JobQuery.open(DB);
    const initial = await e.scope(
      {},
      undefined,
      "SELECT DISTINCT id FROM job_search WHERE salary_min >= ? AND salary_max <= ?",
      [3000, 5500],
    );
    assert.equal((await e.summary(initial)).records, 6);
    const lower = await e.scope(
      {},
      initial,
      "SELECT DISTINCT id FROM job_search WHERE salary_min >= ?",
      [4000],
    );
    assert.equal(lower.predicates.length, 2);
    assert.equal((await e.summary(lower)).records, 0);
    const upper = await e.scope(
      {},
      lower,
      "SELECT DISTINCT id FROM job_search WHERE salary_max <= ?",
      [6500],
    );
    assert.equal((await e.summary(upper)).records, 6);
    const mixed = await e.scope(
      {},
      await e.scope({ salaryHigh: 6000, salaryMode: "contained" }),
      "SELECT DISTINCT id FROM job_search WHERE salary_min >= ?",
      [3500],
    );
    assert.equal(mixed.filters.salaryHigh, 6000);
    assert.equal((await e.summary(mixed)).records, 6);
    const midpoint = await e.scope(
      {},
      undefined,
      "SELECT DISTINCT id FROM job_search WHERE salary_midpoint >= ? AND salary_midpoint <= ?",
      [4500, 5000],
    );
    const midpointLower = await e.scope(
      {},
      midpoint,
      "SELECT DISTINCT id FROM job_search WHERE salary_midpoint >= ?",
      [4800],
    );
    assert.equal((await e.summary(midpointLower)).records, 3);
  } finally {
    sqlite.close();
  }
});

test("a new major replaces inherited occupations and occupation SQL predicates", async () => {
  const { sqlite, DB } = database();
  try {
    const e = await JobQuery.open(DB);
    const f = await e.scope(
      { major: "统计学" },
      await e.scope({ occupations: ["1"] }),
    );
    assert.deepEqual(f.filters.occupations, ["0"]);
    const s = await e.scope(
      { major: "统计学" },
      await e.scope(
        {},
        undefined,
        "SELECT DISTINCT id FROM job_search WHERE occupation = ?",
        ["1"],
      ),
    );
    assert.equal(s.predicates.length, 0);
    assert.equal((await e.summary(s)).records, 20);
    await assert.rejects(() =>
      e.scope({ major: "统计学", occupations: ["1"] }),
    );
  } finally {
    sqlite.close();
  }
});

test("condition descriptions distinguish strict salary and skill matching semantics", async () => {
  const { sqlite, DB } = database();
  try {
    const e = await JobQuery.open(DB);
    const a = e.conditions(
      await e.scope({ salaryLow: 5000, salaryMode: "contained" }),
    );
    const b = e.conditions(
      await e.scope({
        salaryLow: 5000,
        salaryMode: "contained",
        nlSalaryStrict: "lower",
      }),
    );
    assert.notEqual(a, b);
    assert.match(b, /严格高于/);
    const any = e.conditions(
      await e.scope({ skills: ["SQL", "Python"], skillMode: "any" }),
    );
    const every = e.conditions(
      await e.scope({ skills: ["SQL", "Python"], skillMode: "all" }),
    );
    assert.notEqual(any, every);
    assert.match(every, /全部所选技能/);
  } finally {
    sqlite.close();
  }
});

test("evidence can read a paged job while rejecting IDs outside previous query scopes", async () => {
  const { sqlite, DB } = database();
  try {
    const env = { DB, DEEPSEEK_API_KEY: "test-only" };
    let step = 0;
    const call = (name, args) => ({
      id: "tool",
      type: "function",
      function: { name, arguments: JSON.stringify(args) },
    });
    const mock = async () =>
      Response.json({
        choices: [
          {
            message:
              step++ === 0
                ? {
                    tool_calls: [
                      call("query", { filters: { occupations: ["0"] } }),
                    ],
                  }
                : { content: "查询完成。[R1]" },
            finish_reason: "stop",
          },
        ],
      });
    const first = await researchRequest(
      req("start", {
        question: "查岗位",
        dataset: "test-v1",
        context: { filters: {} },
      }),
      env,
      mock,
    );
    const data = await first.json(),
      cookie = first.headers.get("set-cookie").split(";")[0];
    const page = await researchRequest(
      req(
        "page",
        {
          turn: data.turn,
          ref: "R1",
          cursor: data.results[0].cursor,
          dataset: "test-v1",
        },
        cookie,
      ),
      env,
    );
    const paged = (await page.json()).jobs[0].id;
    let second = 0;
    const follow = async (url, init) => {
      if (second++ === 0)
        return Response.json({
          choices: [
            {
              message: { tool_calls: [call("evidence", { ids: [paged] })] },
              finish_reason: "tool_calls",
            },
          ],
        });
      const body = JSON.parse(init.body),
        result = JSON.parse(
          body.messages.at(-1).content,
        ).untrusted_database_result;
      assert.equal(result.jobs[0].id, paged);
      return Response.json({
        choices: [
          { message: { content: "分页依据。[R2]" }, finish_reason: "stop" },
        ],
      });
    };
    const response = await researchRequest(
      req(
        "start",
        { question: "看分页依据", previous: data.turn, dataset: "test-v1" },
        cookie,
      ),
      env,
      follow,
    );
    assert.equal(response.status, 200);
    const engine = await JobQuery.open(DB),
      scope = await engine.scope({ occupations: ["0"] });
    assert.equal(
      (await engine.scopedEvidence([{ kind: "query", scope }], ["job-0"])).size,
      0,
    );
  } finally {
    sqlite.close();
  }
});
