import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSql } from "../lib/sql-guard.mjs";

test("parse full allowlisted SELECT grammar; all values are parameters", () => {
  assert.equal(
    parseSql(
      "select DISTINCT id from job_search WHERE city IN (?, ?) AND salary_min >= ?",
      ["深圳", "杭州", 3000],
    ).length,
    2,
  );
  assert.equal(
    parseSql("SELECT DISTINCT id FROM job_search WHERE updated_at IS NOT NULL")
      .length,
    1,
  );
  assert.equal(parseSql("SELECT DISTINCT id FROM job_search").length, 0);
  assert.equal(
    parseSql("SELECT DISTINCT id FROM job_search WHERE company LIKE ?", [
      "%x' OR 1=1 --%",
    ]).length,
    1,
  );
});
test("reject writes, hidden schema, functions, comments, stacked SQL, literals and unbounded grammar", () => {
  for (const sql of [
    "DELETE FROM jobs",
    "SELECT * FROM research_turns",
    "SELECT DISTINCT id FROM sqlite_master",
    "SELECT DISTINCT id FROM job_search; DROP TABLE jobs",
    "SELECT DISTINCT id FROM job_search -- hi",
    "SELECT DISTINCT id FROM job_search WHERE city = '深圳'",
    "SELECT DISTINCT id FROM job_search WHERE city = ? OR 1=1",
    "WITH RECURSIVE x AS (SELECT 1) SELECT DISTINCT id FROM job_search",
    "SELECT DISTINCT id FROM job_search WHERE randomblob(?) = ?",
    "SELECT DISTINCT id FROM job_search LIMIT 1",
    "SELECT DISTINCT id FROM job_search WHERE city <> ?",
    "SELECT DISTINCT id FROM job_search WHERE dataset_id = ?",
    "SELECT DISTINCT id FROM job_search WHERE salary_min LIKE ?",
    "SELECT DISTINCT id FROM job_search WHERE id IN (SELECT id FROM jobs)",
  ])
    assert.throws(() => parseSql(sql, ["深圳"]), sql);
  assert.throws(() =>
    parseSql("SELECT DISTINCT id FROM job_search WHERE city = ?", []),
  );
  assert.throws(() =>
    parseSql("SELECT DISTINCT id FROM job_search WHERE salary_min > ?", ["0"]),
  );
  assert.throws(() => parseSql("SELECT DISTINCT id FROM job_search", [1]));
});
