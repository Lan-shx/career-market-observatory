import { test } from "node:test";
import assert from "node:assert/strict";
import { jobImport } from "../lib/job-import.mjs";
import { database, fixture } from "./helpers.mjs";

test("maintenance import requires a secret, stages complete data, and only then activates", async () => {
  const { sqlite, DB } = database();
  DB.batch = async (statements) => {
    sqlite.exec("BEGIN");
    try {
      const result = [];
      for (const statement of statements) result.push(await statement.run());
      sqlite.exec("COMMIT");
      return result;
    } catch (e) {
      sqlite.exec("ROLLBACK");
      throw e;
    }
  };
  try {
    const snap = fixture(),
      hash = "a".repeat(64),
      id = hash + "-40-v1";
    const header = {
      rowCount: 40,
      sampling: { poolSha256: hash, sampleCount: 40 },
      geography: { majorCities: ["深圳", "杭州"] },
      importExpected: {
        job_cities: snap.rows.reduce((n, r) => n + r.cities.length, 0),
        job_skills: snap.rows.reduce((n, r) => n + r.skills.length, 0),
        job_related_majors: snap.rows.reduce(
          (n, r) => n + r.relatedMajors.length,
          0,
        ),
      },
    };
    const metadata = {
      ...snap.dataset,
      id,
      manifest_sha256: "b".repeat(64),
      manifest_json: JSON.stringify(header),
    };
    const request = (body, token = "test-maintenance-secret") =>
      new Request("https://example.test/api/research/import", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer " + token,
        },
        body: JSON.stringify(body),
      });
    const env = { DB, JOBS_IMPORT_TOKEN: "test-maintenance-secret" };
    assert.equal(
      (await jobImport(request({ action: "init", metadata }), { DB })).status,
      404,
    );
    assert.equal(
      (await jobImport(request({ action: "init", metadata }, "wrong"), env))
        .status,
      403,
    );
    assert.equal(
      (await jobImport(request({ action: "init", metadata }), env)).status,
      200,
    );
    assert.equal(
      (await jobImport(request({ action: "activate", dataset: id }), env))
        .status,
      409,
    );
    assert.equal(
      sqlite.prepare("SELECT dataset_id FROM active_dataset").get().dataset_id,
      "test-v1",
    );
    for (let i = 0; i < 40; i += 16) {
      const r = await jobImport(
        request({
          action: "batch",
          dataset: id,
          offset: i,
          records: snap.raw.slice(i, i + 16),
        }),
        env,
      );
      assert.equal(r.status, 200, await r.text());
    }
    const conflicting = structuredClone(snap.raw[0]);
    conflicting.skills.push("UnexpectedSkill");
    assert.equal(
      (
        await jobImport(
          request({
            action: "batch",
            dataset: id,
            offset: 0,
            records: [conflicting],
          }),
          env,
        )
      ).status,
      409,
    );
    assert.equal(
      sqlite
        .prepare(
          "SELECT count(*) n FROM job_skills WHERE skill='UnexpectedSkill'",
        )
        .get().n,
      0,
    );
    const status = await jobImport(
      request({ action: "status", dataset: id }),
      env,
    );
    assert.equal((await status.json()).complete, true);
    const activation = await jobImport(
      request({ action: "activate", dataset: id }),
      env,
    );
    assert.equal(activation.status, 200);
    assert.equal(
      sqlite.prepare("SELECT dataset_id FROM active_dataset").get().dataset_id,
      id,
    );
    assert.equal(
      (
        await jobImport(
          request({
            action: "batch",
            dataset: id,
            offset: 0,
            records: [conflicting],
          }),
          env,
        )
      ).status,
      409,
    );
    assert.equal(
      sqlite
        .prepare(
          "SELECT count(*) n FROM job_skills WHERE skill='UnexpectedSkill'",
        )
        .get().n,
      0,
    );
    assert.equal(
      (await jobImport(request({ action: "sql", sql: "DROP TABLE jobs" }), env))
        .status,
      400,
    );
    assert.equal(
      (
        await jobImport(
          request({
            action: "batch",
            dataset: id,
            offset: 40,
            records: [snap.raw[0]],
          }),
          env,
        )
      ).status,
      400,
    );
    const duplicate = await jobImport(
      request({
        action: "batch",
        dataset: id,
        offset: 0,
        records: [snap.raw[0], snap.raw[0]],
      }),
      env,
    );
    assert.equal(duplicate.status, 400);
  } finally {
    sqlite.close();
  }
});
