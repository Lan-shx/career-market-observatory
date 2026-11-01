import {
  defaults,
  dimensions,
  chinaToday,
  DOMAIN_VERSION,
} from "./job-domain.mjs";
import {
  parseSql,
  predicateSql,
  predicateDimensions,
  SQL_COLUMNS,
} from "./sql-guard.mjs";

export const problem = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const clone = (x) => JSON.parse(JSON.stringify(x));
const all = async (db, sql, params = []) => {
  const r = await db
    .prepare(sql)
    .bind(...params)
    .all();
  return r.results;
};
const marks = (a) => a.map(() => "?").join(",");
const date = (s) =>
  typeof s === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s;
const salaryKeys = [
  "salaryLow",
  "salaryHigh",
  "salaryOnly",
  "salaryMode",
  "nlSalaryStrict",
];
const dateKeys = ["dateField", "dateFrom", "dateTo", "keepUnknownDate"];
export function validateFilters(patch) {
  if (
    !patch ||
    typeof patch !== "object" ||
    Array.isArray(patch) ||
    Object.keys(patch).length > 45
  )
    throw problem("筛选条件格式无效。");
  const out = {};
  for (const [k, v] of Object.entries(patch)) {
    if (Object.hasOwn(dimensions, k)) {
      if (
        !Array.isArray(v) ||
        v.length > 20 ||
        v.some((x) => typeof x !== "string" || !x || x.length > 150)
      )
        throw problem("筛选选项格式无效：" + k);
      out[k] = [...new Set(v)];
    } else if (["query", "company", "major"].includes(k)) {
      if (typeof v !== "string" || v.length > 150)
        throw problem("筛选文本过长。");
      out[k] = v;
    } else if (["salaryLow", "salaryHigh"].includes(k)) {
      if (v !== "" && (!Number.isFinite(v) || v < 0 || v > 10000000))
        throw problem("薪资必须为非负数。");
      out[k] = v;
    } else if (
      [
        "salaryOnly",
        "entryOnly",
        "includeUnknownCity",
        "keepUnknownDate",
        "majorRequired",
        "nlIntern",
        "nlGraduate",
        "nlExperienceUnlimited",
      ].includes(k)
    ) {
      if (typeof v !== "boolean") throw problem("筛选开关格式无效。");
      out[k] = v;
    } else if (["dateFrom", "dateTo"].includes(k)) {
      if (v !== "" && !date(v)) throw problem("日期无效。");
      out[k] = v;
    } else if (k === "nlExclude") {
      if (
        !v ||
        typeof v !== "object" ||
        Array.isArray(v) ||
        Object.keys(v).some((key) => !Object.hasOwn(dimensions, key))
      )
        throw problem("排除条件无效。");
      out[k] = validateFilters(v);
    } else if (k === "nlExperience") {
      if (
        v !== null &&
        (!v ||
          Object.keys(v).some((x) => !["low", "high"].includes(x)) ||
          !Number.isFinite(v.low) ||
          !Number.isFinite(v.high) ||
          v.low < 0 ||
          v.high > 60 ||
          v.low > v.high)
      )
        throw problem("经验范围无效。");
      out[k] = v;
    } else {
      const enums = {
        country: ["中国"],
        salaryMode: ["overlap", "contained", "midpoint"],
        skillMode: ["any", "all"],
        dateField: ["updatedAt", "publishedAt"],
        jobStatus: ["all", "current", "expired"],
        nlSalaryStrict: ["", "lower", "upper"],
      };
      if (!Object.hasOwn(enums, k) || !enums[k].includes(v))
        throw problem("不支持的筛选条件：" + k);
      out[k] = v;
    }
  }
  return out;
}
function clearDimensions(filters, keys) {
  const f = clone(filters),
    d = defaults();
  for (const k of keys) {
    const group = k === "salary" ? salaryKeys : k === "date" ? dateKeys : [k];
    for (const x of group)
      if (Object.hasOwn(d, x)) f[x] = d[x];
      else delete f[x];
    if (k === "occupations") f.major = "";
    if (k === "salaryLow" && f.nlSalaryStrict === "lower")
      delete f.nlSalaryStrict;
    if (k === "salaryHigh" && f.nlSalaryStrict === "upper")
      delete f.nlSalaryStrict;
    if (f.nlExclude) for (const x of group) delete f.nlExclude[x];
  }
  return f;
}
export class JobQuery {
  constructor(db, dataset) {
    this.db = db;
    this.dataset = dataset;
    this.taxonomy = JSON.parse(dataset.taxonomy_json);
    this.cache = new Map();
  }
  static async open(db) {
    if (!db) throw problem("岗位数据库尚未连接。", 503);
    let row;
    try {
      row = await db
        .prepare(
          "SELECT d.* FROM active_dataset a JOIN datasets d ON d.id=a.dataset_id WHERE a.singleton=1",
        )
        .first();
      await db.prepare("SELECT id FROM research_turns LIMIT 1").first();
      await db.prepare("SELECT id FROM job_search LIMIT 1").first();
    } catch {
      throw problem("岗位数据库尚未迁移或初始化。", 503);
    }
    if (!row || row.domain_version !== DOMAIN_VERSION)
      throw problem("岗位数据尚未导入或版本不兼容。", 503);
    return new JobQuery(db, row);
  }
  metadata() {
    return {
      id: this.dataset.id,
      rowCount: this.dataset.row_count,
      collectedAt: this.dataset.collected_at,
      dateFrom: this.dataset.date_from,
      dateTo: this.dataset.date_to,
      domainVersion: DOMAIN_VERSION,
    };
  }
  async catalog(key, search = "") {
    if (typeof search !== "string" || search.length > 100)
      throw problem("搜索词过长。");
    if (!this.cache.has(key)) {
      let options;
      if (key === "occupations")
        options = this.taxonomy.occupations.map((o) => ({
          value: o.id,
          label: o.name,
        }));
      else if (key === "majors")
        options = this.taxonomy.majors.map((m) => ({
          value: m.id || m.name,
          label: m.name,
        }));
      else if (Object.hasOwn(dimensions, key)) {
        const col = dimensions[key];
        const sql =
          key === "cities"
            ? "SELECT city value FROM job_cities WHERE dataset_id=? UNION SELECT city_group value FROM job_cities WHERE dataset_id=?"
            : key === "skills"
              ? "SELECT DISTINCT skill value FROM job_skills WHERE dataset_id=?"
              : `SELECT DISTINCT ${col} value FROM jobs WHERE dataset_id=?`;
        options = (
          await all(
            this.db,
            sql,
            key === "cities"
              ? [this.dataset.id, this.dataset.id]
              : [this.dataset.id],
          )
        ).map((o) => ({ value: o.value, label: o.value }));
      } else throw problem("不支持的筛选维度。");
      this.cache.set(
        key,
        options.sort((a, b) => a.label.localeCompare(b.label, "zh")),
      );
    }
    const found = this.cache
      .get(key)
      .filter((o) =>
        (o.label + " " + o.value).toLowerCase().includes(search.toLowerCase()),
      );
    return {
      dimension: key,
      options: found.slice(0, 30),
      totalMatches: found.length,
      truncated: found.length > 30,
    };
  }
  async scope(
    patch = {},
    base = { filters: defaults(), predicates: [] },
    sql,
    params,
  ) {
    patch = validateFilters(patch);
    const incoming = sql === undefined ? [] : parseSql(sql, params);
    if (incoming.length && Object.keys(patch).length)
      throw problem("SQL与筛选覆盖不能同时提交。");
    const changed = new Set(incoming.flatMap(predicateDimensions));
    for (const k of Object.keys(patch))
      changed.add(
        k === "salaryMode" ? "salary" : dateKeys.includes(k) ? "date" : k,
      );
    if (patch.major) changed.add("occupations");
    let filters = { ...clearDimensions(base.filters, changed), ...patch };
    // Filter patches preserve unrelated controls within the same dimension.
    if (sql === undefined) filters = { ...base.filters, ...patch };
    if (Object.hasOwn(patch, "occupations") && !Object.hasOwn(patch, "major"))
      filters.major = "";
    if (filters.major) {
      const major = this.taxonomy.majors.find(
        (m) => (m.id || m.name) === filters.major,
      );
      if (!major) throw problem("专业选项无效。");
      if (patch.major && !Object.hasOwn(patch, "occupations"))
        filters.occupations = [...major.occs];
      if (
        filters.occupations.length &&
        filters.occupations.some((id) => !major.occs.includes(id))
      )
        throw problem("职业不在所选专业映射中。");
      if (!filters.occupations.length) filters.occupations = [...major.occs];
    }
    for (const [k, vs] of [
      ...Object.entries(filters),
      ...Object.entries(filters.nlExclude || {}),
    ])
      if (Object.hasOwn(dimensions, k) && vs.length) {
        await this.catalog(k);
        const known = new Set(this.cache.get(k).map((o) => o.value));
        if (vs.some((v) => !known.has(v)))
          throw problem("未知筛选选项，请先查catalog：" + k);
      }
    if (
      filters.salaryLow !== "" &&
      filters.salaryHigh !== "" &&
      filters.salaryLow > filters.salaryHigh
    )
      throw problem("月薪下限高于上限。");
    if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo)
      throw problem("开始日期晚于结束日期。");
    const predicates = [
      ...(base.predicates || []).filter(
        (p) =>
          !predicateDimensions(p).some(
            (d) =>
              changed.has(d) ||
              (d.startsWith("salary") && changed.has("salary")),
          ),
      ),
      ...incoming,
    ];
    if (predicates.length > 12)
      throw problem("累计SQL条件过多，请开始新研究。");
    return { filters, predicates };
  }
  where(scope, today = chinaToday()) {
    const f = scope.filters,
      clauses = ["j.dataset_id=?", "j.mainland=1"],
      params = [this.dataset.id];
    const add = (sql, ...values) => {
      clauses.push(sql);
      params.push(...values);
    };
    if (!f.includeUnknownCity) add("j.city_known=1");
    const exists = (table, col, values, negative = false) =>
      add(
        `${negative ? "NOT " : ""}EXISTS (SELECT 1 FROM ${table} v WHERE v.dataset_id=j.dataset_id AND v.job_id=j.id AND ${col} IN (${marks(values)}))`,
        ...values,
      );
    for (const [k, col] of Object.entries(dimensions)) {
      const a = f[k] || [];
      if (!a.length) continue;
      if (k === "cities")
        add(
          `EXISTS (SELECT 1 FROM job_cities v WHERE v.dataset_id=j.dataset_id AND v.job_id=j.id AND (v.city IN (${marks(a)}) OR v.city_group IN (${marks(a)})))`,
          ...a,
          ...a,
        );
      else if (k === "skills") {
        if (f.skillMode === "all")
          for (const v of a) exists("job_skills", "v.skill", [v]);
        else exists("job_skills", "v.skill", a);
      } else add(`j.${col} IN (${marks(a)})`, ...a);
    }
    if (f.query) add("instr(j.search_text,?)>0", f.query.trim().toLowerCase());
    if (f.company) add("instr(lower(j.company),?)>0", f.company.toLowerCase());
    if (
      f.salaryOnly ||
      f.salaryLow !== "" ||
      f.salaryHigh !== "" ||
      f.nlSalaryStrict
    )
      add("j.salary_valid=1");
    const lo =
      f.salaryMode === "contained"
        ? "salary_min"
        : f.salaryMode === "midpoint"
          ? "salary_midpoint"
          : "salary_max";
    const hi =
      f.salaryMode === "contained"
        ? "salary_max"
        : f.salaryMode === "midpoint"
          ? "salary_midpoint"
          : "salary_min";
    if (f.salaryLow !== "") add(`j.${lo}>=?`, f.salaryLow);
    if (f.salaryHigh !== "") add(`j.${hi}<=?`, f.salaryHigh);
    if (f.nlSalaryStrict === "lower")
      add("j.salary_min>?", Number(f.salaryLow));
    if (f.nlSalaryStrict === "upper")
      add("j.salary_max<?", Number(f.salaryHigh));
    if (f.dateFrom || f.dateTo) {
      const c = f.dateField === "publishedAt" ? "published_at" : "updated_at",
        parts = [],
        vs = [];
      if (f.dateFrom) {
        parts.push(`j.${c}>=?`);
        vs.push(f.dateFrom);
      }
      if (f.dateTo) {
        parts.push(`j.${c}<=?`);
        vs.push(f.dateTo);
      }
      add(
        "(" +
          parts.join(" AND ") +
          (f.keepUnknownDate ? ` OR j.${c} IS NULL` : "") +
          ")",
        ...vs,
      );
    }
    if (f.jobStatus === "expired")
      add("j.expires_at IS NOT NULL AND j.expires_at<?", today);
    if (f.jobStatus === "current")
      add("(j.expires_at IS NULL OR j.expires_at>=?)", today);
    for (const [k, col] of Object.entries({
      majorRequired: "major_required",
      entryOnly: "entry_only",
      nlIntern: "intern",
      nlGraduate: "graduate",
      nlExperienceUnlimited: "experience_unlimited",
    }))
      if (f[k]) add(`j.${col}=1`);
    if (f.nlExperience)
      add(
        "j.experience_min BETWEEN ? AND ?",
        f.nlExperience.low,
        f.nlExperience.high,
      );
    for (const [k, vs] of Object.entries(f.nlExclude || {}))
      if (vs.length) {
        if (k === "cities")
          add(
            `NOT EXISTS (SELECT 1 FROM job_cities v WHERE v.dataset_id=j.dataset_id AND v.job_id=j.id AND (v.city IN (${marks(vs)}) OR v.city_group IN (${marks(vs)})))`,
            ...vs,
            ...vs,
          );
        else if (k === "skills") exists("job_skills", "v.skill", vs, true);
        else add(`j.${dimensions[k]} NOT IN (${marks(vs)})`, ...vs);
      }
    if (scope.predicates?.length) {
      const p = predicateSql(scope.predicates);
      add(`j.id IN (${p.sql})`, this.dataset.id, ...p.params);
    }
    if (params.length > 90)
      throw problem("查询条件过多，请缩小筛选范围。", 422);
    return { sql: clauses.map((s) => "(" + s + ")").join(" AND "), params };
  }
  async page(scope, after = -1, limit = 8, today = chinaToday()) {
    if (
      !Number.isInteger(after) ||
      after < -1 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 8
    )
      throw problem("分页参数无效。");
    const w = this.where(scope, today);
    const rows = await all(
      this.db,
      `SELECT j.raw_json,j.ordinal FROM jobs j WHERE ${w.sql} AND j.ordinal>? ORDER BY j.ordinal LIMIT ?`,
      [...w.params, after, limit + 1],
    );
    const more = rows.length > limit,
      items = rows.slice(0, limit);
    return {
      jobs: items.map(({ raw_json }) => this.record(JSON.parse(raw_json))),
      cursor: more ? items.at(-1).ordinal : null,
    };
  }
  async scopedEvidence(scopes, ids) {
    const found = new Map();
    for (const result of scopes) {
      if (result.kind !== "query" || !result.scope) continue;
      const missing = ids.filter((id) => !found.has(id));
      if (!missing.length) break;
      const w = this.where(result.scope, result.today);
      const rows = await all(
        this.db,
        `SELECT j.raw_json FROM jobs j WHERE ${w.sql} AND j.id IN (${marks(missing)})`,
        [...w.params, ...missing],
      );
      for (const row of rows) {
        const job = this.record(JSON.parse(row.raw_json));
        found.set(job.id, job);
      }
    }
    return found;
  }
  record(r) {
    let url = "#";
    try {
      const u = new URL(r.url || r.sourceUrl);
      if (["http:", "https:"].includes(u.protocol)) url = u.href;
    } catch {}
    return {
      id: r.id,
      title: r.title.slice(0, 150),
      company: r.company.slice(0, 120),
      cities: r.workCities || [],
      salary: r.salaryText || "未披露",
      salaryMin: r.salaryMin,
      salaryMax: r.salaryMax,
      experience: r.experience,
      education: r.education,
      source: r.source,
      updatedAt: r.updatedAt || null,
      url,
      description: (r.description || "").slice(0, 500),
    };
  }
  async summary(scope, today = chinaToday()) {
    const w = this.where(scope, today),
      cte = `WITH matched AS (SELECT j.dataset_id,j.id,j.salary_valid,j.salary_midpoint,j.company,j.education_level,j.exp_group FROM jobs j WHERE ${w.sql}) `;
    const totals = await this.db
      .prepare(
        cte +
          "SELECT count(*) records,coalesce(sum(salary_valid),0) salaryN,count(DISTINCT CASE WHEN company<>'' AND company<>'未披露' THEN company END) companies FROM matched",
      )
      .bind(...w.params)
      .first();
    const sorted = await all(
      this.db,
      cte +
        `, ordered AS (SELECT salary_midpoint x,row_number() OVER (ORDER BY salary_midpoint) rn,count(*) OVER () n FROM matched WHERE salary_valid=1) SELECT x,rn,n FROM ordered WHERE rn IN (CAST((n-1)*0.25 AS INTEGER)+1,CAST((n-1)*0.25 AS INTEGER)+2,CAST((n-1)*0.5 AS INTEGER)+1,CAST((n-1)*0.5 AS INTEGER)+2,CAST((n-1)*0.75 AS INTEGER)+1,CAST((n-1)*0.75 AS INTEGER)+2)`,
      w.params,
    );
    const q = (p) => {
      if (totals.salaryN < 10) return null;
      const pos = (totals.salaryN - 1) * p,
        i = Math.floor(pos),
        a = sorted.find((r) => r.rn === i + 1)?.x,
        b = sorted.find((r) => r.rn === Math.ceil(pos) + 1)?.x;
      return a + (b - a) * (pos - i);
    };
    const distribution = async (col) =>
      all(
        this.db,
        cte +
          `SELECT ${col} name,count(*) n FROM matched GROUP BY ${col} ORDER BY n DESC,name LIMIT 6`,
        w.params,
      );
    const skills = await all(
      this.db,
      cte +
        `SELECT s.skill name,count(*) n FROM job_skills s JOIN matched m ON s.dataset_id=m.dataset_id AND s.job_id=m.id GROUP BY s.skill ORDER BY n DESC,name LIMIT 6`,
      w.params,
    );
    return {
      ...totals,
      p25: q(0.25),
      p50: q(0.5),
      p75: q(0.75),
      note:
        totals.salaryN < 10
          ? "有效月薪少于10条，薪资统计留空"
          : totals.salaryN < 30
            ? "薪资小样本，仅供探索"
            : "月薪区间中点分位数，非实际到手薪资",
      skills,
      education: await distribution("education_level"),
      experience: await distribution("exp_group"),
    };
  }
  async query(scope, limit = 5, today = chinaToday()) {
    return {
      kind: "query",
      label: "岗位查询",
      scope,
      filters: scope.filters,
      conditions: this.conditions(scope),
      summary: await this.summary(scope, today),
      ...(await this.page(scope, -1, limit, today)),
      sampleOrder: "来源顺序，非推荐排名",
      dataset: this.dataset.id,
      today,
      provenance: {
        source: "历史公开招聘样本",
        from: this.dataset.date_from,
        to: this.dataset.date_to,
      },
    };
  }
  conditions(scope) {
    const labels = {
      cities: "城市",
      occupations: "职业方向",
      industries: "行业",
      sources: "来源",
      experiences: "经验",
      educations: "学历",
      skills: "技能",
      scales: "企业规模",
      properties: "企业性质",
      hiringTypes: "工作性质",
      hiringChannels: "招聘渠道",
      query: "关键词",
      company: "企业",
      major: "专业",
      salaryLow: "月薪下限",
      salaryHigh: "月薪上限",
      salaryOnly: "仅完整月薪",
      entryOnly: "明确应届或实习",
      majorRequired: "企业明示专业",
      dateFrom: "开始日期",
      dateTo: "结束日期",
      jobStatus: "截止状态",
      includeUnknownCity: "包含城市未明确",
      nlIntern: "实习",
      nlGraduate: "应届或校招",
      nlExperienceUnlimited: "经验不限",
    };
    const name = (key, v) =>
      key === "occupations"
        ? this.taxonomy.occupations.find((o) => o.id === v)?.name || v
        : v;
    const parts = [];
    for (const [key, label] of Object.entries(labels)) {
      const v = scope.filters[key];
      if (
        JSON.stringify(v) === JSON.stringify(defaults()[key]) ||
        v === undefined ||
        v === null
      )
        continue;
      parts.push(
        label +
          "：" +
          (Array.isArray(v)
            ? v.map((x) => name(key, x)).join("、")
            : typeof v === "boolean"
              ? "是"
              : v),
      );
    }
    if (scope.filters.nlExclude)
      for (const [k, vs] of Object.entries(scope.filters.nlExclude))
        if (vs.length)
          parts.push(
            "排除" + labels[k] + "：" + vs.map((v) => name(k, v)).join("、"),
          );
    if (scope.filters.nlExperience)
      parts.push(
        "最低经验：" +
          scope.filters.nlExperience.low +
          "–" +
          scope.filters.nlExperience.high +
          "年",
      );
    for (const p of scope.predicates || []) {
      const key = SQL_COLUMNS[p.column],
        label =
          {
            salary_min: "月薪下限",
            salary_max: "月薪上限",
            salary_midpoint: "月薪中点",
            published_at: "发布日期",
            updated_at: "更新日期",
            title: "岗位名称",
          }[p.column] || labels[key];
      parts.push(
        label +
          " " +
          ({
            "=": "为",
            IN: "包含",
            LIKE: "匹配",
            "IS NULL": "未披露",
            "IS NOT NULL": "已披露",
          }[p.op] || p.op) +
          " " +
          p.values.map((v) => name(key, v)).join("、"),
      );
    }
    if (scope.filters.salaryLow !== "" || scope.filters.salaryHigh !== "")
      parts.push(
        "薪资匹配：" +
          { overlap: "区间重叠", contained: "完整区间", midpoint: "区间中点" }[
            scope.filters.salaryMode
          ],
      );
    if (scope.filters.nlSalaryStrict)
      parts.push(
        "严格边界：" +
          (scope.filters.nlSalaryStrict === "lower"
            ? "月薪下限严格高于"
            : "月薪上限严格低于") +
          (scope.filters.nlSalaryStrict === "lower"
            ? scope.filters.salaryLow
            : scope.filters.salaryHigh),
      );
    if (scope.filters.skills?.length)
      parts.push(
        "技能匹配：" +
          (scope.filters.skillMode === "all" ? "全部所选技能" : "任一所选技能"),
      );
    if (scope.filters.dateFrom || scope.filters.dateTo)
      parts.push(
        (scope.filters.dateField === "publishedAt"
          ? "按发布日期"
          : "按更新日期") +
          "；" +
          (scope.filters.keepUnknownDate ? "保留日期未披露" : "排除日期未披露"),
      );
    return [...parts, "仅中国大陆历史记录"].join(" · ");
  }
}
