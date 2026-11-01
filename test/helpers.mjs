import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { normalizeJob } from "../lib/job-domain.mjs";
import {
  insertSql,
  statements,
  activationSql,
} from "../scripts/import-jobs.mjs";

export const taxonomy = {
  occupations: [
    { id: "0", name: "数据分析师" },
    { id: "1", name: "财务会计" },
  ],
  majors: [{ name: "统计学", occs: ["0"] }],
  tracks: [],
};
export function fixture() {
  const raw = Array.from({ length: 40 }, (_, i) => ({
    id: "job-" + i,
    title: i % 3 ? "数据分析" : "校招数据实习",
    company: "公司" + (i % 5),
    country: "中国",
    location: "深圳",
    occupation: i % 2 ? "0" : "1",
    category: "数据分析师",
    industry: "互联网",
    source: "公开来源",
    experience: i % 2 ? "1-3年" : "经验不限",
    education: "大学专科",
    employmentType: "全职",
    hiringType: "全职",
    hiringChannel: "未披露",
    scale: "未披露",
    property: "未披露",
    majorRequirements: "未披露",
    salaryMin: i < 30 ? 3000 + i * 100 : null,
    salaryMax: i < 30 ? 5000 + i * 100 : null,
    salaryText: "薪资原文",
    publishedAt: i % 3 ? "2026-10-01" : null,
    updatedAt: i % 4 ? "2026-10-02" : null,
    expiresAt: i % 5 ? "2027-01-01" : null,
    description: "SQL 数据分析",
    skills: i % 2 ? ["SQL", "Python"] : ["SQL"],
    workCities: i === 0 ? ["深圳", "杭州"] : i % 2 ? ["深圳"] : ["杭州"],
    cityGroups: i === 0 ? ["深圳", "杭州"] : i % 2 ? ["深圳"] : ["杭州"],
    relatedMajors: ["统计学"],
    url: "https://example.test/job/" + i,
  }));
  const rows = raw.map((r, i) =>
    normalizeJob(r, i, { majorCities: ["深圳", "杭州"] }),
  );
  const dataset = {
    id: "test-v1",
    domain_version: 1,
    manifest_sha256: "test-hash",
    row_count: 40,
    salary_count: 30,
    collected_at: "2026-10-07",
    date_from: "2025-10-07",
    date_to: "2026-10-07",
    taxonomy_json: JSON.stringify(taxonomy),
    manifest_json: "{}",
  };
  return { raw, rows, dataset };
}
export function binding(sqlite) {
  return {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async first() {
              return sqlite.prepare(sql).get(...params) || null;
            },
            async all() {
              return { results: sqlite.prepare(sql).all(...params) };
            },
            async run() {
              return {
                success: true,
                meta: sqlite.prepare(sql).run(...params),
              };
            },
          };
        },
        async first() {
          return sqlite.prepare(sql).get() || null;
        },
      };
    },
  };
}
export function database() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of [
    "0000_public_outlaw_kid.sql",
    "0001_fair_wolfsbane.sql",
    "0002_jobs.sql",
    "0003_query_indexes.sql",
  ])
    sqlite.exec(
      readFileSync(new URL("../drizzle/" + file, import.meta.url), "utf8"),
    );
  const snapshot = fixture();
  for (const statement of statements(snapshot)) sqlite.exec(statement);
  sqlite.exec(activationSql(snapshot));
  return { sqlite, DB: binding(sqlite), snapshot };
}
export const req = (
  action,
  body,
  cookie = "",
  origin = "https://example.test",
) =>
  new Request("https://example.test/api/research/" + action, {
    method: "POST",
    headers: { origin, "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
export const insert = insertSql;
