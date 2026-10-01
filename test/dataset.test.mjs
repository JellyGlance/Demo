import test from "node:test";
import assert from "node:assert/strict";
import { buildDataset } from "../src/dataset.mjs";

test("the dataset is deterministic", () => {
  const a = buildDataset("x");
  const b = buildDataset("x");
  assert.deepEqual(a.items.map((i) => i.Id), b.items.map((i) => i.Id));
  assert.deepEqual(a.users.map((u) => u.Id), b.users.map((u) => u.Id));
});

test("episodes point at real seasons and series", () => {
  const { items, byId } = buildDataset();
  for (const episode of items.filter((i) => i.Type === "Episode")) {
    assert.equal(byId.get(episode.SeasonId)?.Type, "Season");
    assert.equal(byId.get(episode.SeriesId)?.Type, "Series");
  }
});
