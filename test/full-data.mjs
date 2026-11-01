import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";
import { JobQuery } from "../lib/job-query.mjs";
import { binding } from "./helpers.mjs";
import { defaults, quantiles, chinaToday } from "../lib/job-domain.mjs";

const read = (name) =>
  readFileSync(new URL("../" + name, import.meta.url), "utf8");
const sqlite = new DatabaseSync(
  new URL("../.textsql/jobs.sqlite", import.meta.url).pathname.replace(
    /^\/([A-Za-z]:)/,
    "$1",
  ),
);
const engine = await JobQuery.open(binding(sqlite));
const raw = sqlite
  .prepare("SELECT raw_json FROM jobs ORDER BY ordinal")
  .all()
  .map((r) => JSON.parse(r.raw_json));
const bundle = JSON.parse(read("public/jobs.json"));
const context = vm.createContext({
  localStorage: {
    getItem() {
      return null;
    },
  },
  console,
  Date,
  setTimeout,
  clearTimeout,
});
vm.runInContext(read("public/app.js").split("function groups(")[0], context);
vm.runInContext(
  read("public/business.js").split("groups=function")[0],
  context,
);
vm.runInContext(
  read("public/city-filters.js").split("const cityGroupsBase")[0],
  context,
);
// Include every wrapper that changes the shared predicate, in script order.
const decision = read("public/decision.js");
vm.runInContext(
  decision.split("\n").find((l) => l.startsWith("const decisionMatchesBase=")),
  context,
);
vm.runInContext(
  decision.split("\n").find((l) => l.startsWith("function isEntry(")),
  context,
);
vm.runInContext(
  read("public/explorer.js")
    .split("\n")
    .find((l) => l.startsWith("const scopeMatches=")),
  context,
);
const nl = read("public/query-workbench.js");
vm.runInContext(
  nl.slice(
    nl.indexOf("const originalMatches=matches;"),
    nl.indexOf("// The legacy form"),
  ),
  context,
);
context.inputRows = raw;
context.inputBundle = bundle;
vm.runInContext("rows=inputRows;bundle=inputBundle;prepRows();", context);
const cases = [
  {},
  { cities: ["深圳"] },
  { cities: ["杭州", "深圳"], occupations: ["0", "1"] },
  { cities: ["其他大陆城市"] },
  { educations: ["大专"] },
  { experiences: ["应届 / 经验不限"] },
  { skills: ["SQL", "Python"], skillMode: "all" },
  { salaryLow: 5000, salaryHigh: 10000, salaryMode: "contained" },
  { salaryLow: 8000, salaryMode: "overlap" },
  { salaryHigh: 10000, salaryMode: "midpoint" },
  { query: "数据分析" },
  { company: "腾讯" },
  { dateFrom: "2026-09-01", dateTo: "2026-10-07", keepUnknownDate: true },
  { dateFrom: "2026-09-01", keepUnknownDate: false, dateField: "publishedAt" },
  { includeUnknownCity: true },
  { entryOnly: true },
  { jobStatus: "expired" },
  { jobStatus: "current" },
  { majorRequired: true },
  { nlIntern: true },
  { nlGraduate: true },
  { nlExperienceUnlimited: true },
  { nlExperience: { low: 1, high: 3 } },
  { nlExclude: { cities: ["深圳"], skills: ["Python"] } },
  { salaryLow: 5000, salaryMode: "contained", nlSalaryStrict: "lower" },
];
const report = [];
for (const patch of cases) {
  const f = { ...defaults(), ...patch };
  context.f = f;
  const expected = vm.runInContext(
    "rows.filter(r=>matches(r,f)).map(r=>r.id)",
    context,
  );
  const scope = await engine.scope(patch),
    w = engine.where(scope, chinaToday());
  const actual = sqlite
    .prepare(`SELECT j.id FROM jobs j WHERE ${w.sql} ORDER BY j.ordinal`)
    .all(...w.params)
    .map((r) => r.id);
  assert.deepEqual(
    actual,
    Array.from(expected),
    "Filter parity: " + JSON.stringify(patch),
  );
  const started = performance.now(),
    summary = await engine.summary(scope),
    elapsedMs = Math.round(performance.now() - started);
  const ids = new Set(actual),
    salaries = raw
      .filter(
        (r) =>
          ids.has(r.id) &&
          Number.isFinite(r.salaryMin) &&
          Number.isFinite(r.salaryMax) &&
          r.salaryMin >= 0 &&
          r.salaryMax >= r.salaryMin,
      )
      .map((r) => (r.salaryMin + r.salaryMax) / 2);
  assert.equal(summary.salaryN, salaries.length);
  assert.deepEqual(
    [summary.p25, summary.p50, summary.p75],
    quantiles(salaries),
  );
  report.push({
    filters: patch,
    records: actual.length,
    salaryN: summary.salaryN,
    p50: summary.p50,
    elapsedMs,
  });
  console.log("PASS", JSON.stringify(report.at(-1)));
}
assert.equal(raw.length, 69465);
assert.equal(
  sqlite.prepare("SELECT count(*) n FROM jobs WHERE salary_valid=1").get().n,
  54415,
);
writeFileSync(
  new URL("../.textsql/parity-report.json", import.meta.url),
  JSON.stringify({ dataset: engine.dataset.id, cases: report }, null, 2),
);
sqlite.close();
console.log(
  "PASS: full 69,465-row snapshot, 25 browser/SQL parity cases and exact salary quantiles.",
);
