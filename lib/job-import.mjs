// Maintenance-only ingestion for managed D1 installations without CLI access.
// Disabled unless the owner explicitly configures a short-lived secret.
import { normalizeJob, DOMAIN_VERSION } from "./job-domain.mjs";
import { problem } from "./job-query.mjs";
const json = (body, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
const cols = (a) => a.map(() => "?").join(",");
const hash = async (s) =>
  new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
  );
export async function jobImport(request, env) {
  try {
    if (!env.JOBS_IMPORT_TOKEN) return json({ error: "维护导入未启用。" }, 404);
    if (request.method !== "POST")
      return json({ error: "需要POST请求。" }, 405);
    const supplied =
      request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
    const a = await hash(supplied),
      b = await hash(env.JOBS_IMPORT_TOKEN);
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    if (diff) return json({ error: "维护授权无效。" }, 403);
    if (
      !(request.headers.get("content-type") || "").startsWith(
        "application/json",
      )
    )
      throw problem("需要JSON请求。", 415);
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 600000)
      throw problem("导入批次过大。", 413);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw problem("无效JSON。");
    }
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      !["init", "batch", "status", "activate"].includes(body.action)
    )
      throw problem("导入操作无效。");
    const db = env.DB;
    if (!db) throw problem("数据库未连接。", 503);
    if (body.action === "init") {
      const d = body.metadata;
      const required = [
        "id",
        "domain_version",
        "manifest_sha256",
        "row_count",
        "salary_count",
        "collected_at",
        "date_from",
        "date_to",
        "taxonomy_json",
        "manifest_json",
      ];
      if (
        !d ||
        Object.keys(d).length !== required.length ||
        required.some((k) => !Object.hasOwn(d, k))
      )
        throw problem("导入元数据无效。");
      if (
        d.domain_version !== DOMAIN_VERSION ||
        !Number.isInteger(d.row_count) ||
        d.row_count < 1 ||
        d.row_count > 1000000 ||
        !Number.isInteger(d.salary_count) ||
        d.salary_count < 0 ||
        d.salary_count > d.row_count ||
        !/^[a-f0-9]{64}$/.test(d.manifest_sha256)
      )
        throw problem("数据版本无效。");
      const manifest = JSON.parse(d.manifest_json),
        taxonomy = JSON.parse(d.taxonomy_json);
      if (
        d.id !==
          `${manifest.sampling?.poolSha256}-${d.row_count}-v${DOMAIN_VERSION}` ||
        !/^[a-f0-9]{64}-\d+-v\d+$/.test(d.id) ||
        manifest.rowCount !== d.row_count ||
        manifest.sampling?.sampleCount !== d.row_count ||
        !Array.isArray(taxonomy.occupations) ||
        !manifest.geography
      )
        throw problem("清单与版本不匹配。");
      for (const field of ["collected_at", "date_from", "date_to"])
        if (
          typeof d[field] !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(d[field])
        )
          throw problem("元数据日期无效。");
      const expected = manifest.importExpected;
      if (
        !expected ||
        ["job_cities", "job_skills", "job_related_majors"].some(
          (k) =>
            !Number.isInteger(expected[k]) ||
            expected[k] < 0 ||
            expected[k] > 50000000,
        )
      )
        throw problem("缺少关系表预期条数。");
      const old = await db
        .prepare(
          "SELECT manifest_sha256,manifest_json FROM datasets WHERE id=?",
        )
        .bind(d.id)
        .first();
      if (
        old &&
        (old.manifest_sha256 !== d.manifest_sha256 ||
          old.manifest_json !== d.manifest_json)
      )
        throw problem("已有不可变版本与本次导入冲突。", 409);
      await db
        .prepare(
          `INSERT OR IGNORE INTO datasets (${required.join(",")}) VALUES (${cols(required)})`,
        )
        .bind(...required.map((k) => d[k]))
        .run();
      return json({ dataset: d.id, ready: true });
    }
    if (
      typeof body.dataset !== "string" ||
      !/^[a-f0-9]{64}-\d+-v\d+$/.test(body.dataset)
    )
      throw problem("数据版本无效。");
    const d = await db
      .prepare("SELECT * FROM datasets WHERE id=?")
      .bind(body.dataset)
      .first();
    if (!d || d.domain_version !== DOMAIN_VERSION)
      throw problem("请先初始化数据版本。", 409);
    const manifest = JSON.parse(d.manifest_json);
    if (body.action === "batch") {
      if (
        !Array.isArray(body.records) ||
        !body.records.length ||
        body.records.length > 32 ||
        !Number.isInteger(body.offset) ||
        body.offset < 0 ||
        body.offset + body.records.length > d.row_count
      )
        throw problem("批次范围无效。");
      const ids = new Set(),
        jobs = [],
        cities = [],
        skills = [],
        majors = [];
      for (let i = 0; i < body.records.length; i++) {
        const raw = body.records[i];
        if (
          !raw ||
          typeof raw.id !== "string" ||
          !raw.id ||
          raw.id.length > 150 ||
          ids.has(raw.id)
        )
          throw problem("重复或无效岗位ID。");
        ids.add(raw.id);
        for (const field of [
          "title",
          "company",
          "country",
          "location",
          "occupation",
          "source",
          "education",
          "experience",
          "description",
        ])
          if (typeof raw[field] !== "string")
            throw problem("岗位文本字段无效。");
        for (const field of [
          "skills",
          "workCities",
          "cityGroups",
          "relatedMajors",
        ])
          if (
            !Array.isArray(raw[field]) ||
            raw[field].length > 100 ||
            raw[field].some((v) => typeof v !== "string" || v.length > 150)
          )
            throw problem("岗位多值字段无效。");
        for (const field of ["salaryMin", "salaryMax"])
          if (raw[field] !== null && !Number.isFinite(raw[field]))
            throw problem("薪资字段无效。");
        const {
          cities: cs,
          skills: ss,
          relatedMajors: ms,
          ...job
        } = normalizeJob(raw, body.offset + i, manifest.geography);
        jobs.push({ dataset_id: d.id, ...job });
        for (const c of cs)
          cities.push({ dataset_id: d.id, job_id: job.id, ...c });
        for (const skill of ss)
          skills.push({ dataset_id: d.id, job_id: job.id, skill });
        for (const major of ms)
          majors.push({ dataset_id: d.id, job_id: job.id, major });
      }
      const statements = [
        db
          .prepare(
            "UPDATE datasets SET domain_version=NULL WHERE id=? AND EXISTS(SELECT 1 FROM active_dataset WHERE dataset_id=?)",
          )
          .bind(d.id, d.id),
      ];
      for (const [table, rows] of [
        ["jobs", jobs],
        ["job_cities", cities],
        ["job_skills", skills],
        ["job_related_majors", majors],
      ]) {
        if (!rows.length) continue;
        const keys = Object.keys(rows[0]),
          size = Math.floor(90 / keys.length);
        for (let i = 0; i < rows.length; i += size) {
          const part = rows.slice(i, i + size);
          const conflict =
            table === "jobs"
              ? " ON CONFLICT(dataset_id,id) DO UPDATE SET ordinal=CASE WHEN jobs.raw_json=excluded.raw_json AND jobs.ordinal=excluded.ordinal THEN jobs.ordinal ELSE NULL END"
              : "";
          statements.push(
            db
              .prepare(
                `INSERT ${table === "jobs" ? "" : "OR IGNORE "}INTO ${table} (${keys.join(",")}) VALUES ${part.map(() => `(${cols(keys)})`).join(",")}${conflict}`,
              )
              .bind(...part.flatMap((r) => keys.map((k) => r[k]))),
          );
        }
      }
      if (statements.length > 44) throw problem("导入批次过大，请拆分。", 413);
      try {
        await db.batch(statements);
      } catch (e) {
        if (/constraint|SQLITE_CONSTRAINT/i.test(e.message))
          throw problem("目标版本已激活，或重放数据与不可变版本冲突。", 409);
        throw e;
      }
      return json({
        dataset: d.id,
        offset: body.offset,
        count: body.records.length,
      });
    }
    const expected = manifest.importExpected;
    if (!expected) throw problem("缺少导入完整性元数据。", 409);
    const stats = await db
      .prepare(
        "SELECT (SELECT count(*) FROM jobs WHERE dataset_id=?) jobs,(SELECT coalesce(sum(salary_valid),0) FROM jobs WHERE dataset_id=?) salary,(SELECT count(*) FROM job_cities WHERE dataset_id=?) cities,(SELECT count(*) FROM job_skills WHERE dataset_id=?) skills,(SELECT count(*) FROM job_related_majors WHERE dataset_id=?) majors",
      )
      .bind(d.id, d.id, d.id, d.id, d.id)
      .first();
    const complete =
      stats.jobs === d.row_count &&
      stats.salary === d.salary_count &&
      stats.cities === expected.job_cities &&
      stats.skills === expected.job_skills &&
      stats.majors === expected.job_related_majors;
    if (body.action === "status")
      return json({ dataset: d.id, stats, complete });
    if (!complete) throw problem("导入不完整，不能切换活动数据。", 409);
    // One statement checks completeness again while switching the pointer.
    const result = await db
      .prepare(
        "INSERT INTO active_dataset(singleton,dataset_id) SELECT 1,? WHERE (SELECT count(*) FROM jobs WHERE dataset_id=?)=? AND (SELECT coalesce(sum(salary_valid),0) FROM jobs WHERE dataset_id=?)=? AND (SELECT count(*) FROM job_cities WHERE dataset_id=?)=? AND (SELECT count(*) FROM job_skills WHERE dataset_id=?)=? AND (SELECT count(*) FROM job_related_majors WHERE dataset_id=?)=? ON CONFLICT(singleton) DO UPDATE SET dataset_id=excluded.dataset_id",
      )
      .bind(
        d.id,
        d.id,
        d.row_count,
        d.id,
        d.salary_count,
        d.id,
        expected.job_cities,
        d.id,
        expected.job_skills,
        d.id,
        expected.job_related_majors,
      )
      .run();
    if (!result.meta?.changes) throw problem("数据完整性校验失败。", 409);
    return json({ dataset: d.id, active: true, stats });
  } catch (e) {
    return json(
      { error: e.status ? e.message : "维护导入失败。" },
      e.status || 500,
    );
  }
}
