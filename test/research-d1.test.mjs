import { test } from "node:test";
import assert from "node:assert/strict";
import { researchRequest } from "../lib/research-server.mjs";
import { database, req, insert } from "./helpers.mjs";

const start = {
  question: "上海岗位",
  dataset: "test-v1",
  context: { filters: {} },
};
const call = (name, args, id = "call-1") => ({
  id,
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});
test("model SQL executes inside server, returns trusted cards and inherited scope", async () => {
  const { sqlite, DB } = database();
  try {
    let round = 0;
    const mock = async (url, init) => {
      const b = JSON.parse(init.body);
      assert.ok(!JSON.stringify(b).includes("not-a-real-key"));
      if (round++ === 0) {
        assert.ok(b.tools.some((t) => t.function.name === "sql_query"));
        return Response.json({
          choices: [
            {
              message: {
                tool_calls: [
                  call("sql_query", {
                    sql: "SELECT DISTINCT id FROM job_search WHERE city = ?",
                    params: ["深圳"],
                  }),
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        });
      }
      const tool = JSON.parse(
        b.messages.at(-1).content,
      ).untrusted_database_result;
      assert.equal(tool.summary.records, 21);
      return Response.json({
        choices: [
          {
            message: { content: "深圳观察到21条记录。[R1]" },
            finish_reason: "stop",
          },
        ],
      });
    };
    const response = await researchRequest(
      req("start", start),
      { DB, DEEPSEEK_API_KEY: "not-a-real-key" },
      mock,
    );
    assert.equal(response.status, 200);
    const a = await response.json(),
      cookie = response.headers.get("set-cookie").split(";")[0];
    assert.equal(a.status, "done");
    assert.equal(a.results[0].summary.records, 21);
    assert.equal(a.results[0].ref, "R1");
    const page = await researchRequest(
      req(
        "page",
        {
          dataset: "test-v1",
          turn: a.turn,
          ref: "R1",
          cursor: a.results[0].cursor,
        },
        cookie,
      ),
      { DB },
    );
    assert.equal(page.status, 200);
    assert.equal((await page.json()).jobs.length, 8);
    const foreign = await researchRequest(
      req("page", { dataset: "test-v1", turn: a.turn, ref: "R1", cursor: 4 }),
      { DB },
    );
    assert.equal(foreign.status, 409);
    let second = 0;
    const follow = async (url, init) => {
      const b = JSON.parse(init.body);
      if (second++ === 0)
        return Response.json({
          choices: [
            {
              message: {
                tool_calls: [
                  call("sql_query", {
                    sql: "SELECT DISTINCT id FROM job_search WHERE city = ?",
                    params: ["杭州"],
                  }),
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        });
      assert.equal(
        JSON.parse(b.messages.at(-1).content).untrusted_database_result.summary
          .records,
        20,
      );
      return Response.json({
        choices: [
          { message: { content: "杭州20条。[R2]" }, finish_reason: "stop" },
        ],
      });
    };
    const r = await researchRequest(
      req(
        "start",
        { ...start, question: "换成杭州", previous: a.turn },
        cookie,
      ),
      { DB, DEEPSEEK_API_KEY: "key" },
      follow,
    );
    assert.equal(r.status, 200);
    assert.equal((await r.json()).results[0].ref, "R2");
    assert.ok(
      !sqlite
        .prepare("SELECT group_concat(payload) p FROM research_turns")
        .get()
        .p.includes("not-a-real-key"),
    );
  } finally {
    sqlite.close();
  }
});
test("reject forged results, unsafe SQL, cross origin, stale data and expired turns", async () => {
  const { sqlite, DB } = database();
  try {
    const env = { DB };
    assert.equal(
      (
        await researchRequest(
          req("query", { dataset: "wrong", filters: {} }),
          env,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await researchRequest(
          req(
            "query",
            { dataset: "test-v1", filters: {} },
            "",
            "https://evil.test",
          ),
          env,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await researchRequest(
          req("query", {
            dataset: "test-v1",
            sql: "DROP TABLE jobs",
            params: [],
          }),
          env,
        )
      ).status,
      422,
    );
    assert.equal(
      (
        await researchRequest(
          req("start", { ...start, results: [{ summary: { records: 999 } }] }),
          { DB, DEEPSEEK_API_KEY: "key" },
        )
      ).status,
      400,
    );
    assert.equal(
      (await researchRequest(req("continue", { turn: "x", results: [] }), env))
        .status,
      404,
    );
    sqlite.exec(
      insert("research_turns", {
        id: "old",
        sid: "12345678-1234-1234-1234-123456789012",
        payload: "{}",
        status: "done",
        expires: 0,
      }),
    );
    assert.equal(
      (
        await researchRequest(
          req(
            "page",
            { dataset: "test-v1", turn: "old", ref: "R1", cursor: 0 },
            "research_sid=12345678-1234-1234-1234-123456789012",
          ),
          env,
        )
      ).status,
      409,
    );
    assert.equal(sqlite.prepare("SELECT count(*) n FROM jobs").get().n, 40);
    const status = await researchRequest(
      new Request("https://example.test/api/research/status"),
      env,
    );
    assert.equal((await status.json()).dataReady, true);
  } finally {
    sqlite.close();
  }
});
test("malformed or rejected tools can be corrected; call budget and failure leave no successful turn", async () => {
  const { sqlite, DB } = database();
  try {
    let calls = 0;
    const mock = async (url, init) => {
      const b = JSON.parse(init.body);
      if (calls++ === 0)
        return Response.json({
          choices: [
            {
              message: {
                tool_calls: [
                  call("sql_query", {
                    sql: "DELETE FROM research_turns",
                    params: [],
                  }),
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        });
      assert.ok(
        JSON.parse(b.messages.at(-1).content).untrusted_database_result.error,
      );
      return Response.json({
        choices: [
          { message: { content: "暂未执行查询。" }, finish_reason: "stop" },
        ],
      });
    };
    assert.equal(
      (
        await researchRequest(
          req("start", start),
          { DB, DEEPSEEK_API_KEY: "key" },
          mock,
        )
      ).status,
      200,
    );
    const looping = async () =>
      Response.json({
        choices: [
          {
            message: {
              tool_calls: Array.from({ length: 7 }, (_, i) =>
                call("catalog", { dimension: "cities" }, "c" + i),
              ),
            },
            finish_reason: "tool_calls",
          },
        ],
      });
    assert.equal(
      (
        await researchRequest(
          req("start", start),
          { DB, DEEPSEEK_API_KEY: "key" },
          looping,
        )
      ).status,
      422,
    );
    assert.ok(
      sqlite
        .prepare(
          "SELECT count(*) n FROM research_turns WHERE status='failed' AND payload='{}'",
        )
        .get().n > 0,
    );
  } finally {
    sqlite.close();
  }
});

test("same-round tools use a frozen scope; compare returns independent groups", async () => {
  const { sqlite, DB } = database();
  try {
    let round = 0;
    const mock = async (url, init) => {
      const body = JSON.parse(init.body);
      if (round++ === 0)
        return Response.json({
          choices: [
            {
              message: {
                tool_calls: [
                  call("query", { filters: { occupations: ["1"] } }, "one"),
                  call("query", { filters: { cities: ["杭州"] } }, "two"),
                  call(
                    "compare",
                    {
                      filters: {},
                      dimension: "cities",
                      values: ["深圳", "杭州"],
                    },
                    "three",
                  ),
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        });
      const tools = body.messages
        .filter((m) => m.role === "tool")
        .map((m) => JSON.parse(m.content).untrusted_database_result);
      assert.equal(tools[0].summary.records, 20);
      assert.equal(tools[1].summary.records, 20);
      assert.deepEqual(
        tools[2].groups.map((g) => g.summary.records),
        [21, 20],
      );
      return Response.json({
        choices: [
          {
            message: { content: "各组独立统计。[R1][R2][R3]" },
            finish_reason: "stop",
          },
        ],
      });
    };
    const response = await researchRequest(
      req("start", start),
      { DB, DEEPSEEK_API_KEY: "test-key" },
      mock,
    );
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.results.length, 3);
    assert.deepEqual(result.effectiveScope.filters.cities, ["深圳", "杭州"]);
  } finally {
    sqlite.close();
  }
});

test("provider failures stay redacted and invented evidence references are rejected", async () => {
  const { sqlite, DB } = database();
  try {
    const env = { DB, DEEPSEEK_API_KEY: "private-key-never-output" };
    const failed = await researchRequest(
      req("start", start),
      env,
      async () =>
        new Response("private-key-never-output upstream details", {
          status: 500,
        }),
    );
    assert.equal(failed.status, 502);
    assert.ok(!(await failed.text()).includes("private-key"));
    const invented = await researchRequest(req("start", start), env, async () =>
      Response.json({
        choices: [
          { message: { content: "结论来自[R999]。" }, finish_reason: "stop" },
        ],
      }),
    );
    assert.equal(invented.status, 502);
    assert.match((await invented.json()).error, /依据/);
  } finally {
    sqlite.close();
  }
});
