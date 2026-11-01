import { test } from "node:test";
import assert from "node:assert/strict";
import { database, fixture } from "./helpers.mjs";
import { statements, activationSql } from "../scripts/import-jobs.mjs";

test("reimport is idempotent and incomplete versions cannot replace the active snapshot", () => {
  const { sqlite, snapshot } = database();
  try {
    for (const sql of statements(snapshot)) sqlite.exec(sql);
    sqlite.exec(activationSql(snapshot));
    assert.equal(sqlite.prepare("SELECT count(*) n FROM jobs").get().n, 40);
    const conflicting = {
      ...snapshot,
      dataset: { ...snapshot.dataset, manifest_sha256: "changed" },
    };
    assert.throws(() => {
      for (const sql of statements(conflicting)) sqlite.exec(sql);
    });
    assert.equal(sqlite.prepare("SELECT count(*) n FROM jobs").get().n, 40);
    const next = fixture();
    next.dataset.id = "incomplete";
    next.rows = next.rows.slice(0, 1);
    for (const sql of statements(next)) sqlite.exec(sql);
    assert.throws(() =>
      sqlite.exec(activationSql({ ...next, rows: snapshot.rows })),
    );
    assert.equal(
      sqlite.prepare("SELECT dataset_id FROM active_dataset").get().dataset_id,
      "test-v1",
    );
  } finally {
    sqlite.close();
  }
});
